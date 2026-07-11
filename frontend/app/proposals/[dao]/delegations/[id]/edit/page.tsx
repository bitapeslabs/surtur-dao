'use client';

/**
 * Edit a delegation's metadata (owner only) — name, description,
 * Chinese versions, icon. Publishing signs a nonce-versioned update
 * ("Update delegator <id> with update id: <sha256>"); every node and
 * client keeps the version with the highest (height, seq) nonce, so
 * edits converge network-wide without touching the immutable creation
 * bundle or the delegator's id.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Plus } from 'lucide-react';
import { SubfrostConnectError } from 'subfrost-connect';
import {
  buildDelegatorUpdateSignMessage,
  computeDelegatorUpdateId,
  effectiveDelegatorMeta,
} from '@surtur/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getDao } from '@/daos';
import { getDaoStore } from '@/lib/dao/store';
import { fetchEspoHeight } from '@/lib/dao/governance';
import { stripLeadingEmptyBlocks } from '@/lib/dao/format';
import { useVendorWallet } from '@/context/VendorWalletContext';
import { useI18n } from '@/hooks/useI18n';
import MarkdownEditor from '@/components/MarkdownEditor';
import DelegationIconPicker from '@/components/DelegationIconPicker';
import InfoTip from '@/components/InfoTip';
import Skeleton from '@/components/Skeleton';

export default function EditDelegationPage() {
  const params = useParams<{ dao: string; id: string }>();
  const dao = getDao(params?.dao);
  const router = useRouter();
  const { t, p } = useI18n();
  const queryClient = useQueryClient();
  const { session, signMessage, openSignPopup } = useVendorWallet();

  const bundleQuery = useQuery({
    queryKey: ['nodes', 'delegator', params?.id],
    queryFn: () => getDaoStore().getDelegator(params!.id),
    enabled: !!params?.id,
    staleTime: Infinity,
  });
  const bundle = bundleQuery.data ?? null;

  const [name, setName] = useState('');
  const [nameZh, setNameZh] = useState('');
  const [icon, setIcon] = useState<string | null>(null);
  const [withZh, setWithZh] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const descriptionRef = useRef('');
  const descriptionZhRef = useRef('');

  // Seed the form once from the current effective metadata.
  useEffect(() => {
    if (!bundle || seeded) return;
    const meta = effectiveDelegatorMeta(bundle);
    setName(meta.name);
    setNameZh(meta.nameZh ?? '');
    setIcon(meta.icon ?? null);
    setWithZh(!!(meta.nameZh || meta.descriptionZh));
    descriptionRef.current = meta.description;
    descriptionZhRef.current = meta.descriptionZh ?? '';
    setSeeded(true);
  }, [bundle, seeded]);

  if (!dao) return null;

  const isOwner = !!bundle && !!session && session.account.address === bundle.delegator.delegator;
  const canSubmit = !submitting && seeded && name.trim().length > 0 && isOwner;

  const submit = async () => {
    if (!canSubmit || !session || !bundle) return;
    const description = stripLeadingEmptyBlocks(descriptionRef.current).trim();
    if (!description) {
      setError(t('dlg.descriptionRequired'));
      return;
    }
    setError(null);
    const popup = openSignPopup('signMessage');
    setSubmitting(true);
    try {
      const tip = await fetchEspoHeight(dao.espoNetwork);
      // Nonce beats the currently-served update (and any same-height one).
      const current = bundle.update;
      const seq = current && current.height === tip ? current.seq + 1 : 0;
      const content = {
        daoId: dao.id,
        delegatorId: bundle.delegator.id,
        name: name.trim(),
        nameZh: withZh && nameZh.trim() ? nameZh.trim() : undefined,
        description,
        descriptionZh:
          withZh && descriptionZhRef.current.trim()
            ? stripLeadingEmptyBlocks(descriptionZhRef.current).trim()
            : undefined,
        icon: icon ?? undefined,
        height: tip,
        seq,
      };
      const updateId = computeDelegatorUpdateId(content);
      const { signature, address } = await signMessage(
        buildDelegatorUpdateSignMessage(bundle.delegator.id, updateId),
        { popup },
      );
      if (address !== bundle.delegator.delegator) {
        throw new Error('Signing account is not the delegation owner.');
      }
      await getDaoStore().publishDelegatorUpdate({
        ...content,
        signature,
        updatedAt: new Date().toISOString(),
      });
      await queryClient.invalidateQueries({ queryKey: ['nodes', 'delegator', bundle.delegator.id] });
      await queryClient.invalidateQueries({ queryKey: ['nodes', 'delegators', dao.id] });
      router.push(p(`/proposals/${dao.id}/delegations/${bundle.delegator.id}`));
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

  if (bundleQuery.isPending || !seeded) {
    return (
      <main className="max-w-3xl mx-auto px-5 py-10 flex flex-col gap-6">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </main>
    );
  }

  if (!bundle || (session && !isOwner)) {
    return (
      <main className="max-w-3xl mx-auto px-5 py-10">
        <div className="text-sm text-[color:var(--oa-ink-tertiary)]">Not found.</div>
      </main>
    );
  }

  return (
    <main className="max-w-3xl mx-auto px-5 py-10 flex flex-col gap-6">
      <div>
        <Link
          href={p(`/proposals/${dao.id}/delegations/${bundle.delegator.id}`)}
          className="oa-btn-ghost !px-2 -ml-2 mb-3"
        >
          <ArrowLeft size={15} />
          {t('dlg.backToDao')}
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

      <section className="rounded-2xl bg-[color:var(--oa-bg-raised)]">
        <MarkdownEditor
          className="oa-editor"
          defaultValue={descriptionRef.current}
          placeholder={t('dlg.descriptionPlaceholder')}
          onChange={(md) => {
            descriptionRef.current = md;
          }}
        />
      </section>

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
              defaultValue={descriptionZhRef.current}
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

      {error && <div className="text-sm text-[color:var(--oa-danger)]">{error}</div>}

      <div className="flex items-center justify-end gap-2 pb-6">
        <Link
          href={p(`/proposals/${dao.id}/delegations/${bundle.delegator.id}`)}
          className="oa-btn-secondary"
        >
          {t('create.cancel')}
        </Link>
        <button type="button" className="oa-btn-primary" onClick={submit} disabled={!canSubmit}>
          {submitting && <Loader2 size={14} className="animate-spin" />}
          {submitting ? t('dlg.saving') : t('dlg.saveChanges')}
        </button>
      </div>
    </main>
  );
}
