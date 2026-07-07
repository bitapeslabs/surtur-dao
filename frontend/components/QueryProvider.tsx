'use client';

/**
 * TanStack Query provider. Espo data is cached aggressively: queries that
 * depend on chain state carry the espo height in their query key, so a new
 * height produces a new key (fresh fetch) while an unchanged height serves
 * from cache. Only the height itself (hooks/useEspoHeight) polls espo.
 */

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export default function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
