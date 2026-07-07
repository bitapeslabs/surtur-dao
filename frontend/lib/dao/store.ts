/**
 * DaoStore — the data-access boundary for all proposal and vote
 * reads/writes. Pages and components only ever talk to this interface, so
 * swapping the localStorage skeleton for a real backend (indexer /
 * on-chain state) later is a one-file change in `getDaoStore()`.
 *
 * Every method is async even where the current implementation is
 * synchronous, so the interface already matches a network-backed store.
 */

import type { ProposalBundle, ResolutionWire } from '@surtur/shared';
import type { Proposal, ProposalPage, Vote } from './types';
import { normalizeDaoId, getDao as getDaoDef } from '@/daos';
import { SURTUR_NODES } from '@/surtur.config';
import { fakeLoadDelay } from './delay';
import { NodeDaoStore } from './nodeStore';

export interface DaoStore {
  /** Newest-first page of one DAO's proposals. `page` is 1-based. */
  listProposals(daoId: string, page: number, pageSize: number): Promise<ProposalPage>;
  getProposal(id: string): Promise<Proposal | null>;
  /**
   * Publish a SIGNED proposal bundle (id = sha256 of the canonical
   * content, signature = BIP-322 by the proposer over the id). The signing
   * happens in the UI (SUBFROST popup) before this call.
   */
  publishProposal(bundle: ProposalBundle): Promise<Proposal>;
  /** All cast votes for a proposal. */
  listVotes(proposalId: string): Promise<Vote[]>;
  /**
   * Persist a signed vote. One vote per address per proposal — votes are
   * final (the UI disables re-voting). The backend that eventually replaces
   * this must verify the signature AND reject duplicate votes server-side.
   */
  submitVote(vote: Vote): Promise<Vote>;
  /**
   * Persist a proposal's terminal status once its end block passes (the
   * tally is read from Espo pinned at endBlock, so it's static forever).
   * TODO(backend): the close + passed/rejected verdict MUST be computed
   * server-side — a client writing its own verdict is not trustworthy.
   */
  updateProposalStatus(id: string, status: Proposal['status']): Promise<Proposal | null>;
  /** The proposal's resolution, if the DAO's resolver has provided one. */
  getResolution(proposalId: string): Promise<ResolutionWire | null>;
  /**
   * Publish a SIGNED resolution. Surtur nodes verify the signer is the
   * DAO's resolverSigner and gossip it across the network.
   */
  publishResolution(resolution: ResolutionWire): Promise<void>;
}

const PROPOSALS_KEY = 'surtur:proposals';
const VOTES_KEY = 'surtur:votes';
const RESOLUTIONS_KEY = 'surtur:resolutions';

function readArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

class LocalStorageDaoStore implements DaoStore {
  async listProposals(daoId: string, page: number, pageSize: number): Promise<ProposalPage> {
    await fakeLoadDelay();
    const all = readArray<Proposal>(PROPOSALS_KEY)
      .filter((p) => normalizeDaoId(p.daoId) === daoId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const total = all.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const clamped = Math.min(Math.max(1, page), pageCount);
    const start = (clamped - 1) * pageSize;
    return {
      items: all.slice(start, start + pageSize),
      total,
      page: clamped,
      pageSize,
      pageCount,
    };
  }

  async getProposal(id: string): Promise<Proposal | null> {
    await fakeLoadDelay();
    return readArray<Proposal>(PROPOSALS_KEY).find((p) => p.id === id) ?? null;
  }

  async publishProposal(bundle: ProposalBundle): Promise<Proposal> {
    const p = bundle.proposal;
    const proposal: Proposal = {
      id: p.id,
      daoId: p.daoId,
      title: p.title,
      titleZh: p.titleZh,
      body: p.body,
      bodyZh: p.bodyZh,
      transfers: p.transfers,
      author: p.proposer,
      createdAt: p.createdAt,
      status: 'open',
      startBlock: p.startBlock,
      endBlock: p.endBlock,
    };
    localStorage.setItem(
      PROPOSALS_KEY,
      JSON.stringify([...readArray<Proposal>(PROPOSALS_KEY), proposal]),
    );
    return proposal;
  }

  async listVotes(proposalId: string): Promise<Vote[]> {
    await fakeLoadDelay();
    return readArray<Vote>(VOTES_KEY).filter((v) => v.proposalId === proposalId);
  }

  async updateProposalStatus(
    id: string,
    status: Proposal['status'],
  ): Promise<Proposal | null> {
    const all = readArray<Proposal>(PROPOSALS_KEY);
    const index = all.findIndex((p) => p.id === id);
    if (index < 0) return null;
    const updated = { ...all[index], status };
    all[index] = updated;
    localStorage.setItem(PROPOSALS_KEY, JSON.stringify(all));
    return updated;
  }

  async submitVote(vote: Vote): Promise<Vote> {
    const rest = readArray<Vote>(VOTES_KEY).filter(
      (v) => !(v.proposalId === vote.proposalId && v.address === vote.address),
    );
    localStorage.setItem(VOTES_KEY, JSON.stringify([...rest, vote]));
    return vote;
  }

  async getResolution(proposalId: string): Promise<ResolutionWire | null> {
    await fakeLoadDelay();
    return (
      readArray<ResolutionWire>(RESOLUTIONS_KEY).find((r) => r.proposalId === proposalId) ?? null
    );
  }

  async publishResolution(resolution: ResolutionWire): Promise<void> {
    const all = readArray<ResolutionWire>(RESOLUTIONS_KEY);
    if (all.some((r) => r.proposalId === resolution.proposalId)) return;
    localStorage.setItem(RESOLUTIONS_KEY, JSON.stringify([...all, resolution]));
  }
}

let store: DaoStore | null = null;

/**
 * The app-wide DaoStore. With surtur nodes configured (the default) all
 * reads fan out to every whitelisted node and merge; writes POST the
 * signed bundle to every node. NEXT_PUBLIC_SURTUR_NODES="local" falls back
 * to the offline localStorage store.
 */
export function getDaoStore(): DaoStore {
  if (!store) {
    store =
      SURTUR_NODES.length > 0
        ? new NodeDaoStore(SURTUR_NODES, getDaoDef)
        : new LocalStorageDaoStore();
  }
  return store;
}
