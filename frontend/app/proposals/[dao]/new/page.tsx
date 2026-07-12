'use client';

/**
 * New-proposal page — title, Milkdown (Crepe) markdown editor for the
 * proposal body, and a Transfers builder beneath it: each transfer is a
 * DIESEL amount + recipient address the DAO reserves would pay out if the
 * proposal passes. Requires a connected SUBFROST wallet (the author).
 * Writes go through the DaoStore abstraction (localStorage for now).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Plus, Trash2 } from 'lucide-react';
import { useVendorWallet } from '@/context/VendorWalletContext';
import { getDaoStore } from '@/lib/dao/store';
import { useQuery } from '@tanstack/react-query';
import { SubfrostConnectError } from 'subfrost-connect';
import {
  delegationMembersAt,
  buildProposalSignMessage,
  computeProposalId,
  resolveThreshold,
  type ProposalContent,
} from '@surtur/shared';
import { fetchDaoOverviewCached, fetchEspoHeight, fetchSupplyAndHolders } from '@/lib/dao/governance';
import { useEspoHeight } from '@/hooks/useEspoHeight';
import { getDao } from '@/daos';
import { bodySchema, validateProposalDraft } from '@/lib/dao/schemas';
import {
  stripLeadingEmptyBlocks, formatUsdCompact } from '@/lib/dao/format';
import { useI18n } from '@/hooks/useI18n';
import { useProposerEligibility } from '@/hooks/useProposerEligibility';
import InfoTip from '@/components/InfoTip';
import MarkdownEditor from '@/components/MarkdownEditor';
import TokenIcon from '@/components/TokenIcon';

interface TransferDraft {
  key: number;
  amount: string;
  address: string;
}

/** Default voting window: ~1 week of blocks. */
const DEFAULT_WINDOW_BLOCKS = 1008;

const BLOCK_MS = 10 * 60 * 1000;

/** Wall-clock estimate for a block, from the current tip (~10 min/block). */
function estimateBlockDate(block: number, currentHeight: number): string {
  const d = new Date(Date.now() + (block - currentHeight) * BLOCK_MS);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function NewProposalPage() {
  const router = useRouter();
  const params = useParams<{ dao: string }>();
  const dao = getDao(params?.dao);
  const { t, p, locale } = useI18n();
  const {
    hydrated,
    session,
    connect,
    connecting,
    network,
    signMessage: signWalletMessage,
    openSignPopup,
  } = useVendorWallet();

  const [title, setTitle] = useState('');
  // Optional Chinese version — when provided, zh readers see it instead of
  // the English title/body.
  const [withZh, setWithZh] = useState(false);
  const [titleZh, setTitleZh] = useState('');
  const zhBodyRef = useRef('');
  // The editor owns the document; keep markdown in a ref so keystrokes
  // don't re-render the page.
  const bodyRef = useRef('');
  const nextKey = useRef(1);
  const [transfers, setTransfers] = useState<TransferDraft[]>([]);
  const [startBlock, setStartBlock] = useState('');
  // "Use current block" lock: while locked the input mirrors the tip and
  // the real start block is re-resolved from Espo at submit time.
  const [startLocked, setStartLocked] = useState(false);
  const [endMode, setEndMode] = useState<'block' | 'duration'>('block');
  const [endValue, setEndValue] = useState('');
  // Tip from the height poller; reserves + price cache against it (same
  // query key as the DAO page — usually already in cache on arrival).
  const { data: tipData } = useEspoHeight(dao?.espoNetwork);
  const currentHeight = tipData ?? null;
  const overviewQuery = useQuery({
    queryKey: ['espo', dao?.espoNetwork, 'dao-overview', dao?.id, currentHeight],
    queryFn: () => fetchDaoOverviewCached(dao!),
    enabled: !!dao && currentHeight !== null,
    staleTime: Infinity,
    placeholderData: (prev) => prev,
  });
  const reserves = overviewQuery.data?.reserves ?? null;
  const treasuryUsd = overviewQuery.data?.treasuryUsd ?? null;

  // Treasury-token USD price rides the overview batch.
  const usdValue = (displayAmount: number): number | undefined =>
    treasuryUsd !== null && Number.isFinite(displayAmount) && displayAmount > 0
      ? displayAmount * treasuryUsd
      : undefined;
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Prefill the voting window once the tip arrives (empty fields only —
  // user edits are never clobbered by later height ticks).
  useEffect(() => {
    if (currentHeight === null) return;
    setStartBlock((cur) => (cur === '' ? String(currentHeight) : cur));
    setEndValue((cur) => (cur === '' ? String(currentHeight + DEFAULT_WINDOW_BLOCKS) : cur));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentHeight === null]);

  // ---- Zod validation (live — every input; drives red borders and the
  // Create button; see lib/dao/schemas.ts) ----
  const { errors: fieldErrors, valid: draftValid } = validateProposalDraft(
    { title, transfers, startBlock, endValue },
    {
      // Recipient addresses live on the DAO's network — validating against
      // the wallet's network would reject mainnet bc1… addresses whenever
      // the wallet is on regtest.
      network: dao?.espoNetwork ?? network,
      currentHeight,
      startLocked,
      endMode,
      reservesBase: reserves,
      treasurySymbol: dao?.treasuryToken.symbol ?? '',
      locale,
    },
  );
  const startNum = Number(startBlock);
  const endNum = Number(endValue);
  const effectiveStart = startLocked ? currentHeight : Number.isInteger(startNum) ? startNum : null;
  // Red borders only appear on non-empty fields; empty required fields
  // still keep the button disabled via draftValid.
  const startInvalid = !startLocked && startBlock !== '' && !!fieldErrors.startBlock;
  const endInvalid = endValue !== '' && !!fieldErrors.end;
  // Direct navigation can't bypass the threshold: submit stays disabled
  // until the wallet provably holds enough of the voting token (and the
  // surtur nodes re-enforce the same rule on POST regardless).
  const eligibility = useProposerEligibility(dao);
  const canSubmit = !submitting && draftValid && eligibility.eligible && !eligibility.checking;

  const toggleStartLock = () => {
    if (startLocked) {
      setStartLocked(false);
    } else if (currentHeight !== null) {
      setStartBlock(String(currentHeight));
      setStartLocked(true);
    }
  };

  if (!hydrated) return null;

  // Unknown slug or disabled DAO (reachable only by direct URL — the DAO
  // list hides the way in). Creating proposals for a disabled DAO must
  // ALSO be rejected by the future backend; this client gate is UX only.
  if (!dao || !dao.enabled) {
    return (
      <main className="max-w-5xl mx-auto px-5 min-h-[calc(100dvh-3.5rem)] flex items-center justify-center">
        <div className="text-center max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight mb-2">
            {dao ? t('dao.disabledTitle', { name: dao.name }) : t('dao.notFound')}
          </h1>
          <p className="text-sm text-[color:var(--oa-ink-secondary)] mb-6">
            {dao ? t('dao.disabledHintCreate') : t('dao.notFoundHint')}
          </p>
          <Link href={p('/proposals')} className="oa-btn-primary">
            {t('dao.backToDaos')}
          </Link>
        </div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="max-w-5xl mx-auto px-5 min-h-[calc(100dvh-3.5rem)] flex items-center justify-center">
        <div className="text-center max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight mb-2">{t('create.title')}</h1>
          <p className="text-sm text-[color:var(--oa-ink-secondary)] mb-6">
            {t('create.connectHint')}
          </p>
          <button type="button" className="oa-btn-primary" onClick={connect} disabled={connecting}>
            {connecting ? t('header.connecting') : t('header.connect')}
          </button>
        </div>
      </main>
    );
  }

  const addTransfer = () =>
    setTransfers((list) => [...list, { key: nextKey.current++, amount: '', address: '' }]);

  const updateTransfer = (key: number, patch: Partial<TransferDraft>) =>
    setTransfers((list) => list.map((t) => (t.key === key ? { ...t, ...patch } : t)));

  const removeTransfer = (key: number) =>
    setTransfers((list) => list.filter((t) => t.key !== key));

  const submit = async () => {
    setError(null);
    if (!canSubmit || !session) return;
    const body = bodySchema(locale).safeParse(bodyRef.current);
    if (!body.success) {
      setError(body.error.issues[0]?.message ?? t('err.bodyInvalid'));
      return;
    }
    // Pre-open the signing popup synchronously in the click gesture
    // (Safari-safe) — the signature request comes after async espo work.
    const popup = openSignPopup('signMessage');
    const closePopup = () => {
      if (popup && !popup.closed) popup.close();
    };
    setSubmitting(true);
    try {
      // Resolve the start block at click time from the Espo tip: "use
      // current block" means the tip right now, and a typed start must not
      // already have passed.
      const tip = await fetchEspoHeight(dao.espoNetwork);
      const finalStart = startLocked ? tip : Number(startBlock);
      if (!startLocked && finalStart < tip) {
        setError(
          t('create.blockPassedAt', {
            block: finalStart.toLocaleString(),
            tip: tip.toLocaleString(),
          }),
        );
        closePopup();
        setSubmitting(false);
        return;
      }
      const finalEnd = endMode === 'duration' ? finalStart + Number(endValue) : Number(endValue);
      if (finalEnd <= finalStart) {
        setError(t('err.endAfterStart'));
        closePopup();
        setSubmitting(false);
        return;
      }

      // Proposal threshold: the creator must hold the DAO's configured
      // share of the circulating voting token — the fork entry in force at
      // the resolved start block. Surtur nodes re-enforce this on POST;
      // the client check just fails fast with a friendly message.
      const proposalPct = resolveThreshold(dao.proposalThreshold, finalStart);
      if (proposalPct > 0) {
        const { supply, holders } = await fetchSupplyAndHolders(dao);
        const balancesByAddress = new Map(holders.map((h) => [h.address, h.amount]));
        let mine = balancesByAddress.get(session.account.address) ?? 0n;
        // Delegation owners propose with delegated power (members at the
        // start block — the same rule nodes enforce).
        const owned = (await getDaoStore().listDelegators(dao.id)).find(
          (b) => b.delegator.delegator === session.account.address,
        );
        if (owned) {
          const daoActions = await getDaoStore().listDelegationActions(dao.id);
          for (const member of delegationMembersAt(
            session.account.address,
            owned.delegator.id,
            daoActions,
            finalStart,
          )) {
            mine += balancesByAddress.get(member) ?? 0n;
          }
        }
        const sharePct = supply > 0n ? Number((mine * 10_000n) / supply) / 100 : 0;
        if (sharePct < proposalPct) {
          setError(
            t('create.thresholdError', {
              pct: proposalPct,
              symbol: dao.votingToken.symbol,
              held: sharePct,
            }),
          );
          closePopup();
          setSubmitting(false);
          return;
        }
      }

      // The proposal id IS the sha256 of the canonical content, and the
      // proposer signs that hash (BIP-322 via the SUBFROST popup) —
      // tampering with any field breaks both the id and the signature.
      const content: ProposalContent = {
        daoId: dao.id,
        title: title.trim(),
        titleZh: withZh && titleZh.trim() ? titleZh.trim() : undefined,
        // Milkdown serializes empty leading paragraphs as "<br />" — strip
        // before hashing so the published document starts clean.
        body: stripLeadingEmptyBlocks(body.data),
        bodyZh:
          withZh && zhBodyRef.current.trim()
            ? stripLeadingEmptyBlocks(zhBodyRef.current)
            : undefined,
        transfers: transfers.map((tf) => ({
          address: tf.address.trim(),
          amount: tf.amount.trim(),
        })),
        proposer: session.account.address,
        startBlock: finalStart,
        endBlock: finalEnd,
        createdAt: new Date().toISOString(),
      };
      const id = computeProposalId(content);
      const { signature, address } = await signWalletMessage(buildProposalSignMessage(id), {
        popup,
      });
      if (address !== content.proposer) {
        throw new Error('Signing account does not match the connected account.');
      }

      await getDaoStore().publishProposal({ proposal: { ...content, id }, signature });
      router.push(p(`/proposals/${dao.id}`));
    } catch (e) {
      if (
        e instanceof SubfrostConnectError &&
        (e.code === 'POPUP_CLOSED' || e.code === 'USER_REJECTED')
      ) {
        // silent — user changed their mind
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
      closePopup();
      setSubmitting(false);
    }
  };

  return (
    <main className="max-w-3xl mx-auto px-5 py-10 flex flex-col gap-6">
      <div>
        <Link href={p(`/proposals/${dao.id}`)} className="oa-btn-ghost !px-2 -ml-2 mb-3">
          <ArrowLeft size={15} />
          {dao.name}
        </Link>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('create.titlePlaceholder')}
          className="w-full bg-transparent text-2xl font-semibold tracking-tight placeholder:text-[color:var(--oa-ink-tertiary)] focus:outline-none"
        />
      </div>

      {/* No overflow-hidden here: Crepe's slash menu and block handle are
          absolutely positioned and would be clipped. */}
      <section className="rounded-2xl bg-[color:var(--oa-bg-raised)]">
        <MarkdownEditor
          className="oa-editor"
          placeholder={t('create.bodyPlaceholder')}
          onChange={(md) => {
            bodyRef.current = md;
          }}
        />
      </section>

      {/* Optional Chinese version — when provided, zh readers see it
          instead of the English title/body. */}
      {withZh ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium flex items-center gap-1.5">
              {t('create.zhSection')}
              <InfoTip text={t('create.zhTip')} />
            </h2>
            <button
              type="button"
              className="oa-hoverable text-xs font-medium text-[color:var(--oa-ink-tertiary)] hover:text-[color:var(--oa-danger)]"
              onClick={() => setWithZh(false)}
            >
              {t('create.removeZh')}
            </button>
          </div>
          <input
            type="text"
            value={titleZh}
            onChange={(e) => setTitleZh(e.target.value)}
            placeholder={t('create.zhTitlePlaceholder')}
            className="oa-input"
          />
          <section className="rounded-2xl bg-[color:var(--oa-bg-raised)]">
            <MarkdownEditor
              className="oa-editor"
              placeholder={t('create.zhBodyPlaceholder')}
              onChange={(md) => {
                zhBodyRef.current = md;
              }}
            />
          </section>
        </section>
      ) : (
        <button
          type="button"
          className="oa-hoverable flex items-center justify-center gap-1.5 rounded-2xl border border-dashed border-[color:var(--oa-border)] px-4 py-3 text-sm font-medium text-[color:var(--oa-ink-secondary)] hover:text-[color:var(--oa-ink)] hover:bg-[color:var(--oa-bg-subtle)]"
          onClick={() => setWithZh(true)}
        >
          <Plus size={15} />
          {t('create.addZh')}
        </button>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium flex items-center gap-1.5">
          {t('create.transfers')}
          <InfoTip text={t('create.transfersTip', { symbol: dao.treasuryToken.symbol })} />
        </h2>

        {transfers.map((tf) => {
          const transferUsd =
            tf.amount !== '' && !fieldErrors.transfers[tf.key]?.amount
              ? usdValue(Number(tf.amount))
              : undefined;
          return (
          <div key={tf.key} className="oa-tile p-3 flex items-center gap-2.5">
            <div className="w-44 shrink-0">
              <div className="relative">
                <input
                  type="text"
                  inputMode="decimal"
                  value={tf.amount}
                  onChange={(e) => updateTransfer(tf.key, { amount: e.target.value })}
                  placeholder="0.0"
                  className={`oa-input !pr-11 tabular-nums ${
                    tf.amount !== '' && fieldErrors.transfers[tf.key]?.amount
                      ? '!border-[color:var(--oa-danger)]'
                      : ''
                  }`}
                  aria-label={t('create.amountAria')}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  <TokenIcon id={dao.treasuryToken.alkaneId} symbol={dao.treasuryToken.symbol} size="sm" />
                </span>
              </div>
              {transferUsd !== undefined && (
                <div className="mt-1 text-xs text-[color:var(--oa-ink-tertiary)] tabular-nums">
                  ≈ {formatUsdCompact(transferUsd)}
                </div>
              )}
            </div>
            <input
              type="text"
              value={tf.address}
              onChange={(e) => updateTransfer(tf.key, { address: e.target.value })}
              placeholder={t('create.recipientPlaceholder')}
              className={`oa-input flex-1 ${
                tf.address !== '' && fieldErrors.transfers[tf.key]?.address
                  ? '!border-[color:var(--oa-danger)]'
                  : ''
              }`}
              aria-label={t('send.recipient')}
            />
            <button
              type="button"
              className="oa-hoverable p-2 rounded-lg text-[color:var(--oa-ink-tertiary)] hover:text-[color:var(--oa-danger)] hover:bg-[color:var(--oa-bg-raised)]"
              onClick={() => removeTransfer(tf.key)}
              aria-label={t('create.removeAria')}
            >
              <Trash2 size={15} />
            </button>
          </div>
          );
        })}

        <button
          type="button"
          className="oa-hoverable flex items-center justify-center gap-1.5 rounded-2xl border border-dashed border-[color:var(--oa-border)] px-4 py-3 text-sm font-medium text-[color:var(--oa-ink-secondary)] hover:text-[color:var(--oa-ink)] hover:bg-[color:var(--oa-bg-subtle)]"
          onClick={addTransfer}
        >
          <Plus size={15} />
          {t('create.addTransfer')}
        </button>

        {fieldErrors.total && (
          <div className="text-sm text-[color:var(--oa-danger)]">{fieldErrors.total}</div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium flex items-center gap-1.5">
          {t('create.votingWindow')}
          <InfoTip
            text={`${t('create.votingWindowTip')}${
              currentHeight !== null
                ? ` ${t('create.currentBlockIs', { height: currentHeight.toLocaleString() })}`
                : ''
            }`}
          />
        </h2>
        <div className="mt-3 flex flex-col sm:flex-row gap-2.5">
          <div className="flex-1">
            <div className="mb-1.5 flex items-center justify-between">
              <label className="oa-label !mb-0" htmlFor="start-block">
                {t('create.startBlock')}
              </label>
              <button
                type="button"
                className="oa-hoverable text-xs font-medium text-[color:var(--oa-ink-secondary)] hover:text-[color:var(--oa-ink)] disabled:opacity-40"
                onClick={toggleStartLock}
                disabled={currentHeight === null}
              >
                {startLocked ? t('create.editBlock') : t('create.useCurrentBlock')}
              </button>
            </div>
            <input
              id="start-block"
              type="text"
              inputMode="numeric"
              value={startLocked ? t('create.currentBlock') : startBlock}
              onChange={(e) => setStartBlock(e.target.value)}
              placeholder={currentHeight !== null ? String(currentHeight) : '—'}
              disabled={startLocked}
              className={`oa-input tabular-nums disabled:opacity-60 ${
                startInvalid ? '!border-[color:var(--oa-danger)]' : ''
              }`}
            />
            <p className="mt-1.5 text-xs">
              {startLocked ? (
                <span className="text-[color:var(--oa-ink-tertiary)]">&nbsp;</span>
              ) : startInvalid && currentHeight !== null ? (
                <span className="text-[color:var(--oa-danger)]">{fieldErrors.startBlock}</span>
              ) : currentHeight !== null && Number.isInteger(startNum) && startBlock !== '' ? (
                <span className="text-[color:var(--oa-ink-secondary)]">
                  ≈ {estimateBlockDate(startNum, currentHeight)}
                </span>
              ) : (
                <span className="text-[color:var(--oa-ink-tertiary)]">&nbsp;</span>
              )}
            </p>
          </div>
          <div className="flex-1">
            <div className="mb-1.5 flex items-center justify-between">
              <label className="oa-label !mb-0" htmlFor="end-block">
                {endMode === 'block' ? t('create.endBlock') : t('create.durationLabel')}
              </label>
              <div className="flex gap-2">
                {(['block', 'duration'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`oa-hoverable text-xs font-medium ${
                      endMode === mode
                        ? 'text-[color:var(--oa-ink)]'
                        : 'text-[color:var(--oa-ink-tertiary)] hover:text-[color:var(--oa-ink)]'
                    }`}
                    onClick={() => {
                      if (endMode === mode) return;
                      setEndMode(mode);
                      setEndValue(
                        mode === 'duration'
                          ? String(DEFAULT_WINDOW_BLOCKS)
                          : currentHeight !== null
                            ? String(currentHeight + DEFAULT_WINDOW_BLOCKS)
                            : '',
                      );
                    }}
                  >
                    {mode === 'block' ? t('create.endBlock') : t('create.durationToggle')}
                  </button>
                ))}
              </div>
            </div>
            <input
              id="end-block"
              type="text"
              inputMode="numeric"
              value={endValue}
              onChange={(e) => setEndValue(e.target.value)}
              placeholder={
                endMode === 'duration'
                  ? String(DEFAULT_WINDOW_BLOCKS)
                  : currentHeight !== null
                    ? String(currentHeight + DEFAULT_WINDOW_BLOCKS)
                    : '—'
              }
              className={`oa-input tabular-nums ${
                endInvalid ? '!border-[color:var(--oa-danger)]' : ''
              }`}
            />
            <p className="mt-1.5 text-xs">
              {endInvalid && currentHeight !== null ? (
                <span className="text-[color:var(--oa-danger)]">{fieldErrors.end}</span>
              ) : currentHeight !== null && Number.isInteger(endNum) && endValue !== '' ? (
                <span className="text-[color:var(--oa-ink-secondary)]">
                  ≈{' '}
                  {estimateBlockDate(
                    endMode === 'duration' ? (effectiveStart ?? currentHeight) + endNum : endNum,
                    currentHeight,
                  )}
                </span>
              ) : (
                <span className="text-[color:var(--oa-ink-tertiary)]">&nbsp;</span>
              )}
            </p>
          </div>
        </div>
      </section>

      {!eligibility.checking && !eligibility.eligible && (
        <div className="text-sm text-[color:var(--oa-danger)]">
          {t('create.thresholdError', {
            pct: eligibility.requiredPct,
            symbol: dao.votingToken.symbol,
            held: eligibility.heldPct ?? 0,
          })}
        </div>
      )}

      {error && <div className="text-sm text-[color:var(--oa-danger)]">{error}</div>}

      <div className="flex items-center justify-end gap-2 pb-6">
        <Link href={p(`/proposals/${dao.id}`)} className="oa-btn-secondary">
          {t('create.cancel')}
        </Link>
        <button type="button" className="oa-btn-primary" onClick={submit} disabled={!canSubmit}>
          {submitting && <Loader2 size={14} className="animate-spin" />}
          {t('create.submit')}
        </button>
      </div>
    </main>
  );
}
