'use client';

/**
 * Delegation detail — looks like a proposal page: name, signer, the
 * markdown description, member/power stats, and ONE action button:
 * Delegate (sign a join) or Leave delegation (sign a leave with a
 * higher nonce). Nonces are (height ≈ live tip, seq) — nodes enforce
 * the tip±5 allowance and everyone respects the highest nonce.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2 } from 'lucide-react';
import {
  buildDelegationActionMessage,
  effectiveDelegatorMeta,
  resolveDelegationState,
  type DelegationActionWire,
} from '@surtur/shared';
import { getDao } from '@/daos';
import { getDaoStore } from '@/lib/dao/store';
import { fetchEspoHeight, fetchSupplyAndHolders } from '@/lib/dao/governance';
import { useEspoHeight } from '@/hooks/useEspoHeight';
import { useVendorWallet } from '@/context/VendorWalletContext';
import { useI18n } from '@/hooks/useI18n';
import { formatTokenCompact, shortAddress, stripLeadingEmptyBlocks } from '@/lib/dao/format';
import { explorerAddressUrl } from '@/lib/config';
import { PhArrowUpRight } from '@/components/PhosphorIcons';
import MarkdownEditor from '@/components/MarkdownEditor';
import Skeleton from '@/components/Skeleton';
import TokenIcon from '@/components/TokenIcon';

export default function DelegationDetailPage() {
  const params = useParams<{ dao: string; id: string }>();
  const dao = getDao(params?.dao);
  const { t, p, locale } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();

  // Arrivals come from several places (delegations list, a proposal's
  // voters list) — go back to wherever that was; fall back to the DAO's
  // delegations view on a direct/deep link.
  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push(p(`/proposals/${dao?.id}?view=delegations`));
  };
  const { hydrated, session, connect, connecting, signMessage, openSignPopup } =
    useVendorWallet();

  const { data: tipData } = useEspoHeight(dao?.espoNetwork);
  const height = tipData ?? null;

  const delegatorQuery = useQuery({
    queryKey: ['nodes', 'delegator', params?.id],
    queryFn: () => getDaoStore().getDelegator(params!.id),
    enabled: !!params?.id,
    staleTime: Infinity,
  });
  const bundle = delegatorQuery.data ?? null;

  const actionsQuery = useQuery({
    queryKey: ['nodes', 'delegation-actions', dao?.id],
    queryFn: () => getDaoStore().listDelegationActions(dao!.id),
    enabled: !!dao,
    staleTime: 30_000,
  });
  const actions = actionsQuery.data ?? null;

  const holdersQuery = useQuery({
    queryKey: ['espo', dao?.espoNetwork, 'supply-holders', dao?.id, height],
    queryFn: () => fetchSupplyAndHolders(dao!),
    enabled: !!dao && height !== null,
    staleTime: Infinity,
    placeholderData: (prev) => prev,
  });
  const holders = holdersQuery.data?.holders ?? null;

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Effective membership at the live tip.
  const state = useMemo(
    () =>
      actions && height !== null
        ? resolveDelegationState(actions, height)
        : new Map<string, string>(),
    [actions, height],
  );

  // The owner is inherently a member: rows = owner first, then joined
  // addresses by balance desc. Totals include the owner's own balance —
  // the full weight the delegation votes with.
  const memberRows = useMemo(() => {
    if (!bundle) return [];
    const balances = new Map((holders ?? []).map((h) => [h.address, h.amount]));
    const owner = bundle.delegator.delegator;
    const rows: Array<{ address: string; amount: bigint; isOwner: boolean }> = [
      { address: owner, amount: balances.get(owner) ?? 0n, isOwner: true },
    ];
    const joined: Array<{ address: string; amount: bigint; isOwner: boolean }> = [];
    for (const [address, delegatorId] of state) {
      if (delegatorId !== bundle.delegator.id) continue;
      if (address === owner) continue;
      joined.push({ address, amount: balances.get(address) ?? 0n, isOwner: false });
    }
    joined.sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
    return [...rows, ...joined];
  }, [state, holders, bundle]);

  const stats = useMemo(() => {
    let power = 0n;
    for (const row of memberRows) power += row.amount;
    return { members: memberRows.length, power };
  }, [memberRows]);

  if (!dao) return null;

  const myAddress = session?.account.address ?? null;
  const myDelegation = myAddress ? (state.get(myAddress) ?? null) : null;
  const isMemberHere = bundle !== null && myDelegation === bundle.delegator.id;
  const isSigner = bundle !== null && myAddress === bundle.delegator.delegator;

  const act = async (kind: 'join' | 'leave') => {
    if (!session || !bundle || submitting) return;
    setError(null);
    const popup = openSignPopup('signMessage');
    setSubmitting(true);
    try {
      const tip = await fetchEspoHeight(dao.espoNetwork);
      // seq bumps past any of MY actions already at this height.
      const mine = (actions ?? []).filter(
        (a) => a.address === session.account.address && a.height === tip,
      );
      const seq = mine.length
        ? Math.max(...mine.map((a) => a.seq)) + 1
        : 0;
      const draft = {
        daoId: dao.id,
        delegatorId: bundle.delegator.id,
        address: session.account.address,
        action: kind,
        height: tip,
        seq,
      } as const;
      const { signature, address } = await signMessage(buildDelegationActionMessage(draft), {
        popup,
      });
      if (address !== session.account.address) {
        throw new Error('Signing account does not match the connected account.');
      }
      const wire: DelegationActionWire = {
        ...draft,
        signature,
        signedAt: new Date().toISOString(),
      };
      await getDaoStore().submitDelegationAction(wire);
      await queryClient.invalidateQueries({ queryKey: ['nodes', 'delegation-actions', dao.id] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (popup && !popup.closed) popup.close();
    } finally {
      setSubmitting(false);
    }
  };

  if (delegatorQuery.isPending) {
    return (
      <main className="max-w-3xl mx-auto px-5 py-10 flex flex-col gap-6">
        <section className="rounded-2xl bg-[color:var(--oa-bg-raised)] p-6">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="mt-3 h-4 w-40" />
          <Skeleton className="mt-6 h-24 w-full" />
        </section>
      </main>
    );
  }

  if (!bundle) {
    return (
      <main className="max-w-3xl mx-auto px-5 py-10">
        <div className="text-sm text-[color:var(--oa-ink-tertiary)]">Not found.</div>
      </main>
    );
  }

  const meta = effectiveDelegatorMeta(bundle);
  const name = locale === 'zh' && meta.nameZh ? meta.nameZh : meta.name;
  const description =
    locale === 'zh' && meta.descriptionZh ? meta.descriptionZh : meta.description;

  return (
    <main className="max-w-3xl mx-auto px-5 py-10 flex flex-col gap-6">
      <div>
        <button type="button" className="oa-btn-ghost !px-2 -ml-2" onClick={goBack}>
          <ArrowLeft size={15} />
          {t('dlg.backToDao')}
        </button>
      </div>

      {isMemberHere && (
        <div
          className="self-center rounded-2xl px-4 py-3 text-sm"
          style={{
            background: 'color-mix(in srgb, var(--oa-success) 10%, transparent)',
            color: 'var(--oa-success)',
          }}
        >
          {t('dlg.youAreMember')}
        </div>
      )}

      <section className="rounded-2xl overflow-hidden bg-[color:var(--oa-bg-raised)]">
        <div className="p-6 pb-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {meta.icon && (
                <span className="h-11 w-11 rounded-full overflow-hidden shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={meta.icon} alt="" className="h-full w-full object-cover" />
                </span>
              )}
              <h1 className="text-2xl font-semibold tracking-tight truncate">{name}</h1>
            </div>
            {isSigner && (
              <Link
                href={p(`/delegations/${dao.id}/${bundle.delegator.id}/edit`)}
                className="oa-btn-secondary !px-4 !py-2 shrink-0"
              >
                {t('dlg.edit')}
              </Link>
            )}
          </div>
          <div className="mt-3 flex flex-col gap-1.5 text-sm text-[color:var(--oa-ink-secondary)]">
            <span>
              {t('dlg.signer')}{' '}
              <a
                href={explorerAddressUrl(bundle.delegator.delegator)}
                target="_blank"
                rel="noopener noreferrer"
                className="oa-hoverable text-[color:var(--oa-ink)] hover:underline"
              >
                {shortAddress(bundle.delegator.delegator)}
              </a>
            </span>
            <span className="tabular-nums">
              {t('dlg.createdAtBlock')} {bundle.delegator.createdAtBlock.toLocaleString()}
            </span>
          </div>

          {/* Stats */}
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span className="text-[color:var(--oa-ink-secondary)]">
              {t('dlg.members')}{' '}
              <span className="text-[color:var(--oa-ink)] font-medium tabular-nums">
                {actions === null ? '—' : stats.members.toLocaleString()}
              </span>
            </span>
            <span className="text-[color:var(--oa-ink-secondary)] inline-flex items-center gap-1.5">
              {t('dlg.totalPower')}{' '}
              <span className="text-[color:var(--oa-ink)] font-medium tabular-nums">
                {holders === null ? '—' : formatTokenCompact(stats.power)}
              </span>
              <TokenIcon
                id={dao.votingToken.alkaneId}
                symbol={dao.votingToken.symbol}
                size="xs"
              />
            </span>
          </div>
        </div>

        {stripLeadingEmptyBlocks(description).trim() ? (
          <div className="p-6 border-t border-[color:var(--oa-border)]">
            <MarkdownEditor
              key={`${bundle.delegator.id}:${locale}`}
              className="oa-markdown-view"
              defaultValue={stripLeadingEmptyBlocks(description)}
              readonly
            />
          </div>
        ) : null}

      </section>

      {/* Members — separate card: owner first, then joined by balance. */}
      <section className="rounded-2xl overflow-hidden bg-[color:var(--oa-bg-raised)]">
        <div className="px-5 py-3 border-b border-[color:var(--oa-border)] flex items-center justify-between">
          <span className="text-sm font-medium">
            {t('dlg.members')}
            {actions !== null && (
              <span className="ml-1.5 text-[color:var(--oa-ink-tertiary)] tabular-nums">
                {stats.members.toLocaleString()}
              </span>
            )}
          </span>
        </div>
        <div className="divide-y divide-[color:var(--oa-border)]">
          {actions === null &&
            Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="px-5 py-3.5 flex items-center justify-between gap-3">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          {actions !== null &&
            memberRows.map((row, index) => (
              <a
                key={row.address}
                href={explorerAddressUrl(row.address)}
                target="_blank"
                rel="noopener noreferrer"
                className="oa-row group px-5 py-3.5 flex items-center justify-between gap-3"
              >
                <span className="min-w-0 text-sm font-medium truncate flex items-center gap-2">
                  <span className="w-6 shrink-0 text-xs text-[color:var(--oa-ink-tertiary)] tabular-nums">
                    {index + 1}
                  </span>
                  {shortAddress(row.address)}
                  {row.isOwner && (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-[color:var(--oa-bg-subtle)] text-[color:var(--oa-ink-secondary)]">
                      {t('dlg.owner')}
                    </span>
                  )}
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
                <span className="text-sm font-medium tabular-nums shrink-0 flex items-center gap-1.5">
                  {formatTokenCompact(row.amount)}
                  <TokenIcon
                    id={dao.votingToken.alkaneId}
                    symbol={dao.votingToken.symbol}
                    size="xs"
                  />
                </span>
              </a>
            ))}
        </div>
      </section>

      {/* The single action button, bare like the vote buttons. */}
      {!isSigner && (
        <div className="flex flex-col gap-2">
          {hydrated && !session ? (
            <button
              type="button"
              className="oa-btn-primary w-full"
              onClick={connect}
              disabled={connecting}
            >
              {connecting ? t('header.connecting') : t('dlg.connectToDelegate')}
            </button>
          ) : isMemberHere ? (
            <>
              <button
                type="button"
                className="oa-btn-secondary w-full"
                onClick={() => act('leave')}
                disabled={submitting}
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                {submitting ? t('dlg.signing') : t('dlg.leave')}
              </button>
            </>
          ) : (
            <>
              {myDelegation !== null && (
                <p className="text-sm text-[color:var(--oa-ink-tertiary)] text-center">
                  {t('dlg.memberElsewhere')}
                </p>
              )}
              <button
                type="button"
                className="oa-btn-primary w-full"
                onClick={() => act('join')}
                disabled={submitting}
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                {submitting ? t('dlg.signing') : t('dlg.delegate')}
              </button>
            </>
          )}
          {error && (
            <div className="text-sm text-[color:var(--oa-danger)] text-center break-words">
              {error}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
