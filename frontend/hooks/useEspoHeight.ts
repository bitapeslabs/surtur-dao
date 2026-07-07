'use client';

/**
 * useEspoHeight — the ONE thing polled fresh from espo (low TTL). Every
 * other espo query keys itself on this height: a new block produces new
 * query keys (refetch), an unchanged height serves from cache — so the app
 * never hammers espo for data that cannot have changed.
 *
 * Pinned reads (closed proposals at their end block) key on the end block
 * instead and are never invalidated — past-block data is immutable.
 */

import { useQuery } from '@tanstack/react-query';
import { fetchEspoHeight } from '@/lib/dao/governance';

const HEIGHT_POLL_MS = 30_000;
const HEIGHT_STALE_MS = 10_000;

export function useEspoHeight(network: string | undefined) {
  return useQuery({
    queryKey: ['espo', network ?? 'none', 'height'],
    queryFn: () => fetchEspoHeight(network),
    enabled: !!network,
    refetchInterval: HEIGHT_POLL_MS,
    staleTime: HEIGHT_STALE_MS,
  });
}
