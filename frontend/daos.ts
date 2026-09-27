/**
 * DAO registry — Surtur is DAO-agnostic. Every governance space is defined
 * here; pages, voting math, thresholds and token display all derive from
 * these definitions. Add a DAO by appending to DAOS.
 */

import type { NonCirculating, ThresholdSchedule } from '@surtur/shared';

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
    // NO reserves for now (the operator: "there should be no reserves … set
    // this to 0"): no treasury address, so nothing shows as Reserves and a
    // proposal cannot transfer anything. The resolver is the team wallet.
    treasuryToken: { alkaneId: '4:8888', symbol: 'SLICE' },
    treasuryAddress: '',
    // SLICE (pizza-data 4:47's `slice`), the voting token.
    votingToken: { alkaneId: '4:8888', symbol: 'SLICE' },
    resolverSigner: 'bc1pz860hkyek9584tx5l84pyax5puu7crerspaksz0jen2svww3ce2smzyjer',
    proposalThreshold: [{ height: 0, pctg: 0.5 }],
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
  },
];

export function getDao(id: string | undefined | null): DaoDefinition | null {
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
