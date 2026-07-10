/**
 * subfrost-wc frtun client — webapp (dapp/LISTEN) side over frtun p2p.
 *
 * This is the canonical pairing transport: the browser pairs with the
 * phone over the frtun /v1/pair bridge (NOT the legacy wc-relay). The
 * webapp generates an ephemeral X25519 keypair + a frtun peer identity
 * + a 6-char pairing code, renders a `subfrost://wc/<peer>.peer?...&
 * mode=cli` QR, then LISTENs on the bridge. When the phone scans and
 * dials in, the webapp reads the phone's X25519 pub (its first binary
 * frame), derives the per-pairing symKey, and drives encrypted
 * getAccounts / signPsbt / signMessage round-trips over the same socket.
 *
 * Surface mirrors lib/wc/client.ts so SubfrostFrtunAdapter is a
 * drop-in: `connect(opts)` → { pairingUri, accepted, cancel }, and
 * `FrtunSession` exposes signPsbt / signMessage / getAccounts /
 * disconnect identically to WcSession.
 *
 * Crypto is REUSED from lib/wc/crypto.ts verbatim — frtun uses the
 * exact same X25519 / HKDF-SHA256(salt "subfrost-wc-v1") /
 * ChaCha20-Poly1305 stack. The ONLY differences from the relay path:
 *   1. HKDF info = "<cliPeerName>:<pairingCode>"  (relay used `topic`)
 *   2. envelope wire keys = { ciphertextB64, nonceB64 }  (relay: {ciphertext,nonce})
 *   3. transport = frtun /v1/pair binary stream  (relay: WSS+HTTP relay)
 *
 * Wire contract verified byte-exact against:
 *   reference/subfrost-mobile/crates/subfrost-mobile-ffi/src/pair_cli.rs
 *   reference/subfrost-mobile/crates/subfrost-mobile-cli/src/pair_listen.rs
 *   reference/subfrost-mobile/crates/subfrost-mobile-wc/src/crypto.rs
 *   reference/alkanes-rs-develop-wc/vendor/frtun-pair/src/protocol.rs
 */

import {
  genKeypair, ecdhDerive,
  encrypt, decrypt,
  pubToB64Url, pubFromB64Url,
  bytesToB64Url, bytesFromB64Url,
} from '../crypto';
import { Plaintext } from '../types';
import { generatePeer } from './peer';
import { generatePairingCode, FrtunEnvelope } from './frames';
import { listen, FrtunStream, DEFAULT_BRIDGE_URL, FrtunPairError } from './transport';

export interface FrtunConnectOptions {
  /** Defaults to `wss://wss-tls.subfrost.io/v1/pair`. */
  bridgeUrl?: string;
  /** Origin advertised to the mobile during pairing. Defaults to
   *  `window.location.origin`. */
  origin?: string;
}

export interface FrtunPairingResult {
  /** The QR-encoded pairing URI:
   *  `subfrost://wc/<peer>.peer?key=&code=&bridge=&origin=&mode=cli`. */
  pairingUri: string;
  /** The 6-char pairing code (also embedded in the URI). Surface it
   *  near the QR so the user can visually confirm — anti-MITM. */
  pairingCode: string;
  /** Resolves to a connected `FrtunSession` once the phone dials in and
   *  the symKey is derived. Rejects on bridge error / timeout. */
  accepted: Promise<FrtunSession>;
  /** Abort a pair-in-progress. */
  cancel: () => void;
}

/** A live frtun pairing session. Drives encrypted requests over the
 *  open /v1/pair binary stream and correlates responses by request_id. */
export class FrtunSession {
  readonly origin: string;
  /** Public receive addresses, populated lazily by getAccounts(). */
  readonly addresses: string[] = [];
  private readonly symKey: Uint8Array;
  private readonly stream: FrtunStream;
  /** Serialize requests: the bridge is a single request/response socket
   *  with no multiplexing, so two in-flight requests would race on the
   *  shared stream. Each request waits for the previous to settle. */
  private tail: Promise<unknown> = Promise.resolve();

  constructor(opts: { origin: string; symKey: Uint8Array; stream: FrtunStream }) {
    this.origin = opts.origin;
    this.symKey = opts.symKey;
    this.stream = opts.stream;
  }

  /** Send an encrypted plaintext request and await the decrypted
   *  response, correlating by request_id. One binary frame out, one (or
   *  more, if stale frames precede it) binary frame in. Serialized via
   *  `tail` so concurrent callers don't interleave on the shared stream. */
  private sendRequest(plaintext: Plaintext): Promise<Plaintext> {
    const run = async (): Promise<Plaintext> => {
      const reqId = (plaintext as { request_id: string }).request_id;
      const ptBytes = new TextEncoder().encode(JSON.stringify(plaintext));
      const { ciphertext, nonce } = encrypt(this.symKey, ptBytes);
      const env: FrtunEnvelope = {
        ciphertextB64: bytesToB64Url(ciphertext),
        nonceB64: bytesToB64Url(nonce),
      };
      this.stream.send(new TextEncoder().encode(JSON.stringify(env)));

      // Read frames until one decrypts to a response for THIS request_id.
      // Drains any stale/unsolicited envelope rather than mis-correlating
      // it as the answer. 5-min budget (user approves on the phone).
      const deadline = Date.now() + 5 * 60_000;
      for (;;) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('wc:internal frtun request timed out');
        const respBytes = await this.stream.next(remaining);
        let resp: Plaintext;
        try {
          const respEnv = JSON.parse(new TextDecoder().decode(respBytes)) as FrtunEnvelope;
          const pt = decrypt(this.symKey, bytesFromB64Url(respEnv.nonceB64), bytesFromB64Url(respEnv.ciphertextB64));
          resp = JSON.parse(new TextDecoder().decode(pt)) as Plaintext;
        } catch {
          continue; // undecryptable / malformed frame — skip
        }
        // 'accounts'/'result'/'error' carry request_id; match it.
        if ((resp as { request_id?: string }).request_id === reqId) return resp;
        // otherwise a stale response to a prior (timed-out) request — drop.
      }
    };
    const result = this.tail.then(run, run);
    // keep the chain alive regardless of this request's outcome
    this.tail = result.catch(() => undefined);
    return result;
  }

  async signPsbt(psbtHex: string, addresses: string[] = []): Promise<string> {
    const resp = await this.sendRequest({
      type: 'sign_psbt',
      psbt_hex: psbtHex.startsWith('0x') ? psbtHex.slice(2) : psbtHex,
      addresses,
      request_id: crypto.randomUUID(),
      origin: this.origin,
    });
    if (resp.type === 'result') return resp.result;
    if (resp.type === 'error') throw new Error(`wc:${resp.code} ${resp.message}`);
    throw new Error(`wc unexpected response: ${(resp as { type: string }).type}`);
  }

  async signMessage(message: string, address: string): Promise<string> {
    const resp = await this.sendRequest({
      type: 'sign_message', message, address,
      request_id: crypto.randomUUID(), origin: this.origin,
    });
    if (resp.type === 'result') return resp.result;
    if (resp.type === 'error') throw new Error(`wc:${resp.code} ${resp.message}`);
    throw new Error(`wc unexpected response: ${(resp as { type: string }).type}`);
  }

  async getAccounts(): Promise<string[]> {
    if (this.addresses.length > 0) return [...this.addresses];
    const resp = await this.sendRequest({
      type: 'get_accounts', request_id: crypto.randomUUID(), origin: this.origin,
    });
    if (resp.type === 'accounts') {
      this.addresses.splice(0, this.addresses.length, ...resp.addresses);
      return resp.addresses;
    }
    if (resp.type === 'error') throw new Error(`wc:${resp.code} ${resp.message}`);
    throw new Error(`wc unexpected response: ${(resp as { type: string }).type}`);
  }

  async disconnect(): Promise<void> {
    this.stream.close();
  }
}

/** Open a frtun pairing handshake. Returns the QR URI immediately and a
 *  promise that resolves to a connected session once the phone scans +
 *  dials in. Drop-in shape compatible with lib/wc/client.ts:connect. */
export function connect(opts: FrtunConnectOptions = {}): FrtunPairingResult {
  const bridgeUrl = opts.bridgeUrl ?? DEFAULT_BRIDGE_URL;
  const origin = opts.origin ?? (typeof window !== 'undefined' ? window.location.origin : '');

  // 1. dapp ephemeral X25519 keypair (goes in the QR `key=` param).
  const kp = genKeypair();
  // 2. frtun peer identity — the webapp's LISTEN routing label.
  const self = generatePeer();
  // 3. 6-char pairing code mixed into HKDF info.
  const code = generatePairingCode();

  // The QR/deeplink the phone's in-app scanner accepts on the frtun
  // path (MainActivity.kt:158-161 / pair_cli.rs::parse_pair_link):
  //   mode=cli, path=frtun1….peer, key=<b64url 32B>, code=<6>, bridge=<wss>.
  // [0-9A-Za-z_-] in key/peer/code are URL-safe; bridge+origin are
  // percent-encoded.
  const pairingUri =
    `subfrost://wc/${self.peerName}` +
    `?key=${pubToB64Url(kp.pub)}` +
    `&code=${code}` +
    `&bridge=${encodeURIComponent(bridgeUrl)}` +
    `&origin=${encodeURIComponent(origin)}` +
    `&mode=cli`;

  let stream: FrtunStream | null = null;
  // AbortController lets cancel() tear down the in-flight listen() (which
  // owns the WSS internally) instead of leaking the socket until its
  // 5-min timeout — `stream` is null until the phone dials in.
  const abort = new AbortController();

  const accepted = (async (): Promise<FrtunSession> => {
    stream = await listen({ bridgeUrl, selfPeer: self.peerName, signal: abort.signal });

    // The phone's FIRST binary frame is its X25519 pub — either 43-char
    // base64url utf-8 (pair_cli.rs:188-190) or, on newer phone builds,
    // the raw 32 bytes. Anything else surfaces the frame content in the
    // error instead of a cryptic base64 "Unknown letter" (a raw-byte
    // frame decoded as text contains 0x20 = " ").
    const firstFrame = await stream.next(5 * 60_000);
    let mobilePub: Uint8Array;
    if (firstFrame.length === 32) {
      mobilePub = firstFrame;
    } else {
      const text = new TextDecoder().decode(firstFrame).trim();
      try {
        mobilePub = pubFromB64Url(text);
      } catch {
        throw new FrtunPairError(
          'bad_frame',
          `unexpected first frame from phone (${firstFrame.length} bytes): "${text.slice(0, 100)}"`,
        );
      }
    }

    // symKey = HKDF(ECDH(dappPriv, mobilePub), salt="subfrost-wc-v1",
    //               info="<cliPeerName>:<code>")  — the only crypto
    // difference from the relay path. ECDH is symmetric so this matches
    // the phone's HKDF(ECDH(mobilePriv, dappPub), same info).
    const symKey = ecdhDerive(kp.priv, mobilePub, `${self.peerName}:${code}`);

    return new FrtunSession({ origin, symKey, stream });
  })();

  return {
    pairingUri,
    pairingCode: code,
    accepted,
    cancel: () => {
      abort.abort();             // tear down an in-flight listen()
      try { stream?.close(); } catch { /* */ } // close an established stream
    },
  };
}
