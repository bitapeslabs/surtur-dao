'use client';

/**
 * useI18n — locale from the URL (/zh prefix), `t()` for dictionary strings
 * and `p()` for locale-prefixed hrefs. Every Link/router.push in the app
 * must go through `p()` so navigation stays inside the active locale.
 */

import { useCallback } from 'react';
import { usePathname } from 'next/navigation';
import {
  localeFromPathname,
  localePath,
  tr,
  type Locale,
  type MessageKey,
} from '@/i18n';

export interface I18n {
  locale: Locale;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  p: (href: string) => string;
}

export function useI18n(): I18n {
  const pathname = usePathname();
  const locale = localeFromPathname(pathname ?? '/');
  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) => tr(locale, key, vars),
    [locale],
  );
  const p = useCallback((href: string) => localePath(locale, href), [locale]);
  return { locale, t, p };
}
