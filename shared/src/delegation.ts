/**
 * Delegators — per-DAO vote-delegation entities.
 *
 * A DELEGATOR is created by an address holding the DAO's
 * delegatorThreshold share (0.5%) of circulating supply AT the creation
 * block; nodes verify that and gossip the bundle exactly like proposals.
 *
 * MEMBERSHIP is a stream of signed join/leave actions versioned by a
 * (height, seq) nonce: `height` must be the espo tip ±5 blocks at write
 * time (anti-backdating), `seq` disambiguates multiple actions within
 * one block. The action with the HIGHEST nonce wins everywhere; exact
 * nonce ties converge on the lexicographically smallest signature (same
 * rule as conflicting votes).
 *
 * Tallying: an address whose effective state at the proposal's
 * evaluation height is "joined" cannot vote — its balance rides with
 * its delegator's vote instead.
 */

import * as bitcoin from 'bitcoinjs-lib';

// ---- wire types --------------------------------------------------------

export interface DelegatorContent {
  daoId: string;
  name: string;
  nameZh?: string;
  /** Markdown. */
  description: string;
  descriptionZh?: string;
  /** Optional icon as a base64 data URI (≤5 MB source image). */
  icon?: string;
  /** The address that signs (and votes) for the delegation. */
  delegator: string;
  /** Block the 0.5% eligibility is verified at (~tip at creation). */
  createdAtBlock: number;
  /** ISO 8601. */
  createdAt: string;
}

/**
 * A metadata update pushed by the delegation OWNER. Versioned by the
 * same (height, seq) nonce scheme as membership actions — every node
 * and client keeps the version with the HIGHEST nonce (exact ties break
 * on smallest signature). The delegator's id and creation bundle stay
 * immutable; only display metadata changes.
 */
export interface DelegatorUpdateWire {
  daoId: string;
  delegatorId: string;
  name: string;
  nameZh?: string;
  description: string;
  descriptionZh?: string;
  icon?: string;
  /** Nonce part 1: espo tip at signing (nodes allow ±5 blocks). */
  height: number;
  /** Nonce part 2: intra-block sequence. */
  seq: number;
  /** BIP-322 simple by the OWNER over the update message. */
  signature: string;
  /** ISO 8601 (informational). */
  updatedAt: string;
}

export interface DelegatorWire extends DelegatorContent {
  /** sha256 hex of the canonical content. */
  id: string;
}

export interface DelegatorBundle {
  delegator: DelegatorWire;
  /** BIP-322 simple by the delegator address over the create message. */
  signature: string;
  /** Highest-nonce metadata update, when the owner has pushed one. */
  update?: DelegatorUpdateWire;
}

/** Display metadata: the latest update when present, else creation. */
export function effectiveDelegatorMeta(bundle: DelegatorBundle): {
  name: string;
  nameZh?: string;
  description: string;
  descriptionZh?: string;
  icon?: string;
} {
  const src = bundle.update ?? bundle.delegator;
  return {
    name: src.name,
    nameZh: src.nameZh,
    description: src.description,
    descriptionZh: src.descriptionZh,
    icon: src.icon,
  };
}

export type DelegationActionKind = 'join' | 'leave';

export interface DelegationActionWire {
  daoId: string;
  delegatorId: string;
  /** The member address performing the action. */
  address: string;
  action: DelegationActionKind;
  /** Nonce, part 1: espo tip at signing (nodes allow ±5 blocks). */
  height: number;
  /** Nonce, part 2: intra-block sequence; higher wins within a height. */
  seq: number;
  /** BIP-322 simple by `address` over the canonical action message. */
  signature: string;
  /** ISO 8601 (informational). */
  signedAt: string;
}

// ---- canonical id + messages ------------------------------------------

export function canonicalizeDelegator(d: DelegatorContent): string {
  return JSON.stringify({
    daoId: d.daoId,
    name: d.name,
    nameZh: d.nameZh ?? '',
    description: d.description,
    descriptionZh: d.descriptionZh ?? '',
    // Only present when set — keeps pre-icon delegator ids verifiable.
    ...(d.icon ? { icon: d.icon } : {}),
    delegator: d.delegator,
    createdAtBlock: d.createdAtBlock,
    createdAt: d.createdAt,
  });
}

export function canonicalizeDelegatorUpdate(
  u: Omit<DelegatorUpdateWire, 'signature' | 'updatedAt'>,
): string {
  return JSON.stringify({
    daoId: u.daoId,
    delegatorId: u.delegatorId,
    name: u.name,
    nameZh: u.nameZh ?? '',
    description: u.description,
    descriptionZh: u.descriptionZh ?? '',
    icon: u.icon ?? '',
    height: u.height,
    seq: u.seq,
  });
}

export function computeDelegatorUpdateId(
  u: Omit<DelegatorUpdateWire, 'signature' | 'updatedAt'>,
): string {
  return Buffer.from(
    bitcoin.crypto.sha256(Buffer.from(canonicalizeDelegatorUpdate(u), 'utf8')),
  ).toString('hex');
}

/** The message the owner signs to update metadata. The id commits to
 *  every field including the nonce. */
export function buildDelegatorUpdateSignMessage(
  delegatorId: string,
  updateId: string,
): string {
  return `Update delegator ${delegatorId} with update id: ${updateId}`;
}

export function computeDelegatorId(d: DelegatorContent): string {
  return Buffer.from(
    bitcoin.crypto.sha256(Buffer.from(canonicalizeDelegator(d), 'utf8')),
  ).toString('hex');
}

/** The message the creating address signs. */
export function buildDelegatorSignMessage(delegatorId: string): string {
  return `Create delegator with delegator id: ${delegatorId}`;
}

/** The message a member signs to join/leave. Embeds the (height, seq)
 *  nonce so every action is totally ordered and non-replayable. */
export function buildDelegationActionMessage(
  a: Pick<DelegationActionWire, 'daoId' | 'delegatorId' | 'action' | 'height' | 'seq'>,
): string {
  return [
    'Surtur delegation',
    `dao: ${a.daoId}`,
    `delegator: ${a.delegatorId}`,
    `action: ${a.action.toUpperCase()}`,
    `height: ${a.height}`,
    `seq: ${a.seq}`,
  ].join('\n');
}

// ---- nonce ordering + effective state ----------------------------------

/** Anything carrying the (height, seq, signature) nonce triple. */
export interface NonceCarrier {
  height: number;
  seq: number;
  signature: string;
}

/** (height, seq) ordering; exact ties break on ascending signature so
 *  every node/client picks the same winner. Returns >0 if a wins. */
export function compareActions(a: NonceCarrier, b: NonceCarrier): number {
  if (a.height !== b.height) return a.height - b.height;
  if (a.seq !== b.seq) return a.seq - b.seq;
  // Lower signature WINS a tie — so "a beats b" when a.signature < b.signature.
  return a.signature < b.signature ? 1 : a.signature > b.signature ? -1 : 0;
}

/**
 * Effective membership at `evalHeight`: for each address, the action
 * with the highest nonce whose height <= evalHeight decides. Returns
 * address → delegatorId for currently-joined addresses only.
 */
export function resolveDelegationState(
  actions: DelegationActionWire[],
  evalHeight: number,
): Map<string, string> {
  const best = new Map<string, DelegationActionWire>();
  for (const action of actions) {
    if (action.height > evalHeight) continue;
    const current = best.get(action.address);
    if (!current || compareActions(action, current) > 0) best.set(action.address, action);
  }
  const state = new Map<string, string>();
  for (const [address, action] of best) {
    if (action.action === 'join') state.set(address, action.delegatorId);
  }
  return state;
}

/**
 * Member addresses joined to `delegatorId` at `evalHeight` (excluding
 * the signer). Used for the delegated-power proposal threshold: a
 * delegation owner proposes with own + members' balances, membership
 * and balances both pinned at the proposal's start block.
 */
export function delegationMembersAt(
  signer: string,
  delegatorId: string,
  actions: DelegationActionWire[],
  evalHeight: number,
): string[] {
  const state = resolveDelegationState(actions, evalHeight);
  const members: string[] = [];
  for (const [address, id] of state) {
    if (id === delegatorId && address !== signer) members.push(address);
  }
  return members;
}

// ---- delegation-aware tally ---------------------------------------------

export interface DelegatedVote {
  address: string;
  choice: 'for' | 'against' | 'abstain';
}

export interface DelegatedTallyResult {
  forPower: bigint;
  againstPower: bigint;
  abstainPower: bigint;
  /** Addresses whose votes were ignored (delegated at evalHeight). */
  ignored: Set<string>;
  /** voter address → power counted for that vote (own + delegated). */
  powerByVoter: Map<string, bigint>;
}

/**
 * The ONE tally used by nodes, the orchestrator, and the frontend:
 *  - votes from addresses that are delegated at evalHeight are IGNORED;
 *  - a vote by a delegator's signer address carries its own balance
 *    PLUS every joined member's balance (member self-joins dedupe).
 */
export function computeDelegatedTally(opts: {
  votes: DelegatedVote[];
  /** address → voting-token balance at the evaluation height. */
  balances: Map<string, bigint>;
  /** All delegation actions for the DAO (any height; filtered inside). */
  actions: DelegationActionWire[];
  /** delegator signer address → delegatorId. */
  delegatorsBySigner: Map<string, string>;
  evalHeight: number;
}): DelegatedTallyResult {
  const state = resolveDelegationState(opts.actions, opts.evalHeight);

  const membersByDelegator = new Map<string, string[]>();
  for (const [address, delegatorId] of state) {
    const list = membersByDelegator.get(delegatorId) ?? [];
    list.push(address);
    membersByDelegator.set(delegatorId, list);
  }

  const result: DelegatedTallyResult = {
    forPower: 0n,
    againstPower: 0n,
    abstainPower: 0n,
    ignored: new Set(),
    powerByVoter: new Map(),
  };

  for (const vote of opts.votes) {
    if (state.has(vote.address)) {
      result.ignored.add(vote.address);
      continue;
    }
    let power = opts.balances.get(vote.address) ?? 0n;
    const delegatorId = opts.delegatorsBySigner.get(vote.address);
    if (delegatorId) {
      for (const member of membersByDelegator.get(delegatorId) ?? []) {
        if (member === vote.address) continue; // self-join dedupe
        power += opts.balances.get(member) ?? 0n;
      }
    }
    result.powerByVoter.set(vote.address, power);
    if (vote.choice === 'for') result.forPower += power;
    else if (vote.choice === 'against') result.againstPower += power;
    else result.abstainPower += power;
  }

  return result;
}
