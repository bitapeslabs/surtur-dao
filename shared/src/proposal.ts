/**
 * Canonical proposal serialization + id derivation.
 *
 * The proposal id IS the sha256 of the canonical JSON of all content
 * fields (title/body/transfers/proposer/window/…): tamper with anything
 * and the id — and therefore the proposer's signature over it — breaks.
 * Field order is fixed explicitly; never rely on object key order.
 */

import * as bitcoin from 'bitcoinjs-lib';
import type { ProposalWire, VoteChoiceWire } from './types';

export type ProposalContent = Omit<ProposalWire, 'id'>;

export function canonicalizeProposal(p: ProposalContent): string {
  return JSON.stringify({
    daoId: p.daoId,
    title: p.title,
    titleZh: p.titleZh ?? '',
    body: p.body,
    bodyZh: p.bodyZh ?? '',
    transfers: p.transfers.map((t) => ({ address: t.address, amount: t.amount })),
    proposer: p.proposer,
    startBlock: p.startBlock,
    endBlock: p.endBlock,
    createdAt: p.createdAt,
  });
}

/** sha256 hex of the canonical serialization — the proposal's identity. */
export function computeProposalId(p: ProposalContent): string {
  return Buffer.from(
    bitcoin.crypto.sha256(Buffer.from(canonicalizeProposal(p), 'utf8')),
  ).toString('hex');
}

/**
 * The message the proposer signs. It embeds the proposal's sha256 id, so
 * the signature commits to every content field at once — and reads as a
 * human sentence in the signing popup.
 */
export function buildProposalSignMessage(proposalId: string): string {
  return `Create proposal with proposal id: ${proposalId}`;
}

/** sha256 hex of the resolution markdown — the resolution's identity. */
export function computeResolutionId(resolution: string): string {
  return Buffer.from(bitcoin.crypto.sha256(Buffer.from(resolution, 'utf8'))).toString('hex');
}

/** The message the DAO's resolver signs when resolving a passed proposal. */
export function buildResolutionSignMessage(proposalId: string, resolutionId: string): string {
  return `Resolve proposal id: ${proposalId} with resolution ${resolutionId}`;
}

/**
 * The canonical message a voter signs. Deterministic so any node can
 * rebuild and verify it from (daoId, proposalId, title, choice).
 */
export function buildVoteMessage(
  daoId: string,
  proposalId: string,
  title: string,
  choice: VoteChoiceWire,
): string {
  return [
    'Surtur DAO vote',
    `dao: ${daoId}`,
    `proposal: ${proposalId}`,
    `title: ${title}`,
    `vote: ${choice.toUpperCase()}`,
  ].join('\n');
}
