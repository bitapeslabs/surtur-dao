/**
 * GET /api/orchestrator/overview?dao=<daoId>
 *
 * DAO overview (treasury reserves + USD estimate) cached server-side and
 * invalidated per espo BLOCK: the cache entry carries the tip height it
 * was computed at, and is reused until the tip moves. Display-only data —
 * not trust-critical — so centralizing the espo traffic here is fine; one
 * espo batch per DAO per block serves every visitor.
 */

import { NextResponse } from 'next/server';
import { setDefaultResultOrder } from 'node:dns';
import { setDefaultAutoSelectFamily } from 'node:net';
import { getDao, type DaoDefinition } from '@/daos';
import { fetchDaoOverview, fetchEspoHeight } from '@/lib/dao/governance';

// WSL2 / no-IPv6 environments: force IPv4-first resolution for
// Cloudflare-backed hosts.
try {
  setDefaultResultOrder('ipv4first');
  // WSL2's Happy-Eyeballs (auto family selection) intermittently kills
  // fresh connections with "fetch failed" when there is no IPv6 route —
  // disable it so connects go straight over IPv4.
  setDefaultAutoSelectFamily(false);
} catch {
  /* already set or unsupported */
}

export const dynamic = 'force-dynamic';

interface OverviewEntry {
  height: number;
  reserves: string | null;
  treasuryUsd: number | null;
}

const overviewCache = new Map<string, OverviewEntry>();
const inflight = new Map<string, Promise<OverviewEntry>>();

/** The tip itself is cached briefly so every request doesn't poll espo. */
const TIP_TTL_MS = 15_000;
const tipCache = new Map<string, { height: number; ts: number }>();

/**
 * One retry on failure: the server's keepalive sockets to Cloudflare go
 * stale between infrequent requests, and the first use after idling can
 * die with a reset — the retry gets a fresh connection.
 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    return fn();
  }
}

async function currentTip(network: string): Promise<number> {
  const cached = tipCache.get(network);
  if (cached && Date.now() - cached.ts < TIP_TTL_MS) return cached.height;
  try {
    const height = await withRetry(() => fetchEspoHeight(network));
    tipCache.set(network, { height, ts: Date.now() });
    return height;
  } catch (e) {
    // Espo hiccup — a slightly stale tip beats a 502.
    if (cached) return cached.height;
    throw e;
  }
}

async function resolveOverview(dao: DaoDefinition): Promise<OverviewEntry> {
  const tip = await currentTip(dao.espoNetwork);
  const cached = overviewCache.get(dao.id);
  if (cached && cached.height === tip) return cached;

  let promise = inflight.get(dao.id);
  if (!promise) {
    promise = (async (): Promise<OverviewEntry> => {
      const { reserves, treasuryUsd } = await withRetry(() => fetchDaoOverview(dao));
      const entry: OverviewEntry = {
        height: tip,
        reserves: reserves === null ? null : reserves.toString(),
        treasuryUsd,
      };
      overviewCache.set(dao.id, entry);
      return entry;
    })().finally(() => inflight.delete(dao.id));
    inflight.set(dao.id, promise);
  }
  try {
    return await promise;
  } catch (e) {
    // Espo unreachable — serve the previous block's data if we have it.
    if (cached) return cached;
    throw e;
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const dao = getDao(url.searchParams.get('dao') ?? '');
  if (!dao) {
    return NextResponse.json({ ok: false, error: 'unknown dao' }, { status: 400 });
  }
  try {
    const entry = await resolveOverview(dao);
    return NextResponse.json({ ok: true, ...entry });
  } catch (e) {
    const cause = (e as any)?.cause;
    const detail = cause ? ` (${cause.code ?? cause.name ?? ''}: ${cause.message ?? ''})` : '';
    return NextResponse.json(
      { ok: false, error: `${(e as Error).message}${detail}` },
      { status: 502 },
    );
  }
}
