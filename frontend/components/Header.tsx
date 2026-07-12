'use client';

/**
 * Header — brand · nav · account, openai.com styling (hairline bottom
 * border, pill nav links, pill CTA). Dark by default with a theme toggle.
 * Connected state shows the address as a button with a caret; clicking it
 * opens a dropdown with Disconnect. Disconnected state shows a settings
 * popover for the SUBFROST origin + a Connect CTA.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Check, ChevronDown, Copy, Loader2, Settings2, Unplug, Wallet } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { effectiveDelegatorMeta } from '@surtur/shared';
import { ScrollText } from 'lucide-react';
import { DAOS } from '@/daos';
import { getDaoStore } from '@/lib/dao/store';
import { useVendorWallet } from '@/context/VendorWalletContext';
import { useI18n } from '@/hooks/useI18n';
import { stripLocale, LOCALE_PREFIX } from '@/i18n';
import { PhTranslate } from '@/components/PhosphorIcons';
import SurturLogo from '@/components/SurturLogo';

/** Compact address for the header (fits small screens): 6…4. */
function shortAddress(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

// Desktop top-nav links. Portfolio lives in the account dropdown (desktop) and
// the mobile bottom nav, so it's intentionally absent here.
const NAV = [
  { href: '/proposals', labelKey: 'nav.proposals' as const },
  { href: '/nodes', labelKey: 'nav.nodes' as const },
];

/**
 * Language toggle — replaces the old light/dark switch. Enabled (zh) is
 * shown as an active pill; toggling swaps the /zh prefix on the current URL.
 */
function TranslateToggle() {
  const router = useRouter();
  const pathname = usePathname();
  const { locale, t } = useI18n();

  const toggle = () => {
    const bare = stripLocale(pathname ?? '/');
    router.push(locale === 'zh' ? bare : `${LOCALE_PREFIX}${bare}`);
  };

  return (
    <button
      type="button"
      className={`oa-btn-ghost !px-2 ${
        locale === 'zh' ? 'oa-nav-link-active !text-[color:var(--oa-ink)]' : ''
      }`}
      onClick={toggle}
      aria-label={t('header.translateAria')}
      aria-pressed={locale === 'zh'}
    >
      <PhTranslate size={15} />
    </button>
  );
}

export default function Header() {
  const pathname = usePathname();
  const { locale, t, p } = useI18n();
  const {
    hydrated,
    session,
    subfrostOrigin,
    setSubfrostOrigin,
    connect,
    disconnect,
    connecting,
    connectError,
  } = useVendorWallet();

  // When the connected wallet owns a delegation (in any enabled DAO),
  // the account button wears the delegation's identity.
  const enabledDaoIds = DAOS.filter((d) => d.enabled).map((d) => d.id);
  const myDelegationQuery = useQuery({
    queryKey: ['nodes', 'my-delegation', session?.account.address, enabledDaoIds.join(',')],
    queryFn: async () => {
      for (const daoId of enabledDaoIds) {
        const bundles = await getDaoStore().listDelegators(daoId);
        const mine = bundles.find((b) => b.delegator.delegator === session!.account.address);
        if (mine) {
          const meta = effectiveDelegatorMeta(mine);
          return {
            daoId,
            id: mine.delegator.id,
            name: meta.name,
            nameZh: meta.nameZh,
            icon: meta.icon,
          };
        }
      }
      return null;
    },
    enabled: !!session,
    staleTime: 60_000,
  });
  const myDelegation = myDelegationQuery.data ?? null;
  const [showSettings, setShowSettings] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [copied, setCopied] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

  const copyAddress = async () => {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.account.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  // Close dropdowns on outside click.
  useEffect(() => {
    if (!showAccount && !showSettings) return;
    const handler = (e: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setShowAccount(false);
      }
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAccount, showSettings]);

  return (
    <header className="sticky top-0 z-40 bg-[color:var(--oa-bg)]/90 backdrop-blur border-b border-[color:var(--oa-border)]">
      <div className="max-w-5xl mx-auto px-5 h-14 flex items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <Link href={p('/proposals')} className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <SurturLogo size={22} />
            <span className="hidden md:inline">Surtur</span>
          </Link>
          {/* Top nav — desktop only; mobile navigates via the bottom bar. */}
          <nav className="hidden md:flex items-center gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={p(item.href)}
                className={`oa-nav-link ${
                  stripLocale(pathname ?? '/').startsWith(item.href) ? 'oa-nav-link-active' : ''
                }`}
              >
                {t(item.labelKey)}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-1.5">
          <TranslateToggle />

          {hydrated && session ? (
            <div ref={accountRef} className="relative">
              <button
                type="button"
                className="oa-btn-secondary !px-4 !py-2 !text-[13px]"
                onClick={() => setShowAccount((v) => !v)}
                title={session.account.address}
              >
                {myDelegation ? (
                  <span className="inline-flex items-center gap-1.5 min-w-0">
                    {myDelegation.icon && (
                      <span className="h-5 w-5 rounded-full overflow-hidden shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={myDelegation.icon}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      </span>
                    )}
                    <span className="truncate max-w-36">
                      {locale === 'zh' && myDelegation.nameZh
                        ? myDelegation.nameZh
                        : myDelegation.name}
                    </span>
                  </span>
                ) : (
                  shortAddress(session.account.address)
                )}
                <ChevronDown
                  size={13}
                  className={`transition-transform ${showAccount ? 'rotate-180' : ''}`}
                />
              </button>
              {showAccount && (
                <div className="absolute right-0 top-full mt-2 w-60 oa-card p-2 shadow-xl">
                  {/* Truncated address + copy */}
                  <div className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="text-sm font-medium text-[color:var(--oa-ink)]">
                      {shortAddress(session.account.address)}
                    </span>
                    <button
                      type="button"
                      className="oa-hoverable p-1 rounded-md text-[color:var(--oa-ink-tertiary)] hover:text-[color:var(--oa-ink)] hover:bg-[color:var(--oa-bg-subtle)]"
                      onClick={copyAddress}
                      aria-label={t('header.copyAria')}
                    >
                      {copied ? (
                        <Check size={14} className="text-[color:var(--oa-success)]" />
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                  </div>
                  <div className="my-1 h-px bg-[color:var(--oa-border)]" />
                  {myDelegation && (
                    <Link
                      href={p(`/delegations/${myDelegation.daoId}/${myDelegation.id}`)}
                      className="oa-row w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium text-[color:var(--oa-ink)]"
                      onClick={() => setShowAccount(false)}
                    >
                      <ScrollText size={14} />
                      {t('header.viewDelegation')}
                    </Link>
                  )}
                  <Link
                    href={p('/portfolio')}
                    className="oa-row w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium text-[color:var(--oa-ink)]"
                    onClick={() => setShowAccount(false)}
                  >
                    <Wallet size={14} />
                    {t('nav.portfolio')}
                  </Link>
                  <button
                    type="button"
                    className="oa-row w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium text-[color:var(--oa-ink)]"
                    onClick={() => {
                      setShowAccount(false);
                      disconnect();
                    }}
                  >
                    <Unplug size={14} />
                    {t('header.disconnect')}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <div ref={settingsRef} className="relative">
                <button
                  type="button"
                  className="oa-btn-ghost !px-2"
                  onClick={() => setShowSettings((v) => !v)}
                  aria-label={t('header.settingsAria')}
                >
                  <Settings2 size={15} />
                </button>
                {showSettings && (
                  <div className="absolute right-0 top-full mt-2 w-80 oa-card p-4 shadow-xl">
                    <label className="oa-label" htmlFor="subfrost-origin">
                      {t('header.origin')}
                    </label>
                    <input
                      id="subfrost-origin"
                      className="oa-input"
                      value={subfrostOrigin}
                      onChange={(e) => setSubfrostOrigin(e.target.value)}
                      placeholder="https://app.subfrost.io"
                    />
                    <p className="mt-2 text-xs text-[color:var(--oa-ink-tertiary)]">
                      {t('header.originHint')}
                    </p>
                  </div>
                )}
              </div>
              <button
                type="button"
                className="oa-btn-primary !px-4 !py-2"
                onClick={connect}
                disabled={!hydrated || connecting}
              >
                {connecting && <Loader2 size={14} className="animate-spin" />}
                {connecting ? t('header.connecting') : t('header.connect')}
              </button>
            </>
          )}
        </div>
      </div>
      {connectError && (
        <div className="max-w-5xl mx-auto px-5 pb-2 text-sm text-[color:var(--oa-danger)]">
          {connectError}
        </div>
      )}
    </header>
  );
}
