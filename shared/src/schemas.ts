/**
 * Structural zod validation for network bundles — the SAME shape rules the
 * frontend enforces at proposal creation, re-run by every surtur node on
 * every incoming POST (never trust the client).
 */

import { z } from 'zod';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';

let eccReady = false;
function ensureEcc() {
  if (!eccReady) {
    bitcoin.initEccLib(ecc);
    eccReady = true;
  }
}

const NETWORKS: Record<string, bitcoin.Network> = {
  mainnet: bitcoin.networks.bitcoin,
  testnet: bitcoin.networks.testnet,
  signet: bitcoin.networks.testnet,
  regtest: bitcoin.networks.regtest,
};

export function isValidAddress(address: string, espoNetwork: string): boolean {
  try {
    ensureEcc();
    bitcoin.address.toOutputScript(address, NETWORKS[espoNetwork] ?? bitcoin.networks.bitcoin);
    return true;
  } catch {
    return false;
  }
}

export const tokenAmountWireSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,8})?$/)
  .refine((s) => Number(s) > 0);

export const transferWireSchema = z.object({
  address: z.string().trim().min(1),
  amount: tokenAmountWireSchema,
});

const blockSchema = z.number().int().positive();

export const proposalWireSchema = z
  .object({
    id: z.string().regex(/^[0-9a-f]{64}$/),
    daoId: z.string().min(1),
    title: z.string().trim().min(1).max(200),
    titleZh: z.string().max(200).optional(),
    body: z.string().max(20_000_000),
    bodyZh: z.string().max(20_000_000).optional(),
    transfers: z.array(transferWireSchema).max(100),
    proposer: z.string().trim().min(1),
    startBlock: blockSchema,
    endBlock: blockSchema,
    createdAt: z.string().refine((s) => Number.isFinite(Date.parse(s))),
  })
  .refine((p) => p.endBlock > p.startBlock, { message: 'endBlock must be after startBlock' });

export const proposalBundleSchema = z.object({
  proposal: proposalWireSchema,
  signature: z.string().min(1).max(4096),
});

/** Base64 data-URI icon — same 5 MB source cap as markdown images
 *  (base64 inflates ~4/3, plus the data: header). */
const delegatorIconSchema = z
  .string()
  .regex(/^data:image\//)
  .max(7_200_000);

export const delegatorBundleSchema = z.object({
  delegator: z.object({
    id: z.string().regex(/^[0-9a-f]{64}$/),
    daoId: z.string().min(1),
    name: z.string().trim().min(1).max(120),
    nameZh: z.string().trim().min(1).max(120).optional(),
    description: z.string().min(1).max(20_000_000),
    descriptionZh: z.string().min(1).max(20_000_000).optional(),
    icon: delegatorIconSchema.optional(),
    delegator: z.string().trim().min(1),
    createdAtBlock: z.number().int().nonnegative(),
    createdAt: z.string().refine((s) => Number.isFinite(Date.parse(s))),
  }),
  signature: z.string().min(1).max(4096),
});

export const delegatorUpdateSchema = z.object({
  daoId: z.string().min(1),
  delegatorId: z.string().regex(/^[0-9a-f]{64}$/),
  name: z.string().trim().min(1).max(120),
  nameZh: z.string().trim().min(1).max(120).optional(),
  description: z.string().min(1).max(20_000_000),
  descriptionZh: z.string().min(1).max(20_000_000).optional(),
  icon: delegatorIconSchema.optional(),
  height: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative().max(1_000_000),
  signature: z.string().min(1).max(4096),
  updatedAt: z.string().refine((s) => Number.isFinite(Date.parse(s))),
});

export const delegationActionSchema = z.object({
  daoId: z.string().min(1),
  delegatorId: z.string().regex(/^[0-9a-f]{64}$/),
  address: z.string().trim().min(1),
  action: z.enum(['join', 'leave']),
  height: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative().max(1_000_000),
  signature: z.string().min(1).max(4096),
  signedAt: z.string().refine((s) => Number.isFinite(Date.parse(s))),
});

export const resolutionWireSchema = z.object({
  proposalId: z.string().regex(/^[0-9a-f]{64}$/),
  daoId: z.string().min(1),
  resolutionId: z.string().regex(/^[0-9a-f]{64}$/),
  resolution: z.string().min(1).max(20_000_000),
  address: z.string().trim().min(1),
  signature: z.string().min(1).max(4096),
  resolvedAt: z.string().refine((s) => Number.isFinite(Date.parse(s))),
});

export const voteWireSchema = z.object({
  proposalId: z.string().regex(/^[0-9a-f]{64}$/),
  daoId: z.string().min(1),
  address: z.string().trim().min(1),
  choice: z.enum(['for', 'against', 'abstain']),
  signature: z.string().min(1).max(4096),
  message: z.string().min(1).max(4096),
  votedAt: z.string().refine((s) => Number.isFinite(Date.parse(s))),
});
