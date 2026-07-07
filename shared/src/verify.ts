/**
 * Signature + integrity verification for network bundles — used by BOTH
 * the frontend (when merging node responses) and surtur nodes (when
 * accepting posts). Signatures are BIP-322 "simple" (P2WPKH / P2TR
 * key-path — what the SUBFROST keystore produces), verified against the
 * signer's ADDRESS.
 */

import * as bitcoin from 'bitcoinjs-lib';
import { verifyMessageSimple } from './bip322';
import {
  buildProposalSignMessage,
  buildResolutionSignMessage,
  buildVoteMessage,
  computeProposalId,
  computeResolutionId,
} from './proposal';
import type { ProposalBundle, ResolutionWire, VoteWire } from './types';

/** Pick the bitcoinjs network from a bech32 address prefix. */
export function networkForAddress(address: string): bitcoin.Network | null {
  const a = address.trim().toLowerCase();
  if (a.startsWith('bc1')) return bitcoin.networks.bitcoin;
  if (a.startsWith('tb1')) return bitcoin.networks.testnet;
  if (a.startsWith('bcrt1')) return bitcoin.networks.regtest;
  return null;
}

export interface VerifyResult {
  ok: boolean;
  error?: string;
}

/**
 * Integrity + signature check for a proposal bundle:
 *  1. the id matches the sha256 of the canonical content;
 *  2. the proposer's BIP-322 signature over that id verifies.
 * (The proposal-threshold check needs espo and lives with the caller.)
 */
export function verifyProposalBundle(bundle: ProposalBundle): VerifyResult {
  const { proposal, signature } = bundle;
  const computed = computeProposalId(proposal);
  if (computed !== proposal.id) {
    return { ok: false, error: 'id mismatch: proposal content does not hash to its id' };
  }
  const network = networkForAddress(proposal.proposer);
  if (!network) return { ok: false, error: 'unsupported proposer address' };
  const valid = verifyMessageSimple({
    message: buildProposalSignMessage(proposal.id),
    address: proposal.proposer,
    signature,
    network,
  });
  return valid ? { ok: true } : { ok: false, error: 'invalid proposer signature' };
}

/**
 * Integrity + signature check for a resolution:
 *  1. resolutionId matches the sha256 of the resolution markdown;
 *  2. the signer's BIP-322 signature over the resolve message verifies.
 * (Whether the signer IS the DAO's resolverSigner is checked by surtur
 * nodes against their synced DAO config — not here.)
 */
export function verifyResolutionWire(res: ResolutionWire): VerifyResult {
  if (computeResolutionId(res.resolution) !== res.resolutionId) {
    return { ok: false, error: 'resolutionId mismatch: content does not hash to its id' };
  }
  const network = networkForAddress(res.address);
  if (!network) return { ok: false, error: 'unsupported resolver address' };
  const valid = verifyMessageSimple({
    message: buildResolutionSignMessage(res.proposalId, res.resolutionId),
    address: res.address,
    signature: res.signature,
    network,
  });
  return valid ? { ok: true } : { ok: false, error: 'invalid resolver signature' };
}

/**
 * Integrity + signature check for a vote:
 *  1. the signed message is exactly the canonical vote message;
 *  2. the voter's BIP-322 signature over it verifies.
 * (The has-any-voting-token check needs espo and lives with the caller.)
 */
export function verifyVoteWire(vote: VoteWire, proposalTitle: string): VerifyResult {
  const expected = buildVoteMessage(vote.daoId, vote.proposalId, proposalTitle, vote.choice);
  if (vote.message !== expected) {
    return { ok: false, error: 'message mismatch: not the canonical vote message' };
  }
  const network = networkForAddress(vote.address);
  if (!network) return { ok: false, error: 'unsupported voter address' };
  const valid = verifyMessageSimple({
    message: vote.message,
    address: vote.address,
    signature: vote.signature,
    network,
  });
  return valid ? { ok: true } : { ok: false, error: 'invalid vote signature' };
}
