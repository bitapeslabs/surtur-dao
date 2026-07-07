/**
 * BIP-322 "simple" signature verification — vendor-native port of the
 * alkanes-rs ts-sdk `verifyMessageSimple` (mirrors the SDK algorithm; the
 * published SDK bundles its own inlined bitcoinjs-lib and can't be called
 * cross-instance, so we use the vendor's own bitcoinjs v7).
 *
 * Verify-only (no signing) → needs only ecc.verify / ecc.verifySchnorr, so
 * no `ecpair` dependency. Supports P2WPKH and P2TR key-path — the two types
 * the SUBFROST keystore produces. Interoperable "simple" format (base64 of
 * the to_sign witness stack, no variant prefix).
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';

bitcoin.initEccLib(ecc);

const BIP322_TAG = 'BIP0322-signed-message';

export function bip322MessageHash(message: string): Buffer {
  const tagHash = bitcoin.crypto.sha256(Buffer.from(BIP322_TAG, 'utf8'));
  const msg = Buffer.from(message, 'utf8');
  return Buffer.from(bitcoin.crypto.sha256(Buffer.concat([tagHash, tagHash, msg])));
}

function buildToSpend(scriptPubKey: Buffer, message: string): bitcoin.Transaction {
  const messageHash = bip322MessageHash(message);
  const tx = new bitcoin.Transaction();
  tx.version = 0;
  tx.locktime = 0;
  const scriptSig = bitcoin.script.compile([bitcoin.opcodes.OP_0, messageHash]);
  tx.addInput(Buffer.alloc(32, 0), 0xffffffff, 0, scriptSig);
  tx.addOutput(scriptPubKey, BigInt(0));
  return tx;
}

function buildToSign(toSpendTxid: string): bitcoin.Transaction {
  const tx = new bitcoin.Transaction();
  tx.version = 0;
  tx.locktime = 0;
  tx.addInput(Buffer.from(toSpendTxid, 'hex').reverse(), 0, 0);
  tx.addOutput(bitcoin.script.compile([bitcoin.opcodes.OP_RETURN]), BigInt(0));
  return tx;
}

function readCompactSize(buf: Buffer, offset: number): { value: number; size: number } {
  const first = buf[offset];
  if (first < 0xfd) return { value: first, size: 1 };
  if (first === 0xfd) return { value: buf.readUInt16LE(offset + 1), size: 3 };
  if (first === 0xfe) return { value: buf.readUInt32LE(offset + 1), size: 5 };
  return { value: Number(buf.readBigUInt64LE(offset + 1)), size: 9 };
}

function decodeWitnessStack(buf: Buffer): Buffer[] {
  let offset = 0;
  const count = readCompactSize(buf, offset);
  offset += count.size;
  const items: Buffer[] = [];
  for (let i = 0; i < count.value; i++) {
    const len = readCompactSize(buf, offset);
    offset += len.size;
    items.push(buf.subarray(offset, offset + len.value));
    offset += len.value;
  }
  return items;
}

type ScriptType = 'p2wpkh' | 'p2tr';

function classifyScript(scriptPubKey: Buffer): ScriptType {
  if (scriptPubKey.length === 22 && scriptPubKey[0] === 0x00 && scriptPubKey[1] === 0x14) {
    return 'p2wpkh';
  }
  if (scriptPubKey.length === 34 && scriptPubKey[0] === 0x51 && scriptPubKey[1] === 0x20) {
    return 'p2tr';
  }
  throw new Error('BIP-322: unsupported address type (only P2WPKH and P2TR key-path)');
}

export interface VerifyMessageParams {
  message: string;
  address: string;
  /** Base64 BIP-322 simple signature. */
  signature: string;
  network: bitcoin.Network;
}

/**
 * Verify a BIP-322 simple signature for a P2WPKH or P2TR address.
 * Returns false (never throws) on any malformed input or mismatch.
 */
export function verifyMessageSimple(params: VerifyMessageParams): boolean {
  try {
    const { message, address, signature, network } = params;
    const scriptPubKey = Buffer.from(bitcoin.address.toOutputScript(address, network));
    const type = classifyScript(scriptPubKey);
    const witness = decodeWitnessStack(Buffer.from(signature, 'base64'));
    const toSpend = buildToSpend(scriptPubKey, message);
    const toSign = buildToSign(toSpend.getId());

    if (type === 'p2wpkh') {
      if (witness.length !== 2) return false;
      const [sig, pubkey] = witness;
      const program = scriptPubKey.subarray(2);
      if (!Buffer.from(bitcoin.crypto.hash160(pubkey)).equals(Buffer.from(program))) return false;
      const decoded = bitcoin.script.signature.decode(sig);
      const scriptCode = bitcoin.script.compile([
        bitcoin.opcodes.OP_DUP,
        bitcoin.opcodes.OP_HASH160,
        bitcoin.crypto.hash160(pubkey),
        bitcoin.opcodes.OP_EQUALVERIFY,
        bitcoin.opcodes.OP_CHECKSIG,
      ]);
      const sighash = toSign.hashForWitnessV0(0, scriptCode, BigInt(0), decoded.hashType);
      return ecc.verify(sighash, pubkey, decoded.signature);
    }

    if (witness.length !== 1) return false;
    const sig = witness[0];
    let hashType = bitcoin.Transaction.SIGHASH_DEFAULT;
    let sig64 = sig;
    if (sig.length === 65) {
      hashType = sig[64];
      sig64 = sig.subarray(0, 64);
    } else if (sig.length !== 64) {
      return false;
    }
    const outputKey = scriptPubKey.subarray(2);
    const sighash = toSign.hashForWitnessV1(0, [scriptPubKey], [BigInt(0)], hashType);
    return ecc.verifySchnorr(sighash, outputKey, sig64);
  } catch {
    return false;
  }
}
