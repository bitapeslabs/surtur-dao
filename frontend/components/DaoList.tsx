'use client';

/**
 * DaoList — every DAO defined in daos.ts as a linked list. Enabled DAOs
 * link wherever `hrefFor` points (proposals or delegations view);
 * disabled DAOs are listed but greyed out and not clickable. NOTE: the
 * disabled gate is client-side only — surtur nodes also refuse writes
 * for disabled DAOs.
 */

import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { DAOS, type DaoDefinition } from '@/daos';
import { daoDescription } from '@/i18n';
import { useI18n } from '@/hooks/useI18n';

/** DAO icon from its configured URL, letter tile as fallback. */
function DaoIcon({ dao }: { dao: DaoDefinition }) {
  const [failed, setFailed] = useState(false);
  if (!dao.iconUrl || failed) {
    return (
      <div className="h-9 w-9 rounded-full bg-[color:var(--oa-bg-subtle)] flex items-center justify-center text-sm font-semibold text-[color:var(--oa-ink-secondary)]">
        {dao.name.slice(0, 1).toUpperCase()}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={dao.iconUrl}
      alt=""
      className="h-9 w-9 rounded-full object-cover"
      onError={() => setFailed(true)}
    />
  );
}

function DaoRowContent({ dao }: { dao: DaoDefinition }) {
  const { t, locale } = useI18n();
  const description = daoDescription(dao, locale);
  return (
    <>
      <div className="flex items-center gap-3 min-w-0">
        <DaoIcon dao={dao} />
        <div className="min-w-0">
          <div className="text-sm font-medium truncate flex items-center gap-2">
            {dao.name}
            {!dao.enabled && (
              <span className="rounded-full px-2.5 py-0.5 text-xs font-medium bg-[color:var(--oa-bg-subtle)] text-[color:var(--oa-ink-tertiary)]">
                {t('daos.disabled')}
              </span>
            )}
          </div>
          {description && (
            <div className="mt-0.5 text-xs text-[color:var(--oa-ink-secondary)] truncate">
              {description}
            </div>
          )}
        </div>
      </div>
      {dao.enabled && (
        <ChevronRight size={15} className="shrink-0 text-[color:var(--oa-ink-tertiary)]" />
      )}
    </>
  );
}

export default function DaoList({
  hrefFor,
}: {
  /** Where an enabled DAO's row links (already locale-prefixed by us). */
  hrefFor: (dao: DaoDefinition) => string;
}) {
  const { t, p } = useI18n();
  return (
    <main className="max-w-3xl mx-auto px-5 py-10 flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('daos.title')}</h1>

      <section className="rounded-2xl overflow-hidden bg-[color:var(--oa-bg-raised)]">
        <div className="divide-y divide-[color:var(--oa-border)]">
          {DAOS.map((dao) =>
            dao.enabled ? (
              <Link
                key={dao.id}
                href={p(hrefFor(dao))}
                className="oa-row px-5 py-4 flex items-center justify-between gap-3"
              >
                <DaoRowContent dao={dao} />
              </Link>
            ) : (
              // Disabled: visible but inert (no link, dimmed). The backend
              // must also reject proposal/vote writes for disabled DAOs.
              <div
                key={dao.id}
                className="px-5 py-4 flex items-center justify-between gap-3 opacity-55 cursor-not-allowed select-none"
                aria-disabled="true"
              >
                <DaoRowContent dao={dao} />
              </div>
            ),
          )}
        </div>
      </section>
    </main>
  );
}
