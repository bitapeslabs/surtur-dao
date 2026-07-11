/**
 * HTTP surface. Validation on every POST (never trust the sender, client
 * or peer alike):
 *   proposals — shared zod shape, id = sha256(content), BIP-322 proposer
 *   signature, known+enabled DAO, transfer addresses valid for the DAO's
 *   network, proposer meets the DAO's threshold at the start block (espo
 *   versioned RPC).
 *   votes — shared zod shape, canonical message, BIP-322 voter signature,
 *   proposal known, voter holds any amount of the voting token.
 * Accepted records are relayed to all known peers; already-known records
 * are acknowledged (`known: true`) and NOT re-relayed.
 */

import { Router, type Request, type Response } from 'express';
import {
  delegationActionSchema,
  delegatorBundleSchema,
  isValidAddress,
  proposalBundleSchema,
  resolutionWireSchema,
  verifyDelegationAction,
  verifyDelegatorBundle,
  verifyProposalBundle,
  verifyResolutionWire,
  verifyVoteWire,
  voteWireSchema,
  type DelegationActionWire,
  type DelegatorBundle,
  type ProposalBundle,
  type ResolutionWire,
  type VoteWire,
} from '@surtur/shared';
import * as db from './db';
import {
  computeVerdict,
  delegatorMeetsThreshold,
  fetchEspoTip,
  proposerMeetsThreshold,
  voterHoldsToken,
} from './espo';
import { relayToPeers } from './relay';

export const router = Router();

router.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'surtur-node' });
});

/**
 * Surtur-specific ping — the frontend's Nodes page measures round-trip
 * latency against this (the `pong: 'surtur'` marker distinguishes a real
 * surtur node from any random HTTP server on the whitelist).
 */
router.get('/surtur/ping', (_req, res) => {
  res.json({ ok: true, pong: 'surtur', ts: Date.now() });
});

// ---- proposals --------------------------------------------------------

router.get('/proposals', async (req: Request, res: Response) => {
  try {
    const daoId = typeof req.query.dao === 'string' ? req.query.dao : undefined;
    const rows = await db.listProposals(daoId);
    await refreshVerdicts(rows);
    // METADATA ONLY: the list drops body/bodyZh (potentially megabytes of
    // base64 images) and the signature — the full bundle, verifiable
    // end-to-end, is served by GET /proposals/:id.
    const proposals = rows.map(({ proposal, status }) => {
      const { body: _body, bodyZh: _bodyZh, ...meta } = proposal;
      return { proposal: meta, status };
    });
    res.json({ ok: true, proposals });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

router.get('/proposals/:id', async (req: Request, res: Response) => {
  try {
    const row = await db.getProposal(req.params.id);
    if (!row) {
      res.status(404).json({ ok: false, error: 'not found' });
      return;
    }
    await refreshVerdicts([row]);
    res.json({ ok: true, ...row });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

router.post('/proposals', async (req: Request, res: Response) => {
  try {
    const parsed = proposalBundleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' });
      return;
    }
    const bundle = parsed.data as ProposalBundle;
    const { proposal } = bundle;

    // Dedup FIRST — a known record ends the gossip here.
    if (await db.getProposal(proposal.id)) {
      res.json({ ok: true, known: true });
      return;
    }

    const dao = await db.getDao(proposal.daoId);
    if (!dao) {
      res.status(400).json({ ok: false, error: `unknown dao: ${proposal.daoId}` });
      return;
    }
    // Disabled DAOs accept no proposals — enforced here, not just in the UI.
    if (!dao.enabled) {
      res.status(403).json({ ok: false, error: `dao is disabled: ${proposal.daoId}` });
      return;
    }
    for (const t of proposal.transfers) {
      if (!isValidAddress(t.address, dao.espoNetwork)) {
        res.status(400).json({ ok: false, error: `invalid transfer address: ${t.address}` });
        return;
      }
    }
    if (!isValidAddress(proposal.proposer, dao.espoNetwork)) {
      res.status(400).json({ ok: false, error: 'invalid proposer address' });
      return;
    }

    const integrity = verifyProposalBundle(bundle);
    if (!integrity.ok) {
      res.status(400).json({ ok: false, error: integrity.error });
      return;
    }

    if (!(await proposerMeetsThreshold(dao, proposal.proposer, proposal.startBlock))) {
      res.status(403).json({ ok: false, error: 'proposer below proposal threshold' });
      return;
    }

    await db.insertProposal(proposal, bundle.signature);
    res.json({ ok: true });
    void relayToPeers('/proposals', bundle);
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// ---- votes ------------------------------------------------------------

router.get('/votes', async (req: Request, res: Response) => {
  try {
    const proposalId = typeof req.query.proposal === 'string' ? req.query.proposal : '';
    if (!proposalId) {
      res.status(400).json({ ok: false, error: 'proposal query param required' });
      return;
    }
    res.json({ ok: true, votes: await db.listVotes(proposalId) });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

router.post('/votes', async (req: Request, res: Response) => {
  try {
    const parsed = voteWireSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' });
      return;
    }
    const vote = parsed.data as VoteWire;

    // Identical wire → pure duplicate: acknowledge and stop the gossip.
    const existing = await db.getVote(vote.proposalId, vote.address);
    if (existing && existing.signature === vote.signature) {
      res.json({ ok: true, known: true });
      return;
    }

    const stored = await db.getProposal(vote.proposalId);
    if (!stored) {
      res.status(400).json({ ok: false, error: 'unknown proposal' });
      return;
    }
    const dao = await db.getDao(vote.daoId);
    if (!dao || stored.proposal.daoId !== vote.daoId) {
      res.status(400).json({ ok: false, error: 'dao mismatch' });
      return;
    }

    const integrity = verifyVoteWire(vote, stored.proposal.title);
    if (!integrity.ok) {
      res.status(400).json({ ok: false, error: integrity.error });
      return;
    }

    if (!(await voterHoldsToken(dao, vote.address))) {
      res.status(403).json({ ok: false, error: 'voter holds no voting token' });
      return;
    }

    // Lexicographic consensus rule: an address racing two DIFFERENT valid
    // votes to different nodes must not leave the network split on which
    // one counts. Every node keeps the vote with the lexicographically
    // SMALLEST signature — deterministic regardless of arrival order, so
    // all nodes converge. Replacements re-relay the winner; the signature
    // strictly decreases on every replace, so gossip terminates (identical
    // wires hit the known:true short-circuit above).
    if (existing) {
      if (vote.signature < existing.signature) {
        await db.replaceVote(vote);
        res.json({ ok: true });
        void relayToPeers('/votes', vote);
      } else {
        // Ours wins — acknowledge; the sender converges via our relay.
        res.json({ ok: true, known: true });
      }
      return;
    }

    await db.insertVote(vote);
    res.json({ ok: true });
    void relayToPeers('/votes', vote);
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// ---- delegators -------------------------------------------------------

/** Anti-backdating allowance for creation blocks and action nonces. */
const HEIGHT_ALLOWANCE = 5;

/** Metadata list (descriptions stripped — GET /delegators/:id has them). */
router.get('/delegators', async (req: Request, res: Response) => {
  try {
    const daoId = typeof req.query.dao === 'string' ? req.query.dao : undefined;
    const bundles = await db.listDelegators(daoId);
    const delegators = bundles.map(({ delegator, signature }) => {
      const { description: _d, descriptionZh: _dz, ...meta } = delegator;
      return { delegator: meta, signature };
    });
    res.json({ ok: true, delegators });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

router.get('/delegators/:id', async (req: Request, res: Response) => {
  try {
    const bundle = await db.getDelegator(req.params.id);
    if (!bundle) {
      res.status(404).json({ ok: false, error: 'not found' });
      return;
    }
    res.json({ ok: true, ...bundle });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

router.post('/delegators', async (req: Request, res: Response) => {
  try {
    const parsed = delegatorBundleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' });
      return;
    }
    const bundle = parsed.data as DelegatorBundle;

    if (await db.getDelegator(bundle.delegator.id)) {
      res.json({ ok: true, known: true });
      return;
    }

    const dao = await db.getDao(bundle.delegator.daoId);
    if (!dao || dao.enabled === false) {
      res.status(400).json({ ok: false, error: 'unknown or disabled dao' });
      return;
    }
    if (!isValidAddress(bundle.delegator.delegator, dao.espoNetwork)) {
      res.status(400).json({ ok: false, error: 'invalid delegator address' });
      return;
    }

    const integrity = verifyDelegatorBundle(bundle);
    if (!integrity.ok) {
      res.status(400).json({ ok: false, error: integrity.error });
      return;
    }

    // Creation block must be ~the live tip (anti-backdating into a
    // cheaper threshold era or a moment the creator was richer).
    const tip = await fetchEspoTip(dao.espoUrl);
    if (Math.abs(bundle.delegator.createdAtBlock - tip) > HEIGHT_ALLOWANCE) {
      res.status(400).json({
        ok: false,
        error: `createdAtBlock ${bundle.delegator.createdAtBlock} outside tip±${HEIGHT_ALLOWANCE} (tip ${tip})`,
      });
      return;
    }

    if (!(await delegatorMeetsThreshold(dao, bundle.delegator.delegator, bundle.delegator.createdAtBlock))) {
      res.status(403).json({ ok: false, error: 'creator below delegator threshold at creation block' });
      return;
    }

    await db.insertDelegator(bundle);
    res.json({ ok: true });
    void relayToPeers('/delegators', bundle);
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// ---- delegation actions -------------------------------------------------

/**
 * GET /delegations?dao=<id>[&addresses=a,b,c] — ALL join/leave actions
 * (full history: clients resolve effective state at any height). The
 * optional address filter serves the votes-tally path.
 */
router.get('/delegations', async (req: Request, res: Response) => {
  try {
    const daoId = typeof req.query.dao === 'string' ? req.query.dao : '';
    if (!daoId) {
      res.status(400).json({ ok: false, error: 'dao query param required' });
      return;
    }
    const addresses =
      typeof req.query.addresses === 'string' && req.query.addresses.length > 0
        ? req.query.addresses.split(',').map((a) => a.trim()).filter(Boolean)
        : undefined;
    res.json({ ok: true, actions: await db.listDelegationActions(daoId, addresses) });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

router.post('/delegations', async (req: Request, res: Response) => {
  try {
    const parsed = delegationActionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' });
      return;
    }
    const action = parsed.data as DelegationActionWire;

    if (await db.hasDelegationAction(action)) {
      res.json({ ok: true, known: true });
      return;
    }

    const delegatorBundle = await db.getDelegator(action.delegatorId);
    if (!delegatorBundle || delegatorBundle.delegator.daoId !== action.daoId) {
      res.status(400).json({ ok: false, error: 'unknown delegator' });
      return;
    }
    const dao = await db.getDao(action.daoId);
    if (!dao) {
      res.status(400).json({ ok: false, error: 'unknown dao' });
      return;
    }
    if (!isValidAddress(action.address, dao.espoNetwork)) {
      res.status(400).json({ ok: false, error: 'invalid member address' });
      return;
    }

    const integrity = verifyDelegationAction(action);
    if (!integrity.ok) {
      res.status(400).json({ ok: false, error: integrity.error });
      return;
    }

    // The nonce height must be ~the live tip — so effective-state
    // history can't be rewritten by backdated joins/leaves.
    const tip = await fetchEspoTip(dao.espoUrl);
    if (Math.abs(action.height - tip) > HEIGHT_ALLOWANCE) {
      res.status(400).json({
        ok: false,
        error: `nonce height ${action.height} outside tip±${HEIGHT_ALLOWANCE} (tip ${tip})`,
      });
      return;
    }

    await db.insertDelegationAction(action);
    res.json({ ok: true });
    void relayToPeers('/delegations', action);
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// ---- vote counts ------------------------------------------------------

/**
 * GET /votes/counts?dao=<daoId> → { ok, counts: { [proposalId]: n } }.
 * One aggregate for the whole DAO — the proposals list shows per-row
 * totals without fetching every proposal's full vote set. Clients fan
 * out to all whitelisted nodes and keep the HIGHEST count per proposal.
 */
router.get('/votes/counts', async (req: Request, res: Response) => {
  try {
    const daoId = typeof req.query.dao === 'string' ? req.query.dao : '';
    if (!daoId) {
      res.status(400).json({ ok: false, error: 'dao query param required' });
      return;
    }
    res.json({ ok: true, counts: await db.getVoteCountsByDao(daoId) });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// ---- resolutions ------------------------------------------------------

router.get('/resolutions', async (req: Request, res: Response) => {
  try {
    const proposalId = typeof req.query.proposal === 'string' ? req.query.proposal : '';
    if (!proposalId) {
      res.status(400).json({ ok: false, error: 'proposal query param required' });
      return;
    }
    res.json({ ok: true, resolution: await db.getResolution(proposalId) });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

router.post('/resolutions', async (req: Request, res: Response) => {
  try {
    const parsed = resolutionWireSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' });
      return;
    }
    const resolution = parsed.data as ResolutionWire;

    if (await db.getResolution(resolution.proposalId)) {
      res.json({ ok: true, known: true });
      return;
    }

    const stored = await db.getProposal(resolution.proposalId);
    if (!stored) {
      res.status(400).json({ ok: false, error: 'unknown proposal' });
      return;
    }
    const dao = await db.getDao(resolution.daoId);
    if (!dao || stored.proposal.daoId !== resolution.daoId) {
      res.status(400).json({ ok: false, error: 'dao mismatch' });
      return;
    }

    // The proposal must actually have PASSED (compute the verdict now if
    // the end block went by without a read).
    await refreshVerdicts([stored]);
    if (stored.status !== 'passed') {
      res.status(403).json({ ok: false, error: `proposal is not passed (${stored.status})` });
      return;
    }

    // ONLY the DAO's resolver may resolve — this is the node-side check
    // the frontend deliberately relies on.
    if (!dao.resolverSigner || resolution.address !== dao.resolverSigner) {
      res.status(403).json({ ok: false, error: 'signer is not the dao resolver' });
      return;
    }

    const integrity = verifyResolutionWire(resolution);
    if (!integrity.ok) {
      res.status(400).json({ ok: false, error: integrity.error });
      return;
    }

    await db.insertResolution(resolution);
    res.json({ ok: true });
    void relayToPeers('/resolutions', resolution);
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// ---- lazy verdicts ----------------------------------------------------

const verdictInFlight = new Set<string>();

/**
 * Open proposals whose end block has passed get their verdict computed
 * from this node's stored votes + espo pinned at the end block, then
 * persisted (immutable past-block data → computed once).
 */
async function refreshVerdicts(
  rows: Array<{ proposal: { id: string; daoId: string; endBlock: number }; status: string }>,
): Promise<void> {
  const open = rows.filter((r) => r.status === 'open');
  if (open.length === 0) return;

  const daoIds = [...new Set(open.map((r) => r.proposal.daoId))];
  for (const daoId of daoIds) {
    const dao = await db.getDao(daoId);
    if (!dao) continue;
    let tip: number;
    try {
      tip = await fetchEspoTip(dao.espoUrl);
    } catch {
      continue;
    }
    for (const row of open) {
      if (row.proposal.daoId !== daoId) continue;
      if (row.proposal.endBlock > tip) continue;
      if (verdictInFlight.has(row.proposal.id)) continue;
      verdictInFlight.add(row.proposal.id);
      try {
        const votes = await db.listVotes(row.proposal.id);
        const actions = await db.listDelegationActions(row.proposal.daoId);
        const delegators = await db.listDelegators(row.proposal.daoId);
        const delegatorsBySigner = new Map(
          delegators.map((b) => [b.delegator.delegator, b.delegator.id]),
        );
        const verdict = await computeVerdict(
          dao,
          row.proposal.endBlock,
          votes,
          actions,
          delegatorsBySigner,
        );
        await db.setProposalStatus(row.proposal.id, verdict);
        row.status = verdict;
      } catch (e) {
        console.warn(`[verdict] ${row.proposal.id}: ${(e as Error).message}`);
      } finally {
        verdictInFlight.delete(row.proposal.id);
      }
    }
  }
}
