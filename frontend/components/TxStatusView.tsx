'use client';

/**
 * TxStatusView — shared confirmation-flow screens for sends and swaps:
 * building / waiting-for-signature / broadcasting show a loader; success
 * shows the txid with an espo.sh explorer link (same target as the
 * subfrost app's success notifications); error shows the message.
 * SendModal embeds it in place of its form; SwapCard wraps it in an overlay.
 */

import { CheckCircle2, ExternalLink, Loader2, XCircle } from 'lucide-react';
import { explorerTxUrl } from '@/lib/config';
import { useI18n } from '@/hooks/useI18n';
import type { MessageKey } from '@/i18n';

export type TxFlowStatus =
  | { phase: 'building' }
  | { phase: 'signing' }
  | { phase: 'broadcasting' }
  | { phase: 'success'; txid: string }
  | { phase: 'error'; message: string };

const PENDING_COPY: Record<
  'building' | 'signing' | 'broadcasting',
  { titleKey: MessageKey; subtitleKey: MessageKey }
> = {
  building: {
    titleKey: 'tx.building' as const,
    subtitleKey: 'tx.buildingSub' as const,
  },
  signing: {
    titleKey: 'tx.waiting' as const,
    subtitleKey: 'tx.waitingSub' as const,
  },
  broadcasting: {
    titleKey: 'tx.broadcasting' as const,
    subtitleKey: 'tx.broadcastingSub' as const,
  },
};

export default function TxStatusView({
  status,
  onDone,
}: {
  status: TxFlowStatus;
  /** Close (success) / back (error). Hidden while pending. */
  onDone: () => void;
}) {
  const { t } = useI18n();
  if (status.phase === 'success') {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <CheckCircle2 size={40} className="text-[color:var(--oa-success)]" />
        <div className="text-base font-semibold tracking-tight">{t('tx.success')}</div>
        <div className="text-xs text-[color:var(--oa-ink-tertiary)] break-all px-2">
          {status.txid}
        </div>
        <a
          href={explorerTxUrl(status.txid)}
          target="_blank"
          rel="noopener noreferrer"
          className="oa-btn-secondary !px-4 !py-2 !text-xs"
        >
          {t('tx.view')}
          <ExternalLink size={12} />
        </a>
        <button type="button" className="oa-btn-primary w-full !py-3 mt-2" onClick={onDone}>
          {t('tx.done')}
        </button>
      </div>
    );
  }

  if (status.phase === 'error') {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <XCircle size={40} className="text-[color:var(--oa-danger)]" />
        <div className="text-base font-semibold tracking-tight">{t('tx.failed')}</div>
        <div className="text-sm text-[color:var(--oa-danger)] break-words px-2 max-w-full">
          {status.message}
        </div>
        <button type="button" className="oa-btn-primary w-full !py-3 mt-2" onClick={onDone}>
          {t('tx.back')}
        </button>
      </div>
    );
  }

  const copy = PENDING_COPY[status.phase];
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <Loader2 size={36} className="animate-spin text-[color:var(--oa-ink-secondary)]" />
      <div className="text-base font-semibold tracking-tight">{t(copy.titleKey)}</div>
      <div className="text-xs text-[color:var(--oa-ink-tertiary)] px-4">{t(copy.subtitleKey)}</div>
    </div>
  );
}
