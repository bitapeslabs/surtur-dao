'use client';

/**
 * ConnectWalletModal — the wallet picker. Three ways in, and deliberately
 * NO keystore option (seed phrases never touch this app):
 *
 *  - SUBFROST (passport): the subfrost-connect popup used since day one.
 *  - Browser extensions: SUBFROST ext / OYL / OKX / UniSat / Xverse.
 *    Installed ones connect on click; missing ones link to their site.
 *  - SUBFROST Mobile: frtun p2p pairing — renders a QR + 6-char pairing
 *    code; resolves when the phone's scanner dials in. Mobile sessions
 *    can vote/propose/resolve but portfolio send stays disabled.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Loader2, X } from 'lucide-react';
import QRCode from 'qrcode';
import { useVendorWallet } from '@/context/VendorWalletContext';
import { EXTENSION_WALLETS, type ExtensionWalletId } from '@/lib/wallet/extensions';
import { WALLET_ICONS } from '@/lib/wallet/icons';
import { SubfrostFrtunAdapter } from '@/lib/wallet/mobile';
import { PhDeviceMobile } from '@/components/PhosphorIcons';
import { useI18n } from '@/hooks/useI18n';

type View = 'select' | 'mobile';

export default function ConnectWalletModal() {
  const { t } = useI18n();
  const {
    connectModalOpen,
    setConnectModalOpen,
    installedExtensions,
    connecting,
    connectError,
    connectPassport,
    connectExtensionWallet,
    adoptMobileSession,
  } = useVendorWallet();

  const [view, setView] = useState<View>('select');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const pairingAdapterRef = useRef<SubfrostFrtunAdapter | null>(null);

  const cancelPairing = useCallback(() => {
    const adapter = pairingAdapterRef.current;
    pairingAdapterRef.current = null;
    if (adapter) void adapter.disconnect().catch(() => {});
    setQrDataUrl(null);
    setPairingCode(null);
    setPairingError(null);
  }, []);

  const close = useCallback(() => {
    cancelPairing();
    setView('select');
    setBusyId(null);
    setConnectModalOpen(false);
  }, [cancelPairing, setConnectModalOpen]);

  // Reset transient state whenever the modal opens fresh.
  useEffect(() => {
    if (connectModalOpen) {
      setView('select');
      setBusyId(null);
      setPairingError(null);
    } else {
      cancelPairing();
    }
  }, [connectModalOpen, cancelPairing]);

  const handlePassport = async () => {
    setBusyId('passport');
    try {
      await connectPassport();
    } finally {
      setBusyId(null);
    }
  };

  const handleExtension = async (id: ExtensionWalletId) => {
    setBusyId(id);
    try {
      await connectExtensionWallet(id);
    } catch {
      /* error already surfaced via connectError */
    } finally {
      setBusyId(null);
    }
  };

  const startMobilePairing = async () => {
    setView('mobile');
    setPairingError(null);
    const adapter = new SubfrostFrtunAdapter();
    pairingAdapterRef.current = adapter;
    try {
      const { addresses } = await adapter.connect(
        (uri) => {
          void QRCode.toDataURL(uri, { margin: 1, width: 260 }).then(setQrDataUrl);
        },
        (code) => setPairingCode(code),
      );
      // Only adopt if this pairing wasn't cancelled meanwhile.
      if (pairingAdapterRef.current === adapter) {
        pairingAdapterRef.current = null;
        adoptMobileSession(adapter, addresses);
      }
    } catch (e) {
      if (pairingAdapterRef.current === adapter) {
        setPairingError(e instanceof Error ? e.message : String(e));
        pairingAdapterRef.current = null;
      }
    }
  };

  if (!connectModalOpen) return null;

  const installedIds = new Set(installedExtensions.map((w) => w.id));

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-6"
      onClick={close}
    >
      <div
        className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-[color:var(--oa-bg-raised)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[color:var(--oa-border)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            {view === 'mobile' && (
              <button
                type="button"
                className="oa-btn-ghost !px-1.5 -ml-1.5"
                onClick={() => {
                  cancelPairing();
                  setView('select');
                }}
              >
                <ArrowLeft size={15} />
              </button>
            )}
            <h2 className="text-sm font-medium">
              {view === 'mobile' ? t('wallet.mobileTitle') : t('wallet.connectTitle')}
            </h2>
          </div>
          <button type="button" className="oa-btn-ghost !px-1.5" onClick={close}>
            <X size={15} />
          </button>
        </div>

        {view === 'select' && (
          <div className="p-4 flex flex-col gap-4">
            {/* SUBFROST Webapp (passport popup) — the flagship option. */}
            <button
              type="button"
              className="oa-wallet-option w-full px-4 py-3.5 flex items-center gap-3 text-left"
              onClick={handlePassport}
              disabled={connecting}
            >
              {/* The subfrost-app favicon (/brand/Logo.png) fills the chip;
                  overflow-hidden crops its square canvas to a circle. */}
              <span className="h-9 w-9 rounded-full overflow-hidden shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/subfrost-logo.png" alt="" className="h-full w-full object-cover" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">SUBFROST Webapp</span>
                <span className="block text-xs text-[color:var(--oa-ink-secondary)]">
                  {t('wallet.passportHint')}
                </span>
              </span>
              {busyId === 'passport' && <Loader2 size={15} className="animate-spin shrink-0" />}
            </button>

            {/* Extension wallets */}
            <div>
              <div className="px-1 pb-2 text-xs text-[color:var(--oa-ink-tertiary)]">
                {t('wallet.extensionsSection')}
              </div>
              <div className="flex flex-col gap-1.5">
                {EXTENSION_WALLETS.map((wdef) => {
                  const installed = installedIds.has(wdef.id);
                  const busy = busyId === wdef.id;
                  const icon = (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={WALLET_ICONS[wdef.id]}
                      alt=""
                      width={22}
                      height={22}
                      className={`rounded-md shrink-0 ${installed ? '' : 'opacity-50'}`}
                    />
                  );
                  if (!installed) {
                    return (
                      <a
                        key={wdef.id}
                        href={wdef.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="oa-row px-3 py-2.5 rounded-xl flex items-center gap-3"
                      >
                        {icon}
                        <span className="min-w-0 flex-1 text-sm text-[color:var(--oa-ink-secondary)]">
                          {wdef.name}
                        </span>
                        <span className="text-xs text-[color:var(--oa-ink-tertiary)]">
                          {t('wallet.notInstalled')}
                        </span>
                      </a>
                    );
                  }
                  return (
                    <button
                      key={wdef.id}
                      type="button"
                      className="oa-row oa-hoverable px-3 py-2.5 rounded-xl flex items-center gap-3 text-left"
                      onClick={() => handleExtension(wdef.id)}
                      disabled={connecting}
                    >
                      {icon}
                      <span className="min-w-0 flex-1 text-sm font-medium">{wdef.name}</span>
                      {busy ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <span className="text-xs text-[color:var(--oa-success)]">
                          {t('wallet.installed')}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* SUBFROST Mobile — below the extensions. */}
            <button
              type="button"
              className="oa-wallet-option w-full px-4 py-3.5 flex items-center gap-3 text-left"
              onClick={startMobilePairing}
              disabled={connecting}
            >
              <span className="h-9 w-9 rounded-full bg-[color:var(--oa-bg-subtle)] flex items-center justify-center shrink-0">
                <PhDeviceMobile size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">SUBFROST Mobile</span>
                <span className="block text-xs text-[color:var(--oa-ink-secondary)]">
                  {t('wallet.mobileHint')}
                </span>
              </span>
            </button>

            {connectError && (
              <div className="text-sm text-[color:var(--oa-danger)]">{connectError}</div>
            )}
          </div>
        )}

        {view === 'mobile' && (
          <div className="p-6 flex flex-col items-center gap-4">
            {pairingError ? (
              <>
                <div className="text-sm text-[color:var(--oa-danger)] text-center">
                  {pairingError}
                </div>
                <button type="button" className="oa-btn-secondary" onClick={startMobilePairing}>
                  {t('wallet.retryPairing')}
                </button>
              </>
            ) : qrDataUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrDataUrl}
                  alt="SUBFROST Mobile pairing QR"
                  className="rounded-xl bg-white p-2"
                  width={260}
                  height={260}
                />
                {pairingCode && (
                  <div className="text-center">
                    <div className="text-xs text-[color:var(--oa-ink-tertiary)]">
                      {t('wallet.pairingCode')}
                    </div>
                    <div className="text-lg font-medium tracking-[0.3em] tabular-nums">
                      {pairingCode}
                    </div>
                  </div>
                )}
                <p className="text-xs text-[color:var(--oa-ink-secondary)] text-center max-w-xs">
                  {t('wallet.mobileScanHint')}
                </p>
                <p className="text-xs text-[color:var(--oa-ink-tertiary)] text-center max-w-xs">
                  {t('wallet.mobileNoSend')}
                </p>
              </>
            ) : (
              <div className="py-10 flex items-center gap-2 text-sm text-[color:var(--oa-ink-secondary)]">
                <Loader2 size={15} className="animate-spin" />
                {t('wallet.preparingPairing')}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
