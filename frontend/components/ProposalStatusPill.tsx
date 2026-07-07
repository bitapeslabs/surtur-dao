'use client';

/**
 * ProposalStatusPill — quiet status chip for proposal rows and headers.
 * Open/Passed get the success accent, Rejected the danger accent.
 */

import type { ProposalStatus } from '@/lib/dao/types';
import { useI18n } from '@/hooks/useI18n';
import type { MessageKey } from '@/i18n';

const META: Record<ProposalStatus, { labelKey: MessageKey; color: string }> = {
  open: { labelKey: 'status.open', color: 'var(--oa-success)' },
  passed: { labelKey: 'status.passed', color: 'var(--oa-success)' },
  rejected: { labelKey: 'status.rejected', color: 'var(--oa-danger)' },
  executed: { labelKey: 'status.executed', color: 'var(--oa-ink-secondary)' },
};

export default function ProposalStatusPill({ status }: { status: ProposalStatus }) {
  const { t } = useI18n();
  const meta = META[status] ?? META.open;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium bg-[color:var(--oa-bg-subtle)]"
      style={{ color: meta.color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
      {t(meta.labelKey)}
    </span>
  );
}
