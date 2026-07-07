/** Wire types exchanged between the frontend and surtur nodes. */

export interface TransferWire {
  /** Recipient Bitcoin address. */
  address: string;
  /** Treasury-token amount in display units, decimal string. */
  amount: string;
}

/**
 * A proposal as it travels the network. `id` is DERIVED — the sha256 of
 * the canonical serialization of every other field (see proposal.ts) — so
 * any mutation to the content invalidates both the id and the signature.
 */
export interface ProposalWire {
  id: string;
  daoId: string;
  title: string;
  titleZh?: string;
  /** Markdown body. */
  body: string;
  bodyZh?: string;
  transfers: TransferWire[];
  /** Address that created (and signed) the proposal. */
  proposer: string;
  startBlock: number;
  endBlock: number;
  /** ISO 8601. */
  createdAt: string;
}

/** What the frontend POSTs to every whitelisted node (and nodes relay). */
export interface ProposalBundle {
  proposal: ProposalWire;
  /** BIP-322 simple signature by `proposal.proposer` over the proposal id. */
  signature: string;
}

export type VoteChoiceWire = 'for' | 'against' | 'abstain';

/**
 * A proposal resolution: the DAO's resolver describes how a PASSED
 * proposal was executed. `resolutionId` is the sha256 of the resolution
 * markdown, and the resolver signs
 * "Resolve proposal id: <proposalId> with resolution <resolutionId>".
 * One resolution per proposal (first valid one wins).
 */
export interface ResolutionWire {
  proposalId: string;
  daoId: string;
  /** sha256 hex of `resolution`. */
  resolutionId: string;
  /** Resolution markdown. */
  resolution: string;
  /** The resolver's address (must be the DAO's resolverSigner — enforced
   * by surtur nodes; the frontend deliberately does NOT re-check so past
   * resolutions survive a resolverSigner change). */
  address: string;
  /** BIP-322 simple signature over the resolve message. */
  signature: string;
  /** ISO 8601. */
  resolvedAt: string;
}

export interface VoteWire {
  proposalId: string;
  daoId: string;
  /** Voting wallet address (BIP-322 signer). */
  address: string;
  choice: VoteChoiceWire;
  /** BIP-322 simple signature over `message`. */
  signature: string;
  /** The exact signed message (see buildVoteMessage). */
  message: string;
  /** ISO 8601. */
  votedAt: string;
}

/** Orchestrator payload gossiped to nodes: peers + DAO configurations. */
export interface OrchestratorInfo {
  nodes: string[];
  daos: OrchestratorDao[];
}

/**
 * One fork entry of a threshold schedule: `pctg` applies from `height`
 * onward (until a later entry's height). Keying thresholds to fork heights
 * means changing them later never bleeds into proposals whose anchor block
 * predates the fork — finalized verdicts stay exactly as they were.
 */
export interface ThresholdForkEntry {
  height: number;
  /** Percent, 0-100 (fractions allowed, e.g. 0.5). */
  pctg: number;
}

export type ThresholdSchedule = ThresholdForkEntry[];

/** The pctg in force at `height`: the highest fork entry not above it. */
export function resolveThreshold(schedule: ThresholdSchedule, height: number): number {
  if (schedule.length === 0) return 0;
  const sorted = [...schedule].sort((a, b) => a.height - b.height);
  let pctg = sorted[0].pctg;
  for (const entry of sorted) {
    if (entry.height <= height) pctg = entry.pctg;
  }
  return pctg;
}

/**
 * `pctg`% of `supply` in base units — basis-point math so fractional
 * percentages (0.5%) stay exact under bigint.
 */
export function thresholdPower(supply: bigint, pctg: number): bigint {
  return (supply * BigInt(Math.round(pctg * 100))) / 10_000n;
}

export interface OrchestratorDao {
  id: string;
  name: string;
  enabled: boolean;
  treasuryToken: { alkaneId: string; symbol: string };
  treasuryAddress: string;
  votingToken: { alkaneId: string; symbol: string };
  resolverSigner: string;
  /** Fork-height schedule for the create-proposal threshold. */
  proposalThreshold: ThresholdSchedule;
  /** Fork-height schedule for the vote-pass threshold. */
  votePassThreshold: ThresholdSchedule;
  espoNetwork: string;
  espoUrl: string;
}
