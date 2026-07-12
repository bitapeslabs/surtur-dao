'use client';

/**
 * Proposal detail — title, status, author/date meta, the markdown body
 * rendered read-only through Milkdown, and the list of DIESEL transfers
 * the proposal would execute (portfolio-style rows with a total footer).
 */

import { useCallback, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEspoHeight } from '@/hooks/useEspoHeight';
import { ArrowLeft } from 'lucide-react';
import { PhArrowRight, PhArrowUpRight } from '@/components/PhosphorIcons';
import { getDaoStore } from '@/lib/dao/store';
import type { Proposal } from '@/lib/dao/types';
import { explorerAddressUrl } from '@/lib/config';
import {
  formatBlocksDuration,
  formatTokenCompact,
  formatTokenAmount,
  formatUsdCompact,
  shortAddress,
  stripLeadingEmptyBlocks,
  totalTransferAmount,
  totalTransferBaseUnits,
} from '@/lib/dao/format';
import { useI18n } from '@/hooks/useI18n';
import { proposalBody, proposalTitle } from '@/i18n';
import { getDao } from '@/daos';
import MarkdownEditor from '@/components/MarkdownEditor';
import ProposalStatusPill from '@/components/ProposalStatusPill';
import Skeleton from '@/components/Skeleton';
import TokenIcon from '@/components/TokenIcon';
import { effectiveDelegatorMeta } from '@surtur/shared';
import ResolutionSection from '@/components/ResolutionSection';
import VotingSection, { VoteButtons, useVoting } from '@/components/VotingSection';

export default function ProposalDetailPage() {
  const params = useParams<{ dao: string; id: string }>();
  const dao = getDao(params?.dao);
  const { t, p, locale } = useI18n();
  const queryClient = useQueryClient();

  // The proposal read is keyed on the espo tip: back-and-forth navigation
  // at the same height serves cache; only a new block refetches (shares
  // the polled height query with useVoting — no extra request).
  const tipQuery = useEspoHeight(dao?.espoNetwork);
  const proposalKey = [
    'nodes',
    'proposal',
    params?.id ?? 'none',
    tipQuery.data ?? 'no-tip',
  ] as const;
  const proposalQuery = useQuery({
    queryKey: proposalKey,
    queryFn: () => getDaoStore().getProposal(params!.id),
    enabled: !!params?.id && !tipQuery.isPending,
    staleTime: Infinity,
    placeholderData: (prev) => prev,
  });
  const proposal = proposalQuery.data ?? null;
  const loaded = !proposalQuery.isPending;

  // Keeps the header status pill in sync when the hook closes a proposal
  // whose end block has passed — written straight into the query cache.
  const onProposalChanged = useCallback(
    (updated: Proposal) => {
      queryClient.setQueryData(proposalKey, updated);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, proposalKey.join('|')],
  );
  const voting = useVoting(dao, proposal, onProposalChanged);

  // Delegation-owned proposals show the delegation identity as proposer.
  const delegatorsQuery = useQuery({
    queryKey: ['nodes', 'delegators', dao?.id],
    queryFn: () => getDaoStore().listDelegators(dao!.id),
    enabled: !!dao,
    staleTime: Infinity,
    placeholderData: (prev) => prev,
  });
  const proposerDelegation = useMemo(() => {
    if (!proposal) return null;
    const bundle = (delegatorsQuery.data ?? []).find(
      (b) => b.delegator.delegator === proposal.author,
    );
    if (!bundle) return null;
    const meta = effectiveDelegatorMeta(bundle);
    return { id: bundle.delegator.id, name: meta.name, nameZh: meta.nameZh, icon: meta.icon };
  }, [delegatorsQuery.data, proposal]);

  // Tab title: "Surtur - <proposal title>" (localized), restored to plain
  // "Surtur" when leaving the page (client navigation keeps document.title).
  useEffect(() => {
    if (!proposal) return;
    document.title = `Surtur - ${proposalTitle(proposal, locale)}`;
    return () => {
      document.title = 'Surtur';
    };
  }, [proposal, locale]);

  // Treasury-token USD price rides the voting snapshot batch — no extra
  // request; undefined while loading or when no pool resolves.
  const usdValue = useMemo(() => {
    const price = voting.treasuryUsd;
    return (_assetId: string, displayAmount: number): number | undefined =>
      price !== null && Number.isFinite(displayAmount) && displayAmount > 0
        ? displayAmount * price
        : undefined;
  }, [voting.treasuryUsd]);

  if (!loaded) {
    return (
      <main className="max-w-3xl mx-auto px-5 py-10 flex flex-col gap-6">
        <div>
          <Link
            href={p(dao ? `/proposals/${dao.id}` : '/proposals')}
            className="oa-btn-ghost !px-2 -ml-2"
          >
            <ArrowLeft size={15} />
            {dao?.name ?? t('daos.title')}
          </Link>
        </div>

        <section className="rounded-2xl overflow-hidden bg-[color:var(--oa-bg-raised)]">
          <div className="p-6 pb-5">
            <Skeleton className="h-8 w-2/3" />
            <div className="mt-3 flex flex-col gap-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-52" />
            </div>
          </div>
          <div className="p-6 border-t border-[color:var(--oa-border)] flex flex-col gap-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="mt-4 h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        </section>

        <section className="rounded-2xl overflow-hidden bg-[color:var(--oa-bg-raised)]">
          <div className="px-5 py-3 border-b border-[color:var(--oa-border)]">
            <Skeleton className="h-4 w-24" />
          </div>
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="px-5 py-4 flex items-center justify-between gap-3 border-b border-[color:var(--oa-border)] last:border-b-0"
            >
              <div className="flex items-center gap-3">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div>
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="mt-1.5 h-3 w-20" />
                </div>
              </div>
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </section>
      </main>
    );
  }

  if (!proposal || !dao) {
    return (
      <main className="max-w-5xl mx-auto px-5 min-h-[calc(100dvh-3.5rem)] flex items-center justify-center">
        <div className="text-center max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight mb-2">{t('prop.notFound')}</h1>
          <p className="text-sm text-[color:var(--oa-ink-secondary)] mb-6">
            {t('dao.notFoundHint')}
          </p>
          <Link href={p(dao ? `/proposals/${dao.id}` : '/proposals')} className="oa-btn-primary">
            {t('prop.backToProposals')}
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-3xl mx-auto px-5 py-10 flex flex-col gap-6">
      <div>
        <Link
          href={p(dao ? `/proposals/${dao.id}` : '/proposals')}
          className="oa-btn-ghost !px-2 -ml-2"
        >
          <ArrowLeft size={15} />
          {dao?.name ?? t('daos.title')}
        </Link>
      </div>

      {/* Title + proposer live inside the document card so the proposal
          reads as one piece; transfers share the same container and the
          standalone section below is reserved for voters. */}
      <section className="rounded-2xl overflow-hidden bg-[color:var(--oa-bg-raised)]">
        <div className="p-6 pb-5">
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2.5 min-w-0">
            {proposal.status === 'open' && (
              <span
                className="h-2 w-2 rounded-full shrink-0 bg-[color:var(--oa-success)]"
                aria-label={t('status.open')}
              />
            )}
            <span className="min-w-0">{proposalTitle(proposal, locale)}</span>
            {proposal.status !== 'open' && <ProposalStatusPill status={proposal.status} />}
          </h1>
          <div className="mt-2 flex flex-col gap-0.5 text-sm text-[color:var(--oa-ink-secondary)]">
            <span>
              {t('prop.proposer')}{' '}
              {proposerDelegation ? (
                <Link
                  href={p(`/delegations/${dao.id}/${proposerDelegation.id}`)}
                  className="oa-hoverable text-[color:var(--oa-ink)] hover:underline inline-flex items-center gap-1.5 align-middle"
                >
                  {proposerDelegation.icon && (
                    <span className="h-4 w-4 rounded-full overflow-hidden shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={proposerDelegation.icon}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </span>
                  )}
                  {locale === 'zh' && proposerDelegation.nameZh
                    ? proposerDelegation.nameZh
                    : proposerDelegation.name}
                </Link>
              ) : (
              <a
                href={explorerAddressUrl(proposal.author)}
                target="_blank"
                rel="noopener noreferrer"
                className="oa-hoverable text-[color:var(--oa-ink)] hover:underline"
              >
                {shortAddress(proposal.author)}
              </a>
              )}
            </span>
            {proposal.status === 'open' && (
              <span className="tabular-nums">
                {t('prop.timeLeft')}{' '}
                {proposal.endBlock && voting.height !== null
                  ? proposal.endBlock - voting.height > 0
                    ? t('prop.blocksLeft', {
                        n: (proposal.endBlock - voting.height).toLocaleString(),
                        dur: formatBlocksDuration(proposal.endBlock - voting.height),
                      })
                    : t('common.ended')
                  : '—'}
              </span>
            )}
          </div>
        </div>

        {stripLeadingEmptyBlocks(proposalBody(proposal, locale)).trim() ? (
          <div className="p-6 border-t border-[color:var(--oa-border)]">
            <MarkdownEditor
              key={`${proposal.id}:${locale}`}
              className="oa-markdown-view"
              defaultValue={stripLeadingEmptyBlocks(proposalBody(proposal, locale))}
              readonly
            />
          </div>
        ) : null}

        {/* Transfers sit on the subtle background so they read as their own
            zone inside the document card. */}
        <div className="bg-[color:var(--oa-bg-subtle)]">
        <div className="px-5 py-3 border-y border-[color:var(--oa-border)] flex items-center justify-between">
          <span className="text-sm font-medium">{t('prop.transfersProposed')}</span>
          <span className="text-xs font-medium text-[color:var(--oa-ink-secondary)]">
            {t('prop.amount')}
          </span>
        </div>

        <div className="divide-y divide-[color:var(--oa-border)]">
          {proposal.transfers.map((t, i) => (
            <a
              key={i}
              href={explorerAddressUrl(t.address)}
              target="_blank"
              rel="noopener noreferrer"
              className="oa-hoverable hover:bg-[color:var(--oa-bg-raised)] group px-5 py-4 flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <TokenIcon id={dao.treasuryToken.alkaneId} symbol={dao.treasuryToken.symbol} size="lg" />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate flex items-center gap-1">
                    {shortAddress(t.address)}
                    <PhArrowUpRight
                      size={13}
                      className="shrink-0 text-[color:var(--oa-ink-tertiary)] opacity-0 group-hover:opacity-100"
                    />
                  </div>
                  <div className="text-xs text-[color:var(--oa-ink-secondary)]">{dao.treasuryToken.symbol} · {dao.treasuryToken.alkaneId}</div>
                </div>
              </div>
              <div className="text-right shrink-0 flex flex-col gap-1">
                <div className="flex items-center justify-end gap-1 text-xs text-[color:var(--oa-ink-secondary)]">
                  {dao.name}
                  <PhArrowRight size={12} />
                </div>
                <div className="text-sm font-medium tabular-nums">{formatTokenAmount(t.amount, dao.treasuryToken.symbol)}</div>
                {usdValue(dao.treasuryToken.alkaneId, Number(t.amount)) !== undefined && (
                  <div className="text-xs text-[color:var(--oa-ink-tertiary)] tabular-nums">
                    ≈ {formatUsdCompact(usdValue(dao.treasuryToken.alkaneId, Number(t.amount))!)}
                  </div>
                )}
              </div>
            </a>
          ))}

          {proposal.transfers.length === 0 && (
            <div className="px-5 py-4 text-sm text-[color:var(--oa-ink-tertiary)]">
              {t('prop.noTransfers')}
            </div>
          )}
        </div>

        {proposal.transfers.length > 1 && (
          <div className="px-5 py-3 border-t border-[color:var(--oa-border)] flex items-center justify-between text-sm">
            <span className="text-[color:var(--oa-ink-secondary)]">{t('prop.total')}</span>
            <span className="font-medium tabular-nums flex items-center gap-1.5">
              {formatTokenAmount(String(totalTransferAmount(proposal)), dao.treasuryToken.symbol)}
              {usdValue(dao.treasuryToken.alkaneId, totalTransferAmount(proposal)) !== undefined && (
                <span className="font-normal text-[color:var(--oa-ink-tertiary)]">
                  ({formatUsdCompact(usdValue(dao.treasuryToken.alkaneId, totalTransferAmount(proposal))!)})
                </span>
              )}
            </span>
          </div>
        )}

        {/* Reserves remaining after the transfers execute (for closed
            proposals: reserves pinned at the end block). */}
        {voting.reserves !== null && proposal.transfers.length > 0 && (
          <div className="px-5 py-3 border-t border-[color:var(--oa-border)] flex items-center justify-between text-sm">
            <span className="text-[color:var(--oa-ink-secondary)]">{t('prop.treasuryAfter')}</span>
            <span className="font-medium tabular-nums flex items-center gap-1.5">
              {formatTokenCompact(voting.reserves - totalTransferBaseUnits(proposal))}
              <TokenIcon
                id={dao.treasuryToken.alkaneId}
                symbol={dao.treasuryToken.symbol}
                size="xs"
              />
            </span>
          </div>
        )}
        </div>
      </section>

      {/* Vote actions sit bare between the proposal document and the
          voting/resolution cards — not wrapped in any surface. */}
      <VoteButtons voting={voting} />

      <ResolutionSection dao={dao} proposal={proposal} />

      <VotingSection voting={voting} />
    </main>
  );
}
