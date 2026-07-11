/**
 * Espo reads for validation — same versioned-DB semantics as the frontend:
 * pass `height` to read the world as of a block.
 */

import {
  computeDelegatedTally,
  resolveDelegationState,
  resolveThreshold,
  thresholdPower,
  type DelegationActionWire,
  type OrchestratorDao,
  type VoteWire,
} from '@surtur/shared';

async function espoBatch(espoUrl: string, requests: any[]): Promise<Map<string, any>> {
  const res = await fetch(espoUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requests),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`espo ${res.status}`);
  const json = await res.json();
  const envelopes: any[] = Array.isArray(json) ? json : [json];
  return new Map(envelopes.map((e: any) => [String(e?.id), e?.result]));
}

export async function fetchEspoTip(espoUrl: string): Promise<number> {
  const results = await espoBatch(espoUrl, [
    { jsonrpc: '2.0', id: 'height', method: 'get_espo_height', params: {} },
  ]);
  const height = Number(results.get('height')?.height);
  if (!Number.isInteger(height) || height <= 0) throw new Error('bad espo height');
  return height;
}

function votingBalanceOf(dao: OrchestratorDao, balancesResult: any): bigint {
  return BigInt(String(balancesResult?.balances?.[dao.votingToken.alkaneId] ?? 0));
}

/**
 * The proposal-opening threshold, checked at the proposal's start block via
 * espo's versioned DB. If the start block is still in the future (espo
 * can't answer for unmined heights) the check runs at the latest state.
 */
export async function proposerMeetsThreshold(
  dao: OrchestratorDao,
  proposer: string,
  startBlock: number,
): Promise<boolean> {
  // The schedule entry in force AT the start block — later forks never
  // re-judge older proposals.
  const pctg = resolveThreshold(dao.proposalThreshold, startBlock);
  if (pctg <= 0) return true;
  return shareMeets(dao, proposer, pctg, startBlock);
}

/**
 * held-vs-threshold at a pinned height, with two fallbacks:
 *  - the pinned query THROWS (height beyond the tip) → run live;
 *  - the pinned query answers supply=0 while the height is within ±5 of
 *    the tip → espo's versioned view isn't materialized for that block
 *    yet (the exact-tip race) → run live. Genuinely-old zero-supply
 *    heights stay a hard fail — history can't be judged by today's
 *    balances.
 */
async function shareMeets(
  dao: OrchestratorDao,
  address: string,
  pctg: number,
  atBlock: number,
): Promise<boolean> {
  const run = async (height?: number) => {
    const h = height !== undefined ? { height } : {};
    const results = await espoBatch(dao.espoUrl, [
      {
        jsonrpc: '2.0',
        id: 'supply',
        method: 'essentials.get_circulating_supply',
        params: { alkane: dao.votingToken.alkaneId, ...h },
      },
      {
        jsonrpc: '2.0',
        id: 'balance',
        method: 'essentials.get_address_balances',
        params: { address, ...h },
      },
    ]);
    return {
      supply: BigInt(String(results.get('supply')?.supply ?? 0)),
      held: votingBalanceOf(dao, results.get('balance')),
    };
  };

  let state: { supply: bigint; held: bigint };
  try {
    state = await run(atBlock);
  } catch {
    // Block likely beyond the tip — fall back to the latest state.
    state = await run();
  }
  if (state.supply <= 0n) {
    const tip = await fetchEspoTip(dao.espoUrl);
    if (Math.abs(atBlock - tip) <= 5) state = await run();
  }
  if (state.supply <= 0n) return false;
  return state.held >= thresholdPower(state.supply, pctg);
}

/** A vote is valid from any address holding ANY amount of the voting token. */
export async function voterHoldsToken(dao: OrchestratorDao, address: string): Promise<boolean> {
  const results = await espoBatch(dao.espoUrl, [
    {
      jsonrpc: '2.0',
      id: 'balance',
      method: 'essentials.get_address_balances',
      params: { address },
    },
  ]);
  return votingBalanceOf(dao, results.get('balance')) > 0n;
}

/**
 * Whether `creator` held the DAO's delegatorThreshold share at the
 * delegation's creation block — same shape as proposerMeetsThreshold
 * but against the delegator schedule.
 */
export async function delegatorMeetsThreshold(
  dao: OrchestratorDao,
  creator: string,
  createdAtBlock: number,
): Promise<boolean> {
  const pctg = resolveThreshold(dao.delegatorThreshold ?? [], createdAtBlock);
  if (pctg <= 0) return true;
  return shareMeets(dao, creator, pctg, createdAtBlock);
}

/**
 * Verdict for an ended proposal, computed from the node's stored votes and
 * the world pinned at the end block (immutable, so the persisted status is
 * final).
 */
export async function computeVerdict(
  dao: OrchestratorDao,
  endBlock: number,
  votes: VoteWire[],
  actions: DelegationActionWire[],
  delegatorsBySigner: Map<string, string>,
): Promise<'passed' | 'rejected'> {
  // Addresses whose balances matter for FOR power: non-delegated FOR
  // voters, plus every joined member of a delegator whose signer voted
  // FOR (their balances ride the delegator's vote).
  const state = resolveDelegationState(actions, endBlock);
  const forVoters = votes.filter((v) => v.choice === 'for' && !state.has(v.address));
  const priced = new Set<string>(forVoters.map((v) => v.address));
  const forDelegatorIds = new Set(
    forVoters
      .map((v) => delegatorsBySigner.get(v.address))
      .filter((id): id is string => id !== undefined),
  );
  for (const [member, delegatorId] of state) {
    if (forDelegatorIds.has(delegatorId)) priced.add(member);
  }

  const addresses = [...priced];
  const requests: any[] = [
    {
      jsonrpc: '2.0',
      id: 'supply',
      method: 'essentials.get_circulating_supply',
      params: { alkane: dao.votingToken.alkaneId, height: endBlock },
    },
    ...addresses.map((address, i) => ({
      jsonrpc: '2.0',
      id: `bal-${i}`,
      method: 'essentials.get_address_balances',
      params: { address, height: endBlock },
    })),
  ];
  const results = await espoBatch(dao.espoUrl, requests);
  const supply = BigInt(String(results.get('supply')?.supply ?? 0));
  const balances = new Map<string, bigint>();
  addresses.forEach((address, i) => {
    balances.set(address, votingBalanceOf(dao, results.get(`bal-${i}`)));
  });

  const tally = computeDelegatedTally({
    votes: votes.filter((v) => v.choice === 'for'),
    balances,
    actions,
    delegatorsBySigner,
    evalHeight: endBlock,
  });

  // Pass threshold in force AT the end block — finalized verdicts are
  // immune to later fork entries.
  const pctg = resolveThreshold(dao.votePassThreshold, endBlock);
  return tally.forPower >= thresholdPower(supply, pctg) ? 'passed' : 'rejected';
}
