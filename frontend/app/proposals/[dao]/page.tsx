'use client';

/**
 * A DAO's proposals — two sections:
 *   - Proposals: open proposals, ordered by time left before they expire
 *     (soonest first). Rows carry a green dot beside the title and show
 *     how many blocks remain instead of a status pill.
 *   - Past proposals: passed/rejected/executed, newest first. Hidden
 *     entirely while there are none.
 *
 * All data flows through the DaoStore abstraction (localStorage for now);
 * the chain tip comes from Espo for the blocks-left math.
 * TODO(backend): the store fetch grabs one oversized page and splits
 * client-side — replace with filtered server queries when the backend
 * lands.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ChevronLeft, ChevronRight, Plus, ScrollText } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getDaoStore } from '@/lib/dao/store';
import { fetchDaoOverviewCached } from '@/lib/dao/governance';
import { useEspoHeight } from '@/hooks/useEspoHeight';
import { useProposerEligibility } from '@/hooks/useProposerEligibility';
import Toast from '@/components/Toast';
import { explorerAddressUrl } from '@/lib/config';
import { getDao, type DaoDefinition } from '@/daos';
import type { Proposal } from '@/lib/dao/types';
import {
  formatBlocksDuration,
  formatTokenCompact,
  formatUsdCompact,
  shortAddress,
  totalTransferAmount,
} from '@/lib/dao/format';
import ProposalStatusPill from '@/components/ProposalStatusPill';
import { daoDescription, proposalTitle } from '@/i18n';
import { useI18n } from '@/hooks/useI18n';
import TokenIcon from '@/components/TokenIcon';
import Skeleton from '@/components/Skeleton';

const PAGE_SIZE = 10;
const FETCH_ALL = 1000;

function SkeletonRows({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="px-5 py-4 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Skeleton className="h-4 w-48 max-w-[70%]" />
            <Skeleton className="mt-2 h-3 w-36" />
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex flex-col items-end">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-1.5 h-3 w-16" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        </div>
      ))}
    </>
  );
}

function ProposalRow({
  dao,
  proposal,
  height,
}: {
  dao: DaoDefinition;
  proposal: Proposal;
  height: number | null;
}) {
  const { t, p, locale } = useI18n();
  const open = proposal.status === 'open';
  const blocksLeft =
    open && proposal.endBlock && height !== null ? proposal.endBlock - height : null;

  // The whole row is a real <a> (middle-click / cmd+click / open-in-new-tab
  // all work). Anchors can't nest, so the proposer espo link inside is a
  // span that window.opens instead.
  return (
    <Link
      href={p(`/proposals/${dao.id}/${proposal.id}`)}
      className="oa-row px-5 py-4 flex items-center justify-between gap-3 cursor-pointer"
    >
      <div className="min-w-0">
        <div className="text-sm font-medium flex items-center gap-2 min-w-0">
          {open && (
            <span
              className="h-1.5 w-1.5 rounded-full shrink-0 bg-[color:var(--oa-success)]"
              aria-label={t('status.open')}
            />
          )}
          <span className="truncate">{proposalTitle(proposal, locale)}</span>
          {!open && <ProposalStatusPill status={proposal.status} />}
        </div>
        <div className="mt-1 text-xs text-[color:var(--oa-ink-secondary)] truncate">
          {t('prop.proposer')}{' '}
          <span
            role="link"
            tabIndex={0}
            className="oa-hoverable text-[color:var(--oa-ink)] hover:underline"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              window.open(explorerAddressUrl(proposal.author), '_blank', 'noopener,noreferrer');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                window.open(explorerAddressUrl(proposal.author), '_blank', 'noopener,noreferrer');
              }
            }}
          >
            {shortAddress(proposal.author)}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <div className="text-right">
          <div className="text-sm font-medium tabular-nums flex items-center justify-end gap-1.5">
            {totalTransferAmount(proposal).toLocaleString(undefined, { maximumFractionDigits: 8 })}
            <TokenIcon id={dao.treasuryToken.alkaneId} symbol={dao.treasuryToken.symbol} size="xs" />
          </div>
          {open && (
            <div className="mt-0.5 text-xs text-[color:var(--oa-ink-secondary)] tabular-nums whitespace-nowrap">
              {blocksLeft === null
                ? '—'
                : blocksLeft <= 0
                  ? 'Ended'
                  : `${blocksLeft.toLocaleString()} blocks (${formatBlocksDuration(blocksLeft)})`}
            </div>
          )}
        </div>
        <ChevronRight size={15} className="text-[color:var(--oa-ink-tertiary)]" />
      </div>
    </Link>
  );
}

export default function DaoProposalsPage() {
  const params = useParams<{ dao: string }>();
  const dao = getDao(params?.dao);
  const { t, p, locale } = useI18n();
  const [page, setPage] = useState(1);
  const router = useRouter();
  // Below the proposal threshold → clicking New proposal shows a toast
  // with the required amount instead of navigating (nodes reject such
  // proposals anyway; this explains upfront).
  const eligibility = useProposerEligibility(dao);
  const [showThresholdToast, setShowThresholdToast] = useState(false);
  // Bumped per click so a repeat click remounts the toast → re-shake.
  const [toastNonce, setToastNonce] = useState(0);
  const blockedByThreshold =
    !eligibility.checking && !eligibility.eligible && eligibility.requiredAmount !== null;
  const handleNewProposal = () => {
    if (!dao) return;
    if (blockedByThreshold) {
      setToastNonce((n) => n + 1);
      setShowThresholdToast(true);
    }
    else router.push(p(`/proposals/${dao.id}/new`));
  };

  // The tip is polled by useEspoHeight; reserves + price cache against it
  // (same key as the create page, so navigating there is instant).
  const tipQuery = useEspoHeight(dao?.espoNetwork);
  const height = tipQuery.data ?? null;
  const queryClient = useQueryClient();

  // Nothing on this page waits for espo except the New-proposal button:
  // proposals and overview fetch IMMEDIATELY (node data / orchestrator
  // cache) and are invalidated only when the tip actually moves.
  const lastHeightRef = useRef<number | null>(null);
  useEffect(() => {
    if (height === null || !dao) return;
    if (lastHeightRef.current !== null && height !== lastHeightRef.current) {
      void queryClient.invalidateQueries({ queryKey: ['nodes', 'proposals', dao.id] });
      void queryClient.invalidateQueries({ queryKey: ['orchestrator', 'overview', dao.id] });
    }
    lastHeightRef.current = height;
  }, [height, dao, queryClient]);

  const proposalsQuery = useQuery({
    queryKey: ['nodes', 'proposals', dao?.id],
    queryFn: () => getDaoStore().listProposals(dao!.id, 1, FETCH_ALL).then((r) => r.items),
    enabled: !!dao,
    staleTime: Infinity,
    placeholderData: (prev) => prev,
  });
  const proposals = proposalsQuery.data ?? null;
  const overviewQuery = useQuery({
    queryKey: ['orchestrator', 'overview', dao?.id],
    queryFn: () => fetchDaoOverviewCached(dao!),
    enabled: !!dao,
    staleTime: Infinity,
    placeholderData: (prev) => prev,
  });
  const reserves = overviewQuery.data?.reserves ?? null;
  const treasuryUsd = overviewQuery.data?.treasuryUsd ?? null;
  const reservesUsd =
    reserves !== null && treasuryUsd !== null && reserves > 0n
      ? (Number(reserves) / 1e8) * treasuryUsd
      : undefined;

  // Open proposals, soonest-to-expire first (unknown windows sort last).
  const active = useMemo(() => {
    if (!proposals) return null;
    const left = (p: Proposal) =>
      p.endBlock ? (height !== null ? p.endBlock - height : p.endBlock) : Infinity;
    return proposals.filter((p) => p.status === 'open').sort((a, b) => left(a) - left(b));
  }, [proposals, height]);

  // Past proposals, newest first (store order is already createdAt desc).
  const past = useMemo(
    () => proposals?.filter((p) => p.status !== 'open') ?? null,
    [proposals],
  );

  const pageCount = active ? Math.max(1, Math.ceil(active.length / PAGE_SIZE)) : 1;
  const clampedPage = Math.min(page, pageCount);
  const activePageItems = active
    ? active.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE)
    : null;

  // Unknown slug, or a disabled DAO reached by direct URL (the DAO list
  // doesn't link here) — the future backend must enforce the same gate.
  if (!dao || !dao.enabled) {
    return (
      <main className="max-w-5xl mx-auto px-5 min-h-[calc(100dvh-3.5rem)] flex items-center justify-center">
        <div className="text-center max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight mb-2">
            {dao ? t('dao.disabledTitle', { name: dao.name }) : t('dao.notFound')}
          </h1>
          <p className="text-sm text-[color:var(--oa-ink-secondary)] mb-6">
            {dao ? t('dao.disabledHintProposals') : t('dao.notFoundHint')}
          </p>
          <Link href={p('/proposals')} className="oa-btn-primary">
            {t('dao.backToDaos')}
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-3xl mx-auto px-5 py-10 flex flex-col gap-6">
      <div>
        <Link href={p('/proposals')} className="oa-btn-ghost !px-2 -ml-2">
          <ArrowLeft size={15} />
          {t('daos.title')}
        </Link>
      </div>
      {/* Mobile: name+reserves stack with the button full-width below;
          desktop: button on the right. */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{dao.name}</h1>
          <div className="mt-1 text-sm text-[color:var(--oa-ink-secondary)] flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className="inline-flex items-center gap-1.5">
              {t('dao.reserves')}{' '}
              {reserves !== null ? (
                <>
                  <span className="text-[color:var(--oa-ink)]">{formatTokenCompact(reserves)}</span>
                  <TokenIcon
                    id={dao.treasuryToken.alkaneId}
                    symbol={dao.treasuryToken.symbol}
                    size="xs"
                  />
                </>
              ) : (
                <Skeleton className="h-4 w-20" />
              )}
            </span>
            {reserves !== null && reservesUsd !== undefined && (
              <span className="text-[color:var(--oa-ink-tertiary)]">
                (≈ {formatUsdCompact(reservesUsd)})
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          className="oa-btn-primary !px-4 !py-2 shrink-0 w-full sm:w-auto"
          onClick={handleNewProposal}
        >
          <Plus size={15} />
          {t('dao.newProposal')}
        </button>
      </div>

      {proposals !== null && proposals.length === 0 ? (
        <section className="rounded-2xl bg-[color:var(--oa-bg-raised)] px-6 py-16 flex flex-col items-center text-center gap-3">
          <ScrollText size={28} className="text-[color:var(--oa-ink-tertiary)]" />
          <div>
            <div className="text-sm font-medium mb-1">{t('dao.noProposals')}</div>
            <p className="text-sm text-[color:var(--oa-ink-secondary)]">
              {daoDescription(dao, locale) ??
                t('dao.createFirst', { symbol: dao.treasuryToken.symbol })}
            </p>
          </div>
          <button type="button" className="oa-btn-secondary mt-2" onClick={handleNewProposal}>
            <Plus size={15} />
            {t('dao.newProposal')}
          </button>
        </section>
      ) : (
        <section className="rounded-2xl overflow-hidden bg-[color:var(--oa-bg-raised)]">
          <div className="px-5 py-3 border-b border-[color:var(--oa-border)] text-xs font-medium text-[color:var(--oa-ink-secondary)] flex justify-between">
            <span>{t('dao.colProposal')}</span>
            <span>{t('dao.colTransfers')}</span>
          </div>

          <div className="divide-y divide-[color:var(--oa-border)]">
            {activePageItems?.map((p) => (
              <ProposalRow key={p.id} dao={dao} proposal={p} height={height} />
            ))}

            {activePageItems !== null && activePageItems.length === 0 && (
              <div className="px-5 py-4 text-sm text-[color:var(--oa-ink-tertiary)]">
                {t('dao.noOpen')}
              </div>
            )}

            {proposals === null && <SkeletonRows count={4} />}
          </div>
        </section>
      )}

      {active !== null && pageCount > 1 && (
        <div className="flex items-center justify-between text-sm text-[color:var(--oa-ink-secondary)]">
          <span>
            {t('dao.pageInfo', { page: clampedPage, pages: pageCount, total: active.length })}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="oa-btn-ghost !px-2.5"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={clampedPage <= 1}
              aria-label={t('dao.prev')}
            >
              <ChevronLeft size={15} />
              {t('dao.prev')}
            </button>
            <button
              type="button"
              className="oa-btn-ghost !px-2.5"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={clampedPage >= pageCount}
              aria-label={t('dao.next')}
            >
              {t('dao.next')}
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}

      {showThresholdToast && eligibility.requiredAmount !== null && (
        <Toast key={toastNonce} shake onClose={() => setShowThresholdToast(false)}>
          {t('dao.toastNeedPrefix') && (
            <span className="text-[color:var(--oa-ink-secondary)]">{t('dao.toastNeedPrefix')}</span>
          )}
          <span className="font-medium tabular-nums">
            {formatTokenCompact(eligibility.requiredAmount)}
          </span>
          <TokenIcon
            id={dao.votingToken.alkaneId}
            symbol={dao.votingToken.symbol}
            size="xs"
          />
          <span className="text-[color:var(--oa-ink-secondary)]">{t('dao.toastNeedSuffix')}</span>
        </Toast>
      )}

      {past !== null && past.length > 0 && (
        <>
          <h2 className="text-sm font-medium mt-2">{t('dao.past')}</h2>
          <section className="rounded-2xl overflow-hidden bg-[color:var(--oa-bg-raised)] -mt-3">
            <div className="divide-y divide-[color:var(--oa-border)]">
              {past.map((p) => (
                <ProposalRow key={p.id} dao={dao} proposal={p} height={height} />
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
