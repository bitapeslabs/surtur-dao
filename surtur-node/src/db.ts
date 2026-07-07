/**
 * Embedded SQLite storage (node:sqlite — ships with Node, no server, no
 * native build). The schema is created on boot (idempotent) — proposals,
 * votes, discovered peers and the DAO configurations gossiped by the
 * orchestrator all live in one database file, so a node keeps working
 * through orchestrator outages.
 *
 * The exported API stays async so a server-backed database could be
 * swapped in without touching the routes.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { OrchestratorDao, ProposalWire, ResolutionWire, VoteWire } from '@surtur/shared';
import { DATABASE_FILE } from './config';

mkdirSync(dirname(DATABASE_FILE), { recursive: true });
const db = new DatabaseSync(DATABASE_FILE);

export async function migrate(): Promise<void> {
  db.exec(`CREATE TABLE IF NOT EXISTS proposals (
    id TEXT PRIMARY KEY,
    dao_id TEXT NOT NULL,
    title TEXT NOT NULL,
    title_zh TEXT,
    body TEXT NOT NULL,
    body_zh TEXT,
    transfers TEXT NOT NULL,
    proposer TEXT NOT NULL,
    start_block INTEGER NOT NULL,
    end_block INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    signature TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open'
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_proposals_dao ON proposals (dao_id)');
  db.exec(`CREATE TABLE IF NOT EXISTS votes (
    proposal_id TEXT NOT NULL,
    address TEXT NOT NULL,
    dao_id TEXT NOT NULL,
    choice TEXT NOT NULL,
    signature TEXT NOT NULL,
    message TEXT NOT NULL,
    voted_at TEXT NOT NULL,
    PRIMARY KEY (proposal_id, address)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS resolutions (
    proposal_id TEXT PRIMARY KEY,
    dao_id TEXT NOT NULL,
    resolution_id TEXT NOT NULL,
    resolution TEXT NOT NULL,
    address TEXT NOT NULL,
    signature TEXT NOT NULL,
    resolved_at TEXT NOT NULL
  )`);
  db.exec('CREATE TABLE IF NOT EXISTS peers (url TEXT PRIMARY KEY)');
  db.exec('CREATE TABLE IF NOT EXISTS daos (id TEXT PRIMARY KEY, config TEXT NOT NULL)');
}

// ---- proposals --------------------------------------------------------

interface ProposalRow {
  id: string;
  dao_id: string;
  title: string;
  title_zh: string | null;
  body: string;
  body_zh: string | null;
  transfers: string;
  proposer: string;
  start_block: number;
  end_block: number;
  created_at: string;
  signature: string;
  status: string;
}

function rowToProposal(row: ProposalRow): {
  proposal: ProposalWire;
  signature: string;
  status: string;
} {
  return {
    proposal: {
      id: row.id,
      daoId: row.dao_id,
      title: row.title,
      titleZh: row.title_zh ?? undefined,
      body: row.body,
      bodyZh: row.body_zh ?? undefined,
      transfers: JSON.parse(row.transfers),
      proposer: row.proposer,
      startBlock: Number(row.start_block),
      endBlock: Number(row.end_block),
      createdAt: row.created_at,
    },
    signature: row.signature,
    status: row.status,
  };
}

export async function getProposal(id: string) {
  const row = db.prepare('SELECT * FROM proposals WHERE id = ?').get(id) as
    | ProposalRow
    | undefined;
  return row ? rowToProposal(row) : null;
}

export async function listProposals(daoId?: string) {
  const rows = (
    daoId
      ? db.prepare('SELECT * FROM proposals WHERE dao_id = ? ORDER BY created_at DESC').all(daoId)
      : db.prepare('SELECT * FROM proposals ORDER BY created_at DESC').all()
  ) as unknown as ProposalRow[];
  return rows.map(rowToProposal);
}

export async function insertProposal(p: ProposalWire, signature: string): Promise<void> {
  db.prepare(
    `INSERT OR IGNORE INTO proposals
      (id, dao_id, title, title_zh, body, body_zh, transfers, proposer,
       start_block, end_block, created_at, signature)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    p.id,
    p.daoId,
    p.title,
    p.titleZh ?? null,
    p.body,
    p.bodyZh ?? null,
    JSON.stringify(p.transfers),
    p.proposer,
    p.startBlock,
    p.endBlock,
    p.createdAt,
    signature,
  );
}

export async function setProposalStatus(id: string, status: string): Promise<void> {
  db.prepare('UPDATE proposals SET status = ? WHERE id = ?').run(status, id);
}

// ---- votes ------------------------------------------------------------

interface VoteRow {
  proposal_id: string;
  address: string;
  dao_id: string;
  choice: string;
  signature: string;
  message: string;
  voted_at: string;
}

function rowToVote(row: VoteRow): VoteWire {
  return {
    proposalId: row.proposal_id,
    daoId: row.dao_id,
    address: row.address,
    choice: row.choice as VoteWire['choice'],
    signature: row.signature,
    message: row.message,
    votedAt: row.voted_at,
  };
}

export async function getVote(proposalId: string, address: string) {
  const row = db
    .prepare('SELECT * FROM votes WHERE proposal_id = ? AND address = ?')
    .get(proposalId, address) as VoteRow | undefined;
  return row ? rowToVote(row) : null;
}

export async function listVotes(proposalId: string): Promise<VoteWire[]> {
  const rows = db
    .prepare('SELECT * FROM votes WHERE proposal_id = ?')
    .all(proposalId) as unknown as VoteRow[];
  return rows.map(rowToVote);
}

export async function insertVote(v: VoteWire): Promise<void> {
  // Votes are final — first accepted signature per (proposal, address) wins.
  db.prepare(
    `INSERT OR IGNORE INTO votes
      (proposal_id, address, dao_id, choice, signature, message, voted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(v.proposalId, v.address, v.daoId, v.choice, v.signature, v.message, v.votedAt);
}

// ---- resolutions ------------------------------------------------------

interface ResolutionRow {
  proposal_id: string;
  dao_id: string;
  resolution_id: string;
  resolution: string;
  address: string;
  signature: string;
  resolved_at: string;
}

function rowToResolution(row: ResolutionRow): ResolutionWire {
  return {
    proposalId: row.proposal_id,
    daoId: row.dao_id,
    resolutionId: row.resolution_id,
    resolution: row.resolution,
    address: row.address,
    signature: row.signature,
    resolvedAt: row.resolved_at,
  };
}

export async function getResolution(proposalId: string): Promise<ResolutionWire | null> {
  const row = db.prepare('SELECT * FROM resolutions WHERE proposal_id = ?').get(proposalId) as
    | ResolutionRow
    | undefined;
  return row ? rowToResolution(row) : null;
}

export async function insertResolution(r: ResolutionWire): Promise<void> {
  // One resolution per proposal — the first accepted one wins.
  db.prepare(
    `INSERT OR IGNORE INTO resolutions
      (proposal_id, dao_id, resolution_id, resolution, address, signature, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(r.proposalId, r.daoId, r.resolutionId, r.resolution, r.address, r.signature, r.resolvedAt);
}

// ---- peers + daos (orchestrator gossip, cached locally) ---------------

export async function replacePeers(urls: string[]): Promise<void> {
  const insert = db.prepare('INSERT OR IGNORE INTO peers (url) VALUES (?)');
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM peers');
    for (const url of urls) insert.run(url);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export async function listPeers(): Promise<string[]> {
  const rows = db.prepare('SELECT url FROM peers').all() as unknown as Array<{ url: string }>;
  return rows.map((r) => r.url);
}

export async function upsertDao(dao: OrchestratorDao): Promise<void> {
  db.prepare(
    'INSERT INTO daos (id, config) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET config = excluded.config',
  ).run(dao.id, JSON.stringify(dao));
}

export async function getDao(id: string): Promise<OrchestratorDao | null> {
  const row = db.prepare('SELECT config FROM daos WHERE id = ?').get(id) as
    | { config: string }
    | undefined;
  return row ? JSON.parse(row.config) : null;
}
