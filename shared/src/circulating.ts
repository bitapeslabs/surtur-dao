/**
 * Circulating supply with a DAO's exclusions (`NonCirculating`): espo's
 * `essentials.get_circulating_supply` counts every holder, contracts
 * included; a DAO may name holders that are not in circulation — the
 * pizza.fun DAO's vaults, treasury, admin contract and team wallet — and
 * their holdings come off the supply at the SAME height the supply is read
 * at. The requests here ride in the caller's espo batch; `subtract` reads
 * their results back by id.
 */
import type { NonCirculating } from './types';

export interface NonCirculatingDao {
  votingToken: { alkaneId: string };
  nonCirculating?: NonCirculating;
}

export interface EspoBatchRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params: Record<string, unknown>;
}

/** The espo requests that price the exclusions: a contract's balances by alkane id, an address's by address. */
export function nonCirculatingRequests(dao: NonCirculatingDao, atHeight?: number, prefix = 'nc'): EspoBatchRequest[] {
  const h = atHeight !== undefined ? { height: atHeight } : {};
  const nc = dao.nonCirculating;
  if (!nc) return [];
  return [
    ...nc.alkanes.map((alkane, i) => ({
      jsonrpc: '2.0' as const,
      id: `${prefix}-alkane-${i}`,
      method: 'essentials.get_alkane_balances',
      params: { alkane, ...h },
    })),
    ...nc.addresses.map((address, i) => ({
      jsonrpc: '2.0' as const,
      id: `${prefix}-address-${i}`,
      method: 'essentials.get_address_balances',
      params: { address, ...h },
    })),
  ];
}

/** espo's supply less the excluded holders' voting-token balances, as the batch answered them (never below zero). */
export function subtractNonCirculating(
  dao: NonCirculatingDao,
  supply: bigint,
  results: Map<string, any>,
  prefix = 'nc',
): bigint {
  const nc = dao.nonCirculating;
  if (!nc) return supply;
  let excluded = 0n;
  const balanceOf = (result: any): bigint => BigInt(String(result?.balances?.[dao.votingToken.alkaneId] ?? 0));
  nc.alkanes.forEach((_, i) => {
    excluded += balanceOf(results.get(`${prefix}-alkane-${i}`));
  });
  nc.addresses.forEach((_, i) => {
    excluded += balanceOf(results.get(`${prefix}-address-${i}`));
  });
  return supply > excluded ? supply - excluded : 0n;
}

/** An address the DAO keeps out of circulation has no governance power. */
export function isNonCirculatingAddress(dao: NonCirculatingDao, address: string): boolean {
  return dao.nonCirculating?.addresses.includes(address) ?? false;
}
