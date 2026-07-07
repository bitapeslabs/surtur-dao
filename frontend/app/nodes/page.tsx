'use client';

/**
 * Nodes page — every whitelisted surtur node with its address and live
 * round-trip latency, measured against the surtur-specific /surtur/ping
 * endpoint (the `pong: 'surtur'` marker proves it's a real surtur node,
 * not just any HTTP server). Repinged every 10s via TanStack Query.
 */

import { useQuery } from '@tanstack/react-query';
import { SURTUR_NODES } from '@/surtur.config';
import { useI18n } from '@/hooks/useI18n';
import Skeleton from '@/components/Skeleton';

const PING_TIMEOUT_MS = 5_000;
const REPING_MS = 10_000;

interface NodePing {
  url: string;
  /** Round-trip ms, or null when unreachable / not a surtur node. */
  latencyMs: number | null;
}

async function pingNode(url: string): Promise<NodePing> {
  const start = performance.now();
  try {
    const res = await fetch(`${url}/surtur/ping`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });
    if (!res.ok) return { url, latencyMs: null };
    const json = await res.json();
    if (json?.pong !== 'surtur') return { url, latencyMs: null };
    return { url, latencyMs: Math.max(1, Math.round(performance.now() - start)) };
  } catch {
    return { url, latencyMs: null };
  }
}

export default function NodesPage() {
  const { t } = useI18n();

  const pings = useQuery({
    queryKey: ['surtur-nodes', 'ping'],
    queryFn: () => Promise.all(SURTUR_NODES.map(pingNode)),
    refetchInterval: REPING_MS,
    placeholderData: (prev) => prev,
  });

  return (
    <main className="max-w-3xl mx-auto px-5 py-10 flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('nodes.title')}</h1>
        <p className="mt-1 text-sm text-[color:var(--oa-ink-secondary)]">{t('nodes.subtitle')}</p>
      </div>

      <section className="rounded-2xl overflow-hidden bg-[color:var(--oa-bg-raised)]">
        <div className="divide-y divide-[color:var(--oa-border)]">
          {SURTUR_NODES.map((url) => {
            const ping = pings.data?.find((p) => p.url === url);
            const loading = pings.data === undefined;
            const online = ping?.latencyMs !== null && ping?.latencyMs !== undefined;
            return (
              <div key={url} className="px-5 py-4 flex items-center justify-between gap-3">
                <div className="min-w-0 flex items-center gap-2.5">
                  {loading ? (
                    <Skeleton className="h-1.5 w-1.5 rounded-full shrink-0" />
                  ) : (
                    <span
                      className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                        online ? 'bg-[color:var(--oa-success)]' : 'bg-[color:var(--oa-danger)]'
                      }`}
                    />
                  )}
                  <span className="text-sm font-medium truncate tabular-nums">{url}</span>
                </div>
                <div className="text-right shrink-0">
                  {loading ? (
                    <Skeleton className="h-4 w-16" />
                  ) : online ? (
                    <div className="text-sm font-medium tabular-nums">
                      {t('nodes.latencyMs', { ms: ping!.latencyMs! })}
                    </div>
                  ) : (
                    <div className="text-sm font-medium text-[color:var(--oa-danger)]">
                      {t('nodes.offline')}
                    </div>
                  )}
                  {!loading && online && (
                    <div className="text-xs text-[color:var(--oa-ink-tertiary)]">
                      {t('nodes.online')}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
