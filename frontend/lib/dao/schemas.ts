/**
 * Zod schemas for every proposal-creation input. The create page runs
 * `validateProposalDraft` on each keystroke — any failure paints the field
 * red and disables the Create button.
 *
 * TODO(backend): these schemas are the single source of truth for input
 * shapes — reuse them server-side when the real backend replaces the
 * localStorage DaoStore; client-side validation alone is bypassable.
 */

import { z } from 'zod';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { getBitcoinNetwork } from '@/lib/config';
import { toBaseUnits } from '@/lib/format';
import { tr, type Locale } from '@/i18n';
import { formatTokenCompact } from './format';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function titleSchema(locale: Locale) {
  return z
    .string()
    .trim()
    .min(1, tr(locale, 'err.titleRequired'))
    .max(200, tr(locale, 'err.titleTooLong'));
}

/** Markdown body — generous cap that still fits a few base64 images. */
export function bodySchema(locale: Locale) {
  return z.string().max(20_000_000, tr(locale, 'err.bodyTooLarge'));
}

// Taproot (bc1p…) output-script construction needs an ECC lib — without
// initEccLib, toOutputScript throws and every taproot address would read
// as invalid.
let eccReady = false;
function ensureEcc() {
  if (!eccReady) {
    bitcoin.initEccLib(ecc);
    eccReady = true;
  }
}

/**
 * Bitcoin address, validated with bitcoinjs (`address.toOutputScript`)
 * against the given network's params — the DAO's network, NOT the connected
 * wallet's (a mainnet DAO takes bc1… recipients regardless of the wallet).
 */
export function addressSchema(network: string, locale: Locale) {
  return z
    .string()
    .trim()
    .min(1, tr(locale, 'err.addressRequired'))
    .refine((addr) => {
      try {
        ensureEcc();
        bitcoin.address.toOutputScript(addr, getBitcoinNetwork(network));
        return true;
      } catch {
        return false;
      }
    }, tr(locale, 'err.addressInvalid'));
}

/** Token display amount: positive decimal, at most 8 fraction digits. */
export function tokenAmountSchema(locale: Locale) {
  return z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,8})?$/, tr(locale, 'err.amountFormat'))
    .refine((s) => Number(s) > 0, tr(locale, 'err.amountPositive'));
}

export function transferSchema(network: string, locale: Locale) {
  return z.object({
    address: addressSchema(network, locale),
    amount: tokenAmountSchema(locale),
  });
}

export function blockHeightSchema(locale: Locale) {
  return z
    .string()
    .trim()
    .regex(/^\d+$/, tr(locale, 'err.blockHeight'))
    .transform(Number)
    .refine((n) => Number.isSafeInteger(n) && n > 0, tr(locale, 'err.blockHeightValid'));
}

export function durationBlocksSchema(locale: Locale) {
  return z
    .string()
    .trim()
    .regex(/^\d+$/, tr(locale, 'err.durationBlocks'))
    .transform(Number)
    .refine((n) => Number.isSafeInteger(n) && n > 0, tr(locale, 'err.durationPositive'));
}

/** Image embedded into the markdown as base64 — capped at 5 MB. */
export function imageFileSchema(locale: Locale) {
  return z
    .custom<File>((f) => f instanceof File, tr(locale, 'err.imageNotFile'))
    .refine((f) => f.type.startsWith('image/'), tr(locale, 'err.imageType'))
    .refine((f) => f.size <= MAX_IMAGE_BYTES, tr(locale, 'err.imageSize'));
}

// ---------------------------------------------------------------------------

export interface ProposalDraft {
  title: string;
  transfers: Array<{ key: number; address: string; amount: string }>;
  startBlock: string;
  endValue: string;
}

export interface ProposalDraftContext {
  network: string;
  /** Espo tip, null while loading (the draft can't be valid without it). */
  currentHeight: number | null;
  /** "Use current block" lock — start comes from the tip at submit time. */
  startLocked: boolean;
  endMode: 'block' | 'duration';
  /**
   * Treasury reserves in base units (null while loading / unknown). The
   * cumulative transfer amount may not exceed this.
   * TODO(backend): re-check against live reserves server-side.
   */
  reservesBase: bigint | null;
  /** Treasury token symbol, for the over-reserves error message. */
  treasurySymbol: string;
  /** Active UI locale — validation messages come from the dictionary. */
  locale: Locale;
}

export interface ProposalDraftErrors {
  title?: string;
  /** Keyed by transfer draft key. */
  transfers: Record<number, { address?: string; amount?: string }>;
  /** Cumulative-transfers-vs-reserves failure. */
  total?: string;
  startBlock?: string;
  end?: string;
}

function firstMessage(result: { success: false; error: z.ZodError }): string {
  return result.error.issues[0]?.message ?? 'Invalid value.';
}

export function validateProposalDraft(
  draft: ProposalDraft,
  ctx: ProposalDraftContext,
): { errors: ProposalDraftErrors; valid: boolean } {
  const errors: ProposalDraftErrors = { transfers: {} };

  const title = titleSchema(ctx.locale).safeParse(draft.title);
  if (!title.success) errors.title = firstMessage(title);

  const tSchema = transferSchema(ctx.network, ctx.locale);
  for (const t of draft.transfers) {
    const parsed = tSchema.safeParse(t);
    if (!parsed.success) {
      const fieldErrors: { address?: string; amount?: string } = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === 'address' && !fieldErrors.address) fieldErrors.address = issue.message;
        if (field === 'amount' && !fieldErrors.amount) fieldErrors.amount = issue.message;
      }
      errors.transfers[t.key] = fieldErrors;
    }
  }

  // Cumulative transfers may not exceed the treasury reserves.
  if (ctx.reservesBase !== null && draft.transfers.length > 0) {
    let totalBase = 0n;
    for (const t of draft.transfers) {
      try {
        totalBase += BigInt(toBaseUnits(t.amount.trim(), 8));
      } catch {
        /* per-field validation reports the malformed amount */
      }
    }
    if (totalBase > ctx.reservesBase) {
      errors.total = tr(ctx.locale, 'err.overReserves', {
        amount: formatTokenCompact(ctx.reservesBase),
        symbol: ctx.treasurySymbol,
      });
    }
  }

  let effectiveStart: number | null = ctx.startLocked ? ctx.currentHeight : null;
  if (!ctx.startLocked) {
    const start = blockHeightSchema(ctx.locale).safeParse(draft.startBlock);
    if (!start.success) {
      errors.startBlock = firstMessage(start);
    } else if (ctx.currentHeight !== null && start.data < ctx.currentHeight) {
      errors.startBlock = tr(ctx.locale, 'err.blockPassed');
    } else {
      effectiveStart = start.data;
    }
  }

  if (ctx.endMode === 'duration') {
    const duration = durationBlocksSchema(ctx.locale).safeParse(draft.endValue);
    if (!duration.success) errors.end = firstMessage(duration);
  } else {
    const end = blockHeightSchema(ctx.locale).safeParse(draft.endValue);
    if (!end.success) {
      errors.end = firstMessage(end);
    } else if (ctx.currentHeight !== null && end.data <= ctx.currentHeight) {
      errors.end = tr(ctx.locale, 'err.blockPassed');
    } else if (effectiveStart !== null && end.data <= effectiveStart) {
      errors.end = tr(ctx.locale, 'err.endAfterStart');
    }
  }

  const valid =
    !errors.title &&
    Object.keys(errors.transfers).length === 0 &&
    !errors.total &&
    !errors.startBlock &&
    !errors.end &&
    ctx.currentHeight !== null;

  return { errors, valid };
}
