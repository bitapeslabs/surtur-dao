/**
 * UNCLAIMED SLICE COUNTS (2026 10 11; the operator: "if someone has 100 unclaimed slice in a
 * position, that 100 slice counts towards total circulating on surtur and also towards that
 * address's voting power, so they don't need to claim from their positions to vote").
 *
 * The pizza.fun vaults hold the SLICE they emit until a position claims it, and the DAO keeps
 * the vaults out of circulation — so what a staker had earned but not claimed counted for
 * nothing, and claiming (which resets the proposed HODL boost) was the only way to vote with it.
 * This module reads the vault's OWN RECORDS through espo at a pinned height and computes exactly
 * what cheese-vault's `getPendingRewards` view answers there (apps/contracts/cheese-vault
 * storage.rs `accrual_state` / `vested` / `claimable`):
 *
 *   acc(h)    = /acc_slice + emission × (min(h, farm_end) − /last_accrual) × 1e18 ÷ /total_weight
 *               (only while last_accrual > 0 and total_weight > 0; a MIGRATED vault reads against
 *               the accumulator at the farm's end instead)
 *   vested    = banked_slice + eff_weight × acc ÷ 1e18 − reward_debt
 *   claimable = vested − claimed_slice
 *
 * Positions are supply-1 clones of the deployment's token template, so
 * `essentials.get_orbital_holders { factory }` is "who holds which position" in one indexed read
 * (it lists every clone — member tokens, keys — the vault's record tells positions apart), and
 * `essentials.get_keys { alkane: vault, keys: ["/pos/<id>"…] }` is the vault's record of each.
 * Both take `height`. espo's `get_keys` answers a PAGE whatever the number of keys named, so every
 * page is read and a short answer is refused rather than counted.
 *
 * Nothing here is cached: the node computes once per verdict, the frontend keys it by the tip.
 */
import type { EspoBatchRequest } from './circulating';
import type { NonCirculating } from './types';

/** The vaults whose unclaimed emission counts, and the token template their positions are cloned from. */
export interface VaultPositions {
  /** The vault contracts (the pizza.fun TORTILLA and wTACO vaults), "block:tx". */
  vaults: string[];
  /** The token template every position token is cloned from (pizza-data `token_factory`). */
  tokenFactory: string;
  /**
   * The FORK HEIGHT the rule applies from (0 or absent = always): a read pinned BELOW it answers
   * zero, so proposals and delegators judged at earlier blocks keep the verdicts they had — the
   * same reason the thresholds are fork-height schedules. A live read is always past it.
   */
  fromHeight?: number;
}

export interface VaultDao {
  vaultPositions?: VaultPositions;
  /** an address the DAO keeps out of circulation has no power: its positions' unclaimed SLICE counts for nothing */
  nonCirculating?: NonCirculating;
}

/** One JSON-RPC batch POST to espo: results keyed by request id (an envelope's `result`). */
export type EspoBatch = (requests: EspoBatchRequest[]) => Promise<Map<string, any>>;

export interface VaultUnclaimed {
  /** Every position's claimable SLICE added up (base units): what joins the circulating supply. */
  total: bigint;
  /** Per holding address: the claimable SLICE of the positions it holds. */
  byAddress: Map<string, bigint>;
  /** The height the figures are as of. */
  height: number;
}

const NONE: VaultUnclaimed = { total: 0n, byAddress: new Map(), height: 0 };

/** keys per get_keys request, and per page (asked explicitly; espo honours it) */
const KEY_CHUNK = 500;
const HOLDERS_LIMIT = 100_000;
const ACC_SCALE = 1_000_000_000_000_000_000n;

/** SchemaPosition (borsh): tier u8, lp / base_weight / fire_paid u128, member (u32 + u64), eff_weight, reward_debt, banked_slice, claimed_slice u128 */
const POS_EFF_WEIGHT = 1 + 16 + 16 + 16 + 12;
const POS_REWARD_DEBT = POS_EFF_WEIGHT + 16;
const POS_BANKED = POS_REWARD_DEBT + 16;
const POS_CLAIMED = POS_BANKED + 16;
const POS_LEN = POS_CLAIMED + 16;

const GLOBAL_KEYS = ['/consts', '/acc_slice', '/last_accrual', '/total_weight', '/farm_start', '/migrated'];

const hexBytes = (hex: string): Uint8Array => {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
};
const leAt = (b: Uint8Array, offset: number, len: number): bigint => {
  let v = 0n;
  for (let i = len - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[offset + i] ?? 0);
  return v;
};
/** a whole little-endian value, whatever its width (espo gives u64s and u128s as hex) */
const leAll = (hex: string | undefined): bigint => (hex ? leAt(hexBytes(hex), 0, hexBytes(hex).length) : 0n);

/** The vault's storage key of a position: "/pos/" + borsh(AlkaneId { block: u32, tx: u64 }), as hex. */
export const positionKeyHex = (id: string): string => {
  const [block, tx] = id.split(':');
  const bytes = new Uint8Array(5 + 12);
  bytes.set([0x2f, 0x70, 0x6f, 0x73, 0x2f], 0); // "/pos/"
  const view = new DataView(bytes.buffer);
  view.setUint32(5, Number(block), true);
  view.setBigUint64(9, BigInt(tx), true);
  return '0x' + Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join('');
};

export interface VaultGlobals {
  acc: bigint;
  lastAccrual: bigint;
  totalWeight: bigint;
  farmStart: bigint;
  farmBlocks: bigint;
  slicePot: bigint;
  migrated: boolean;
}

/** SchemaVaultInit as Initialize stored it: data id, stake_token_key, stake_is_lp, in_program, boost, fire_price_p, tiers, vault_name, slice_pot, farm_blocks … */
function parseConsts(hex: string): { slicePot: bigint; farmBlocks: bigint } {
  const b = hexBytes(hex);
  let at = 12; // the pizza-data id
  const str = () => {
    const len = Number(leAt(b, at, 4));
    at += 4 + len;
  };
  str(); // stake_token_key
  at += 3; // stake_is_lp, in_program, boost
  at += 16; // fire_price_p
  const tiers = Number(leAt(b, at, 4));
  at += 4 + tiers * (16 + 8 + 1);
  str(); // vault_name
  const slicePot = leAt(b, at, 16);
  at += 16;
  const farmBlocks = leAt(b, at, 8);
  return { slicePot, farmBlocks };
}

export function parseVaultGlobals(items: Record<string, { key_str?: string; key_hex?: string; value_hex?: string }>): VaultGlobals | null {
  const byKey = new Map<string, string>();
  for (const item of Object.values(items ?? {})) {
    if (item.key_str && item.value_hex) byKey.set(item.key_str, item.value_hex);
  }
  const consts = byKey.get('/consts');
  if (!consts) return null;
  const { slicePot, farmBlocks } = parseConsts(consts);
  return {
    acc: leAll(byKey.get('/acc_slice')),
    lastAccrual: leAll(byKey.get('/last_accrual')),
    totalWeight: leAll(byKey.get('/total_weight')),
    farmStart: leAll(byKey.get('/farm_start')),
    farmBlocks,
    slicePot,
    migrated: leAll(byKey.get('/migrated')) === 1n,
  };
}

const mulDiv = (a: bigint, b: bigint, c: bigint): bigint => (c === 0n ? 0n : (a * b) / c);

/** The accumulator a position is read against at `height`: the vault's `accrual_state`, or `acc_at_farm_end` once migrated. */
export function accumulatorAt(g: VaultGlobals, height: number): bigint {
  const emission = g.farmBlocks === 0n ? 0n : g.slicePot / g.farmBlocks;
  const farmEnd = g.farmStart === 0n ? 0n : g.farmStart + g.farmBlocks;
  const h = BigInt(height);
  const now = h < farmEnd ? h : farmEnd;
  let acc = g.acc;
  if (now > g.lastAccrual && g.lastAccrual > 0n && g.totalWeight > 0n) {
    acc += mulDiv(emission * (now - g.lastAccrual), ACC_SCALE, g.totalWeight);
  }
  if (g.migrated && g.totalWeight > 0n && farmEnd > now) {
    // frozen weights: the position's figure is exact from now to the farm's end
    acc += mulDiv(emission * (farmEnd - now), ACC_SCALE, g.totalWeight);
  }
  return acc;
}

/** What one position record can still claim at accumulator `acc`: the vault's `claimable`. */
export function claimableOf(recordHex: string, acc: bigint): bigint | null {
  const b = hexBytes(recordHex);
  if (b.length < POS_LEN) return null;
  const effWeight = leAt(b, POS_EFF_WEIGHT, 16);
  const debt = leAt(b, POS_REWARD_DEBT, 16);
  const banked = leAt(b, POS_BANKED, 16);
  const claimed = leAt(b, POS_CLAIMED, 16);
  const gross = mulDiv(effWeight, acc, ACC_SCALE);
  const vested = banked + (gross > debt ? gross - debt : 0n);
  return vested > claimed ? vested - claimed : 0n;
}

const withHeight = (params: Record<string, unknown>, height?: number) =>
  height === undefined ? params : { ...params, height };

const req = (id: string, method: string, params: Record<string, unknown>): EspoBatchRequest => ({
  jsonrpc: '2.0',
  id,
  method,
  params,
});

/**
 * Every position's unclaimed SLICE, by holder and in all, as of `atHeight` (the tip when omitted).
 * A DAO without `vaultPositions` answers zero everywhere.
 */
export async function vaultUnclaimed(dao: VaultDao, espo: EspoBatch, atHeight?: number): Promise<VaultUnclaimed> {
  const vp = dao.vaultPositions;
  if (!vp || vp.vaults.length === 0) return { ...NONE, byAddress: new Map(), height: atHeight ?? 0 };
  // before the fork the rule did not exist: history keeps its verdicts
  if (atHeight !== undefined && vp.fromHeight !== undefined && atHeight < vp.fromHeight) return { ...NONE, byAddress: new Map(), height: atHeight };

  // 1) the tip (when live), every vault's accrual globals, the first page of holders
  const first = await espo([
    req('height', 'get_espo_height', {}),
    ...vp.vaults.map((vault, v) =>
      req(`globals-${v}`, 'essentials.get_keys', withHeight({ alkane: vault, keys: GLOBAL_KEYS, limit: 100 }, atHeight)),
    ),
    req('holders-1', 'essentials.get_orbital_holders', withHeight({ factory: vp.tokenFactory, limit: HOLDERS_LIMIT, page: 1 }, atHeight)),
  ]);
  const tip = Number(first.get('height')?.height);
  const height = atHeight ?? tip;
  if (!Number.isInteger(height) || height <= 0) throw new Error('vaultUnclaimed: no height');

  const holders: { address: string; alkanes: string[] }[] = [];
  const takeHolders = (result: any) => {
    if (!result?.ok) throw new Error(`espo get_orbital_holders: ${result?.error ?? 'no result'}`);
    for (const item of result.items ?? []) {
      // a contract holding clones is not a staker
      if (item?.address && (item.type ?? 'address') === 'address') holders.push({ address: item.address, alkanes: item.alkanes ?? [] });
    }
    return Boolean(result.has_more);
  };
  let more = takeHolders(first.get('holders-1'));
  for (let page = 2; more; page++) {
    const r = await espo([req(`holders-${page}`, 'essentials.get_orbital_holders', withHeight({ factory: vp.tokenFactory, limit: HOLDERS_LIMIT, page }, atHeight))]);
    more = takeHolders(r.get(`holders-${page}`));
  }

  const globals = vp.vaults.map((_, v) => parseVaultGlobals(first.get(`globals-${v}`)?.items ?? {}));
  const accs = globals.map((g) => (g ? accumulatorAt(g, height) : null));

  // 2) the vaults' records of every clone id held: an id with a record IS a position
  const candidates = [...new Set(holders.flatMap((h) => h.alkanes))];
  const holderOf = new Map<string, string>();
  for (const h of holders) for (const id of h.alkanes) holderOf.set(id, h.address);

  const recordsByVault: Map<string, string>[] = vp.vaults.map(() => new Map());
  type Chunk = { v: number; keys: string[]; page: number };
  let pending: Chunk[] = [];
  vp.vaults.forEach((_, v) => {
    if (!accs[v]) return; // a vault espo knows nothing of (not initialized at this height)
    for (let i = 0; i < candidates.length; i += KEY_CHUNK) pending.push({ v, keys: candidates.slice(i, i + KEY_CHUNK).map(positionKeyHex), page: 1 });
  });
  while (pending.length > 0) {
    const batch = pending;
    pending = [];
    const results = await espo(
      batch.map((c, i) => req(`pos-${i}`, 'essentials.get_keys', withHeight({ alkane: vp.vaults[c.v], keys: c.keys, limit: KEY_CHUNK, page: c.page }, atHeight))),
    );
    batch.forEach((c, i) => {
      const result = results.get(`pos-${i}`);
      if (!result?.ok) throw new Error(`espo get_keys: ${result?.error ?? 'no result'}`);
      for (const item of Object.values(result.items ?? {}) as { key_hex?: string; value_hex?: string }[]) {
        if (item.key_hex && item.value_hex && item.value_hex !== '0x') recordsByVault[c.v].set(item.key_hex.toLowerCase(), item.value_hex);
      }
      if (result.has_more) pending.push({ ...c, page: c.page + 1 });
      else if (result.total !== undefined && c.page * KEY_CHUNK < result.total) throw new Error(`espo get_keys: ${result.total} keys, ${c.page * KEY_CHUNK} read`);
    });
  }

  // 3) each position's claimable SLICE, added to its holder
  const byAddress = new Map<string, bigint>();
  let total = 0n;
  for (const id of candidates) {
    const key = positionKeyHex(id);
    for (let v = 0; v < vp.vaults.length; v++) {
      const record = recordsByVault[v].get(key);
      const acc = accs[v];
      if (!record || acc === null) continue;
      const claimable = claimableOf(record, acc);
      if (claimable === null || claimable === 0n) continue;
      const holder = holderOf.get(id);
      if (!holder || dao.nonCirculating?.addresses.includes(holder)) continue;
      byAddress.set(holder, (byAddress.get(holder) ?? 0n) + claimable);
      total += claimable;
    }
  }
  return { total, byAddress, height };
}

/** `balances` with each address's unclaimed SLICE added (an address only the vault knows joins the map). */
export function addUnclaimed(balances: Map<string, bigint>, unclaimed: VaultUnclaimed): Map<string, bigint> {
  const out = new Map(balances);
  for (const [address, amount] of unclaimed.byAddress) out.set(address, (out.get(address) ?? 0n) + amount);
  return out;
}
