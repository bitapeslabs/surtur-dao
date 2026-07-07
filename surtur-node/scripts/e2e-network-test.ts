/**
 * Live network e2e: signs a real proposal bundle with a throwaway taproot
 * key, POSTs it to node :3007 ONLY, and asserts:
 *   1. :3007 accepted it (validation pipeline works),
 *   2. :3008 has it too (p2p relay works),
 *   3. re-POST answers known:true (gossip termination),
 *   4. a tampered bundle is rejected,
 *   5. a vote from a non-FIRE-holder is rejected (espo check).
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { randomBytes } from 'node:crypto';
import {
  bip322MessageHash,
  buildProposalSignMessage,
  buildVoteMessage,
  computeProposalId,
  type ProposalContent,
} from '@surtur/shared';

bitcoin.initEccLib(ecc);

function makeKey() {
  let priv: Buffer;
  do {
    priv = randomBytes(32);
  } while (!ecc.isPrivate(priv));
  return { priv, pub: Buffer.from(ecc.pointFromScalar(priv, true)!) };
}

function signBip322P2tr(message: string, priv: Buffer, pub: Buffer) {
  const network = bitcoin.networks.bitcoin;
  const internalPubkey = pub.subarray(1, 33);
  const { address, output } = bitcoin.payments.p2tr({ internalPubkey, network });
  if (!address || !output) throw new Error('p2tr failed');
  const messageHash = bip322MessageHash(message);
  const toSpend = new bitcoin.Transaction();
  toSpend.version = 0;
  toSpend.addInput(Buffer.alloc(32, 0), 0xffffffff, 0, bitcoin.script.compile([bitcoin.opcodes.OP_0, messageHash]));
  toSpend.addOutput(Buffer.from(output), BigInt(0));
  const toSign = new bitcoin.Transaction();
  toSign.version = 0;
  toSign.addInput(Buffer.from(toSpend.getId(), 'hex').reverse(), 0, 0);
  toSign.addOutput(bitcoin.script.compile([bitcoin.opcodes.OP_RETURN]), BigInt(0));
  let d = priv;
  if (pub[0] === 0x03) d = Buffer.from(ecc.privateNegate(d));
  const tweaked = ecc.privateAdd(d, bitcoin.crypto.taggedHash('TapTweak', internalPubkey))!;
  const sighash = toSign.hashForWitnessV1(0, [Buffer.from(output)], [BigInt(0)], 0);
  const sig = Buffer.from(ecc.signSchnorr(sighash, tweaked, randomBytes(32)));
  const witness = Buffer.concat([Buffer.from([1]), Buffer.from([sig.length]), sig]);
  return { address, signature: witness.toString('base64') };
}

const A = 'http://localhost:3007';
const B = 'http://localhost:3008';

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  ← ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
}

const { priv, pub } = makeKey();
const probe = signBip322P2tr('probe', priv, pub);

const content: ProposalContent = {
  daoId: 'alkanes',
  title: `E2E network test ${Date.now()}`,
  body: 'posted to :3007 only — :3008 must receive it via relay',
  transfers: [],
  proposer: probe.address,
  startBlock: 956900,
  endBlock: 1_100_000,
  createdAt: new Date().toISOString(),
};
const id = computeProposalId(content);
const { signature } = signBip322P2tr(buildProposalSignMessage(id), priv, pub);
const bundle = { proposal: { ...content, id }, signature };

// 1) POST to node A only
const r1 = await post(`${A}/proposals`, bundle);
check('node A accepts the signed proposal', r1.status === 200 && r1.json?.ok === true, r1);

// 2) relay: node B should have it (allow a moment)
await new Promise((r) => setTimeout(r, 1500));
const r2 = await fetch(`${B}/proposals/${id}`).then((r) => r.json());
check('node B received it via p2p relay', r2?.ok === true && r2?.proposal?.id === id, r2);

// 3) dedupe: re-POST to node B answers known:true (gossip stops)
const r3 = await post(`${B}/proposals`, bundle);
check('re-POST answers known:true', r3.json?.ok === true && r3.json?.known === true, r3);

// 4a) same-id tamper: acknowledged as known but MUST NOT overwrite the
// stored content (ids are content-derived — dedupe first is safe).
const evilSameId = { proposal: { ...content, id, title: 'Evil title' }, signature };
await post(`${A}/proposals`, evilSameId);
const stored = await fetch(`${A}/proposals/${id}`).then((r) => r.json());
check('same-id tamper does not overwrite content', stored?.proposal?.title === content.title, stored);

// 4b) consistently re-hashed tamper (fresh id, stale signature) rejected
const evilContent = { ...content, title: 'Evil title' };
const evilId = computeProposalId(evilContent);
const r4 = await post(`${A}/proposals`, { proposal: { ...evilContent, id: evilId }, signature });
check('re-hashed tamper rejected (signature mismatch)', r4.status === 400, r4);

// 5) vote from a non-holder rejected by the espo check
const voteMessage = buildVoteMessage('alkanes', id, content.title, 'for');
const voteSig = signBip322P2tr(voteMessage, priv, pub);
const r5 = await post(`${A}/votes`, {
  proposalId: id,
  daoId: 'alkanes',
  address: probe.address,
  choice: 'for',
  signature: voteSig.signature,
  message: voteMessage,
  votedAt: new Date().toISOString(),
});
check('vote from non-holder rejected (403)', r5.status === 403, r5);

// 6) list endpoints return it on both nodes
for (const [name, base] of [['A', A], ['B', B]] as const) {
  const list = await fetch(`${base}/proposals?dao=alkanes`).then((r) => r.json());
  const found = list?.proposals?.some((p: any) => p.proposal.id === id);
  check(`node ${name} lists the proposal`, !!found);
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nnetwork e2e passed');
