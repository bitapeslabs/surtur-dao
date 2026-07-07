/**
 * Espo reads for validation — same versioned-DB semantics as the frontend:
 * pass `height` to read the world as of a block.
 */

import { resolveThreshold, thresholdPower, type OrchestratorDao } from '@surtur/shared';

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
        params: { address: proposer, ...h },
      },
    ]);
    const supply = BigInt(String(results.get('supply')?.supply ?? 0));
    const held = votingBalanceOf(dao, results.get('balance'));
    if (supply <= 0n) return false;
    return held >= thresholdPower(supply, pctg);
  };
  try {
    return await run(startBlock);
  } catch {
    // Start block likely beyond the tip — fall back to the latest state.
    return run();
  }
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
 * Verdict for an ended proposal, computed from the node's stored votes and
 * the world pinned at the end block (immutable, so the persisted status is
 * final).
 */
export async function computeVerdict(
  dao: OrchestratorDao,
  endBlock: number,
  forVoters: string[],
): Promise<'passed' | 'rejected'> {
  const requests: any[] = [
    {
      jsonrpc: '2.0',
      id: 'supply',
      method: 'essentials.get_circulating_supply',
      params: { alkane: dao.votingToken.alkaneId, height: endBlock },
    },
    ...forVoters.map((address, i) => ({
      jsonrpc: '2.0',
      id: `bal-${i}`,
      method: 'essentials.get_address_balances',
      params: { address, height: endBlock },
    })),
  ];
  const results = await espoBatch(dao.espoUrl, requests);
  const supply = BigInt(String(results.get('supply')?.supply ?? 0));
  let forPower = 0n;
  forVoters.forEach((_, i) => {
    forPower += votingBalanceOf(dao, results.get(`bal-${i}`));
  });
  // Pass threshold in force AT the end block — finalized verdicts are
  // immune to later fork entries.
  const pctg = resolveThreshold(dao.votePassThreshold, endBlock);
  return forPower >= thresholdPower(supply, pctg) ? 'passed' : 'rejected';
}
