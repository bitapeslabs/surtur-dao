/** Display helpers for proposal data (token amounts, addresses, dates). */

import { toBaseUnits } from '@/lib/format';
import type { Proposal } from './types';

/** Compact address: 6…4 (same convention as the header). */
export function shortAddress(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

/** "12.5" + a symbol → "12.5 TOKEN" with grouped thousands. */
export function formatTokenAmount(amount: string, symbol: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${amount} ${symbol}`;
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${symbol}`;
}

/** Sum of a proposal's transfer amounts, in display units. */
export function totalTransferAmount(proposal: Proposal): number {
  return proposal.transfers.reduce((sum, t) => {
    const n = Number(t.amount);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
}

/** Sum of a proposal's transfer amounts in base units (8 decimals). */
export function totalTransferBaseUnits(proposal: Proposal): bigint {
  return proposal.transfers.reduce((sum, t) => {
    try {
      return sum + BigInt(toBaseUnits(t.amount, 8));
    } catch {
      return sum;
    }
  }, 0n);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// The canonical vote message lives in @surtur/shared so nodes verify the
// exact bytes the frontend signs.
export { buildVoteMessage } from '@surtur/shared';

/** Compact USD: 5600000 → "5.6M USD"; 46123.4 → "46.12k USD". */
export function formatUsdCompact(value: number): string {
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (value >= 1e9) return `${fmt(value / 1e9)}B USD`;
  if (value >= 1e6) return `${fmt(value / 1e6)}M USD`;
  if (value >= 1e3) return `${fmt(value / 1e3)}k USD`;
  return `${fmt(value)} USD`;
}

/** Compact token amount: 30,343.4098 → "30.34k" (2 max fraction digits). */
export function formatTokenCompact(base: bigint, decimals = 8): string {
  const value = Number(base) / 10 ** decimals;
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (value >= 1_000_000_000) return `${fmt(value / 1_000_000_000)}B`;
  if (value >= 1_000_000) return `${fmt(value / 1_000_000)}M`;
  if (value >= 1_000) return `${fmt(value / 1_000)}k`;
  return fmt(value);
}

/**
 * Human time-left for a block count (~10 min/block), capped at two units:
 * "1D 4h", "4h 20m", "20m" — units below days are lowercase; minutes only
 * shown under an hour of context.
 */
export function formatBlocksDuration(blocks: number): string {
  const totalMinutes = Math.max(0, blocks) * 10;
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = Math.floor(totalMinutes % 60);
  if (days > 0) return hours > 0 ? `${days}D ${hours}h` : `${days}D`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

/**
 * Milkdown serializes empty leading paragraphs as literal "<br />" lines
 * in the markdown. Strip them (and leading blank lines) so displayed
 * documents don't start with a phantom empty block. Used at render time
 * (published bodies are immutable — their hash includes the noise) and
 * at publish time so new content is clean.
 */
export function stripLeadingEmptyBlocks(markdown: string): string {
  return markdown.replace(/^(?:\s*<br\s*\/?>)+\s*/i, '').replace(/^\n+/, '');
}
