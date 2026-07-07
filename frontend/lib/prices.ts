/**
 * Espo USD price parsing — prices come back scaled by 10^16, from
 * `ammdata.get_btc_usd_price` and `ammdata.get_candles` (`<id>-usd` pool).
 * The batched fetches live with their callers (hooks/useTokenMeta,
 * lib/dao/governance).
 */

const ESPO_PRICE_SCALE = 10_000_000_000_000_000; // 10^16
const FRBTC_ID = '32:0';

export function parseEspoScaledUsd(value: unknown): number | undefined {
  const raw = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const scaled = Number(raw);
  if (!Number.isFinite(scaled) || scaled <= 0) return undefined;
  return scaled / ESPO_PRICE_SCALE;
}
