/**
 * NodeDaoStore — the DaoStore backed by the surtur-node p2p network.
 *
 * Reads fan out to EVERY whitelisted node in parallel and union-merge: a
 * record is shown as long as ONE node has a VALID copy, so a node missing
 * data never hides anything. Validity is re-checked client-side (never
 * trust a node): sha256 id integrity + BIP-322 signatures via
 * @surtur/shared, and the proposal-opening threshold at the start block
 * via espo's versioned RPC.
 *
 * Writes POST the signed bundle to every node; each node then relays to
 * its peers, so reaching a single node is enough for the network to
 * converge. A write succeeds if at least one node accepted it.
 */

import {
  resolveThreshold,
  thresholdPower,
  verifyProposalBundle,
  verifyVoteWire,
  type ProposalBundle,
  type ProposalWire,
  type ResolutionWire,
  type VoteWire,
} from '@surtur/shared';
import type { DaoDefinition } from '@/daos';
import { getEspoUrl } from '@/lib/config';
import type { DaoStore } from './store';
import type { Proposal, ProposalPage, ProposalStatus, Vote } from './types';
import { fakeLoadDelay } from './delay';

const NODE_TIMEOUT_MS = 15_000;

/**
 * List rows are METADATA-only (no body/bodyZh/signature — see the node's
 * GET /proposals); the detail read carries the full verifiable bundle.
 */
type ProposalWireMeta = Omit<ProposalWire, 'body' | 'bodyZh'> &
  Partial<Pick<ProposalWire, 'body' | 'bodyZh'>>;

interface NodeProposal {
  proposal: ProposalWireMeta;
  signature?: string;
  status: string;
}

function wireToProposal(row: NodeProposal): Proposal {
  const p = row.proposal;
  const body = p.body ?? '';
  const status: ProposalStatus = ['open', 'passed', 'rejected', 'executed'].includes(row.status)
    ? (row.status as ProposalStatus)
    : 'open';
  return {
    id: p.id,
    daoId: p.daoId,
    title: p.title,
    titleZh: p.titleZh,
    body,
    bodyZh: p.bodyZh,
    transfers: p.transfers,
    author: p.proposer,
    createdAt: p.createdAt,
    status,
    startBlock: p.startBlock,
    endBlock: p.endBlock,
  };
}

/** A terminal status from any node beats 'open' (verdicts are lazy). */
function preferStatus(a: string, b: string): string {
  return a === 'open' ? b : a;
}

/**
 * proposalId → "proposer met the threshold at startBlock". Pinned at the
 * start block, so immutable — persisted in localStorage so reloads never
 * re-ask espo about a proposal it has already judged. Trust-critical, so
 * it stays CLIENT-side (never delegated to the orchestrator).
 */
const THRESHOLD_CACHE_KEY = 'surtur:threshold-checks';

class ThresholdVerdictCache {
  private map: Map<string, boolean> | null = null;

  private load(): Map<string, boolean> {
    if (this.map) return this.map;
    this.map = new Map();
    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(THRESHOLD_CACHE_KEY);
        if (raw) {
          for (const [id, ok] of Object.entries(JSON.parse(raw) as Record<string, boolean>)) {
            this.map.set(id, ok);
          }
        }
      } catch {
        /* corrupt cache — start fresh */
      }
    }
    return this.map;
  }

  get(id: string): boolean | undefined {
    return this.load().get(id);
  }

  set(id: string, ok: boolean): void {
    const map = this.load();
    map.set(id, ok);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(THRESHOLD_CACHE_KEY, JSON.stringify(Object.fromEntries(map)));
      } catch {
        /* storage full/blocked — in-memory only */
      }
    }
  }
}

const thresholdVerdictCache = new ThresholdVerdictCache();

export class NodeDaoStore implements DaoStore {
  constructor(
    private readonly nodes: string[],
    private readonly getDao: (id: string) => DaoDefinition | null,
  ) {}

  private async fanOutGet<T>(path: string, pick: (json: any) => T | null): Promise<T[]> {
    const settled = await Promise.allSettled(
      this.nodes.map(async (node): Promise<T | null> => {
        const res = await fetch(`${node}${path}`, {
          signal: AbortSignal.timeout(NODE_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`${node} ${res.status}`);
        return pick(await res.json());
      }),
    );
    const out: T[] = [];
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value !== null) out.push(r.value as T);
    }
    return out;
  }

  private async fanOutPost(path: string, body: unknown): Promise<void> {
    const results = await Promise.allSettled(
      this.nodes.map(async (node) => {
        const res = await fetch(`${node}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(NODE_TIMEOUT_MS),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || json?.ok !== true) {
          throw new Error(json?.error ?? `${node} HTTP ${res.status}`);
        }
      }),
    );
    // The relay converges the rest of the network — one acceptance is
    // enough. Surface the node error only when EVERY node refused.
    if (!results.some((r) => r.status === 'fulfilled')) {
      const firstError = results.find(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      )?.reason;
      throw new Error(
        firstError instanceof Error ? firstError.message : 'no surtur node accepted the request',
      );
    }
  }

  /** Union rows from all nodes by proposal id (best status wins). */
  private mergeProposalRows(perNode: NodeProposal[][]): Map<string, NodeProposal> {
    const merged = new Map<string, NodeProposal>();
    for (const rows of perNode) {
      for (const row of rows) {
        const existing = merged.get(row.proposal.id);
        if (!existing) {
          merged.set(row.proposal.id, row);
        } else {
          existing.status = preferStatus(existing.status, row.status);
        }
      }
    }
    return merged;
  }

  /**
   * Client-side validity: signature/id integrity (only when the full
   * bundle is present — list rows are metadata-only and can't be hashed)
   * + the proposer's threshold share at the start block (espo versioned
   * RPC, one batch for all candidates). Nodes run the same checks — this
   * guards against a misbehaving node.
   *
   * The threshold check is pinned at each proposal's start block, so its
   * outcome is IMMUTABLE — cached per proposal id (localStorage) so espo
   * is only asked about proposals it hasn't judged yet. Fail-open results
   * (espo unreachable) are deliberately not cached so they retry.
   *
   * `optimistic` (list views): rows espo hasn't judged yet are shown
   * IMMEDIATELY and verified in the background — the list never waits on
   * espo. Anything that fails the check is pruned on the next fetch (and
   * the blocking detail view never shows it at all).
   */
  private async filterValidProposals(
    rows: NodeProposal[],
    opts?: { optimistic?: boolean },
  ): Promise<NodeProposal[]> {
    const intact = rows.filter(
      (row) =>
        row.signature === undefined ||
        row.proposal.body === undefined ||
        verifyProposalBundle({
          proposal: row.proposal as ProposalWire,
          signature: row.signature,
        }).ok,
    );
    const needCheck: NodeProposal[] = [];
    const passThrough: NodeProposal[] = [];
    for (const row of intact) {
      const dao = this.getDao(row.proposal.daoId);
      if (!dao) continue;
      const cached = thresholdVerdictCache.get(row.proposal.id);
      if (cached !== undefined) {
        if (cached) passThrough.push(row);
        continue;
      }
      // The fork entry in force at the proposal's start block.
      if (resolveThreshold(dao.proposalThreshold, row.proposal.startBlock) <= 0) {
        thresholdVerdictCache.set(row.proposal.id, true);
        passThrough.push(row);
      } else {
        needCheck.push(row);
      }
    }
    if (needCheck.length === 0) return passThrough;

    if (opts?.optimistic) {
      // Show now, judge in the background (results land in the cache and
      // apply from the next fetch onward).
      void this.checkThresholds(needCheck);
      return [...passThrough, ...needCheck];
    }
    const checked = await this.checkThresholds(needCheck);
    return [...passThrough, ...checked];
  }

  /** The batched espo threshold check; caches verdicts, returns passers. */
  private async checkThresholds(needCheck: NodeProposal[]): Promise<NodeProposal[]> {
    const byNetwork = new Map<string, NodeProposal[]>();
    for (const row of needCheck) {
      const dao = this.getDao(row.proposal.daoId)!;
      const list = byNetwork.get(dao.espoNetwork) ?? [];
      list.push(row);
      byNetwork.set(dao.espoNetwork, list);
    }

    const valid: NodeProposal[] = [];
    for (const [network, list] of byNetwork) {
      try {
        const requests = list.flatMap((row, i) => {
          const dao = this.getDao(row.proposal.daoId)!;
          return [
            {
              jsonrpc: '2.0',
              id: `s-${i}`,
              method: 'essentials.get_circulating_supply',
              params: { alkane: dao.votingToken.alkaneId, height: row.proposal.startBlock },
            },
            {
              jsonrpc: '2.0',
              id: `b-${i}`,
              method: 'essentials.get_address_balances',
              params: { address: row.proposal.proposer, height: row.proposal.startBlock },
            },
          ];
        });
        const res = await fetch(getEspoUrl(network), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requests),
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) throw new Error(`espo ${res.status}`);
        const json = await res.json();
        const byId = new Map(
          (Array.isArray(json) ? json : [json]).map((e: any) => [String(e?.id), e?.result]),
        );
        list.forEach((row, i) => {
          const dao = this.getDao(row.proposal.daoId)!;
          const supply = BigInt(String(byId.get(`s-${i}`)?.supply ?? 0));
          const held = BigInt(
            String(byId.get(`b-${i}`)?.balances?.[dao.votingToken.alkaneId] ?? 0),
          );
          if (supply <= 0n) return;
          const pctg = resolveThreshold(dao.proposalThreshold, row.proposal.startBlock);
          const meets = held >= thresholdPower(supply, pctg);
          thresholdVerdictCache.set(row.proposal.id, meets);
          if (meets) valid.push(row);
        });
      } catch {
        // Espo unavailable — fall back to trusting the nodes' own checks.
        valid.push(...list);
      }
    }
    return valid;
  }

  async listProposals(daoId: string, page: number, pageSize: number): Promise<ProposalPage> {
    await fakeLoadDelay();
    const perNode = await this.fanOutGet<NodeProposal[]>(
      `/proposals?dao=${encodeURIComponent(daoId)}`,
      (json) => (json?.ok && Array.isArray(json.proposals) ? json.proposals : null),
    );
    const merged = [...this.mergeProposalRows(perNode).values()];
    // Optimistic: the list renders straight from node data; espo verdicts
    // arrive in the background and prune on later fetches.
    const valid = await this.filterValidProposals(merged, { optimistic: true });
    const all = valid
      .map(wireToProposal)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const total = all.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const clamped = Math.min(Math.max(1, page), pageCount);
    const start = (clamped - 1) * pageSize;
    return { items: all.slice(start, start + pageSize), total, page: clamped, pageSize, pageCount };
  }

  async getProposal(id: string): Promise<Proposal | null> {
    await fakeLoadDelay();
    const rows = await this.fanOutGet<NodeProposal>(
      `/proposals/${encodeURIComponent(id)}`,
      (json) => (json?.ok && json.proposal ? (json as NodeProposal) : null),
    );
    if (rows.length === 0) return null;
    const merged = [...this.mergeProposalRows([rows]).values()];
    const valid = await this.filterValidProposals(merged);
    return valid.length ? wireToProposal(valid[0]) : null;
  }

  async publishProposal(bundle: ProposalBundle): Promise<Proposal> {
    await this.fanOutPost('/proposals', bundle);
    return wireToProposal({ ...bundle, status: 'open' });
  }

  /**
   * Union of every node's vote set — the "true" vote is all signatures the
   * network knows about, even if individual nodes are missing some. Each
   * signature is re-verified client-side against the proposal.
   */
  async listVotes(proposalId: string): Promise<Vote[]> {
    await fakeLoadDelay();
    const [proposal, perNode] = await Promise.all([
      this.getProposal(proposalId),
      this.fanOutGet<VoteWire[]>(
        `/votes?proposal=${encodeURIComponent(proposalId)}`,
        (json) => (json?.ok && Array.isArray(json.votes) ? json.votes : null),
      ),
    ]);
    if (!proposal) return [];
    const merged = new Map<string, VoteWire>();
    for (const votes of perNode) {
      for (const vote of votes) {
        if (vote.proposalId !== proposalId || merged.has(vote.address)) continue;
        if (!verifyVoteWire(vote, proposal.title).ok) continue;
        merged.set(vote.address, vote);
      }
    }
    return [...merged.values()].map((v) => ({
      proposalId: v.proposalId,
      daoId: v.daoId,
      address: v.address,
      choice: v.choice,
      signature: v.signature,
      publicKey: '',
      message: v.message,
      votedAt: v.votedAt,
    }));
  }

  async submitVote(vote: Vote): Promise<Vote> {
    const wire: VoteWire = {
      proposalId: vote.proposalId,
      daoId: vote.daoId ?? '',
      address: vote.address,
      choice: vote.choice,
      signature: vote.signature,
      message: vote.message,
      votedAt: vote.votedAt,
    };
    await this.fanOutPost('/votes', wire);
    return vote;
  }

  /**
   * First resolution any whitelisted node knows about. The frontend
   * deliberately does NOT re-check the signer against the CURRENT
   * resolverSigner — nodes enforced that at write time, and the resolver
   * may legitimately change later without erasing past resolutions.
   */
  async getResolution(proposalId: string): Promise<ResolutionWire | null> {
    const rows = await this.fanOutGet<ResolutionWire>(
      `/resolutions?proposal=${encodeURIComponent(proposalId)}`,
      (json) => (json?.ok && json.resolution ? (json.resolution as ResolutionWire) : null),
    );
    return rows.find((r) => r.proposalId === proposalId) ?? null;
  }

  async publishResolution(resolution: ResolutionWire): Promise<void> {
    await this.fanOutPost('/resolutions', resolution);
  }

  /**
   * Verdicts are computed by the nodes themselves (deterministically, from
   * espo pinned at the end block) — nothing to persist from the client.
   * Return the proposal with the status applied so the UI updates; the
   * next read converges on the nodes' own verdict.
   */
  async updateProposalStatus(id: string, status: Proposal['status']): Promise<Proposal | null> {
    const proposal = await this.getProposal(id);
    return proposal ? { ...proposal, status } : null;
  }
}
