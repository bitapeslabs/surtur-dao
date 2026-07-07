'use client';

/**
 * Portfolio page — all assets for the connected SUBFROST account. Token
 * names/symbols load the same way subfrost-app does it (KNOWN tokens +
 * direct canon-Espo get-alkane-details fetches); rows show
 * TokenIcon + name with `symbol · id` beneath (AlkanesBalancesCard display
 * contract). Clicking a row expands a Send action inline beneath it —
 * Send opens the tx-construction modal.
 */

import { useMemo, useState } from 'react';
import { ChevronDown, Loader2, RefreshCw, Send } from 'lucide-react';
import { useVendorWallet } from '@/context/VendorWalletContext';
import { useTokenMeta, type TokenInfo } from '@/hooks/useTokenMeta';
import { useBalances } from '@/hooks/useBalances';
import SendModal, { type ModalAsset } from '@/components/SendModal';
import TokenIcon from '@/components/TokenIcon';
import { formatSats, formatAlkaneAmount, formatUsd } from '@/lib/format';
import { useI18n } from '@/hooks/useI18n';
import { ALKANE_DECIMALS } from '@/lib/config';

export default function PortfolioPage() {
  const { t } = useI18n();
  const { hydrated, session, network, connect, connecting } = useVendorWallet();
  // Balances are fetched here (not in the wallet context) so the
  // spendable-outpoints call only fires on this page.
  const balances = useBalances(network, session?.account.address ?? null);
  const { btc, alkanes, loading, error, refresh } = balances;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sendAsset, setSendAsset] = useState<ModalAsset | null>(null);

  const alkaneIds = useMemo(() => alkanes.map((a) => a.alkaneId), [alkanes]);
  // Names + prices in ONE batched espo call.
  const { tokenInfo, usdValue } = useTokenMeta(network, alkaneIds);

  const usdLabel = (assetId: string, displayAmount: number): string | undefined => {
    const v = usdValue(assetId, displayAmount);
    return v !== undefined ? formatUsd(v) : undefined;
  };

  if (!hydrated) return null;

  if (!session) {
    return (
      <main className="max-w-5xl mx-auto px-5 min-h-[calc(100dvh-3.5rem)] flex items-center justify-center">
        <div className="text-center max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight mb-2">{t('portfolio.title')}</h1>
          <p className="text-sm text-[color:var(--oa-ink-secondary)] mb-6">
            {t('portfolio.connectHint')}
          </p>
          <button type="button" className="oa-btn-primary" onClick={connect} disabled={connecting}>
            {connecting ? t('header.connecting') : t('header.connect')}
          </button>
        </div>
      </main>
    );
  }

  const toggle = (id: string) => setExpandedId((cur) => (cur === id ? null : id));

  // Compact actions — same size as the subfrost app's expanded asset row
  // buttons (px-3 py-1.5 text-xs, left-aligned).
  const actionButtons = (asset: ModalAsset) => (
    <div className="flex gap-2 px-5 pb-4">
      <button
        type="button"
        className="oa-btn-small"
        onClick={(e) => {
          e.stopPropagation();
          setSendAsset(asset);
        }}
      >
        <Send size={14} />
        {t('portfolio.send')}
      </button>
    </div>
  );

  const assetRow = (args: {
    id: string;
    iconId: string;
    title: string;
    subtitle: string;
    balance: string;
    usd?: string;
    pending?: string;
  }) => (
    <button
      type="button"
      className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left cursor-pointer"
      onClick={() => toggle(args.id)}
      aria-expanded={expandedId === args.id}
    >
      <div className="flex items-center gap-3 min-w-0">
        <TokenIcon id={args.iconId} symbol={args.subtitle.split(' ')[0]} size="lg" />
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{args.title}</div>
          <div className="text-xs text-[color:var(--oa-ink-secondary)] truncate">
            {args.subtitle}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <div className="text-right">
          <div className="text-sm font-medium tabular-nums">{args.balance}</div>
          {args.usd && (
            <div className="text-xs text-[color:var(--oa-ink-secondary)] tabular-nums">{args.usd}</div>
          )}
          {args.pending && (
            <div className="text-xs text-[color:var(--oa-ink-secondary)] tabular-nums">
              {t('portfolio.pending', { amount: args.pending })}
            </div>
          )}
        </div>
        <ChevronDown
          size={15}
          className={`text-[color:var(--oa-ink-tertiary)] transition-transform ${expandedId === args.id ? 'rotate-180' : ''}`}
        />
      </div>
    </button>
  );

  return (
    <main className="max-w-3xl mx-auto px-5 py-10 flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t('portfolio.title')}</h1>
        <button
          type="button"
          className="oa-btn-ghost"
          onClick={refresh}
          disabled={loading}
          aria-label={t('portfolio.refresh')}
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          {t('portfolio.refresh')}
        </button>
      </div>

      {/* Assets — raised card background, no border; the wrapper div is the
          hover surface so the expanded Send area shares the row's hover
          background. */}
      <section className="rounded-2xl overflow-hidden bg-[color:var(--oa-bg-raised)]">
        <div className="px-5 py-3 border-b border-[color:var(--oa-border)] text-xs font-medium text-[color:var(--oa-ink-secondary)] flex justify-between">
          <span>{t('portfolio.asset')}</span>
          <span>{t('portfolio.balance')}</span>
        </div>

        <div className="divide-y divide-[color:var(--oa-border)]">
          <div className="oa-row">
            {assetRow({
              id: 'btc',
              iconId: 'btc',
              title: 'Bitcoin',
              subtitle: 'BTC',
              balance: btc ? formatSats(btc.totalSats) : '—',
              usd: btc ? usdLabel('btc', btc.totalSats / 1e8) : undefined,
              pending: btc && btc.mempoolSats !== 0 ? formatSats(btc.mempoolSats) : undefined,
            })}
            {expandedId === 'btc' &&
              actionButtons({ kind: 'btc', balanceSats: btc?.totalSats ?? 0 })}
          </div>

          {alkanes.map((a) => {
            const info: TokenInfo = tokenInfo[a.alkaneId] ?? { name: a.alkaneId, symbol: a.alkaneId };
            return (
              <div key={a.alkaneId} className="oa-row">
                {assetRow({
                  id: a.alkaneId,
                  iconId: a.alkaneId,
                  title: info.name,
                  subtitle: `${info.symbol} · ${a.alkaneId}`,
                  balance: formatAlkaneAmount(a.balance),
                  usd: usdLabel(a.alkaneId, Number(a.balance) / 10 ** ALKANE_DECIMALS),
                })}
                {expandedId === a.alkaneId &&
                  actionButtons({ kind: 'alkane', alkaneId: a.alkaneId, balance: a.balance, info })}
              </div>
            );
          })}

          {alkanes.length === 0 && (
            <div className="px-5 py-4 text-sm text-[color:var(--oa-ink-tertiary)]">
              {loading ? t('portfolio.loading') : t('portfolio.noTokens')}
            </div>
          )}
        </div>
      </section>

      {error && <div className="text-sm text-[color:var(--oa-danger)] break-words">{error}</div>}

      {sendAsset && (
        <SendModal asset={sendAsset} balances={balances} onClose={() => setSendAsset(null)} />
      )}
    </main>
  );
}
