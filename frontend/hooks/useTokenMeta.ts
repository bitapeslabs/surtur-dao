'use client';

/**
 * useTokenMeta — names/symbols AND USD prices for a set of alkane ids.
 * Two TanStack queries:
 *   - names: immutable → cached forever, fetched once per id-set.
 *   - prices (+ BTC): keyed on the espo height — refetch on a new block,
 *     served from cache otherwise.
 * frBTC (32:0) prices at the BTC price.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { KNOWN_ALKANES, getEspoUrl } from '@/lib/config';
import { parseEspoScaledUsd } from '@/lib/prices';
import { useEspoHeight } from '@/hooks/useEspoHeight';

export interface TokenInfo {
  name: string;
  symbol: string;
}

const FRBTC_ID = '32:0';

async function espoBatchRaw(network: string, requests: any[]): Promise<Map<string, any>> {
  const res = await fetch(getEspoUrl(network), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requests),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`espo batch ${res.status}`);
  const json = await res.json();
  const envelopes: any[] = Array.isArray(json) ? json : [json];
  return new Map(envelopes.map((e) => [String(e?.id), e?.result]));
}

async function fetchNames(network: string, ids: string[]): Promise<Record<string, TokenInfo>> {
  const out: Record<string, TokenInfo> = {};
  const need = ids.filter((id) => !KNOWN_ALKANES[id]).slice(0, 50);
  if (need.length === 0) return out;
  try {
    const results = await espoBatchRaw(
      network,
      need.map((id, i) => ({
        jsonrpc: '2.0',
        id: `info-${i}`,
        method: 'essentials.get_alkane_info',
        params: { alkane: id },
      })),
    );
    need.forEach((alkaneId, i) => {
      const r = results.get(`info-${i}`);
      out[alkaneId] = {
        name: r?.name || r?.symbol || alkaneId,
        symbol: r?.symbol || r?.name || alkaneId,
      };
    });
  } catch {
    for (const id of need) out[id] = { name: id, symbol: id };
  }
  return out;
}

async function fetchPrices(
  network: string,
  ids: string[],
): Promise<{ btcUsd: number; alkaneUsd: Record<string, number> }> {
  const out = { btcUsd: 0, alkaneUsd: {} as Record<string, number> };
  const priceIds = ids.filter((id) => id !== FRBTC_ID);
  try {
    const results = await espoBatchRaw(network, [
      { jsonrpc: '2.0', id: 'btc-usd', method: 'ammdata.get_btc_usd_price', params: {} },
      ...priceIds.map((id, i) => ({
        jsonrpc: '2.0',
        id: `price-${i}`,
        method: 'ammdata.get_candles',
        params: { pool: `${id}-usd`, timeframe: '10m', side: 'base', limit: 1, page: 1 },
      })),
    ]);
    const btc = results.get('btc-usd');
    if (btc?.ok === true) out.btcUsd = parseEspoScaledUsd(btc.price) ?? 0;
    priceIds.forEach((alkaneId, i) => {
      const r = results.get(`price-${i}`);
      const candle = Array.isArray(r?.candles) ? r.candles[0] : null;
      if (r?.ok !== true || !candle) return;
      const price = parseEspoScaledUsd(candle.close);
      if (price !== undefined) out.alkaneUsd[alkaneId] = price;
    });
  } catch {
    /* non-fatal — USD lines hide */
  }
  return out;
}

export interface TokenMeta {
  tokenInfo: Record<string, TokenInfo>;
  btcUsd: number;
  /** USD value of a decimal display amount for 'btc' or an alkane id. */
  usdValue: (assetId: string, displayAmount: number) => number | undefined;
}

export function useTokenMeta(network: string, alkaneIds: string[]): TokenMeta {
  const idsKey = useMemo(() => [...alkaneIds].sort().join(','), [alkaneIds]);
  const ids = useMemo(() => (idsKey ? idsKey.split(',').filter(Boolean) : []), [idsKey]);

  // Names are immutable — never invalidated.
  const namesQuery = useQuery({
    queryKey: ['espo', network, 'alkane-names', idsKey],
    queryFn: () => fetchNames(network, ids),
    enabled: ids.some((id) => !KNOWN_ALKANES[id]),
    staleTime: Infinity,
    gcTime: Infinity,
  });

  // Prices key on the espo height: new block → refetch, else cache.
  const { data: tipData } = useEspoHeight(network);
  const height = tipData ?? null;
  const pricesQuery = useQuery({
    queryKey: ['espo', network, 'usd-prices', idsKey, height],
    queryFn: () => fetchPrices(network, ids),
    enabled: height !== null,
    staleTime: Infinity,
    placeholderData: (prev) => prev,
  });

  const tokenInfo = useMemo(() => {
    const out: Record<string, TokenInfo> = {};
    for (const id of ids) {
      const known = KNOWN_ALKANES[id];
      out[id] = known
        ? { name: known.name, symbol: known.symbol }
        : (namesQuery.data?.[id] ?? { name: id, symbol: id });
    }
    return out;
  }, [ids, namesQuery.data]);

  const btcUsd = pricesQuery.data?.btcUsd ?? 0;
  const alkaneUsd = pricesQuery.data?.alkaneUsd ?? {};

  const usdValue = useMemo(() => {
    return (assetId: string, displayAmount: number): number | undefined => {
      if (!Number.isFinite(displayAmount) || displayAmount <= 0) return undefined;
      // BTC and frBTC (32:0) both price at the BTC price.
      const price = assetId === 'btc' || assetId === FRBTC_ID ? btcUsd : alkaneUsd[assetId];
      if (!price || price <= 0) return undefined;
      return displayAmount * price;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [btcUsd, pricesQuery.data]);

  return { tokenInfo, btcUsd, usdValue };
}
