'use client';

/**
 * VendorWalletContext — app-wide wallet state. Mounted once in the root
 * layout. Balances are NOT fetched here — only the portfolio page needs
 * them, and fetching in the provider would fire the spendable-outpoints
 * call on every page.
 *
 * Surtur supports three wallet kinds (and deliberately NO keystore —
 * seed phrases never touch this app):
 *  - 'passport'  — the SUBFROST webapp via the subfrost-connect popup.
 *  - 'extension' — browser extension wallets (SUBFROST ext, OYL, OKX,
 *                  UniSat, Xverse) via lib/wallet/extensions.
 *  - 'mobile'    — the SUBFROST mobile app paired over frtun p2p. Can
 *                  sign messages (votes/proposals/resolutions) but
 *                  portfolio SEND is disabled (`canSend: false`); the
 *                  pairing key is in-memory only, so mobile sessions do
 *                  not survive a reload.
 *
 * All signing flows go through the unified signMessage / signPsbt here —
 * components never talk to a specific wallet API.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  SubfrostConnector,
  SubfrostConnectError,
  type ConnectSession,
  type SignPsbtParams,
} from 'subfrost-connect';
import { normalizeNetwork, SUPPORTED_NETWORKS, type VendorNetwork } from '@/lib/config';
import { SUBFROST_ORIGIN } from '@/config';
import {
  connectExtension,
  getInstalledExtensions,
  signMessageWithExtension,
  signPsbtWithExtension,
  type ExtensionWalletDef,
  type ExtensionWalletId,
} from '@/lib/wallet/extensions';
import { SubfrostFrtunAdapter } from '@/lib/wallet/mobile';

const ORIGIN_STORAGE_KEY = 'surtur:subfrost-origin';
const DEFAULT_SUBFROST_ORIGIN = SUBFROST_ORIGIN;

export type WalletKind = 'passport' | 'extension' | 'mobile';

/**
 * Unified session. `account.address` is always the taproot identity the
 * whole app keys on (balances, votes, eligibility). Shape is a superset
 * of the old passport-only session, so persisted sessions stay readable.
 */
export interface WalletSession {
  kind: WalletKind;
  /** 'passport' | ExtensionWalletId | 'subfrost-mobile' */
  walletId: string;
  walletName: string;
  account: { address: string; publicKey?: string };
  /** Reported by the passport; inferred from the address otherwise. */
  network?: string;
  /** Passport only. */
  subfrostOrigin?: string;
}

// Session persisted under an app-specific key rather than the SDK's
// loadSession/saveSession helpers, which hardcode `subfrost-connect:session`
// (shared-localhost bleed with the vendor app — see git history).
const SESSION_STORAGE_KEY = 'surtur:session';

function networkFromAddress(address: string): string {
  if (address.startsWith('bcrt1')) return 'regtest';
  if (address.startsWith('tb1')) return 'testnet';
  return 'mainnet';
}

function loadStoredSession(): WalletSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.account?.address) return null;
    // Legacy passport-only sessions predate `kind`.
    if (!parsed.kind) {
      if (!parsed.subfrostOrigin) return null;
      return {
        kind: 'passport',
        walletId: 'passport',
        walletName: 'SUBFROST',
        account: parsed.account,
        network: parsed.network,
        subfrostOrigin: parsed.subfrostOrigin,
      };
    }
    // Mobile sessions can never be restored (in-memory pairing key).
    if (parsed.kind === 'mobile') return null;
    return parsed as WalletSession;
  } catch {
    return null;
  }
}

function saveSession(session: WalletSession): void {
  try {
    if (session.kind === 'mobile') return; // not restorable — don't persist
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* storage unavailable */
  }
}

function clearStoredSession(): void {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

interface VendorWalletValue {
  hydrated: boolean;
  subfrostOrigin: string;
  setSubfrostOrigin: (origin: string) => void;
  session: WalletSession | null;
  network: VendorNetwork;
  networkSupported: boolean;
  /** Only set while a passport session is active (popup plumbing). */
  connector: SubfrostConnector | null;
  connecting: boolean;
  connectError: string | null;
  /** Opens the connect-wallet modal. */
  connect: () => void;
  connectModalOpen: boolean;
  setConnectModalOpen: (open: boolean) => void;
  /** Extensions detected in this browser. */
  installedExtensions: ExtensionWalletDef[];
  connectPassport: () => Promise<void>;
  connectExtensionWallet: (id: ExtensionWalletId) => Promise<void>;
  /** Adopt a completed frtun mobile pairing. */
  adoptMobileSession: (adapter: SubfrostFrtunAdapter, addresses: string[]) => void;
  disconnect: () => void;
  /**
   * Whether the connected wallet may use portfolio send. Extensions and
   * the passport can; the SUBFROST mobile app cannot (policy).
   */
  canSend: boolean;
  /**
   * Pre-open the passport popup inside a click gesture (Safari-safe).
   * Returns null for non-passport wallets — pass the result to
   * signMessage/signPsbt either way.
   */
  openSignPopup: (endpoint: 'sign' | 'signMessage') => Window | null;
  /** BIP-322 message signing through whichever wallet is connected. */
  signMessage: (
    message: string,
    opts?: { popup?: Window | null },
  ) => Promise<{ signature: string; address: string; publicKey?: string }>;
  /** PSBT signing (send flows). Throws for mobile sessions. */
  signPsbt: (
    params: SignPsbtParams,
    opts?: { popup?: Window | null },
  ) => Promise<string>;
}

const VendorWalletContext = createContext<VendorWalletValue | null>(null);

export function VendorWalletProvider({ children }: { children: ReactNode }) {
  const [subfrostOrigin, setOriginState] = useState(DEFAULT_SUBFROST_ORIGIN);
  const [session, setSession] = useState<WalletSession | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [installedExtensions, setInstalledExtensions] = useState<ExtensionWalletDef[]>([]);
  const mobileAdapterRef = useRef<SubfrostFrtunAdapter | null>(null);

  useEffect(() => {
    setOriginState(localStorage.getItem(ORIGIN_STORAGE_KEY) ?? DEFAULT_SUBFROST_ORIGIN);
    setSession(loadStoredSession());
    setHydrated(true);
    // Extensions inject asynchronously — probe after a beat.
    const timer = setTimeout(() => setInstalledExtensions(getInstalledExtensions()), 150);
    return () => clearTimeout(timer);
  }, []);

  const network = normalizeNetwork(session?.network);
  const networkSupported =
    !session?.network || (SUPPORTED_NETWORKS as readonly string[]).includes(session.network);

  const connector = useMemo(() => {
    try {
      return new SubfrostConnector({ subfrostOrigin });
    } catch {
      return null; // invalid origin URL while the user is typing
    }
  }, [subfrostOrigin]);

  const setSubfrostOrigin = useCallback((value: string) => {
    setOriginState(value);
    try {
      localStorage.setItem(ORIGIN_STORAGE_KEY, value);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const adoptSession = useCallback((next: WalletSession) => {
    setSession(next);
    saveSession(next);
    setConnectModalOpen(false);
  }, []);

  const connectPassport = useCallback(async () => {
    if (!connector) return;
    setConnecting(true);
    setConnectError(null);
    try {
      const s: ConnectSession = await connector.connect();
      adoptSession({
        kind: 'passport',
        walletId: 'passport',
        walletName: 'SUBFROST',
        account: s.account,
        network: s.network,
        subfrostOrigin: s.subfrostOrigin,
      });
    } catch (e) {
      if (
        e instanceof SubfrostConnectError &&
        (e.code === 'POPUP_CLOSED' || e.code === 'USER_REJECTED')
      ) {
        // silent — user changed their mind
      } else {
        setConnectError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setConnecting(false);
    }
  }, [connector, adoptSession]);

  const connectExtensionWallet = useCallback(
    async (id: ExtensionWalletId) => {
      setConnecting(true);
      setConnectError(null);
      try {
        const account = await connectExtension(id);
        const def = getInstalledExtensions().find((wdef) => wdef.id === id);
        adoptSession({
          kind: 'extension',
          walletId: id,
          walletName: def?.name ?? id,
          account: { address: account.address, publicKey: account.publicKey },
          network: networkFromAddress(account.address),
        });
      } catch (e) {
        setConnectError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setConnecting(false);
      }
    },
    [adoptSession],
  );

  const adoptMobileSession = useCallback(
    (adapter: SubfrostFrtunAdapter, addresses: string[]) => {
      const taproot = addresses.find((a) => /^(bc1p|tb1p|bcrt1p)/.test(a)) ?? addresses[0];
      if (!taproot) return;
      mobileAdapterRef.current = adapter;
      adoptSession({
        kind: 'mobile',
        walletId: 'subfrost-mobile',
        walletName: 'SUBFROST Mobile',
        account: { address: taproot },
        network: networkFromAddress(taproot),
      });
    },
    [adoptSession],
  );

  const disconnect = useCallback(() => {
    clearStoredSession();
    setSession(null);
    const adapter = mobileAdapterRef.current;
    mobileAdapterRef.current = null;
    if (adapter) void adapter.disconnect().catch(() => {});
  }, []);

  const connect = useCallback(() => {
    setConnectError(null);
    setConnectModalOpen(true);
  }, []);

  const canSend = session !== null && session.kind !== 'mobile';

  const openSignPopup = useCallback(
    (endpoint: 'sign' | 'signMessage'): Window | null => {
      if (session?.kind !== 'passport' || !connector) return null;
      return connector.openPopup(endpoint);
    },
    [session?.kind, connector],
  );

  const signMessage = useCallback(
    async (
      message: string,
      opts?: { popup?: Window | null },
    ): Promise<{ signature: string; address: string; publicKey?: string }> => {
      if (!session) throw new Error('No wallet connected.');
      switch (session.kind) {
        case 'passport': {
          if (!connector) throw new Error('SUBFROST connector unavailable.');
          return connector.signMessage({ message }, { popup: opts?.popup ?? undefined });
        }
        case 'extension': {
          const signature = await signMessageWithExtension(
            session.walletId as ExtensionWalletId,
            session.account.address,
            message,
          );
          return {
            signature,
            address: session.account.address,
            publicKey: session.account.publicKey,
          };
        }
        case 'mobile': {
          const adapter = mobileAdapterRef.current;
          if (!adapter) throw new Error('SUBFROST Mobile session lost — reconnect.');
          const signature = await adapter.signMessage(message, session.account.address);
          return { signature, address: session.account.address };
        }
      }
    },
    [session, connector],
  );

  const signPsbt = useCallback(
    async (params: SignPsbtParams, opts?: { popup?: Window | null }): Promise<string> => {
      if (!session) throw new Error('No wallet connected.');
      switch (session.kind) {
        case 'passport': {
          if (!connector) throw new Error('SUBFROST connector unavailable.');
          const { signedPsbtBase64 } = await connector.signPsbt(params, {
            popup: opts?.popup ?? undefined,
          });
          return signedPsbtBase64;
        }
        case 'extension':
          return signPsbtWithExtension(session.walletId as ExtensionWalletId, {
            psbtBase64: params.psbtBase64,
            address: session.account.address,
            publicKeyHex: session.account.publicKey,
            network,
          });
        case 'mobile':
          // Policy: portfolio send is disabled for the mobile app; the UI
          // gates on `canSend`, this is the backstop.
          throw new Error('Sending is not supported with SUBFROST Mobile.');
      }
    },
    [session, connector, network],
  );

  const value = useMemo<VendorWalletValue>(
    () => ({
      hydrated,
      subfrostOrigin,
      setSubfrostOrigin,
      session,
      network,
      networkSupported,
      connector: session?.kind === 'passport' || session === null ? connector : null,
      connecting,
      connectError,
      connect,
      connectModalOpen,
      setConnectModalOpen,
      installedExtensions,
      connectPassport,
      connectExtensionWallet,
      adoptMobileSession,
      disconnect,
      canSend,
      openSignPopup,
      signMessage,
      signPsbt,
    }),
    [
      hydrated,
      subfrostOrigin,
      setSubfrostOrigin,
      session,
      network,
      networkSupported,
      connector,
      connecting,
      connectError,
      connect,
      connectModalOpen,
      installedExtensions,
      connectPassport,
      connectExtensionWallet,
      adoptMobileSession,
      disconnect,
      canSend,
      openSignPopup,
      signMessage,
      signPsbt,
    ],
  );

  return <VendorWalletContext.Provider value={value}>{children}</VendorWalletContext.Provider>;
}

export function useVendorWallet(): VendorWalletValue {
  const ctx = useContext(VendorWalletContext);
  if (!ctx) throw new Error('useVendorWallet must be used inside VendorWalletProvider');
  return ctx;
}
