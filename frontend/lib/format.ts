import { ALKANE_DECIMALS, KNOWN_ALKANES } from './config';

/** Group the integer part of a numeric string with thousands separators. */
function groupThousands(numeric: string): string {
  const neg = numeric.startsWith('-');
  const body = neg ? numeric.slice(1) : numeric;
  const [whole, frac] = body.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`;
}

/** 100_000_000 sats per BTC, trimmed trailing zeros, comma-grouped ≥ 1000. */
export function formatSats(sats: number): string {
  const btc = sats / 1e8;
  const trimmed = btc.toFixed(8).replace(/\.?0+$/, '') || '0';
  return groupThousands(trimmed);
}

/** Alkane base units → plain decimal string (no grouping) — for editable inputs. */
export function formatAlkaneAmountPlain(base: bigint, decimals = ALKANE_DECIMALS): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = base / divisor;
  const frac = (base % divisor).toString().padStart(decimals, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** Alkane base units (8 decimals) → display string, comma-grouped ≥ 1000. */
export function formatAlkaneAmount(base: bigint, decimals = ALKANE_DECIMALS): string {
  return groupThousands(formatAlkaneAmountPlain(base, decimals));
}

/**
 * Format a USD value: `$1,234.56`, comma-grouped. Sub-cent positive values
 * render as `<$0.01`; zero renders as `$0.00`.
 */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return value === 0 ? '$0.00' : '';
  if (value < 0.01) return '<$0.01';
  return `$${groupThousands(value.toFixed(2))}`;
}

/**
 * Decimal display amount → stringified integer base units.
 * String-based (same approach as subfrost-app lib/alkanes/helpers.ts toAlks)
 * to avoid float precision loss.
 */
export function toBaseUnits(amount: string, decimals: number): string {
  if (!amount) return '0';
  const [wholeRaw = '0', fracRaw = ''] = amount.split('.');
  const whole = wholeRaw.replace(/[^0-9]/g, '') || '0';
  const frac = fracRaw.replace(/[^0-9]/g, '').padEnd(decimals, '0').slice(0, decimals);
  const combined = `${whole}${frac}`.replace(/^0+/, '');
  return combined || '0';
}

export function alkaneDisplayName(alkaneId: string): string {
  return KNOWN_ALKANES[alkaneId]?.symbol ?? alkaneId;
}

export function truncateAddress(addr: string): string {
  return addr.length > 20 ? `${addr.slice(0, 10)}…${addr.slice(-8)}` : addr;
}
