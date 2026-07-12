'use client';

/**
 * Create a delegation — same look and flow as the new-proposal page:
 * bare borderless title input, full-width Milkdown editor, dashed
 * add-Chinese-version section, cancel/submit row. Submitting fetches
 * the fresh tip (nodes enforce createdAtBlock within tip±5), hashes the
 * canonical content into the delegator id, signs
 * "Create delegator with delegator id: <id>", and fans the bundle out
 * to every whitelisted node. Requires the DAO's delegatorThreshold at
 * the creation block — gated here, enforced by nodes.
 */

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Plus } from 'lucide-react';
import { SubfrostConnectError } from 'subfrost-connect';
import {
  buildDelegatorSignMessage,
  computeDelegatorId,
  type DelegatorContent,
} from '@surtur/shared';
import { getDao } from '@/daos';
import { getDaoStore } from '@/lib/dao/store';
import { fetchEspoHeight } from '@/lib/dao/governance';
import { stripLeadingEmptyBlocks } from '@/lib/dao/format';
import { useVendorWallet } from '@/context/VendorWalletContext';
import { useProposerEligibility } from '@/hooks/useProposerEligibility';
import { useI18n } from '@/hooks/useI18n';
import MarkdownEditor from '@/components/MarkdownEditor';
import DelegationIconPicker from '@/components/DelegationIconPicker';
import InfoTip from '@/components/InfoTip';

export default function NewDelegationPage() {
  const params = useParams<{ dao: string }>();
  const dao = getDao(params?.dao);
  const router = useRouter();
  const { t, p } = useI18n();
  const { hydrated, session, connect, connecting, signMessage, openSignPopup } =
    useVendorWallet();
  const eligibility = useProposerEligibility(dao, dao?.delegatorThreshold);

  const [name, setName] = useState('');
  const [nameZh, setNameZh] = useState('');
  const [icon, setIcon] = useState<string | null>(null);
  const [withZh, setWithZh] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const descriptionRef = useRef('');
  const descriptionZhRef = useRef('');

  if (!dao) return null;

  const canSubmit =
    !submitting && name.trim().length > 0 && eligibility.eligible && !eligibility.checking;

  const submit = async () => {
    if (!canSubmit || !session) return;
    const description = stripLeadingEmptyBlocks(descriptionRef.current).trim();
    if (!description) {
      setError(t('dlg.descriptionRequired'));
      return;
    }
    setError(null);
    // Pre-open the passport popup in the click gesture (Safari-safe).
    const popup = openSignPopup('signMessage');
    setSubmitting(true);
    try {
      const tip = await fetchEspoHeight(dao.espoNetwork);
      const content: DelegatorContent = {
        daoId: dao.id,
        name: name.trim(),
        nameZh: withZh && nameZh.trim() ? nameZh.trim() : undefined,
        description,
        icon: icon ?? undefined,
        descriptionZh:
          withZh && descriptionZhRef.current.trim()
            ? stripLeadingEmptyBlocks(descriptionZhRef.current).trim()
            : undefined,
        delegator: session.account.address,
        createdAtBlock: tip,
        createdAt: new Date().toISOString(),
      };
      const id = computeDelegatorId(content);
      const { signature, address } = await signMessage(buildDelegatorSignMessage(id), {
        popup,
      });
      if (address !== content.delegator) {
        throw new Error('Signing account does not match the connected account.');
      }
      await getDaoStore().publishDelegator({ delegator: { ...content, id }, signature });
      router.push(p(`/proposals/${dao.id}?view=delegations`));
    } catch (e) {
      if (
        e instanceof SubfrostConnectError &&
        (e.code === 'POPUP_CLOSED' || e.code === 'USER_REJECTED')
      ) {
        // silent — user changed their mind
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
      if (popup && !popup.closed) popup.close();
    } finally {
      setSubmitting(false);
    }
  };

  if (hydrated && !session) {
    return (
      <main className="max-w-3xl mx-auto px-5 py-10 flex flex-col gap-6">
        <div>
          <Link
            href={p(`/proposals/${dao.id}?view=delegations`)}
            className="oa-btn-ghost !px-2 -ml-2"
          >
            <ArrowLeft size={15} />
            {dao.name}
          </Link>
        </div>
        <section className="rounded-2xl bg-[color:var(--oa-bg-raised)] px-6 py-16 flex flex-col items-center text-center gap-4">
          <div className="text-sm text-[color:var(--oa-ink-secondary)]">
            {t('dlg.connectToDelegate')}
          </div>
          <button type="button" className="oa-btn-primary" onClick={connect} disabled={connecting}>
            {connecting ? t('header.connecting') : t('header.connect')}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="max-w-3xl mx-auto px-5 py-10 flex flex-col gap-6">
      <div>
        <Link
          href={p(`/proposals/${dao.id}?view=delegations`)}
          className="oa-btn-ghost !px-2 -ml-2 mb-3"
        >
          <ArrowLeft size={15} />
          {dao.name}
        </Link>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('dlg.name')}
          maxLength={120}
          className="w-full bg-transparent text-2xl font-semibold tracking-tight placeholder:text-[color:var(--oa-ink-tertiary)] focus:outline-none"
        />
      </div>

      <DelegationIconPicker value={icon} onChange={setIcon} />

      {/* No overflow-hidden here: Crepe's slash menu and block handle are
          absolutely positioned and would be clipped. */}
      <section className="rounded-2xl bg-[color:var(--oa-bg-raised)]">
        <MarkdownEditor
          className="oa-editor"
          placeholder={t('dlg.descriptionPlaceholder')}
          onChange={(md) => {
            descriptionRef.current = md;
          }}
        />
      </section>

      {/* Optional Chinese version — when provided, zh readers see it
          instead of the English name/description. */}
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
            value={nameZh}
            onChange={(e) => setNameZh(e.target.value)}
            placeholder={t('dlg.nameZh')}
            maxLength={120}
            className="oa-input"
          />
          <section className="rounded-2xl bg-[color:var(--oa-bg-raised)]">
            <MarkdownEditor
              className="oa-editor"
              placeholder={t('dlg.descriptionPlaceholder')}
              onChange={(md) => {
                descriptionZhRef.current = md;
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

      {!eligibility.checking && !eligibility.eligible && (
        <div className="text-sm text-[color:var(--oa-danger)]">
          {t('dlg.thresholdNote', { pct: String(eligibility.requiredPct) })}
        </div>
      )}

      {error && <div className="text-sm text-[color:var(--oa-danger)]">{error}</div>}

      <div className="flex items-center justify-end gap-2 pb-6">
        <Link href={p(`/proposals/${dao.id}?view=delegations`)} className="oa-btn-secondary">
          {t('create.cancel')}
        </Link>
        <button type="button" className="oa-btn-primary" onClick={submit} disabled={!canSubmit}>
          {submitting && <Loader2 size={14} className="animate-spin" />}
          {t('dlg.create')}
        </button>
      </div>
    </main>
  );
}
