/**
 * GET /api/orchestrator/verdicts?dao=<daoId>
 *
 * ALL pass/reject verdicts for a DAO's ended proposals in one response:
 * `{ ok: true, verdicts: { [proposalId]: 'passed' | 'rejected' } }`.
 *
 * Verdicts are pinned at each proposal's end block, so they are immutable
 * — computed at most ONCE per proposal (across all visitors) and held in
 * memory indefinitely. Per proposal, resolution order:
 *  1. memory cache — free;
 *  2. a whitelisted surtur node already computed a terminal status — adopt
 *     it (nodes run the identical deterministic computation);
 *  3. cold path: supply + holders pinned at each end block for EVERY
 *     still-unresolved proposal in ONE espo batch, plus node votes.
 */

import { NextResponse } from 'next/server';
import { setDefaultResultOrder } from 'node:dns';
import { setDefaultAutoSelectFamily } from 'node:net';
import { getDao, type DaoDefinition } from '@/daos';
import { SURTUR_NODES } from '@/surtur.config';
import {
  computeDelegatedTally,
  resolveDelegationState,
  resolveThreshold,
  thresholdPower,
  type DelegationActionWire,
  type VoteWire,
} from '@surtur/shared';
import { fetchEspoHeight, fetchVerdictSnapshots } from '@/lib/dao/governance';

// WSL2 / no-IPv6 environments: Node's fetch resolves Cloudflare hosts to
// AAAA first and times out — force IPv4-first resolution.
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

type TerminalStatus = 'passed' | 'rejected';

/** proposalId → verdict. Immutable once computed; held forever. */
const verdictCache = new Map<string, TerminalStatus>();
/** Dedupes concurrent cold sweeps per DAO. */
const inflight = new Map<string, Promise<void>>();

const NODE_TIMEOUT_MS = 10_000;

interface ProposalRowMeta {
  id: string;
  endBlock?: number;
  status: string;
}

/** Metadata rows for a DAO from the first whitelisted node that answers. */
async function fetchNodeRows(daoId: string): Promise<ProposalRowMeta[] | null> {
  for (const base of SURTUR_NODES) {
    try {
      const res = await fetch(`${base}/proposals?dao=${encodeURIComponent(daoId)}`, {
        signal: AbortSignal.timeout(NODE_TIMEOUT_MS),
        cache: 'no-store',
      });
      const json = await res.json().catch(() => null);
      if (json?.ok && Array.isArray(json.proposals)) {
        return json.proposals.map((row: any) => ({
          id: String(row.proposal?.id ?? ''),
          endBlock: typeof row.proposal?.endBlock === 'number' ? row.proposal.endBlock : undefined,
          status: String(row.status ?? 'open'),
        }));
      }
    } catch {
      /* try the next node */
    }
  }
  return null;
}

/** Union of delegation actions + delegator signers across all nodes. */
async function fetchDelegationContext(daoId: string): Promise<{
  actions: DelegationActionWire[];
  delegatorsBySigner: Map<string, string>;
}> {
  const actionKeys = new Set<string>();
  const actions: DelegationActionWire[] = [];
  const delegatorsBySigner = new Map<string, string>();
  await Promise.all(
    SURTUR_NODES.map(async (base) => {
      try {
        const [actionsRes, delegatorsRes] = await Promise.all([
          fetch(`${base}/delegations?dao=${encodeURIComponent(daoId)}`, {
            signal: AbortSignal.timeout(NODE_TIMEOUT_MS),
            cache: 'no-store',
          }).then((r) => r.json()),
          fetch(`${base}/delegators?dao=${encodeURIComponent(daoId)}`, {
            signal: AbortSignal.timeout(NODE_TIMEOUT_MS),
            cache: 'no-store',
          }).then((r) => r.json()),
        ]);
        if (actionsRes?.ok && Array.isArray(actionsRes.actions)) {
          for (const a of actionsRes.actions as DelegationActionWire[]) {
            const key = `${a.address}:${a.height}:${a.seq}:${a.delegatorId}:${a.action}:${a.signature}`;
            if (!actionKeys.has(key)) {
              actionKeys.add(key);
              actions.push(a);
            }
          }
        }
        if (delegatorsRes?.ok && Array.isArray(delegatorsRes.delegators)) {
          for (const b of delegatorsRes.delegators) {
            if (b?.delegator?.delegator && b?.delegator?.id) {
              delegatorsBySigner.set(b.delegator.delegator, b.delegator.id);
            }
          }
        }
      } catch {
        /* node unreachable */
      }
    }),
  );
  return { actions, delegatorsBySigner };
}

/** Union of votes across all whitelisted nodes (one vote per address). */
async function fetchNodeVotes(proposalId: string): Promise<VoteWire[]> {
  const byAddress = new Map<string, VoteWire>();
  await Promise.all(
    SURTUR_NODES.map(async (base) => {
      try {
        const res = await fetch(`${base}/votes?proposal=${encodeURIComponent(proposalId)}`, {
          signal: AbortSignal.timeout(NODE_TIMEOUT_MS),
          cache: 'no-store',
        });
        const json = await res.json().catch(() => null);
        if (json?.ok && Array.isArray(json.votes)) {
          for (const v of json.votes as VoteWire[]) {
            // Lexicographic consensus rule (same as the nodes): when nodes
            // disagree on an address's vote, the smallest signature wins.
            const current = byAddress.get(v.address);
            if (!current || v.signature < current.signature) byAddress.set(v.address, v);
          }
        }
      } catch {
        /* node unreachable */
      }
    }),
  );
  return [...byAddress.values()];
}

/** Cold-computes and caches verdicts for every ended-but-unresolved row. */
async function sweepDao(dao: DaoDefinition, rows: ProposalRowMeta[]): Promise<void> {
  // Adopt node-computed terminal statuses first — free and identical.
  for (const row of rows) {
    if (!verdictCache.has(row.id) && (row.status === 'passed' || row.status === 'rejected')) {
      verdictCache.set(row.id, row.status);
    }
  }

  const candidates = rows.filter(
    (row) => !verdictCache.has(row.id) && row.status === 'open' && row.endBlock !== undefined,
  );
  if (candidates.length === 0) return;

  const tip = await fetchEspoHeight(dao.espoNetwork);
  const ended = candidates.filter((row) => tip >= row.endBlock!);
  if (ended.length === 0) return;

  // The one espo cold fetch: every unresolved proposal's pinned snapshot
  // in a single batch; votes + delegation context from nodes in parallel.
  const [snapshots, votesById, delegationCtx] = await Promise.all([
    fetchVerdictSnapshots(
      dao,
      ended.map((row) => ({ proposalId: row.id, endBlock: row.endBlock! })),
    ),
    Promise.all(ended.map(async (row) => [row.id, await fetchNodeVotes(row.id)] as const)).then(
      (pairs) => new Map(pairs),
    ),
    fetchDelegationContext(dao.id),
  ]);

  for (const row of ended) {
    const snapshot = snapshots.get(row.id);
    if (!snapshot) continue;
    const balances = new Map(snapshot.holders.map((h) => [h.address, h.amount]));
    const tally = computeDelegatedTally({
      votes: (votesById.get(row.id) ?? []).map((v) => ({ address: v.address, choice: v.choice })),
      balances,
      actions: delegationCtx.actions,
      delegatorsBySigner: delegationCtx.delegatorsBySigner,
      evalHeight: row.endBlock!,
    });
    const pctg = resolveThreshold(dao.votePassThreshold, row.endBlock!);
    verdictCache.set(
      row.id,
      snapshot.supply > 0n && tally.forPower >= thresholdPower(snapshot.supply, pctg)
        ? 'passed'
        : 'rejected',
    );
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const daoId = url.searchParams.get('dao') ?? '';
  const dao = getDao(daoId);
  if (!dao) {
    return NextResponse.json({ ok: false, error: 'unknown dao' }, { status: 400 });
  }
  try {
    const rows = await fetchNodeRows(dao.id);
    if (rows && rows.length > 0) {
      let sweep = inflight.get(dao.id);
      if (!sweep) {
        sweep = sweepDao(dao, rows).finally(() => inflight.delete(dao.id));
        inflight.set(dao.id, sweep);
      }
      // A failed sweep (espo hiccup) must not 502 the verdicts we DO have
      // cached — unresolved proposals just stay absent until the next try.
      await sweep.catch(() => {});
    }
    const verdicts: Record<string, TerminalStatus> = {};
    for (const row of rows ?? []) {
      const verdict = verdictCache.get(row.id);
      if (verdict) verdicts[row.id] = verdict;
    }
    return NextResponse.json({ ok: true, verdicts });
  } catch (e) {
    const cause = (e as any)?.cause;
    const detail = cause ? ` (${cause.code ?? cause.name ?? ''}: ${cause.message ?? ''})` : '';
    return NextResponse.json(
      { ok: false, error: `${(e as Error).message}${detail}` },
      { status: 502 },
    );
  }
}
