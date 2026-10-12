/**
 * Global Surtur constants. DAO-specific values (tokens, thresholds, espo
 * network, admin signer) live in daos.ts — one entry per DAO.
 */

/**
 * get_holders page size — one oversized call fetches every holder of a
 * DAO's voting token (fine at current holder counts; paginate when that
 * stops being true).
 */
export const HOLDERS_FETCH_LIMIT = 1_000_000;

/**
 * Artificial delay (ms) added to data loads so skeleton loaders are
 * visible during development. Set to 0 to disable (MUST be 0 in prod).
 */
export const FAKE_DELAY_LOAD = 0;

/**
 * DAOs HIDDEN from the site (the operator, 2026 10 11: "hide the Alkanes foundation and not
 * allow navigation to it … we aren't deleting it, we are hiding it"): not listed, not linked, and
 * every `/proposals/<id>` and `/delegations/<id>` page of theirs answers not found (`getDao` is
 * null for them). The definition stays in `daos.ts`; the orchestrator still hands it to the nodes,
 * so what they already hold keeps validating. Remove an id here to show it again.
 */
export const HIDE_DAO: readonly string[] = ['alkanes'];
