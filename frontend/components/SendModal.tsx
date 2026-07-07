'use client';

/**
 * SendModal — transaction-construction modal opened from the Portfolio's
 * inline asset actions. Send form (recipient / amount / fee rate) running
 * the build → SUBFROST-popup-sign → broadcast lifecycle.
 */

import { useMemo, useState } from 'react';
import { ChevronDown, Send, X, XCircle } from 'lucide-react';
import { SubfrostConnectError, type SignRequestOverview } from 'subfrost-connect';
import { useVendorWallet } from '@/context/VendorWalletContext';
import type { BalancesState } from '@/hooks/useBalances';
import { buildBtcTransferPsbt, buildAlkaneTransferPsbt, finalizeAndBroadcast } from '@/lib/psbt';
import { ALKANE_DECIMALS } from '@/lib/config';
import { toBaseUnits, formatAlkaneAmount, formatSats } from '@/lib/format';
import TokenIcon from '@/components/TokenIcon';
import TxStatusView, { type TxFlowStatus } from '@/components/TxStatusView';
import { useI18n } from '@/hooks/useI18n';
import type { TokenInfo } from '@/hooks/useTokenMeta';

export type ModalAsset =
  | { kind: 'btc'; balanceSats: number }
  | { kind: 'alkane'; alkaneId: string; balance: bigint; info: TokenInfo };

type SendStatus =
  | { phase: 'idle' }
  | { phase: 'building' }
  | { phase: 'signing' }
  | { phase: 'broadcasting' }
  | { phase: 'success'; txid: string }
  | { phase: 'cancelled' }
  | { phase: 'error'; message: string };

export default function SendModal({
  asset,
  balances,
  onClose,
}: {
  asset: ModalAsset;
  balances: BalancesState;
  onClose: () => void;
}) {
  const { session, network, connector } = useVendorWallet();
  const { t } = useI18n();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [feeRate, setFeeRate] = useState('5');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [status, setStatus] = useState<SendStatus>({ phase: 'idle' });

  const symbol = asset.kind === 'btc' ? 'BTC' : asset.info.symbol;
  const iconId = asset.kind === 'btc' ? 'btc' : asset.alkaneId;

  const busy =
    status.phase === 'building' || status.phase === 'signing' || status.phase === 'broadcasting';
  const canSubmit =
    !busy && !!session && !!connector && recipient.trim().length > 0 && Number(amount) > 0 && Number(feeRate) > 0;

  const maxAmount = useMemo(
    () => (asset.kind === 'btc' ? formatSats(asset.balanceSats) : formatAlkaneAmount(asset.balance)),
    [asset],
  );

  const handleSend = async () => {
    if (!canSubmit || !session || !connector) return;
    const fee = Math.max(1, Math.round(Number(feeRate)));
    const recipientAddress = recipient.trim();
    // Pre-open the popup synchronously in the click gesture (Safari-safe).
    const popup = connector.openPopup('sign');
    try {
      setStatus({ phase: 'building' });
      let unsignedPsbt: string;
      let label: string;
      let overview: SignRequestOverview;
      if (asset.kind === 'btc') {
        const amountSats = Math.round(Number(amount) * 1e8);
        if (!Number.isFinite(amountSats) || amountSats <= 0) throw new Error('Invalid amount');
        unsignedPsbt = await buildBtcTransferPsbt({
          network,
          fromAddress: session.account.address,
          recipientAddress,
          amountSats,
          feeRate: fee,
          espoCache: balances.espoCache,
        });
        label = `Send ${amount} BTC`;
        overview = { kind: 'btc-send', recipientAddress, amountSats, feeRate: fee };
      } else {
        const amountBaseUnits = toBaseUnits(amount, ALKANE_DECIMALS);
        if (amountBaseUnits === '0') throw new Error('Invalid amount');
        if (BigInt(amountBaseUnits) > asset.balance) {
          throw new Error(`Insufficient balance: have ${formatAlkaneAmount(asset.balance)} ${symbol}`);
        }
        unsignedPsbt = await buildAlkaneTransferPsbt({
          network,
          fromAddress: session.account.address,
          recipientAddress,
          alkaneId: asset.alkaneId,
          amountBaseUnits,
          feeRate: fee,
          espoCache: balances.espoCache,
        });
        label = `Send ${amount} ${symbol}`;
        overview = {
          kind: 'alkane-send',
          recipientAddress,
          alkane: {
            alkaneId: asset.alkaneId,
            amountBaseUnits,
            symbol,
            decimals: ALKANE_DECIMALS,
          },
          feeRate: fee,
        };
      }

      setStatus({ phase: 'signing' });
      const { signedPsbtBase64 } = await connector.signPsbt(
        { psbtBase64: unsignedPsbt, label, overview },
        { popup },
      );

      setStatus({ phase: 'broadcasting' });
      const txid = await finalizeAndBroadcast(network, signedPsbtBase64);
      setStatus({ phase: 'success', txid });
      setRecipient('');
      setAmount('');
      balances.refresh();
    } catch (e) {
      try {
        if (popup && !popup.closed) popup.close();
      } catch {
        /* ignore */
      }
      if (e instanceof SubfrostConnectError && (e.code === 'POPUP_CLOSED' || e.code === 'USER_REJECTED')) {
        setStatus({ phase: 'cancelled' });
        return;
      }
      setStatus({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  // Confirmation-flow screens replace the form while a tx is in flight.
  const inFlow =
    status.phase === 'building' ||
    status.phase === 'signing' ||
    status.phase === 'broadcasting' ||
    status.phase === 'success' ||
    status.phase === 'error';

  return (
    <div className="oa-overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="rounded-2xl bg-[color:var(--oa-bg)] border border-[color:var(--oa-border-faint)] w-full max-w-sm p-5 flex flex-col gap-3 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <TokenIcon id={iconId} symbol={symbol} size="lg" />
            <div className="text-base font-semibold tracking-tight">
              {t('send.title', { symbol })}
            </div>
          </div>
          <button
            type="button"
            className="oa-btn-ghost !px-1.5"
            onClick={onClose}
            disabled={busy}
            aria-label={t('send.closeAria')}
          >
            <X size={16} />
          </button>
        </div>

        {inFlow ? (
          <TxStatusView
            status={status as TxFlowStatus}
            onDone={() => {
              if (status.phase === 'success') onClose();
              else setStatus({ phase: 'idle' });
            }}
          />
        ) : (
          <>
        {/* Recipient — swap-input style: tile with inline label + transparent input */}
        <div className="oa-tile p-4 flex flex-col gap-2">
          <label
            className="text-xs font-medium text-[color:var(--oa-ink-secondary)]"
            htmlFor="asset-send-recipient"
          >
            {t('send.recipient')}
          </label>
          <input
            id="asset-send-recipient"
            className="w-full bg-transparent text-sm font-medium focus:outline-none placeholder:text-[color:var(--oa-ink-tertiary)]"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="bc1p… / bcrt1p…"
            disabled={busy}
          />
        </div>

        {/* Amount — swap-input style */}
        <div className="oa-tile p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label
              className="text-xs font-medium text-[color:var(--oa-ink-secondary)]"
              htmlFor="asset-send-amount"
            >
              {t('send.amount')}
            </label>
            <button
              type="button"
              className="oa-hoverable text-xs text-[color:var(--oa-ink-secondary)] hover:text-[color:var(--oa-ink)]"
              onClick={() => setAmount(maxAmount)}
              disabled={busy}
            >
              {t('send.balance', { amount: maxAmount })}
            </button>
          </div>
          <div className="flex gap-2 items-baseline">
            <input
              id="asset-send-amount"
              className="flex-1 bg-transparent text-2xl font-medium focus:outline-none placeholder:text-[color:var(--oa-ink-tertiary)] min-w-0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              inputMode="decimal"
              disabled={busy}
            />
            <span className="text-sm font-medium text-[color:var(--oa-ink-secondary)] shrink-0">
              {symbol}
            </span>
          </div>
        </div>

        {/* Advanced options (collapsed by default) */}
        <div className="oa-tile">
          <button
            type="button"
            className="oa-hoverable w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-[color:var(--oa-ink-secondary)] hover:text-[color:var(--oa-ink)]"
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
          >
            <span>
              {t('send.advanced')}
              <span className="ml-2 text-xs text-[color:var(--oa-ink-tertiary)]">
                {feeRate} sat/vB
              </span>
            </span>
            <ChevronDown
              size={15}
              className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
            />
          </button>
          {showAdvanced && (
            <div className="px-4 pb-4">
              <label className="oa-label" htmlFor="asset-send-feerate">{t('send.feeRate')}</label>
              <input
                id="asset-send-feerate"
                className="oa-input"
                value={feeRate}
                onChange={(e) => setFeeRate(e.target.value)}
                inputMode="numeric"
                disabled={busy}
              />
            </div>
          )}
        </div>

        <button type="button" className="oa-btn-primary w-full !py-3" onClick={handleSend} disabled={!canSubmit}>
          <Send size={15} />
          {t('send.send')}
        </button>

        {status.phase === 'cancelled' && (
          <div className="flex items-center gap-2 text-sm text-[color:var(--oa-ink-secondary)]">
            <XCircle size={15} className="shrink-0" />
            {t('send.cancelled')}
          </div>
        )}
          </>
        )}
      </div>
    </div>
  );
}
