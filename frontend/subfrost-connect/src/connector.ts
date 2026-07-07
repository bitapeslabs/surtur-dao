/**
 * SubfrostConnector — vendor-side driver for the SUBFROST popup flow.
 *
 * Usage:
 *   const connector = new SubfrostConnector({ subfrostOrigin: 'http://localhost:3000' });
 *   const session = await connector.connect();          // opens /request/wallets
 *   const { signedPsbtBase64 } = await connector.signPsbt({ psbtBase64 }); // opens /request/sign
 *
 * Both calls open a popup on the SUBFROST origin, perform the
 * ready/init/ack handshake (see protocol.ts) and resolve with the popup's
 * terminal message. The promise rejects with a `SubfrostConnectError` whose
 * `code` is:
 *   - 'POPUP_BLOCKED'  — window.open returned null
 *   - 'POPUP_CLOSED'   — user closed the popup before responding
 *   - 'USER_REJECTED'  — user clicked reject in the popup
 *   - 'TIMEOUT'        — no response within `timeoutMs`
 */

import {
  SUBFROST_WALLETS_PATH,
  SUBFROST_SIGN_PATH,
  SUBFROST_SIGNMESSAGE_PATH,
  type ConnectRequestPayload,
  type InitMessage,
  type PopupToVendorMessage,
  type SignRequestOverview,
  type SubfrostAccount,
  type WalletsResultMessage,
  type SignResultMessage,
  type SignMessageResultMessage,
} from './protocol';

export type SubfrostConnectErrorCode =
  | 'POPUP_BLOCKED'
  | 'POPUP_CLOSED'
  | 'USER_REJECTED'
  | 'TIMEOUT';

export class SubfrostConnectError extends Error {
  code: SubfrostConnectErrorCode;
  constructor(code: SubfrostConnectErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'SubfrostConnectError';
    this.code = code;
  }
}

export interface SubfrostConnectorOptions {
  /** Origin of the SUBFROST app, e.g. 'https://app.subfrost.io' or 'http://localhost:3000'. */
  subfrostOrigin: string;
  /** Override the wallet-selection popup path. Default '/request/wallets'. */
  walletsPath?: string;
  /** Override the sign popup path. Default '/request/sign'. */
  signPath?: string;
  /** Override the message-signing popup path. Default '/request/signmessage'. */
  signMessagePath?: string;
  /** window.open features. Default: centered 420x640 popup. */
  popupFeatures?: string;
  /** How long to wait for the popup to respond. Default 5 minutes. */
  timeoutMs?: number;
}

export type PopupKind = 'wallets' | 'sign' | 'signMessage';

export interface RequestOptions {
  /**
   * A popup window pre-opened synchronously via `openPopup()`. Pass this
   * when the request follows async work (e.g. building a PSBT) so the popup
   * is opened during the user's click gesture — Safari blocks `window.open`
   * that runs after an `await`. If omitted, a popup is opened lazily (fine
   * for `connect()`, which is called directly from a click).
   */
  popup?: Window | null;
}

export interface ConnectSession {
  account: SubfrostAccount;
  network: string;
  /** SUBFROST origin this session was established against. */
  subfrostOrigin: string;
}

export interface SignPsbtParams {
  /** Unsigned PSBT, base64-encoded. */
  psbtBase64: string;
  /** Optional label shown to the user in the SUBFROST tx overview. */
  label?: string;
  /** Optional structured overview (SUBFROST verifies it against the PSBT). */
  overview?: SignRequestOverview;
}

export interface SignPsbtResult {
  /** Signed (not necessarily finalized) PSBT, base64-encoded. */
  signedPsbtBase64: string;
}

export interface SignMessageParams {
  /** UTF-8 message to sign. */
  message: string;
}

export interface SignMessageResult {
  /**
   * Base64 signature. NOTE: the SUBFROST keystore signs raw ECDSA over
   * sha256(message) — not BIP-137/BIP-322. Verify against `publicKey`.
   */
  signature: string;
  address: string;
  publicKey: string;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const INIT_RESEND_INTERVAL_MS = 250;
const CLOSE_POLL_INTERVAL_MS = 300;

function defaultPopupFeatures(): string {
  const width = 420;
  const height = 680;
  const left = Math.max(0, Math.round((window.screen.width - width) / 2));
  const top = Math.max(0, Math.round((window.screen.height - height) / 2));
  return `popup=yes,width=${width},height=${height},left=${left},top=${top}`;
}

function randomRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export class SubfrostConnector {
  readonly subfrostOrigin: string;
  private readonly walletsPath: string;
  private readonly signPath: string;
  private readonly signMessagePath: string;
  private readonly popupFeatures?: string;
  private readonly timeoutMs: number;

  constructor(options: SubfrostConnectorOptions) {
    // Normalize: strip trailing slash so `origin + path` is well-formed and
    // so origin comparison against `event.origin` (never has a slash) works.
    this.subfrostOrigin = new URL(options.subfrostOrigin).origin;
    this.walletsPath = options.walletsPath ?? SUBFROST_WALLETS_PATH;
    this.signPath = options.signPath ?? SUBFROST_SIGN_PATH;
    this.signMessagePath = options.signMessagePath ?? SUBFROST_SIGNMESSAGE_PATH;
    this.popupFeatures = options.popupFeatures;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private pathFor(kind: PopupKind): string {
    switch (kind) {
      case 'wallets':
        return this.walletsPath;
      case 'sign':
        return this.signPath;
      case 'signMessage':
        return this.signMessagePath;
    }
  }

  /**
   * Open a SUBFROST popup synchronously and return its window (or null if the
   * browser blocked it). Call this DIRECTLY inside a click handler — before
   * any `await` — then pass the returned window to `signPsbt`/`signMessage`
   * via `{ popup }`. This keeps `window.open` inside the user gesture so
   * Safari doesn't block popups that follow async work (e.g. PSBT building).
   */
  openPopup(kind: PopupKind): Window | null {
    if (typeof window === 'undefined') return null;
    return window.open(
      `${this.subfrostOrigin}${this.pathFor(kind)}`,
      'subfrost-connect',
      this.popupFeatures ?? defaultPopupFeatures(),
    );
  }

  /**
   * Open the SUBFROST wallet-selection popup. Resolves once the user unlocks
   * their keystore and picks an account.
   */
  async connect(opts?: RequestOptions): Promise<ConnectSession> {
    const result = await this.request<WalletsResultMessage>(
      this.walletsPath,
      { method: 'wallets' },
      opts?.popup,
    );
    return {
      account: result.account,
      network: result.network,
      subfrostOrigin: this.subfrostOrigin,
    };
  }

  /**
   * Open the SUBFROST sign popup with an unsigned PSBT. Resolves with the
   * signed PSBT once the user reviews the transaction overview and signs.
   * Rejects with `POPUP_CLOSED` if the user closes the popup mid-flight —
   * treat that as a cancellation.
   *
   * Pass `opts.popup` from `openPopup('sign')` when signing follows async
   * work, so the popup opens during the click (Safari-safe).
   */
  async signPsbt(params: SignPsbtParams, opts?: RequestOptions): Promise<SignPsbtResult> {
    const result = await this.request<SignResultMessage>(
      this.signPath,
      {
        method: 'sign',
        psbtBase64: params.psbtBase64,
        label: params.label,
        overview: params.overview,
      },
      opts?.popup,
    );
    return { signedPsbtBase64: result.signedPsbtBase64 };
  }

  /**
   * Open the SUBFROST message-signing popup. Resolves with the signature
   * once the user reviews the message and signs. See SignMessageResult for
   * the signature scheme. Pass `opts.popup` for Safari-safe pre-opening.
   */
  async signMessage(params: SignMessageParams, opts?: RequestOptions): Promise<SignMessageResult> {
    const result = await this.request<SignMessageResultMessage>(
      this.signMessagePath,
      { method: 'signMessage', message: params.message },
      opts?.popup,
    );
    return { signature: result.signature, address: result.address, publicKey: result.publicKey };
  }

  private request<T extends WalletsResultMessage | SignResultMessage | SignMessageResultMessage>(
    path: string,
    payload: ConnectRequestPayload,
    presetPopup?: Window | null,
  ): Promise<T> {
    if (typeof window === 'undefined') {
      return Promise.reject(new Error('subfrost-connect can only run in a browser'));
    }

    const requestId = randomRequestId();
    const init: InitMessage = {
      type: 'init',
      requestId,
      origin: window.location.origin,
      request: payload,
    };

    // Reuse a popup pre-opened during the click gesture; otherwise open one
    // now (safe only when this call itself runs inside the gesture).
    const popup =
      presetPopup && !presetPopup.closed
        ? presetPopup
        : window.open(
            `${this.subfrostOrigin}${path}`,
            'subfrost-connect',
            this.popupFeatures ?? defaultPopupFeatures(),
          );
    if (!popup) {
      return Promise.reject(
        new SubfrostConnectError('POPUP_BLOCKED', 'Popup was blocked by the browser'),
      );
    }

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let acked = false;

      const cleanup = () => {
        settled = true;
        window.removeEventListener('message', onMessage);
        window.clearInterval(resendTimer);
        window.clearInterval(closeTimer);
        window.clearTimeout(timeoutTimer);
      };

      const fail = (err: Error, closePopup: boolean) => {
        if (settled) return;
        cleanup();
        if (closePopup) {
          try {
            popup.close();
          } catch {
            /* ignore */
          }
        }
        reject(err);
      };

      const succeed = (msg: T) => {
        if (settled) return;
        cleanup();
        resolve(msg);
      };

      const sendInit = () => {
        try {
          popup.postMessage(init, this.subfrostOrigin);
        } catch {
          /* popup may be mid-navigation; the next tick retries */
        }
      };

      const onMessage = (event: MessageEvent) => {
        // Only accept messages from OUR popup on the SUBFROST origin.
        if (event.origin !== this.subfrostOrigin) return;
        if (event.source !== popup) return;
        const msg = event.data as PopupToVendorMessage | undefined;
        if (!msg || typeof msg !== 'object') return;

        switch (msg.type) {
          case 'subfrost:ready':
            sendInit();
            break;
          case 'subfrost:ack':
            if (msg.requestId === requestId) acked = true;
            break;
          case 'subfrost:wallets_result':
          case 'subfrost:sign_result':
          case 'subfrost:signmessage_result':
            if (msg.requestId === requestId) succeed(msg as T);
            break;
          case 'subfrost:reject':
            if (msg.requestId === requestId) {
              fail(
                new SubfrostConnectError('USER_REJECTED', msg.reason ?? 'Request rejected'),
                true,
              );
            }
            break;
        }
      };

      window.addEventListener('message', onMessage);

      // Belt & braces vs the ready message: resend init until acked. Covers
      // the popup attaching its listener after our `subfrost:ready` handler
      // missed it (e.g. hard reload inside the popup).
      const resendTimer = window.setInterval(() => {
        if (!acked) sendInit();
      }, INIT_RESEND_INTERVAL_MS);

      // Cancel when the user closes the popup without responding.
      const closeTimer = window.setInterval(() => {
        if (popup.closed) {
          fail(
            new SubfrostConnectError('POPUP_CLOSED', 'SUBFROST popup was closed'),
            false,
          );
        }
      }, CLOSE_POLL_INTERVAL_MS);

      const timeoutTimer = window.setTimeout(() => {
        fail(new SubfrostConnectError('TIMEOUT', 'SUBFROST request timed out'), true);
      }, this.timeoutMs);
    });
  }
}

// ---------------------------------------------------------------------------
// Session persistence helpers (optional convenience for vendor apps)
// ---------------------------------------------------------------------------

const SESSION_STORAGE_KEY = 'subfrost-connect:session';

export function saveSession(session: ConnectSession): void {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* storage unavailable */
  }
}

export function loadSession(): ConnectSession | null {
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

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}
