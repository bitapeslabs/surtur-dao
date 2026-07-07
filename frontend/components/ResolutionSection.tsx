'use client';

/**
 * ResolutionSection — sits ABOVE the Votes card on a proposal page.
 *
 * - Proposal has a resolution → render it (markdown, read-only) with the
 *   resolver's address and date. The frontend deliberately does NOT check
 *   the signer against the CURRENT resolverSigner — surtur nodes enforced
 *   that at write time, and resolvers may change without erasing history.
 * - Proposal PASSED but unresolved → "Waiting to be resolved" card; the
 *   DAO's resolverSigner additionally gets a Resolve Proposal button that
 *   opens a markdown editor. Submitting signs
 *   "Resolve proposal id: <id> with resolution <sha256(resolution)>"
 *   via the SUBFROST popup and broadcasts to every whitelisted node.
 */

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { SubfrostConnectError } from 'subfrost-connect';
import {
  buildResolutionSignMessage,
  computeResolutionId,
  type ResolutionWire,
} from '@surtur/shared';
import type { DaoDefinition } from '@/daos';
import type { Proposal } from '@/lib/dao/types';
import { getDaoStore } from '@/lib/dao/store';
import { useVendorWallet } from '@/context/VendorWalletContext';
import { useI18n } from '@/hooks/useI18n';
import { shortAddress, formatDate } from '@/lib/dao/format';
import { explorerAddressUrl } from '@/lib/config';
import MarkdownEditor from '@/components/MarkdownEditor';
import Skeleton from '@/components/Skeleton';

export default function ResolutionSection({
  dao,
  proposal,
}: {
  dao: DaoDefinition;
  proposal: Proposal;
}) {
  const { t } = useI18n();
  const { session, connector } = useVendorWallet();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef('');

  const resolutionQuery = useQuery({
    queryKey: ['nodes', 'resolution', proposal.id],
    queryFn: () => getDaoStore().getResolution(proposal.id),
    staleTime: 60_000,
  });
  const resolution: ResolutionWire | null | undefined = resolutionQuery.data;

  const isResolver =
    !!session && !!dao.resolverSigner && session.account.address === dao.resolverSigner;

  const submit = async () => {
    if (!session || !connector) return;
    const markdown = draftRef.current.trim();
    if (!markdown) {
      setError(t('resolution.empty'));
      return;
    }
    setError(null);
    // Pre-open the signing popup in the click gesture (Safari-safe).
    const popup = connector.openPopup('signMessage');
    setSubmitting(true);
    try {
      const resolutionId = computeResolutionId(markdown);
      const { signature, address } = await connector.signMessage(
        { message: buildResolutionSignMessage(proposal.id, resolutionId) },
        { popup: popup ?? undefined },
      );
      await getDaoStore().publishResolution({
        proposalId: proposal.id,
        daoId: dao.id,
        resolutionId,
        resolution: markdown,
        address,
        signature,
        resolvedAt: new Date().toISOString(),
      });
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: ['nodes', 'resolution', proposal.id] });
    } catch (e) {
      if (
        e instanceof SubfrostConnectError &&
        (e.code === 'POPUP_CLOSED' || e.code === 'USER_REJECTED')
      ) {
        // silent — resolver changed their mind
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
      if (popup && !popup.closed) popup.close();
    } finally {
      setSubmitting(false);
    }
  };

  // Nothing to show while the proposal isn't passed and has no resolution.
  if (resolutionQuery.isPending) {
    if (proposal.status !== 'passed') return null;
    return (
      <section className="rounded-2xl overflow-hidden bg-[color:var(--oa-bg-raised)] px-5 py-4">
        <Skeleton className="h-4 w-48" />
      </section>
    );
  }

  // ---- resolved: show the resolution ----
  if (resolution) {
    return (
      <section className="rounded-2xl overflow-hidden bg-[color:var(--oa-bg-raised)]">
        <div className="px-5 py-3 border-b border-[color:var(--oa-border)] flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">{t('resolution.title')}</h2>
          <span className="text-xs text-[color:var(--oa-ink-secondary)]">
            {t('resolution.resolvedBy')}{' '}
            <a
              href={explorerAddressUrl(resolution.address)}
              target="_blank"
              rel="noopener noreferrer"
              className="oa-hoverable text-[color:var(--oa-ink)] hover:underline"
            >
              {shortAddress(resolution.address)}
            </a>{' '}
            · {formatDate(resolution.resolvedAt)}
          </span>
        </div>
        <div className="p-6">
          <MarkdownEditor
            key={resolution.resolutionId}
            className="oa-markdown-view"
            defaultValue={resolution.resolution}
            readonly
          />
        </div>
      </section>
    );
  }

  if (proposal.status !== 'passed') return null;

  // ---- passed, unresolved: waiting card (+ editor for the resolver) ----
  return (
    <section className="rounded-2xl overflow-hidden bg-[color:var(--oa-bg-raised)]">
      <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium flex items-center gap-2">
            <Loader2 size={14} className="shrink-0 animate-spin text-[color:var(--oa-ink-secondary)]" />
            {t('resolution.waiting')}
          </h2>
          <p className="mt-0.5 text-xs text-[color:var(--oa-ink-secondary)]">
            {t('resolution.waitingHint')}
          </p>
        </div>
        {isResolver && !editing && (
          <button
            type="button"
            className="oa-btn-primary !px-4 !py-2 shrink-0"
            onClick={() => setEditing(true)}
          >
            {t('resolution.resolveButton')}
          </button>
        )}
      </div>

      {isResolver && editing && (
        <div className="border-t border-[color:var(--oa-border)]">
          <MarkdownEditor
            className="oa-editor"
            placeholder={t('resolution.placeholder')}
            onChange={(md) => {
              draftRef.current = md;
            }}
          />
          {error && (
            <div className="px-5 pb-3 text-sm text-[color:var(--oa-danger)]">{error}</div>
          )}
          <div className="px-5 pb-4 flex items-center justify-end gap-2">
            <button
              type="button"
              className="oa-btn-secondary"
              onClick={() => setEditing(false)}
              disabled={submitting}
            >
              {t('resolution.cancel')}
            </button>
            <button
              type="button"
              className="oa-btn-primary"
              onClick={submit}
              disabled={submitting}
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {t('resolution.resolveButton')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
