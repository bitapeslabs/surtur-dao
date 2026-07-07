'use client';

/**
 * MobileBottomNav — fixed bottom navigation shown only on mobile (md:hidden),
 * mirroring the subfrost app pattern. On desktop the top navbar carries the
 * links; on mobile the top navbar is empty and navigation lives here.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Network, ScrollText, Wallet, type LucideIcon } from 'lucide-react';
import { useI18n } from '@/hooks/useI18n';
import { stripLocale } from '@/i18n';
import type { MessageKey } from '@/i18n';

const ITEMS: Array<{ href: string; labelKey: MessageKey; icon: LucideIcon }> = [
  { href: '/proposals', labelKey: 'nav.proposals', icon: ScrollText },
  { href: '/nodes', labelKey: 'nav.nodes', icon: Network },
  { href: '/portfolio', labelKey: 'nav.portfolio', icon: Wallet },
];

export default function MobileBottomNav() {
  const pathname = usePathname();
  const { t, p } = useI18n();

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 md:hidden bg-[color:var(--oa-bg)]/95 backdrop-blur border-t border-[color:var(--oa-border)]">
      <div className="flex items-stretch justify-around h-16 px-2 pb-[env(safe-area-inset-bottom)]">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const active = stripLocale(pathname ?? '/').startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={p(item.href)}
              className={`oa-hoverable flex flex-col items-center justify-center flex-1 gap-1 ${
                active
                  ? 'text-[color:var(--oa-ink)]'
                  : 'text-[color:var(--oa-ink-tertiary)] hover:text-[color:var(--oa-ink)]'
              }`}
            >
              <Icon size={20} strokeWidth={active ? 2.5 : 2} />
              <span className="text-[10px] font-semibold">{t(item.labelKey)}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
