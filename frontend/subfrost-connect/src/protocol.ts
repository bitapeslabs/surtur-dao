/**
 * subfrost-connect wire protocol.
 *
 * A vendor app opens a SUBFROST popup (`/request/wallets` or `/request/sign`)
 * via `window.open` and the two sides talk over `postMessage`:
 *
 *   1. popup → opener   : `subfrost:ready`   (sent repeatedly until init arrives;
 *                          carries no sensitive data, so targetOrigin is `*`)
 *   2. opener → popup   : `init`             (targetOrigin = subfrost origin;
 *                          the popup records `event.origin` as the vendor
 *                          origin — the browser-set origin is authoritative,
 *                          the `origin` field in the payload is informational)
 *   3. popup → opener   : `subfrost:ack`     (init received; vendor stops resending)
 *   4. popup → opener   : one terminal message —
 *                          `subfrost:wallets_result` | `subfrost:sign_result`
 *                          | `subfrost:reject`
 *                          (targetOrigin = recorded vendor origin)
 *
 * NOTE: the SUBFROST app keeps a copy of this file at
 * `subfrost-app/lib/connect/protocol.ts`. Keep the two in sync.
 */

export const SUBFROST_WALLETS_PATH = '/request/wallets';
export const SUBFROST_SIGN_PATH = '/request/sign';
export const SUBFROST_SIGNMESSAGE_PATH = '/request/signmessage';

/**
 * Structured transfer overview shown by the SUBFROST sign popup ("Confirm
 * Send" style: recipient / amount / network fee / token). Display-only hints:
 * the popup derives what it can from the PSBT itself (recipient output, BTC
 * amount, fee) and cross-checks these values, so a lying vendor is surfaced
 * to the user rather than trusted.
 */
export interface SignRequestOverview {
  kind: 'btc-send' | 'alkane-send' | 'swap';
  recipientAddress?: string;
  /** BTC amount in sats (btc-send). */
  amountSats?: number;
  /** Alkane transfer details (alkane-send). */
  alkane?: {
    /** "block:tx" */
    alkaneId: string;
    /** Stringified integer base units. */
    amountBaseUnits: string;
    symbol?: string;
    /** Display decimals (default 8). */
    decimals?: number;
  };
  /** Swap details (kind 'swap') — display amounts, already decimal-formatted. */
  swap?: {
    sellSymbol: string;
    sellAmount: string;
    buySymbol: string;
    /** Minimum received after slippage. */
    minBuyAmount: string;
  };
  /** Fee rate the PSBT was built with (sat/vB). */
  feeRate?: number;
}

/** Request payloads carried inside the vendor's `init` message. */
export type ConnectRequestPayload =
  | { method: 'wallets' }
  | {
      method: 'sign';
      /** Unsigned PSBT, base64-encoded. */
      psbtBase64: string;
      /** Optional human-readable label shown in the SUBFROST tx overview. */
      label?: string;
      /** Optional structured overview (verified against the PSBT). */
      overview?: SignRequestOverview;
    }
  | {
      method: 'signMessage';
      /** UTF-8 message to sign. */
      message: string;
    };

/** Vendor → popup. */
export interface InitMessage {
  type: 'init';
  /** Random id echoed back on every popup response. */
  requestId: string;
  /** Informational copy of the vendor origin (popup trusts `event.origin`). */
  origin: string;
  request: ConnectRequestPayload;
}

/** Popup → vendor: popup is loaded and listening. */
export interface ReadyMessage {
  type: 'subfrost:ready';
  endpoint: 'wallets' | 'sign' | 'signMessage';
}

/** Popup → vendor: init received, stop resending. */
export interface AckMessage {
  type: 'subfrost:ack';
  requestId: string;
}

/** The account a user selected in the wallets popup. */
export interface SubfrostAccount {
  /** Taproot (P2TR) address. */
  address: string;
  /** Compressed public key hex (33 bytes / 66 hex chars). */
  publicKey: string;
  /** BIP86 address index (last path segment) this account derives from. */
  addressIndex: number;
}

/** Popup → vendor: user picked an account. */
export interface WalletsResultMessage {
  type: 'subfrost:wallets_result';
  requestId: string;
  account: SubfrostAccount;
  /** Network the SUBFROST app is on (e.g. 'mainnet', 'subfrost-regtest'). */
  network: string;
}

/** Popup → vendor: PSBT signed. */
export interface SignResultMessage {
  type: 'subfrost:sign_result';
  requestId: string;
  /** Signed (not necessarily finalized) PSBT, base64-encoded. */
  signedPsbtBase64: string;
}

/**
 * Popup → vendor: message signed.
 *
 * NOTE on the signature scheme: the SUBFROST keystore signs via the alkanes
 * SDK's message signer, which is raw ECDSA over sha256(message) encoded as
 * base64 — NOT BIP-137 (no magic prefix / recovery byte) and NOT BIP-322.
 * Verify against the returned publicKey with plain ECDSA, not with standard
 * Bitcoin signed-message verifiers.
 */
export interface SignMessageResultMessage {
  type: 'subfrost:signmessage_result';
  requestId: string;
  /** Signature, base64-encoded (see scheme note above). */
  signature: string;
  /** Address of the connected account. */
  address: string;
  /** Compressed public key hex of the connected account. */
  publicKey: string;
}

/** Popup → vendor: user rejected, or the request failed inside SUBFROST. */
export interface RejectMessage {
  type: 'subfrost:reject';
  requestId: string;
  reason?: string;
}

export type PopupToVendorMessage =
  | ReadyMessage
  | AckMessage
  | WalletsResultMessage
  | SignResultMessage
  | SignMessageResultMessage
  | RejectMessage;
