/**
 * Crypto smoke test: proves the full proposal/vote signing pipeline
 * end-to-end WITHOUT a wallet — generates a taproot key, signs BIP-322
 * exactly like the SUBFROST keystore does, and runs it through
 * @surtur/shared's verification + zod validation.
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { randomBytes } from 'node:crypto';
import {
  buildProposalSignMessage,
  buildVoteMessage,
  computeProposalId,
  proposalBundleSchema,
  verifyProposalBundle,
  verifyVoteWire,
  voteWireSchema,
  bip322MessageHash,
  type ProposalContent,
  type VoteWire,
} from '@surtur/shared';

bitcoin.initEccLib(ecc);

// ---- minimal taproot BIP-322 signer (mirrors subfrost-app's) ----------

function makeKey() {
  let priv: Buffer;
  do {
    priv = randomBytes(32);
  } while (!ecc.isPrivate(priv));
  const pub = Buffer.from(ecc.pointFromScalar(priv, true)!);
  return { priv, pub };
}

function signBip322P2tr(message: string, priv: Buffer, pub: Buffer): { address: string; signature: string } {
  const network = bitcoin.networks.bitcoin;
  const internalPubkey = pub.subarray(1, 33);
  const { address, output } = bitcoin.payments.p2tr({ internalPubkey, network });
  if (!address || !output) throw new Error('p2tr derivation failed');

  // to_spend / to_sign per BIP-322
  const messageHash = bip322MessageHash(message);
  const toSpend = new bitcoin.Transaction();
  toSpend.version = 0;
  toSpend.locktime = 0;
  toSpend.addInput(
    Buffer.alloc(32, 0),
    0xffffffff,
    0,
    bitcoin.script.compile([bitcoin.opcodes.OP_0, messageHash]),
  );
  toSpend.addOutput(Buffer.from(output), BigInt(0));

  const toSign = new bitcoin.Transaction();
  toSign.version = 0;
  toSign.locktime = 0;
  toSign.addInput(Buffer.from(toSpend.getId(), 'hex').reverse(), 0, 0);
  toSign.addOutput(bitcoin.script.compile([bitcoin.opcodes.OP_RETURN]), BigInt(0));

  // taproot key tweak
  let d = priv;
  if (pub[0] === 0x03) d = Buffer.from(ecc.privateNegate(d));
  const tweak = bitcoin.crypto.taggedHash('TapTweak', internalPubkey);
  const tweaked = ecc.privateAdd(d, tweak);
  if (!tweaked) throw new Error('tweak failed');

  const sighash = toSign.hashForWitnessV1(
    0,
    [Buffer.from(output)],
    [BigInt(0)],
    bitcoin.Transaction.SIGHASH_DEFAULT,
  );
  const sig = Buffer.from(ecc.signSchnorr(sighash, tweaked, randomBytes(32)));

  // witness stack encode: [sig]
  const witness = Buffer.concat([Buffer.from([1]), Buffer.from([sig.length]), sig]);
  return { address, signature: witness.toString('base64') };
}

// ---- tests -------------------------------------------------------------

let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

const { priv, pub } = makeKey();
const probe = signBip322P2tr('probe', priv, pub);
const proposer = probe.address;

const content: ProposalContent = {
  daoId: 'alkanes',
  title: 'Test proposal',
  body: '# hello',
  transfers: [{ address: proposer, amount: '12.5' }],
  proposer,
  startBlock: 957000,
  endBlock: 958008,
  createdAt: new Date().toISOString(),
};

const id = computeProposalId(content);
check('id is 64-hex sha256', /^[0-9a-f]{64}$/.test(id));
check('id deterministic', computeProposalId({ ...content }) === id);
check(
  'id changes when content changes',
  computeProposalId({ ...content, title: 'Tampered' }) !== id,
);

const { signature } = signBip322P2tr(buildProposalSignMessage(id), priv, pub);
const bundle = { proposal: { ...content, id }, signature };

check('zod accepts bundle', proposalBundleSchema.safeParse(bundle).success);
check('verifyProposalBundle accepts valid bundle', verifyProposalBundle(bundle).ok);
check(
  'verify rejects tampered title (id mismatch)',
  !verifyProposalBundle({ ...bundle, proposal: { ...bundle.proposal, title: 'Evil' } }).ok,
);
{
  const evil = { ...content, title: 'Evil' };
  const evilId = computeProposalId(evil);
  check(
    'verify rejects re-hashed tamper (signature mismatch)',
    !verifyProposalBundle({ proposal: { ...evil, id: evilId }, signature }).ok,
  );
}
{
  const other = makeKey();
  const otherSig = signBip322P2tr(buildProposalSignMessage(id), other.priv, other.pub).signature;
  check(
    'verify rejects signature from a different key',
    !verifyProposalBundle({ proposal: { ...content, id }, signature: otherSig }).ok,
  );
}

// votes
const voteMessage = buildVoteMessage('alkanes', id, content.title, 'for');
const voteSig = signBip322P2tr(voteMessage, priv, pub);
const vote: VoteWire = {
  proposalId: id,
  daoId: 'alkanes',
  address: proposer,
  choice: 'for',
  signature: voteSig.signature,
  message: voteMessage,
  votedAt: new Date().toISOString(),
};
check('zod accepts vote', voteWireSchema.safeParse(vote).success);
check('verifyVoteWire accepts valid vote', verifyVoteWire(vote, content.title).ok);
check(
  'verify rejects flipped choice (message mismatch)',
  !verifyVoteWire({ ...vote, choice: 'against' }, content.title).ok,
);
check(
  'verify rejects vote for a different proposal title',
  !verifyVoteWire(vote, 'Some other title').ok,
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
