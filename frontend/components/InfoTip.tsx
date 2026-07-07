'use client';

/**
 * InfoTip — a question-circle (Phosphor) next to a heading that reveals a
 * short description: on hover for pointers, on tap for touch (click
 * toggles; outside-tap closes).
 */

import { useEffect, useRef, useState } from 'react';
import { PhQuestion } from '@/components/PhosphorIcons';
import { useI18n } from '@/hooks/useI18n';

export default function InfoTip({ text }: { text: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        className="oa-hoverable inline-flex text-[color:var(--oa-ink-tertiary)] hover:text-[color:var(--oa-ink)]"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        aria-label={t('common.moreInfo')}
      >
        <PhQuestion size={14} />
      </button>
      {open && (
        <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 z-30 w-64 oa-card p-3 shadow-xl text-xs font-normal leading-relaxed text-[color:var(--oa-ink-secondary)]">
          {text}
        </span>
      )}
    </span>
  );
}
