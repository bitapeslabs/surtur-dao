'use client';

/**
 * Proposal voting — one shared `useVoting` state hook and two views:
 *   - VoteButtons: the Vote For / Abstain / Against row (rendered below
 *     the proposal title + proposer, runs the SUBFROST sign-message popup)
 *   - VotingSection (default): the votes card — voting-token-weighted
 *     green/grey/red bar (non-voters count as abstain), pass-threshold
 *     marker, and the voter list with voting-token balances.
 *
 * Everything token/threshold-specific comes from the DaoDefinition.
 *
 * Data: circulating supply + full holder list from Espo (one oversized
 * get_holders call — already sorted by amount desc), votes via DaoStore.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { SubfrostConnectError } from 'subfrost-connect';
import { useVendorWallet } from '@/context/VendorWalletContext';
import { useEspoHeight } from '@/hooks/useEspoHeight';
import { getDaoStore } from '@/lib/dao/store';
import type { Proposal, Vote, VoteChoice } from '@/lib/dao/types';
import { fetchGovernanceSnapshot } from '@/lib/dao/governance';
import { buildVoteMessage, formatTokenCompact, shortAddress } from '@/lib/dao/format';
import { explorerAddressUrl } from '@/lib/config';
import type { DaoDefinition } from '@/daos';
import { resolveThreshold, thresholdPower as thresholdPowerOf } from '@surtur/shared';
import { PhArrowUpRight } from '@/components/PhosphorIcons';
import Skeleton from '@/components/Skeleton';
import TokenIcon from '@/components/TokenIcon';
import { useI18n } from '@/hooks/useI18n';
import type { MessageKey } from '@/i18n';

const CHOICE_META: Record<
  VoteChoice,
  { labelKey: MessageKey; voteKey: MessageKey; color: string }
> = {
  for: { labelKey: 'votes.for', voteKey: 'votes.voteFor', color: 'var(--oa-success)' },
  abstain: {
    labelKey: 'votes.abstain',
    voteKey: 'votes.voteAbstain',
    color: 'var(--oa-ink-tertiary)',
  },
  against: { labelKey: 'votes.against', voteKey: 'votes.voteAgainst', color: 'var(--oa-danger)' },
};

function pct(part: bigint, whole: bigint): number {
  if (whole <= 0n) return 0;
  return Number((part * 10_000n) / whole) / 100;
}

/** Up to 2 decimals, only when present: 100 → "100", 56.78 → "56.78". */
function fmtPct(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}


/**
 * All voting state for a proposal. Accepts null so the page can call it
 * unconditionally while the proposal itself is still loading.
 *
 * Espo's DB is versioned, so a closed proposal reads supply/holders pinned
 * at its end block — the tally is static forever with no self-maintained
 * snapshot. The first load after the end block passes computes the
 * passed/rejected verdict (For power vs the DAO's pass threshold % of the
 * end-block supply), persists it via the DaoStore, and reports the updated
 * proposal through `onProposalChanged`.
 */
export function useVoting(
  dao: DaoDefinition | null,
  proposal: Proposal | null,
  onProposalChanged?: (proposal: Proposal) => void,
) {
  const {
    hydrated,
    session,
    connect,
    connecting,
    signMessage: signWalletMessage,
    openSignPopup,
  } = useVendorWallet();
  const queryClient = useQueryClient();

  const [signing, setSigning] = useState<VoteChoice | null>(null);
  const [voteError, setVoteError] = useState<string | null>(null);

  const proposalId = proposal?.id ?? null;

  const onProposalChangedRef = useRef(onProposalChanged);
  onProposalChangedRef.current = onProposalChanged;

  // The tip is the only thing polled from espo; everything below caches
  // against it.
  const { data: tipData } = useEspoHeight(dao?.espoNetwork);
  const height = tipData ?? null;

  const isClosed = proposal !== null && proposal.status !== 'open';
  const pin = isClosed && proposal?.endBlock ? proposal.endBlock : undefined;

  // Votes cache like everything else: open proposals key on the live tip
  // (same block → cache hit), closed ones pin on their end block and are
  // never invalidated. Submitting a vote invalidates the proposal's keys.
  const votesQuery = useQuery({
    queryKey:
      pin !== undefined
        ? ['nodes', 'votes', proposalId, 'pinned', pin]
        : ['nodes', 'votes', proposalId, height ?? 'no-tip'],
    queryFn: () => getDaoStore().listVotes(proposalId!),
    enabled: !!proposalId,
    staleTime: Infinity,
    placeholderData: (prev) => prev,
  });
  const votes = votesQuery.data ?? null;

  const reloadVotes = useCallback(() => {
    if (!proposalId) return;
    void queryClient.invalidateQueries({ queryKey: ['nodes', 'votes', proposalId] });
  }, [queryClient, proposalId]);

  // Supply + holders + reserves + price in ONE batched espo call.
  // Open proposals key on the live tip: a new block → new key → refetch;
  // same block → served from cache. Closed proposals key on their end
  // block and are NEVER invalidated — past-block data is immutable.
  const snapshotQuery = useQuery({
    queryKey:
      pin !== undefined
        ? ['espo', dao?.espoNetwork, 'snapshot', dao?.id, 'pinned', pin]
        : ['espo', dao?.espoNetwork, 'snapshot', dao?.id, height],
    queryFn: () => fetchGovernanceSnapshot(dao!, pin),
    enabled: !!dao && !!proposal && (pin !== undefined || height !== null),
    staleTime: Infinity,
    // Keep showing the previous block's data while the new one loads.
    placeholderData: (prev) => prev,
  });

  const supply = snapshotQuery.data?.supply ?? null;
  const holders = snapshotQuery.data?.holders ?? null;
  const reserves = dao?.treasuryAddress ? (snapshotQuery.data?.reserves ?? null) : null;
  const treasuryUsd = snapshotQuery.data?.treasuryUsd ?? null;
  const espoError = snapshotQuery.error
    ? snapshotQuery.error instanceof Error
      ? snapshotQuery.error.message
      : String(snapshotQuery.error)
    : null;

  // Close transition: the tip crossed the end block while the proposal is
  // still open — read the world AT the end block (pinned, cacheable
  // forever), decide the verdict, persist it.
  const windowEnded =
    !isClosed && !!proposal?.endBlock && height !== null && height >= proposal.endBlock;
  useEffect(() => {
    if (!dao || !proposal || !windowEnded || !proposal.endBlock) return;
    let cancelled = false;
    (async () => {
      try {
        // The orchestrator computes verdicts once per ended proposal and
        // caches them in memory indefinitely — the browser never has to
        // download supply + full holder lists to learn pass/reject.
        let verdict: 'passed' | 'rejected' | null = null;
        try {
          const res = await fetch(
            `/api/orchestrator/verdicts?dao=${encodeURIComponent(dao.id)}`,
          );
          const json = await res.json().catch(() => null);
          const status = json?.ok ? json.verdicts?.[proposal.id] : undefined;
          if (status === 'passed' || status === 'rejected') {
            verdict = status;
          }
        } catch {
          /* orchestrator unreachable — compute locally below */
        }

        if (verdict === null) {
          // Fallback: localStorage store mode, or the orchestrator/nodes
          // are down — the legacy client-side computation.
          const snapshot = await fetchGovernanceSnapshot(dao, proposal.endBlock);
          const allVotes = await getDaoStore().listVotes(proposal.id);
          const balances = new Map(snapshot.holders.map((h) => [h.address, h.amount]));
          let forPower = 0n;
          for (const v of allVotes) {
            if (v.choice === 'for') forPower += balances.get(v.address) ?? 0n;
          }
          const pctg = resolveThreshold(dao.votePassThreshold, proposal.endBlock);
          verdict = forPower >= thresholdPowerOf(snapshot.supply, pctg) ? 'passed' : 'rejected';
        }

        const updated = await getDaoStore().updateProposalStatus(proposal.id, verdict);
        if (!cancelled && updated) onProposalChangedRef.current?.(updated);
      } catch {
        /* next load retries the transition */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dao?.id, proposalId, windowEnded]);

  const balanceByAddress = useMemo(() => {
    const map = new Map<string, bigint>();
    for (const h of holders ?? []) map.set(h.address, h.amount);
    return map;
  }, [holders]);

  const choiceByAddress = useMemo(() => {
    const map = new Map<string, VoteChoice>();
    for (const v of votes ?? []) map.set(v.address, v.choice);
    return map;
  }, [votes]);

  // Voters ordered by voting-token balance desc: walk the (already
  // sorted) holder list, then append voters holding none at all.
  const voterRows = useMemo(() => {
    const rows: Array<{ address: string; choice: VoteChoice; amount: bigint }> = [];
    for (const h of holders ?? []) {
      const choice = choiceByAddress.get(h.address);
      if (choice) rows.push({ address: h.address, choice, amount: h.amount });
    }
    for (const v of votes ?? []) {
      if (!balanceByAddress.has(v.address)) {
        rows.push({ address: v.address, choice: v.choice, amount: 0n });
      }
    }
    return rows;
  }, [holders, votes, choiceByAddress, balanceByAddress]);

  const tally = useMemo(() => {
    let forPower = 0n;
    let againstPower = 0n;
    for (const row of voterRows) {
      if (row.choice === 'for') forPower += row.amount;
      else if (row.choice === 'against') againstPower += row.amount;
    }
    const total = supply ?? 0n;
    const cast = forPower + againstPower;
    // Everything not explicitly for/against — including uncast supply —
    // counts as abstain.
    const abstainPower = total > cast ? total - cast : 0n;
    return { forPower, againstPower, abstainPower, total };
  }, [voterRows, supply]);

  const myChoice = session ? choiceByAddress.get(session.account.address) : undefined;

  /** Voting is over — the tally shown is the static end-block state. */
  const closed = proposal !== null && proposal.status !== 'open';

  // Voting power still missing from the For column before the pass line.
  // The pass threshold is the fork entry in force at the proposal's END
  // block (legacy proposals without a window use the latest entry).
  const passPct = dao
    ? resolveThreshold(dao.votePassThreshold, proposal?.endBlock ?? Number.MAX_SAFE_INTEGER)
    : 0;
  const passPower = supply !== null ? thresholdPowerOf(supply, passPct) : 0n;
  const neededPower = passPower > tally.forPower ? passPower - tally.forPower : 0n;

  const castVote = async (choice: VoteChoice) => {
    if (!dao || !proposal || !session) return;
    setVoteError(null);
    setSigning(choice);
    // Pre-open the passport popup synchronously in the click gesture
    // (Safari-safe); null for extension/mobile wallets.
    const popup = openSignPopup('signMessage');
    try {
      const message = buildVoteMessage(dao.id, proposal.id, proposal.title, choice);
      const { signature, address, publicKey } = await signWalletMessage(message, { popup });
      await getDaoStore().submitVote({
        proposalId: proposal.id,
        daoId: dao.id,
        address,
        choice,
        signature,
        publicKey,
        message,
        votedAt: new Date().toISOString(),
      });
      reloadVotes();
    } catch (e) {
      if (
        e instanceof SubfrostConnectError &&
        (e.code === 'POPUP_CLOSED' || e.code === 'USER_REJECTED')
      ) {
        // silent — user changed their mind
      } else {
        setVoteError(e instanceof Error ? e.message : String(e));
      }
      if (popup && !popup.closed) popup.close();
    } finally {
      setSigning(null);
    }
  };

  const segments: Array<{ choice: VoteChoice; power: bigint }> = [
    { choice: 'for', power: tally.forPower },
    { choice: 'abstain', power: tally.abstainPower },
    { choice: 'against', power: tally.againstPower },
  ];

  return {
    hydrated,
    session,
    connect,
    connecting,
    dao,
    passPct,
    proposal,
    height,
    supply,
    reserves,
    treasuryUsd,
    votes,
    espoError,
    voteError,
    signing,
    myChoice,
    closed,
    tally,
    segments,
    voterRows,
    neededPower,
    castVote,
  };
}

export type VotingState = ReturnType<typeof useVoting>;

/** Vote For / Abstain / Against row (connect CTA while disconnected). */
export function VoteButtons({ voting }: { voting: VotingState }) {
  const { hydrated, session, connect, connecting, myChoice, signing, castVote, closed } = voting;
  const { t } = useI18n();

  if (closed) return null;

  if (hydrated && !session) {
    return (
      <button type="button" className="oa-btn-primary w-full" onClick={connect} disabled={connecting}>
        {connecting ? t('header.connecting') : t('votes.connectToVote')}
      </button>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      {(Object.keys(CHOICE_META) as VoteChoice[]).map((choice) => (
        <button
          key={choice}
          type="button"
          className={`oa-btn-secondary w-full ${
            myChoice !== undefined
              ? 'hover:!bg-[color:var(--oa-bg-subtle)] !cursor-default'
              : ''
          } ${myChoice === choice ? 'outline outline-1 !opacity-100' : ''}`}
          style={myChoice === choice ? { outlineColor: CHOICE_META[choice].color } : undefined}
          onClick={() => castVote(choice)}
          disabled={signing !== null || myChoice !== undefined}
        >
          {signing === choice ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <span className="h-2 w-2 rounded-full" style={{ background: CHOICE_META[choice].color }} />
          )}
          {t(CHOICE_META[choice].voteKey)}
        </button>
      ))}
    </div>
  );
}

export default function VotingSection({ voting }: { voting: VotingState }) {
  const {
    session,
    dao,
    passPct,
    proposal,
    height,
    supply,
    reserves,
    treasuryUsd,
    votes,
    espoError,
    voteError,
    closed,
    tally,
    segments,
    voterRows,
    neededPower,
  } = voting;
  const { t } = useI18n();
  const votingSymbol = dao?.votingToken.symbol ?? '';
  const votingTokenId = dao?.votingToken.alkaneId ?? '';

  // Threshold-label anchoring: centered on the dotted line when it fits;
  // when the line sits near the bar's left edge the label grows RIGHT from
  // the line, near the right edge it grows LEFT — never overflowing the
  // bar. Decided by measuring the rendered label against the bar width.
  // Voter list: segmented For/Against tabs, top holders first (voterRows
  // are already sorted by voting-token balance desc).
  const [voterTab, setVoterTab] = useState<'for' | 'against'>('for');

  const markerWrapRef = useRef<HTMLDivElement>(null);
  const markerLabelRef = useRef<HTMLDivElement>(null);
  const [markerAlign, setMarkerAlign] = useState<'center' | 'left' | 'right'>('center');
  const markerTransform =
    markerAlign === 'center'
      ? 'translateX(-50%)'
      : markerAlign === 'right'
        ? 'translateX(-100%)'
        : undefined;

  // One espo batch feeds supply/holders/height — this is the page's API
  // wait, covered by skeletons until it resolves (or errors).
  const snapshotLoading = supply === null && !espoError;
  const votersLoading = votes === null || (snapshotLoading && (votes?.length ?? 0) > 0);

  const passPctForMeasure = passPct;
  useLayoutEffect(() => {
    const measure = () => {
      const wrap = markerWrapRef.current;
      const label = markerLabelRef.current;
      if (!wrap || !label) return;
      const width = wrap.clientWidth;
      const labelWidth = label.offsetWidth;
      const center = (passPctForMeasure / 100) * width;
      if (center - labelWidth / 2 < 0) setMarkerAlign('left');
      else if (center + labelWidth / 2 > width) setMarkerAlign('right');
      else setMarkerAlign('center');
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (markerWrapRef.current) observer.observe(markerWrapRef.current);
    if (markerLabelRef.current) observer.observe(markerLabelRef.current);
    return () => observer.disconnect();
  });

  return (
    <section className="rounded-2xl overflow-hidden bg-[color:var(--oa-bg-raised)]">
      <div className="px-5 py-3 border-b border-[color:var(--oa-border)]">
        <h2 className="text-sm font-medium">
          {t('votes.title')}
          {votes !== null && votes.length > 0 ? ` (${votes.length})` : ''}
        </h2>
      </div>

      <div className="px-5 py-4 flex flex-col gap-3">
        {/* For / abstain / against, voting-token-weighted over supply.
            The dotted marker sits at the pass threshold, with the
            still-needed text centered above it. */}
        <div ref={markerWrapRef} className={`relative ${passPct > 0 ? 'pt-7' : ''}`}>
          {passPct > 0 && snapshotLoading && (
            <div
              ref={markerLabelRef}
              className="absolute top-0"
              style={{ left: `${passPct}%`, transform: markerTransform }}
            >
              <Skeleton className="h-3.5 w-44" />
            </div>
          )}
          {passPct > 0 && supply !== null && (
            <div
              ref={markerLabelRef}
              className="absolute top-0 text-xs text-[color:var(--oa-ink-secondary)] whitespace-nowrap"
              style={{ left: `${passPct}%`, transform: markerTransform }}
            >
              {closed ? (
                proposal?.status === 'rejected' ? (
                  <span className="text-[color:var(--oa-danger)]">{t('votes.rejectedLabel')}</span>
                ) : (
                  <span className="text-[color:var(--oa-success)]">{t('votes.passedLabel')}</span>
                )
              ) : neededPower > 0n ? (
                <span className="inline-flex items-center gap-1">
                  {t('votes.moreNeeded', { pct: fmtPct(pct(neededPower, supply)) })} (
                  <span className="text-[color:var(--oa-ink)]">{formatTokenCompact(neededPower)}</span>
                  <TokenIcon id={votingTokenId} symbol={votingSymbol} size="xs" />)
                </span>
              ) : (
                <span className="text-[color:var(--oa-success)]">{t('votes.thresholdReached')}</span>
              )}
            </div>
          )}
          <div className="relative">
            {snapshotLoading ? (
              <Skeleton className="h-2.5 w-full rounded-full" />
            ) : (
              <div className="h-2.5 rounded-full overflow-hidden flex bg-[color:var(--oa-bg-subtle)]">
                {tally.total > 0n &&
                  segments.map(
                    (s) =>
                      s.power > 0n && (
                        <div
                          key={s.choice}
                          style={{
                            width: `${pct(s.power, tally.total)}%`,
                            background: CHOICE_META[s.choice].color,
                          }}
                        />
                      ),
                  )}
              </div>
            )}
            {passPct > 0 && !snapshotLoading && (
              <div
                className="absolute -inset-y-1 w-0 border-l-2 border-dotted border-[color:var(--oa-ink)]"
                style={{ left: `${passPct}%` }}
                aria-hidden="true"
              />
            )}
          </div>
        </div>
        {/* Fixed label slots so labels can never collide, regardless of
            segment widths: For pinned to the bar's left edge, Abstain dead
            center, Against pinned to the right edge. Zero-balance sections
            leave their slot empty. On narrow (mobile) viewports the row
            would overlap anyway, so the labels stack as a left-aligned
            column instead. */}
        <div className="flex flex-col gap-1 sm:grid sm:grid-cols-3 sm:items-center text-xs text-[color:var(--oa-ink-secondary)]">
          {snapshotLoading ? (
            <>
              <Skeleton className="h-3 w-24 sm:justify-self-start" />
              <Skeleton className="h-3 w-24 sm:justify-self-center" />
              <Skeleton className="h-3 w-24 sm:justify-self-end" />
            </>
          ) : tally.total > 0n ? (
            segments.map((s, i) => (
              <div
                key={s.choice}
                className={`${s.power > 0n ? '' : 'hidden sm:block'} ${
                  i === 0
                    ? 'sm:justify-self-start'
                    : i === 1
                      ? 'sm:justify-self-center'
                      : 'sm:justify-self-end'
                }`}
              >
                {s.power > 0n && (
                  <span className="inline-flex items-center gap-1 whitespace-nowrap">
                    <span
                      className="h-1.5 w-1.5 rounded-full shrink-0 mr-0.5"
                      style={{ background: CHOICE_META[s.choice].color }}
                    />
                    {fmtPct(pct(s.power, tally.total))}% (
                    <span className="text-[color:var(--oa-ink)]">{formatTokenCompact(s.power)}</span>
                    <TokenIcon id={votingTokenId} symbol={votingSymbol} size="xs" />)
                  </span>
                )}
              </div>
            ))
          ) : (
            <span className="sm:col-span-3 text-[color:var(--oa-ink-tertiary)]">
              {t('votes.supplyUnavailable')}
            </span>
          )}
        </div>
        {espoError && (
          <div className="text-xs text-[color:var(--oa-danger)] break-words">{espoError}</div>
        )}
        {voteError && (
          <div className="text-xs text-[color:var(--oa-danger)] break-words">{voteError}</div>
        )}
      </div>

      {/* Segmented control: top For voters vs top Against voters. */}
      <div className="px-5 py-3 border-t border-[color:var(--oa-border)]">
        {/* Segments meet with a tiny inner radius (squared facing edges)
            while the outer edges keep the pill rounding. */}
        <div className="inline-flex rounded-full bg-[color:var(--oa-bg-subtle)] p-0.5 gap-0.5">
          {(['for', 'against'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className={`oa-hoverable inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium ${
                tab === 'for' ? 'rounded-l-full rounded-r-sm' : 'rounded-r-full rounded-l-sm'
              } ${
                voterTab === tab
                  ? 'bg-[color:var(--oa-bg-raised)] text-[color:var(--oa-ink)]'
                  : 'text-[color:var(--oa-ink-secondary)] hover:text-[color:var(--oa-ink)]'
              }`}
              onClick={() => setVoterTab(tab)}
              aria-pressed={voterTab === tab}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: CHOICE_META[tab].color }}
              />
              {t(CHOICE_META[tab].labelKey)}
              {!votersLoading && (
                <span className="text-[color:var(--oa-ink-tertiary)] tabular-nums">
                  {voterRows.filter((r) => r.choice === tab).length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="divide-y divide-[color:var(--oa-border)] border-t border-[color:var(--oa-border)]">
        {votersLoading &&
          Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="px-5 py-3.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Skeleton className="h-4 w-5" />
                <Skeleton className="h-4 w-36" />
              </div>
              <Skeleton className="h-4 w-20" />
            </div>
          ))}

        {!votersLoading &&
          voterRows
            .filter((row) => row.choice === voterTab)
            .map((row, index) => (
              <a
                key={row.address}
                href={explorerAddressUrl(row.address)}
                target="_blank"
                rel="noopener noreferrer"
                className="oa-row group px-5 py-3.5 flex items-center justify-between gap-3"
              >
                <div className="min-w-0 flex items-center gap-2.5">
                  <span className="w-6 shrink-0 text-xs text-[color:var(--oa-ink-tertiary)] tabular-nums">
                    {index + 1}
                  </span>
                  <span className="text-sm font-medium truncate flex items-center gap-1">
                    {shortAddress(row.address)}
                    {session && row.address === session.account.address && (
                      <span className="text-xs text-[color:var(--oa-ink-tertiary)]">
                        {t('votes.you')}
                      </span>
                    )}
                    <PhArrowUpRight
                      size={13}
                      className="shrink-0 text-[color:var(--oa-ink-tertiary)] opacity-0 group-hover:opacity-100"
                    />
                  </span>
                </div>
                <div className="text-sm font-medium tabular-nums shrink-0 flex items-center gap-1.5">
                  {formatTokenCompact(row.amount)}
                  <TokenIcon id={votingTokenId} symbol={votingSymbol} size="xs" />
                </div>
              </a>
            ))}

        {!votersLoading &&
          votes !== null &&
          voterRows.filter((row) => row.choice === voterTab).length === 0 && (
            <div className="px-5 py-4 text-sm text-[color:var(--oa-ink-tertiary)]">
              {t(voterTab === 'for' ? 'votes.noneFor' : 'votes.noneAgainst')}
            </div>
          )}
      </div>
    </section>
  );
}
