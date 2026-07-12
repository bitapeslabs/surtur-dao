/**
 * Governance-token reads from Espo (essentials module + root methods, espo
 * v3.0.0-rc3 API), parameterized by DAO — each DaoDefinition names its
 * voting token and the network whose Espo serves it.
 *
 * Espo's DB is versioned: every essentials method accepts an optional
 * top-level `height` and answers as of that block. Pass `atHeight` to read
 * a proposal's world at its end block — no self-maintained snapshots.
 *
 * All requests go straight to the espo endpoint from the browser (it
 * sends CORS), batched JSON-RPC 2.0 where more than one value is needed.
 * Amounts are alkane base units.
 */

import { HOLDERS_FETCH_LIMIT } from '@/consts';
import { getEspoUrl } from '@/lib/config';
import { parseEspoScaledUsd } from '@/lib/prices';
import type { DaoDefinition } from '@/daos';
import { fakeLoadDelay } from './delay';

export interface TokenHolder {
  address: string;
  /** Voting-token balance in base units. */
  amount: bigint;
}

/**
 * Everything the proposal page needs from Espo, fetched in one batch. The
 * chain tip is NOT part of it — useEspoHeight owns the tip, and these
 * snapshots are cached keyed by it (or pinned to a proposal's end block).
 */
export interface GovernanceSnapshot {
  /** Total circulating voting-token supply in base units. */
  supply: bigint;
  /** Address-type holders, sorted by amount descending. */
  holders: TokenHolder[];
  /** Treasury-token balance of the DAO's treasury address (base units). */
  reserves: bigint;
  /** USD per display unit of the treasury token (null when unresolvable). */
  treasuryUsd: number | null;
}

interface EspoRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params: unknown;
}

/**
 * One JSON-RPC 2.0 batch POST; returns results keyed by request id.
 * Requests whose id is in `optionalIds` resolve to null on failure instead
 * of failing the whole batch (used for price lookups).
 */
async function espoBatch(
  network: string,
  requests: EspoRequest[],
  optionalIds?: Set<string>,
): Promise<Map<string, any>> {
  await fakeLoadDelay();
  const res = await fetch(getEspoUrl(network), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requests),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`espo batch ${res.status}`);
  const json = await res.json();
  const envelopes: any[] = Array.isArray(json) ? json : [json];
  const byId = new Map(envelopes.map((e) => [String(e?.id), e]));

  const results = new Map<string, any>();
  for (const request of requests) {
    const optional = optionalIds?.has(request.id) ?? false;
    const envelope = byId.get(request.id);
    if (!envelope || envelope.error || envelope.result?.ok === false) {
      if (optional) {
        results.set(request.id, null);
        continue;
      }
      if (!envelope) throw new Error(`missing espo batch response for ${request.method}`);
      if (envelope.error) {
        throw new Error(
          `${request.method} failed: ${envelope.error.message ?? envelope.error.code ?? 'rpc error'}`,
        );
      }
      throw new Error(`${request.method} failed: ${envelope.result.error ?? 'rpc error'}`);
    }
    results.set(request.id, envelope.result);
  }
  return results;
}

function parseSupply(result: any): bigint {
  return BigInt(String(result?.supply ?? 0));
}

function parseHolders(result: any): TokenHolder[] {
  const items: any[] = Array.isArray(result?.items) ? result.items : [];
  return items
    .filter((item) => item?.type === 'address' && typeof item?.address === 'string')
    .map((item) => ({ address: item.address as string, amount: BigInt(String(item.amount ?? 0)) }));
}

function parseReserves(dao: DaoDefinition, result: any): bigint {
  return BigInt(String(result?.balances?.[dao.treasuryToken.alkaneId] ?? 0));
}

function parseHeight(result: any): number {
  const height = Number(result?.height);
  if (!Number.isInteger(height) || height <= 0) {
    throw new Error(`get_espo_height returned ${JSON.stringify(result)}`);
  }
  return height;
}

function supplyRequest(dao: DaoDefinition, atHeight?: number): EspoRequest {
  return {
    jsonrpc: '2.0',
    id: 'supply',
    method: 'essentials.get_circulating_supply',
    params: {
      alkane: dao.votingToken.alkaneId,
      ...(atHeight !== undefined ? { height: atHeight } : {}),
    },
  };
}

function holdersRequest(dao: DaoDefinition, atHeight?: number): EspoRequest {
  return {
    jsonrpc: '2.0',
    id: 'holders',
    method: 'essentials.get_holders',
    params: {
      alkane: dao.votingToken.alkaneId,
      page: 1,
      limit: HOLDERS_FETCH_LIMIT,
      ...(atHeight !== undefined ? { height: atHeight } : {}),
    },
  };
}

function reservesRequest(dao: DaoDefinition, atHeight?: number): EspoRequest {
  return {
    jsonrpc: '2.0',
    id: 'reserves',
    method: 'essentials.get_address_balances',
    params: {
      address: dao.treasuryAddress,
      ...(atHeight !== undefined ? { height: atHeight } : {}),
    },
  };
}

/** Root method — always the live tip (ignores versioning). */
const HEIGHT_REQUEST: EspoRequest = {
  jsonrpc: '2.0',
  id: 'height',
  method: 'get_espo_height',
  params: {},
};

const FRBTC_ID = '32:0';
const PRICE_IDS = new Set(['btc-usd', 'treasury-usd']);

/**
 * Price lookups riding the same batch (optional — a missing pool must not
 * fail the page). frBTC treasuries price at BTC; others at their -usd pool.
 */
function priceRequests(dao: DaoDefinition): EspoRequest[] {
  if (dao.treasuryToken.alkaneId === FRBTC_ID) {
    return [{ jsonrpc: '2.0', id: 'btc-usd', method: 'ammdata.get_btc_usd_price', params: {} }];
  }
  return [
    {
      jsonrpc: '2.0',
      id: 'treasury-usd',
      method: 'ammdata.get_candles',
      params: {
        pool: `${dao.treasuryToken.alkaneId}-usd`,
        timeframe: '10m',
        side: 'base',
        limit: 1,
        page: 1,
      },
    },
  ];
}

function parseTreasuryUsd(dao: DaoDefinition, results: Map<string, any>): number | null {
  if (dao.treasuryToken.alkaneId === FRBTC_ID) {
    return parseEspoScaledUsd(results.get('btc-usd')?.price) ?? null;
  }
  const candle = results.get('treasury-usd')?.candles?.[0];
  return parseEspoScaledUsd(candle?.close) ?? null;
}

/**
 * Supply + holders + live tip in ONE batched call (proposal page load).
 * With `atHeight`, supply/holders are pinned to that block (closed
 * proposals read their end block); `height` is always the current tip.
 */
export async function fetchGovernanceSnapshot(
  dao: DaoDefinition,
  atHeight?: number,
): Promise<GovernanceSnapshot> {
  const requests = [
    supplyRequest(dao, atHeight),
    holdersRequest(dao, atHeight),
    ...priceRequests(dao),
  ];
  const hasTreasury = dao.treasuryAddress.length > 0;
  if (hasTreasury) requests.push(reservesRequest(dao, atHeight));
  const results = await espoBatch(dao.espoNetwork, requests, PRICE_IDS);
  return {
    supply: parseSupply(results.get('supply')),
    holders: parseHolders(results.get('holders')),
    reserves: hasTreasury ? parseReserves(dao, results.get('reserves')) : 0n,
    treasuryUsd: parseTreasuryUsd(dao, results),
  };
}

/** Treasury-token balance of the DAO's treasury address (base units). */
export async function fetchTreasuryReserves(dao: DaoDefinition): Promise<bigint | null> {
  if (!dao.treasuryAddress) return null;
  const results = await espoBatch(dao.espoNetwork, [reservesRequest(dao)]);
  return parseReserves(dao, results.get('reserves'));
}

/**
 * Everything the DAO proposals page needs from Espo — chain tip + treasury
 * reserves — in ONE batched call.
 */
export async function fetchDaoOverview(dao: DaoDefinition): Promise<{
  reserves: bigint | null;
  treasuryUsd: number | null;
}> {
  const hasTreasury = dao.treasuryAddress.length > 0;
  const requests = [...priceRequests(dao)];
  if (hasTreasury) requests.push(reservesRequest(dao));
  const results = await espoBatch(dao.espoNetwork, requests, PRICE_IDS);
  return {
    reserves: hasTreasury ? parseReserves(dao, results.get('reserves')) : null,
    treasuryUsd: parseTreasuryUsd(dao, results),
  };
}

/** Current Espo-indexed tip height. */
/**
 * DAO overview (reserves + treasury USD) through the orchestrator, which
 * caches it server-side until the next block. This data is display-only —
 * NOT trust-critical — so delegating it is fine; falls back to a direct
 * espo batch when the orchestrator is unreachable.
 */
export async function fetchDaoOverviewCached(dao: DaoDefinition): Promise<{
  reserves: bigint | null;
  treasuryUsd: number | null;
}> {
  try {
    const res = await fetch(`/api/orchestrator/overview?dao=${encodeURIComponent(dao.id)}`, {
      signal: AbortSignal.timeout(20_000),
    });
    const json = await res.json().catch(() => null);
    if (json?.ok) {
      return {
        reserves: json.reserves == null ? null : BigInt(String(json.reserves)),
        treasuryUsd: typeof json.treasuryUsd === 'number' ? json.treasuryUsd : null,
      };
    }
  } catch {
    /* orchestrator down — ask espo directly */
  }
  return fetchDaoOverview(dao);
}

export async function fetchEspoHeight(network: string = 'mainnet'): Promise<number> {
  const results = await espoBatch(network, [HEIGHT_REQUEST]);
  return parseHeight(results.get('height'));
}

/**
 * Supply + an address's voting-token share in ONE batched call. Member
 * addresses (a delegation owner's joined members) count toward `held` —
 * delegation owners propose with delegated power.
 */
export async function fetchProposerShare(
  dao: DaoDefinition,
  address: string,
  memberAddresses: string[] = [],
): Promise<{ supply: bigint; held: bigint }> {
  const results = await espoBatch(dao.espoNetwork, [
    supplyRequest(dao),
    {
      jsonrpc: '2.0',
      id: 'holder-balance',
      method: 'essentials.get_address_balances',
      params: { address },
    },
    ...memberAddresses.map((member, i) => ({
      jsonrpc: '2.0' as const,
      id: `member-${i}`,
      method: 'essentials.get_address_balances',
      params: { address: member },
    })),
  ]);
  let memberHeld = 0n;
  memberAddresses.forEach((_, i) => {
    memberHeld += BigInt(
      String(results.get(`member-${i}`)?.balances?.[dao.votingToken.alkaneId] ?? 0),
    );
  });
  return {
    supply: parseSupply(results.get('supply')),
    held: memberHeld + BigInt(
      String(results.get('holder-balance')?.balances?.[dao.votingToken.alkaneId] ?? 0),
    ),
  };
}

/** Supply + holders in one batch (proposal-threshold check on create). */
/**
 * Supply + holders pinned at each proposal's end block — ONE espo batch
 * for any number of ended proposals. Used server-side by the orchestrator
 * verdicts endpoint.
 */
export async function fetchVerdictSnapshots(
  dao: DaoDefinition,
  entries: Array<{ proposalId: string; endBlock: number }>,
): Promise<Map<string, { supply: bigint; holders: TokenHolder[] }>> {
  const snapshots = new Map<string, { supply: bigint; holders: TokenHolder[] }>();
  if (entries.length === 0) return snapshots;
  const requests = entries.flatMap((e) => [
    { ...supplyRequest(dao, e.endBlock), id: `supply:${e.proposalId}` },
    { ...holdersRequest(dao, e.endBlock), id: `holders:${e.proposalId}` },
  ]);
  const results = await espoBatch(dao.espoNetwork, requests);
  for (const e of entries) {
    snapshots.set(e.proposalId, {
      supply: parseSupply(results.get(`supply:${e.proposalId}`)),
      holders: parseHolders(results.get(`holders:${e.proposalId}`)),
    });
  }
  return snapshots;
}

export async function fetchSupplyAndHolders(
  dao: DaoDefinition,
  atHeight?: number,
): Promise<{
  supply: bigint;
  holders: TokenHolder[];
}> {
  const results = await espoBatch(dao.espoNetwork, [
    supplyRequest(dao, atHeight),
    holdersRequest(dao, atHeight),
  ]);
  return {
    supply: parseSupply(results.get('supply')),
    holders: parseHolders(results.get('holders')),
  };
}
