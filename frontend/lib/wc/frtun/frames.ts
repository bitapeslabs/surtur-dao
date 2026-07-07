/**
 * frtun-pair bridge control frames — byte-exact JSON matching the Rust
 * `frtun-pair::protocol` serde definitions.
 *
 * Source of truth:
 *   reference/alkanes-rs-develop-wc/vendor/frtun-pair/src/protocol.rs
 *
 *   #[serde(tag = "op",    rename_all = "snake_case")] ClientFrame
 *     Listen { peer }
 *     Dial   { peer, self_peer }
 *   #[serde(tag = "event", rename_all = "snake_case")] ServerFrame
 *     Ready
 *     Dialed   { peer }
 *     Incoming { peer }
 *     Error    { code, msg }
 *
 * Control frames are WS TEXT (one JSON object per WS text message, no
 * trailing newline). After the handshake (ready → dialed/incoming),
 * the socket carries WS BINARY frames forwarded verbatim by the bridge
 * — one WS binary message == one application frame, no length prefix.
 */

/** Build a Listen ClientFrame: `{"op":"listen","peer":"frtun1….peer"}`.
 *  `selfPeer` includes the `.peer` suffix. */
export function listenFrame(selfPeer: string): string {
  return JSON.stringify({ op: 'listen', peer: selfPeer });
}

/** Build a Dial ClientFrame:
 *  `{"op":"dial","peer":"<target>","self_peer":"<self>"}`. Note the
 *  on-wire field is snake_case `self_peer`. The browser plays LISTEN,
 *  so it normally never sends this — provided for completeness/parity. */
export function dialFrame(remotePeer: string, selfPeer: string): string {
  return JSON.stringify({ op: 'dial', peer: remotePeer, self_peer: selfPeer });
}

export interface ServerFrame {
  event: 'ready' | 'dialed' | 'incoming' | 'error' | string;
  peer?: string;
  /** Stable error codes: peer_not_found | peer_busy | bad_peer_name |
   *  bad_frame | internal (protocol.rs). */
  code?: string;
  msg?: string;
}

/** Parse a ServerFrame from a WS text frame. The discriminator key is
 *  `event` (NOT `op`). Throws on non-JSON. */
export function parseServerFrame(text: string): ServerFrame {
  return JSON.parse(text) as ServerFrame;
}

// ── pairing code ────────────────────────────────────────────────────
// 6-char code mixed into HKDF info ("<peerName>:<code>") so a
// wrong/absent code derives a divergent symKey and the first encrypted
// frame fails its auth tag. Alphabet excludes ambiguous glyphs
// (no O/I/0/1/L) — verbatim from
// subfrost-mobile-web-sys/src/lib.rs generate_pairing_code.
const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Generate a 6-char pairing code from the no-ambiguous-glyph alphabet,
 *  using a CSPRNG with rejection sampling for uniformity. */
export function generatePairingCode(): string {
  const n = PAIRING_CODE_ALPHABET.length; // 30
  // 256 % 30 == 16, so bytes >= 240 would bias; reject them.
  const limit = 256 - (256 % n);
  let out = '';
  const buf = new Uint8Array(1);
  while (out.length < 6) {
    crypto.getRandomValues(buf);
    if (buf[0] >= limit) continue;
    out += PAIRING_CODE_ALPHABET[buf[0] % n];
  }
  return out;
}

// ── envelope wire shape (frtun path) ────────────────────────────────
// The frtun-pair data plane uses camelCase envelope keys
// `{ ciphertextB64, nonceB64 }` (base64url-no-pad), distinct from the
// legacy relay path's `{ ciphertext, nonce }`. Source:
// subfrost-mobile-ffi/src/pair_cli.rs WireEnvelope (#[serde(rename)]).
export interface FrtunEnvelope {
  ciphertextB64: string;
  nonceB64: string;
}
