/**
 * Unsigned-PSBT builders + finalize/broadcast helpers.
 *
 * BOTH transfer types go through the WASM SDK's `alkanesExecuteWithStrings`
 * with `auto_confirm: false`, mirroring subfrost-app's keystore paths:
 *
 * - BTC transfers (useBtcSendMutation.sendKeystore): inputRequirements
 *   `B:<amount>:v0,B:546:v1` + protostones `v1:v1`, toAddresses
 *   [recipient, sender]. The SDK ALWAYS emits a protostone even on
 *   BTC-only sends — the B:546:v1 output + v1:v1 protostone captures any
 *   alkane edict from spent inputs back into the sender's taproot (costs
 *   ~600 sats, eliminates silent alkane-burn risk).
 * - Alkane transfers (useAlkaneSendMutation / lib/alkanes/builders.ts):
 *   protostone `[b:t:amt:v1]:v0:v0` + inputRequirements `b:t:amt`,
 *   toAddresses [sender-change, recipient].
 *
 * `utxo_source` follows the data-source switch (espo on mainnet — branch
 * morkle-oyl-fix execute.ts default). On espo mode the spendable-outpoint
 * cache is forwarded the way alkanesExecuteTyped forwards `cachedUtxos`:
 * clean carriers as `payment_utxos` (skips the WASM BTC fanout) and the
 * full set as `prefetched_utxos` with alkane assertions (`[]` = asserted
 * clean, skips per-outpoint RPC).
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { getBitcoinNetwork, type VendorNetwork } from './config';
import { broadcastTransaction } from './rpc';
import { getWebProvider } from './provider';
import { getAlkanesDataSource } from './dataSource';
import { fetchSpendableOutpointsViaEspo, type EspoUtxoCache } from './espo';
import { DUST_LIMIT_SATS } from './balances';

let eccReady = false;
function ensureEcc() {
  if (!eccReady) {
    bitcoin.initEccLib(ecc);
    eccReady = true;
  }
}

/**
 * Shared execute → unsigned-PSBT path (subfrost-app's alkanesExecuteTyped
 * PSBT-return branch, reduced to the keystore/single-address case).
 * Also used by lib/swap.ts for factory swaps.
 */
export async function executeToUnsignedPsbt(args: {
  network: VendorNetwork;
  fromAddress: string;
  toAddresses: string[];
  inputRequirements: string;
  protostones: string;
  feeRate: number;
  espoCache?: EspoUtxoCache | null;
}): Promise<string> {
  const { network, fromAddress, toAddresses, inputRequirements, protostones, feeRate, espoCache } =
    args;
  const provider = await getWebProvider(network);
  const dataSource = getAlkanesDataSource(network);

  const options: Record<string, unknown> = {
    from: [fromAddress],
    from_addresses: [fromAddress],
    change_address: fromAddress,
    alkanes_change_address: fromAddress,
    utxo_source: dataSource,
    auto_confirm: false,
    // Keystore semantics: taproot-only wallet, no second address to protect.
    ordinals_strategy: 'burn',
    protect_taproot: false,
  };

  if (dataSource === 'espo') {
    try {
      const cache = espoCache ?? (await fetchSpendableOutpointsViaEspo(network, [fromAddress]));
      const clean = cache.utxos
        .filter((u) => u.alkanes.length === 0 && u.value > DUST_LIMIT_SATS)
        .map((u) => ({ txid: u.txid, vout: u.vout, value: u.value }));
      if (clean.length > 0) {
        options.payment_utxos = clean;
      }
      const prefetched = cache.utxos
        .filter((u) => !!u.scriptPubKeyHex)
        .map((u) => ({
          outpoint: `${u.txid}:${u.vout}`,
          value: u.value,
          script_pubkey_hex: u.scriptPubKeyHex,
          alkanes: u.alkanes.map((a) => ({
            block: a.block,
            tx: a.tx,
            amount: a.amount.toString(),
          })),
        }));
      if (prefetched.length > 0) {
        options.prefetched_utxos = prefetched;
        options.prefetchedUtxos = prefetched;
      }
    } catch (e) {
      // Non-fatal — the SDK falls back to its own espo discovery.
      console.warn('[executeToUnsignedPsbt] espo prefetch failed:', e);
    }
  }

  const result = await provider.alkanesExecuteWithStrings(
    JSON.stringify(toAddresses),
    inputRequirements,
    protostones,
    feeRate,
    null,
    JSON.stringify(options),
  );
  const parsed = typeof result === 'string' ? JSON.parse(result) : result;
  const psbtBase64 = extractPsbtBase64FromExecuteResult(parsed);
  if (!psbtBase64) {
    throw new Error('SDK did not return a signable PSBT');
  }
  return psbtBase64;
}

export interface BuildBtcTransferParams {
  network: VendorNetwork;
  /** Connected SUBFROST taproot address (inputs + change + alkane safety output). */
  fromAddress: string;
  recipientAddress: string;
  amountSats: number;
  feeRate: number;
  /** Optional pre-fetched espo cache (from useBalances) to skip a refetch. */
  espoCache?: EspoUtxoCache | null;
}

/**
 * Build an unsigned BTC transfer PSBT. A protostone is ALWAYS included as
 * the last-line-of-defense against alkane burns, but the 546-sat safety
 * vout is only added when the vins can't be proven alkane-free:
 *
 * - **Clean vins verified (espo)**: the spendable-outpoint cache carries
 *   per-utxo alkane balance sheets; the clean carriers become
 *   `payment_utxos`, so every input is asserted alkane-free. Construction:
 *   `B:<amt>:v0` + bare `v0:v0` protostone — no dust vout.
 *   (Empirically verified 2026-07-05: protostone pointers CANNOT reference
 *   the SDK-appended change output — any `vN` pointer target materializes
 *   as a new dust output at that index, which is exactly what we're
 *   avoiding. With proven-clean vins the pointer is never exercised, so
 *   `v0` is safe; if an alkane ever did slip in it would flow to the
 *   recipient rather than burn.)
 * - **Unverified vins** (metashrew networks / espo fetch failed /
 *   insufficient clean funds): subfrost-app's keystore construction —
 *   v1 = 546-sat safety output to the sender, `B:<amt>:v0,B:546:v1` +
 *   `v1:v1` protostone, capturing any alkane edict from spent inputs.
 */
export async function buildBtcTransferPsbt(params: BuildBtcTransferParams): Promise<string> {
  const { network, fromAddress, recipientAddress, amountSats, feeRate } = params;
  let espoCache = params.espoCache ?? null;

  if (getAlkanesDataSource(network) === 'espo' && !espoCache) {
    try {
      espoCache = await fetchSpendableOutpointsViaEspo(network, [fromAddress]);
    } catch (e) {
      console.warn('[buildBtcTransferPsbt] espo cache fetch failed, using safety vout:', e);
    }
  }

  // Vins are provably clean only when the clean carriers (which become
  // payment_utxos) can fund the send on their own — otherwise the SDK may
  // reach for unasserted UTXOs.
  let cleanVinsVerified = false;
  if (getAlkanesDataSource(network) === 'espo' && espoCache) {
    const cleanTotal = espoCache.utxos
      .filter((u) => u.alkanes.length === 0 && u.value > DUST_LIMIT_SATS)
      .reduce((sum, u) => sum + u.value, 0);
    const feeBudget = Math.max(2_000, feeRate * 300);
    cleanVinsVerified = cleanTotal >= amountSats + feeBudget;
  }

  if (cleanVinsVerified) {
    return executeToUnsignedPsbt({
      network,
      fromAddress,
      toAddresses: [recipientAddress],
      inputRequirements: `B:${amountSats}:v0`,
      protostones: 'v0:v0',
      feeRate,
      espoCache,
    });
  }

  return executeToUnsignedPsbt({
    network,
    fromAddress,
    toAddresses: [recipientAddress, fromAddress],
    inputRequirements: `B:${amountSats}:v0,B:546:v1`,
    protostones: 'v1:v1',
    feeRate,
    espoCache,
  });
}

export interface BuildAlkaneTransferParams {
  network: VendorNetwork;
  /** Connected SUBFROST taproot address (token source, change, fees). */
  fromAddress: string;
  recipientAddress: string;
  /** "block:tx" */
  alkaneId: string;
  /** Amount in base units (8 decimals), stringified integer. */
  amountBaseUnits: string;
  feeRate: number;
  /** Optional pre-fetched espo cache (from useBalances) to skip a refetch. */
  espoCache?: EspoUtxoCache | null;
}

/** Build an unsigned alkane transfer PSBT via the WASM SDK. Returns base64. */
export async function buildAlkaneTransferPsbt(params: BuildAlkaneTransferParams): Promise<string> {
  const { network, fromAddress, recipientAddress, alkaneId, amountBaseUnits, feeRate, espoCache } =
    params;
  const [block, tx] = alkaneId.split(':');
  if (!block || !tx) throw new Error(`Invalid alkane id: ${alkaneId}`);

  // Same strings as subfrost-app lib/alkanes/builders.ts:
  //   protostone: single edict of `amount` to v1 (recipient), change → v0
  //   toAddresses: [v0 = sender change, v1 = recipient]
  return executeToUnsignedPsbt({
    network,
    fromAddress,
    toAddresses: [fromAddress, recipientAddress],
    inputRequirements: `${block}:${tx}:${amountBaseUnits}`,
    protostones: `[${block}:${tx}:${amountBaseUnits}:v1]:v0:v0`,
    feeRate,
    espoCache,
  });
}

/**
 * Finalize a signed PSBT and broadcast it. Returns the txid.
 * (The SUBFROST keystore signs but does not finalize.)
 */
export async function finalizeAndBroadcast(
  network: VendorNetwork,
  signedPsbtBase64: string,
): Promise<string> {
  ensureEcc();
  const btcNetwork = getBitcoinNetwork(network);
  const psbt = bitcoin.Psbt.fromBase64(signedPsbtBase64, { network: btcNetwork });
  let tx: bitcoin.Transaction;
  try {
    tx = psbt.extractTransaction();
  } catch {
    psbt.finalizeAllInputs();
    tx = psbt.extractTransaction();
  }
  return broadcastTransaction(network, tx.toHex());
}

// ---------------------------------------------------------------------------
// SDK result parsing — copied from subfrost-app (lib/alkanes/helpers.ts
// extractPsbtBase64 + execute.ts extractPsbtBase64FromExecuteResult).
// The SDK has shipped base64-string, Uint8Array and numeric-key-object PSBTs.
// ---------------------------------------------------------------------------

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function coercePsbtBase64(psbt: unknown): string {
  if (psbt instanceof Uint8Array) return uint8ArrayToBase64(psbt);
  if (typeof psbt === 'string') return psbt;
  if (typeof psbt === 'object' && psbt !== null) {
    const keys = Object.keys(psbt).map(Number).sort((a, b) => a - b);
    const bytes = new Uint8Array(keys.length);
    for (let i = 0; i < keys.length; i++) bytes[i] = (psbt as Record<number, number>)[keys[i]];
    return uint8ArrayToBase64(bytes);
  }
  throw new Error('Unexpected PSBT format: ' + typeof psbt);
}

function extractPsbtBase64FromExecuteResult(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const r = result as Record<string, any>;
  const candidates = [
    r?.readyToSign?.psbt,
    r?.ready_to_sign?.psbt,
    r?.psbt,
    r?.psbtBase64,
    r?.psbt_base64,
    r?.unsigned_psbt,
  ];
  for (const c of candidates) {
    if (c == null) continue;
    if (typeof c === 'string' && c.length > 0) return c;
    try {
      return coercePsbtBase64(c);
    } catch {
      continue;
    }
  }
  return undefined;
}
