/**
 * Surtur domain types. Amounts are treasury-token display units, kept as
 * decimal strings so precision survives serialization (converted to base
 * units only at execution time, which is out of scope for the skeleton).
 */

/** A single treasury-token transfer a proposal asks the DAO to execute. */
export interface Transfer {
  /** Recipient Bitcoin/alkane address. */
  address: string;
  /** Amount in display units, as a decimal string (e.g. "12.5"). */
  amount: string;
}

export type ProposalStatus = 'open' | 'passed' | 'rejected' | 'executed';

export interface Proposal {
  id: string;
  /** DAO this proposal belongs to (daos.ts id; legacy records omit it). */
  daoId?: string;
  title: string;
  /** Optional Chinese title — rendered instead of `title` in zh locale. */
  titleZh?: string;
  /** Proposal body, markdown. */
  body: string;
  /** Optional Chinese body — rendered instead of `body` in zh locale. */
  bodyZh?: string;
  transfers: Transfer[];
  /** Address of the wallet that created the proposal. */
  author: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
  status: ProposalStatus;
  /** Block height voting opens at. */
  startBlock: number;
  /** Block height voting closes at (exclusive — last voting block is endBlock - 1). */
  endBlock: number;
}

export interface CreateProposalInput {
  daoId: string;
  title: string;
  titleZh?: string;
  body: string;
  bodyZh?: string;
  transfers: Transfer[];
  author: string;
  startBlock: number;
  endBlock: number;
}

export interface ProposalPage {
  items: Proposal[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export type VoteChoice = 'for' | 'against' | 'abstain';

/**
 * A cast vote. Non-voters implicitly count as abstain in the tally — these
 * records only exist for wallets that explicitly voted (and signed).
 */
export interface Vote {
  proposalId: string;
  /** DAO the proposal belongs to (part of the signed vote message). */
  daoId?: string;
  /** Address of the voting wallet (as returned by the signing popup). */
  address: string;
  choice: VoteChoice;
  /**
   * Base64 signature over `message` from the SUBFROST keystore — raw ECDSA
   * over sha256(message), verified against `publicKey` (not BIP-137/322).
   */
  signature: string;
  /** Compressed public key hex of the voting account. */
  publicKey: string;
  /** The exact message that was signed (see buildVoteMessage). */
  message: string;
  /** ISO 8601 timestamp. */
  votedAt: string;
}
