/**
 * frtun-pair peer identity — browser reimplementation of the Rust
 * `frtun-pair-wasm` / `subfrost-mobile-ffi::frtun_identity` derivation.
 *
 * A peer name is the routing label the frtun /v1/pair bridge uses to
 * rendezvous a dialer with a listener. It is derived from a 32-byte
 * secret, byte-for-byte identically to the mobile/Rust side:
 *
 *   1. fp = BLAKE3(secret).finalize_xof().fill(&mut [0u8; 20])   // first 20 bytes
 *   2. name = bech32m(hrp = "frtun", data = fp)                  // Bech32m checksum
 *   3. peer_name = name + ".peer"                                // single DNS label
 *
 * The secret is carried as base64url-no-pad (32 raw bytes → 43 chars).
 *
 * Source of truth (reference clone):
 *   reference/subfrost-mobile/crates/subfrost-mobile-ffi/src/frtun_identity.rs
 *     PEER_FINGERPRINT_BYTES = 20, PEER_HRP = "frtun", PEER_SUFFIX = ".peer"
 *     blake3::Hasher::finalize_xof().fill(&mut fp[..20])
 *     bech32::encode::<Bech32m>(Hrp::parse("frtun"), fp)
 *
 * Byte-exactness was proven against a standalone Rust build using the
 * same deps (blake3=1, bech32=0.11): blake3 XOF-first-20 == blake3
 * hash-first-20, and @noble/hashes `blake3(secret, { dkLen: 20 })`
 * reproduces it. Golden vectors are pinned in
 * `__tests__/peer.test.ts` (e.g. 0x55*32 →
 * frtun1dpc7mpp8ae8g364ssg82p0xz2pq8ke0z52tjlp.peer).
 *
 * ⚠️ Do NOT confuse this with the `frtun-identity` crate's scheme
 * (BLAKE3 over a PUBKEY → 32-byte fingerprint → DNS-split
 * `frtun1<56>.<8>.peer`). That is a different protocol and produces
 * unroutable names for the pair bridge.
 */

// @noble/hashes 2.x requires the `.js` suffix on subpath imports (its
// package.json exports map only the `.js` keys). Matches the convention
// in lib/wc/crypto.ts — don't drop the suffix.
import { blake3 } from '@noble/hashes/blake3.js';
import { bech32m } from '@scure/base';
import { bytesToB64Url, bytesFromB64Url } from '../crypto';

const PEER_FINGERPRINT_BYTES = 20;
const PEER_HRP = 'frtun';
const PEER_SUFFIX = '.peer';

export interface FrtunPeer {
  /** Canonical `frtun1<…>.peer` routing label. Goes in the QR path and
   *  in the listen/dial frame `peer` field — the SAME string in both. */
  peerName: string;
  /** 32-byte secret, base64url-no-pad (43 chars). Memory-only. */
  secretB64: string;
}

/** Derive the canonical `frtun1<…>.peer` for a 32-byte secret. */
export function peerNameFromSecretBytes(secret: Uint8Array): string {
  if (secret.length === 0) throw new Error('frtun secret is empty');
  // blake3 XOF filled into a 20-byte buffer == first 20 bytes of the
  // default 32-byte digest (XOF is a prefix-extension of the hash).
  const fp = blake3(secret, { dkLen: PEER_FINGERPRINT_BYTES });
  const words = bech32m.toWords(fp);
  // Infinity = no length cap (peer names exceed the bech32 90-char
  // default ceiling once `.peer` is appended; the bech32 string itself
  // is well under it, but pass Infinity for safety/parity).
  const encoded = bech32m.encode(PEER_HRP, words, Infinity);
  return `${encoded}${PEER_SUFFIX}`;
}

/** Derive the peer name from a base64url-no-pad secret (43 chars). */
export function peerNameFromSecret(secretB64: string): string {
  const bytes = bytesFromB64Url(secretB64.trim());
  return peerNameFromSecretBytes(bytes);
}

/** Generate a fresh frtun peer identity: random 32-byte secret +
 *  derived `frtun1….peer` name. Mirrors the wasm `generatePeer()`. */
export function generatePeer(): FrtunPeer {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  return {
    peerName: peerNameFromSecretBytes(secret),
    secretB64: bytesToB64Url(secret),
  };
}
