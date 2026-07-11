'use client';

/**
 * Optional delegation icon — same limits as markdown images (5 MB,
 * image/*), embedded as a base64 data URI in the signed content.
 */

import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { imageFileSchema } from '@/lib/dao/schemas';
import { useI18n } from '@/hooks/useI18n';

export default function DelegationIconPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (dataUri: string | null) => void;
}) {
  const { t, locale } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = (file: File | undefined) => {
    setError(null);
    if (!file) return;
    const parsed = imageFileSchema(locale).safeParse(file);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid image');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result));
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        className="oa-hoverable h-14 w-14 rounded-full overflow-hidden bg-[color:var(--oa-bg-subtle)] border border-dashed border-[color:var(--oa-border)] flex items-center justify-center shrink-0"
        onClick={() => inputRef.current?.click()}
        aria-label={t('dlg.icon')}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="text-xl text-[color:var(--oa-ink-tertiary)]">+</span>
        )}
      </button>
      <div className="min-w-0">
        <div className="text-sm font-medium">{t('dlg.icon')}</div>
        <div className="text-xs text-[color:var(--oa-ink-tertiary)]">{t('dlg.iconHint')}</div>
        {value && (
          <button
            type="button"
            className="oa-hoverable mt-1 inline-flex items-center gap-1 text-xs text-[color:var(--oa-ink-secondary)] hover:text-[color:var(--oa-danger)]"
            onClick={() => onChange(null)}
          >
            <X size={12} />
            {t('dlg.iconRemove')}
          </button>
        )}
        {error && <div className="mt-1 text-xs text-[color:var(--oa-danger)]">{error}</div>}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
