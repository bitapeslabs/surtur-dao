'use client';

/**
 * VendorWalletContext — app-wide SUBFROST connection state (origin, session,
 * connector). Mounted once in the root layout. Balances are NOT fetched
 * here — only the portfolio page needs them, and fetching in the provider
 * would fire the spendable-outpoints call on every page.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  SubfrostConnector,
  SubfrostConnectError,
  type ConnectSession,
} from 'subfrost-connect';
import { normalizeNetwork, SUPPORTED_NETWORKS, type VendorNetwork } from '@/lib/config';
import { SUBFROST_ORIGIN } from '@/config';

const ORIGIN_STORAGE_KEY = 'surtur:subfrost-origin';
const DEFAULT_SUBFROST_ORIGIN = SUBFROST_ORIGIN;

// Session persisted under an app-specific key rather than the SDK's
// loadSession/saveSession helpers, which hardcode `subfrost-connect:session`.
// Snowfort (vendor) uses that shared key, and when either dev server hops
// onto the other's port (Next auto-increments a busy port) both apps share
// the localhost origin — a namespaced key keeps their sessions from
// bleeding into each other.
const SESSION_STORAGE_KEY = 'surtur:session';

function loadSession(): ConnectSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConnectSession;
    if (!parsed?.account?.address || !parsed?.subfrostOrigin) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveSession(session: ConnectSession): void {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* storage unavailable */
  }
}

function clearSession(): void {
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
  session: ConnectSession | null;
  network: VendorNetwork;
  networkSupported: boolean;
  connector: SubfrostConnector | null;
  connecting: boolean;
  connectError: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const VendorWalletContext = createContext<VendorWalletValue | null>(null);

export function VendorWalletProvider({ children }: { children: ReactNode }) {
  const [subfrostOrigin, setOriginState] = useState(DEFAULT_SUBFROST_ORIGIN);
  const [session, setSession] = useState<ConnectSession | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  useEffect(() => {
    setOriginState(localStorage.getItem(ORIGIN_STORAGE_KEY) ?? DEFAULT_SUBFROST_ORIGIN);
    setSession(loadSession());
    setHydrated(true);
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

  const connect = useCallback(async () => {
    if (!connector) return;
    setConnecting(true);
    setConnectError(null);
    try {
      const s = await connector.connect();
      setSession(s);
      saveSession(s);
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
  }, [connector]);

  const disconnect = useCallback(() => {
    clearSession();
    setSession(null);
  }, []);

  const value = useMemo<VendorWalletValue>(
    () => ({
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
      disconnect,
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
      disconnect,
    ],
  );

  return <VendorWalletContext.Provider value={value}>{children}</VendorWalletContext.Provider>;
}

export function useVendorWallet(): VendorWalletValue {
  const ctx = useContext(VendorWalletContext);
  if (!ctx) throw new Error('useVendorWallet must be used inside VendorWalletProvider');
  return ctx;
}
