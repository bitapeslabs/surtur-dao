/**
 * Browser-extension wallet layer — detection, connect, BIP-322 message
 * signing, and PSBT signing for the wallets Surtur supports natively
 * (the same enabled set as subfrost-app): SUBFROST extension, OYL, OKX,
 * UniSat, Xverse.
 *
 * Policy notes:
 * - Taproot is REQUIRED: alkane balances, votes, and eligibility all key
 *   on the P2TR address. Single-address wallets (UniSat/OKX/SUBFROST ext)
 *   must be switched to Taproot mode; dual-address wallets (Xverse, OYL)
 *   use their ordinals/taproot account as the Surtur identity.
 * - No keystore mode, ever — seed phrases never touch this app.
 * - PSBTs come from the WASM SDK built against a dummy wallet, so before
 *   an extension can sign we patch witnessUtxo scripts + tapInternalKey
 *   to the connected wallet's real key (the SUBFROST passport popup does
 *   the identical patch on its own side).
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { getBitcoinNetwork, type VendorNetwork } from '@/lib/config';

export type ExtensionWalletId = 'subfrost' | 'oyl' | 'okx' | 'unisat' | 'xverse';

export interface ExtensionWalletDef {
  id: ExtensionWalletId;
  name: string;
  website: string;
}

/** Display order mirrors subfrost-app's WALLET_ORDER. */
export const EXTENSION_WALLETS: ExtensionWalletDef[] = [
  { id: 'subfrost', name: 'SUBFROST Extension', website: 'https://chromewebstore.google.com/category/extensions' },
  { id: 'oyl', name: 'OYL Wallet', website: 'https://www.oyl.io/' },
  { id: 'okx', name: 'OKX Wallet', website: 'https://www.okx.com/web3' },
  { id: 'unisat', name: 'UniSat Wallet', website: 'https://unisat.io/download' },
  { id: 'xverse', name: 'Xverse', website: 'https://www.xverse.app/download' },
];

export interface ExtensionAccount {
  address: string;
  publicKey?: string;
  /** Payment (segwit) address for dual-address wallets — unused by Surtur
   *  today but kept for completeness. */
  paymentAddress?: string;
}

function win(): any {
  return typeof window !== 'undefined' ? (window as any) : {};
}

export function isExtensionInstalled(id: ExtensionWalletId): boolean {
  const w = win();
  switch (id) {
    case 'subfrost':
      return typeof w.subfrost === 'object' && w.subfrost !== null &&
        typeof w.subfrost.requestAccounts === 'function';
    case 'oyl':
      return w.oyl != null;
    case 'okx':
      return w.okxwallet?.bitcoin != null;
    case 'unisat':
      return w.unisat != null;
    case 'xverse':
      return w.XverseProviders?.BitcoinProvider != null;
  }
}

export function getInstalledExtensions(): ExtensionWalletDef[] {
  return EXTENSION_WALLETS.filter((wdef) => isExtensionInstalled(wdef.id));
}

function isTaprootAddress(address: string): boolean {
  return (
    address.startsWith('bc1p') || address.startsWith('tb1p') || address.startsWith('bcrt1p')
  );
}

function requireTaproot(address: string, walletName: string): void {
  if (!isTaprootAddress(address)) {
    throw new Error(
      `${walletName} is not in Taproot mode. Alkane balances and votes live at ` +
        `P2TR addresses — switch the wallet's address type to Taproot and reconnect.`,
    );
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Connect
// ---------------------------------------------------------------------------

export async function connectExtension(id: ExtensionWalletId): Promise<ExtensionAccount> {
  const w = win();
  switch (id) {
    case 'unisat': {
      const provider = w.unisat;
      if (!provider) throw new Error('UniSat not detected.');
      const accounts: string[] = await withTimeout(
        provider.requestAccounts(),
        30_000,
        'UniSat connection',
      );
      if (!accounts?.length) throw new Error('No accounts returned from UniSat.');
      requireTaproot(accounts[0], 'UniSat');
      let publicKey: string | undefined;
      try {
        publicKey = await provider.getPublicKey();
      } catch {
        /* optional */
      }
      return { address: accounts[0], publicKey };
    }

    case 'okx': {
      const provider = w.okxwallet?.bitcoin;
      if (!provider) throw new Error('OKX wallet not detected.');
      const result = await withTimeout<any>(provider.connect(), 15_000, 'OKX connection');
      const address: string | undefined = result?.address;
      if (!address) throw new Error('No address returned from OKX.');
      requireTaproot(address, 'OKX');
      return { address, publicKey: result?.publicKey };
    }

    case 'xverse': {
      const provider = w.XverseProviders?.BitcoinProvider;
      if (!provider) throw new Error('Xverse not detected.');
      const response: any = await withTimeout(
        provider.request('getAccounts', {
          purposes: ['ordinals', 'payment'],
          message: 'Connect to Surtur',
        }),
        30_000,
        'Xverse connection',
      );
      const accounts: any[] = response?.result || [];
      if (!accounts.length) throw new Error('Xverse returned no accounts.');
      const ordinals =
        accounts.find((a) => a.purpose === 'ordinals' || a.addressType === 'p2tr') ?? accounts[0];
      const payment = accounts.find(
        (a) => a.purpose === 'payment' || a.addressType === 'p2wpkh' || a.addressType === 'p2sh',
      );
      requireTaproot(ordinals.address, 'Xverse (ordinals account)');
      return {
        address: ordinals.address,
        publicKey: ordinals.publicKey,
        paymentAddress: payment?.address,
      };
    }

    case 'oyl': {
      const provider = w.oyl;
      if (!provider) throw new Error('OYL not detected.');
      const raw: any = await withTimeout(provider.getAddresses(), 30_000, 'OYL connection');
      const taproot = raw?.taproot;
      if (!taproot?.address) throw new Error('OYL returned no taproot address.');
      requireTaproot(taproot.address, 'OYL');
      return {
        address: taproot.address,
        publicKey: taproot.publicKey,
        paymentAddress: raw?.nativeSegwit?.address,
      };
    }

    case 'subfrost': {
      const provider = w.subfrost;
      if (!provider) throw new Error('SUBFROST extension not detected.');
      const accounts: string[] = await withTimeout(
        provider.requestAccounts(),
        30_000,
        'SUBFROST connection',
      );
      if (!accounts?.length) throw new Error('No accounts returned from SUBFROST.');
      requireTaproot(accounts[0], 'SUBFROST extension');
      let publicKey: string | undefined;
      try {
        publicKey = await provider.getPublicKey();
      } catch {
        /* optional */
      }
      return { address: accounts[0], publicKey };
    }
  }
}

// ---------------------------------------------------------------------------
// BIP-322 message signing (votes / proposals / resolutions)
// ---------------------------------------------------------------------------

export async function signMessageWithExtension(
  id: ExtensionWalletId,
  address: string,
  message: string,
): Promise<string> {
  const w = win();
  switch (id) {
    case 'unisat':
      return w.unisat.signMessage(message, 'bip322-simple');
    case 'okx':
      return w.okxwallet.bitcoin.signMessage(message, 'bip322-simple');
    case 'xverse': {
      const response = await w.XverseProviders.BitcoinProvider.request('signMessage', {
        address,
        message,
        protocol: 'BIP322',
      });
      const signature = response?.result?.signature;
      if (!signature) throw new Error(response?.error?.message ?? 'Xverse signMessage failed.');
      return signature;
    }
    case 'oyl': {
      const result = await w.oyl.signMessage({ address, message });
      if (!result?.signature) throw new Error('OYL signMessage failed.');
      return result.signature;
    }
    case 'subfrost':
      return w.subfrost.signMessage(message, address);
  }
}

// ---------------------------------------------------------------------------
// PSBT signing (portfolio send)
// ---------------------------------------------------------------------------

let eccReady = false;
function ensureEcc() {
  if (!eccReady) {
    bitcoin.initEccLib(ecc);
    eccReady = true;
  }
}

function isP2TR(script: Uint8Array): boolean {
  return script.length === 34 && script[0] === 0x51 && script[1] === 0x20;
}

/**
 * Patch an SDK-built PSBT for extension signing: witnessUtxo P2TR scripts
 * and tapInternalKey are rewritten from the SDK's dummy wallet to the
 * connected wallet's real key. UniSat auto-detects signable inputs by
 * deriving P2TR from tapInternalKey (mismatch = silent skip), and Xverse
 * hard-validates it. Script-path inputs (tapLeafScript) are left alone.
 */
export function patchPsbtForExtension(
  psbtBase64: string,
  params: { taprootAddress: string; publicKeyHex?: string; network: VendorNetwork },
): { psbtBase64: string; inputCount: number } {
  ensureEcc();
  const btcNetwork = getBitcoinNetwork(params.network);
  const psbt = bitcoin.Psbt.fromBase64(psbtBase64, { network: btcNetwork });
  const taprootScript = bitcoin.address.toOutputScript(params.taprootAddress, btcNetwork);

  let xOnlyKey: Uint8Array | null = null;
  if (params.publicKeyHex) {
    let raw = Buffer.from(params.publicKeyHex, 'hex');
    if (raw.length === 33 && (raw[0] === 0x02 || raw[0] === 0x03)) raw = raw.subarray(1);
    if (raw.length === 32) xOnlyKey = new Uint8Array(raw);
  }

  for (const input of psbt.data.inputs) {
    // Script-path spends must sign against the real prevout script.
    if (input.tapLeafScript?.length) continue;
    if (input.witnessUtxo && isP2TR(input.witnessUtxo.script)) {
      input.witnessUtxo = { ...input.witnessUtxo, script: taprootScript };
    }
    if (input.tapInternalKey && xOnlyKey) {
      input.tapInternalKey = xOnlyKey;
    }
  }
  return { psbtBase64: psbt.toBase64(), inputCount: psbt.data.inputs.length };
}

function base64ToHex(b64: string): string {
  return Buffer.from(b64, 'base64').toString('hex');
}

/** Wallets answer in hex or base64 depending on vendor — normalize. */
function toPsbtBase64(value: string): string {
  const trimmed = value.trim();
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    return Buffer.from(trimmed, 'hex').toString('base64');
  }
  return trimmed;
}

/**
 * Sign a (patched) PSBT with the given extension. Returns the signed PSBT
 * base64 — possibly already finalized (SUBFROST extension self-finalizes);
 * `finalizeAndBroadcast` handles both.
 */
export async function signPsbtWithExtension(
  id: ExtensionWalletId,
  params: {
    psbtBase64: string;
    address: string;
    publicKeyHex?: string;
    network: VendorNetwork;
  },
): Promise<string> {
  const w = win();
  const { psbtBase64: patched, inputCount } = patchPsbtForExtension(params.psbtBase64, {
    taprootAddress: params.address,
    publicKeyHex: params.publicKeyHex,
    network: params.network,
  });
  const patchedHex = base64ToHex(patched);

  switch (id) {
    case 'unisat': {
      const signed = await withTimeout<string>(
        w.unisat.signPsbt(patchedHex, { autoFinalized: false }),
        60_000,
        'UniSat signing',
      );
      return toPsbtBase64(signed);
    }
    case 'okx': {
      const signed = await withTimeout<string>(
        w.okxwallet.bitcoin.signPsbt(patchedHex, { autoFinalized: false }),
        60_000,
        'OKX signing',
      );
      return toPsbtBase64(signed);
    }
    case 'xverse': {
      const response = await withTimeout<any>(
        w.XverseProviders.BitcoinProvider.request('signPsbt', {
          psbt: patched,
          signInputs: {
            [params.address]: Array.from({ length: inputCount }, (_, i) => i),
          },
          broadcast: false,
        }),
        60_000,
        'Xverse signing',
      );
      const signed = response?.result?.psbt;
      if (!signed) throw new Error(response?.error?.message ?? 'Xverse signPsbt failed.');
      return toPsbtBase64(signed);
    }
    case 'oyl': {
      const result = await withTimeout<any>(
        w.oyl.signPsbt({ psbt: patchedHex, finalize: false, broadcast: false }),
        120_000,
        'OYL signing',
      );
      if (!result?.psbt) throw new Error('OYL signPsbt failed.');
      return toPsbtBase64(result.psbt);
    }
    case 'subfrost': {
      // The SUBFROST extension signs AND finalizes.
      const signed = await withTimeout<string>(
        w.subfrost.signPsbt(patchedHex),
        60_000,
        'SUBFROST signing',
      );
      return toPsbtBase64(signed);
    }
  }
}
