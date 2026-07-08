/**
 * DAO registry — Surtur is DAO-agnostic. Every governance space is defined
 * here; pages, voting math, thresholds and token display all derive from
 * these definitions. Add a DAO by appending to DAOS.
 */

import type { ThresholdSchedule } from '@surtur/shared';

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
  /** Network whose Espo instance serves this DAO's token data. */
  espoNetwork: string;
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
    // 0.5% from genesis — DELIBERATELY retroactive: proposals whose
    // proposer held less at their start block are invalid everywhere
    // (the FE prunes them and nodes reject new ones).
    proposalThreshold: [{ height: 0, pctg: 0.5 }],
    // 40% before the test fork, 0.05% after — deliberately tiny so the
    // passed-proposal → resolution flow is testable with a small wallet.
    votePassThreshold: [
      { height: 0, pctg: 40 },
    ],
    espoNetwork: 'mainnet',
  },
  {
    // Example disabled DAO — listed on /proposals but greyed out and not
    // enterable; kept here to exercise the disabled state.
    id: 'pizza',
    name: 'Pizza.fun Foundation',
    description: "Governs pizza.fun's CHEESE and FIRE reserves",
    descriptionZh: '管理 pizza.fun 的 CHEESE 和 FIRE 储备',
    iconUrl: 'https://app.subfrost.io/tokens/cheese-logo.png',
    enabled: false,
    treasuryToken: { alkaneId: '32:0', symbol: 'frBTC' },
    treasuryAddress: '',
    votingToken: { alkaneId: '32:0', symbol: 'frBTC' },
    resolverSigner: '',
    proposalThreshold: [
      { height: 0, pctg: 0 },
      { height: 957018, pctg: 0.5 },
    ],
    votePassThreshold: [{ height: 0, pctg: 40 }],
    espoNetwork: 'mainnet',
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
