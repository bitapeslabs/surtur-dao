'use client';

/**
 * useBalances — wallet BTC + alkane balances as a TanStack query keyed on
 * the espo height: a new block refetches, an unchanged height serves from
 * cache. On networks whose espo is unreachable the key pins to 'live' and
 * `refresh()` remains the manual escape hatch.
 */

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchWalletBalances, type BtcBalance, type AlkaneBalance } from '@/lib/balances';
import type { EspoUtxoCache } from '@/lib/espo';
import type { VendorNetwork } from '@/lib/config';
import { useEspoHeight } from '@/hooks/useEspoHeight';

export interface BalancesState {
  btc: BtcBalance | null;
  alkanes: AlkaneBalance[];
  /** Espo spendable-outpoint cache (mainnet/espo data source only). */
  espoCache: EspoUtxoCache | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useBalances(network: VendorNetwork, address: string | null): BalancesState {
  const { data: tipData } = useEspoHeight(network);
  const height = tipData ?? null;

  const query = useQuery({
    queryKey: ['espo', network, 'balances', address, height ?? 'live'],
    queryFn: () => fetchWalletBalances(network, address!),
    enabled: !!address,
    staleTime: Infinity,
    placeholderData: (prev) => prev,
  });

  const refresh = useCallback(() => {
    void query.refetch();
  }, [query]);

  return {
    btc: query.data?.btc ?? null,
    alkanes: query.data?.alkanes ?? [],
    espoCache: query.data?.espoCache ?? null,
    loading: query.isFetching,
    error: query.error
      ? query.error instanceof Error
        ? query.error.message
        : String(query.error)
      : null,
    refresh,
  };
}
