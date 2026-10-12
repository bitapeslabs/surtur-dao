/**
 * DAO registry — Surtur is DAO-agnostic. Every governance space is defined
 * here; pages, voting math, thresholds and token display all derive from
 * these definitions. Add a DAO by appending to DAOS.
 */

import type { NonCirculating, ThresholdSchedule, VaultPositions } from '@surtur/shared';
import { HIDE_DAO } from '@/consts';

export interface DaoToken {
  /** Alkane id, "block:tx". */
  alkaneId: string;
  symbol: string;
}

export interface DaoDefinition {
  /** URL slug ("/proposals/<id>") and the id stored on proposals. */
  id: string;
  /** Display name. */
  name: string;
  /** Short blurb shown on the DAO list and the DAO's proposals page. */
  description?: string;
  /** Chinese description (falls back to `description` in zh locale). */
  descriptionZh?: string;
  /** Icon shown on the DAO list (falls back to a letter tile). */
  iconUrl?: string;
  /**
   * Disabled DAOs are listed but not clickable, and no proposals can be
   * created for them. NOTE: this is client-side only for now — once the
   * backend replaces the localStorage store, it MUST also reject proposal
   * and vote writes for disabled DAOs (client checks are bypassable).
   */
  enabled: boolean;
  /** Token the DAO treasury holds — proposals transfer this token. */
  treasuryToken: DaoToken;
  /**
   * Address holding the DAO's reserves. Its treasuryToken balance is shown
   * as "Reserves" and caps the cumulative transfers of a proposal.
   */
  treasuryAddress: string;
  /** Token whose holders vote; power = balance at the proposal end block. */
  votingToken: DaoToken;
  /**
   * The DAO's resolver: the ONLY address allowed to resolve a passed
   * proposal (write up how it was executed and sign it). Enforced by
   * surtur nodes; the frontend shows the Resolve button to this address.
   */
  resolverSigner: string;
  /**
   * Fork-height schedule for the share of circulating voting token a
   * wallet must hold to create a proposal — resolved at the proposal's
   * START block, so later threshold changes never re-judge older
   * proposals. Enforced by surtur nodes AND re-checked client-side.
   */
  proposalThreshold: ThresholdSchedule;
  /**
   * Fork-height schedule for the share of circulating voting token that
   * must vote "for" for a proposal to pass — resolved at the proposal's
   * END block (where the verdict is computed), so finalized verdicts are
   * immune to later threshold changes.
   */
  votePassThreshold: ThresholdSchedule;
  /**
   * Fork-height schedule for the share of circulating voting token an
   * address must hold to CREATE a delegator — resolved at the
   * delegation's creation block. Enforced by surtur nodes AND re-checked
   * client-side.
   */
  delegatorThreshold: ThresholdSchedule;
  /** Network whose Espo instance serves this DAO's token data. */
  espoNetwork: string;
  /**
   * Holders of the voting token that are NOT circulating: their balances
   * come off the supply every threshold is measured against, and such an
   * ADDRESS has no governance power. Enforced by surtur nodes AND
   * re-checked client-side (shared `circulating.ts`).
   */
  nonCirculating?: NonCirculating;
  /**
   * UNCLAIMED SLICE COUNTS (2026 10 11): the vaults whose positions earn the voting token hold
   * it until it is claimed, and the DAO excludes the vaults from circulation — so a position's
   * unclaimed emission counts for its HOLDER's power and joins the circulating supply, read from
   * the vaults' own records at the same height (shared `vaultPower.ts`). Enforced by surtur
   * nodes AND re-checked client-side.
   */
  vaultPositions?: VaultPositions;
}

export const DAOS: DaoDefinition[] = [
  {
    id: 'alkanes',
    name: 'Alkanes Foundation',
    description:
      'Governs Alkanes upgrades and available DIESEL reserves for ecosystem incentives - FIRE holders vote on the future of Alkanes.',
    descriptionZh:
      '管理 Alkanes 升级与用于生态激励的可用 DIESEL 储备 - 由 FIRE 持有者决定 Alkanes 的未来。',
    iconUrl: 'https://cdn.subfrost.io/alkanes/2_0',
    enabled: true,
    treasuryToken: { alkaneId: '2:0', symbol: 'DIESEL' },
    // TODO: replace with the real Fire DAO treasury (placeholder: the top
    // DIESEL holder, so the reserves display has live data while testing).
    treasuryAddress: 'bc1phqvgwn7wn5e4s8g0999rtgafd07jpuuy59rkdrk4s5thw9jafkasg8umr8',
    votingToken: { alkaneId: '2:77623', symbol: 'FIRE' },
    // Test resolver — the dev wallet used while testing the flow.
    resolverSigner: 'bc1psn0925c2p5mjnvkg0xkntpd26wtcyktmwt3shuw7ue04yed5sjfs7xwmj4',
    proposalThreshold: [{ height: 0, pctg: 0.5 }],
    // 40% before the test fork, 0.05% after — deliberately tiny so the
    // passed-proposal → resolution flow is testable with a small wallet.
    votePassThreshold: [
      { height: 0, pctg: 40 },
    ],
    delegatorThreshold: [{ height: 0, pctg: 0.5 }],
    espoNetwork: 'mainnet',
  },
  {
    id: 'pizza',
    name: 'Pizza.fun Foundation',
    description: "Governs pizza.fun's reserves — SLICE holders vote.",
    descriptionZh: '管理 pizza.fun 的储备 — 由 SLICE 持有者投票。',
    // the SLICE token's icon (pizza.fun's), also what TokenIcon shows for 4:8888
    iconUrl: '/tokens/slice.png',
    enabled: true,
    // The reserves address (the operator's; an empty address left the Reserves
    // tile loading forever). Its SLICE balance shows as Reserves and caps what a
    // proposal may transfer. The resolver is the team wallet.
    treasuryToken: { alkaneId: '4:8888', symbol: 'SLICE' },
    treasuryAddress: 'bc1p5slv4trnh68a8y9zcuxvgdz6l599swhgfux27r08lp4cap6qduxspgr636',
    // SLICE (pizza-data 4:47's `slice`), the voting token.
    votingToken: { alkaneId: '4:8888', symbol: 'SLICE' },
    resolverSigner: 'bc1pz860hkyek9584tx5l84pyax5puu7crerspaksz0jen2svww3ce2smzyjer',
    // 1.2% of circulating SLICE to create a proposal (the operator, 2026-09-26)
    // 1.2% at launch; 0.5% from block 971,040 (2026 10 11, the operator: "lower it to 0.5%") — a
    // fork entry, so proposals opened before it keep the bar they were judged against
    proposalThreshold: [
      { height: 0, pctg: 1.2 },
      { height: 971_040, pctg: 0.5 },
    ],
    votePassThreshold: [{ height: 0, pctg: 40 }],
    delegatorThreshold: [{ height: 0, pctg: 0.5 }],
    espoNetwork: 'mainnet',
    // Every SLICE counts as circulating EXCEPT what sits in pizza.fun's own
    // contracts — the treasury (4:53), the admin contract (4:54), the TORTILLA
    // vault (4:55), the wTACO vault (4:56) — and the team wallet.
    nonCirculating: {
      alkanes: ['4:53', '4:54', '4:55', '4:56'],
      addresses: ['bc1pz860hkyek9584tx5l84pyax5puu7crerspaksz0jen2svww3ce2smzyjer'],
    },
    // the TORTILLA vault 4:55 and the wTACO vault 4:56; every position is a clone of the token
    // template 4:45. From block 971,000 (2026 10 11): what was judged before keeps its verdict.
    vaultPositions: { vaults: ['4:55', '4:56'], tokenFactory: '4:45', fromHeight: 971_000 },
  },
];

/** Every DAO the site SHOWS: the registry less `HIDE_DAO` (hidden, never deleted). */
export const VISIBLE_DAOS: DaoDefinition[] = DAOS.filter((d) => !HIDE_DAO.includes(d.id));

/** A DAO by id — null for an unknown id AND for a hidden one, so no page or route reaches it. */
export function getDao(id: string | undefined | null): DaoDefinition | null {
  if (!id || HIDE_DAO.includes(id)) return null;
  return DAOS.find((d) => d.id === id) ?? null;
}

/** Proposals created before multi-DAO support carry no daoId. */
export const LEGACY_DAO_ID = 'alkanes';

/** Old DAO ids that were renamed — normalized wherever daoId is read. */
const DAO_ID_ALIASES: Record<string, string> = {
  fire: 'alkanes',
  frost: 'pizza',
};

export function normalizeDaoId(id: string | undefined | null): string {
  if (!id) return LEGACY_DAO_ID;
  return DAO_ID_ALIASES[id] ?? id;
}
