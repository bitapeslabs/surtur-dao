/**
 * Balance fetching — data-source-switched, mirroring subfrost-app branch
 * morkle-oyl-fix:
 *
 * - **espo** (mainnet default): one batched
 *   `essentials.get_address_spendable_outpoints` call returns the spendable
 *   UTXO set with alkane balances inline. BTC balance = sum of spendable
 *   outpoints (the spendable view — mempool-pending shows as 0 until
 *   indexed); alkane balances = per-outpoint aggregation from the same
 *   response (queries/account.ts:fetchWalletUtxoCacheViaEspo +
 *   useEnrichedWalletData's espo-derived balances).
 * - **metashrew** (non-mainnet): esplora_address::utxo for BTC + dust-UTXO →
 *   `alkanes_protorunesbyoutpoint` fan-out for alkanes
 *   (queries/account.ts:fetchAlkaneBalancesViaProtobuf non-mainnet path).
 */

import { getAddressUtxos, getProtorunesByOutpoint, type ProtoruneBalanceEntry } from './rpc';
import { getAlkanesDataSource } from './dataSource';
import { fetchSpendableOutpointsViaEspo, type EspoUtxoCache } from './espo';

export const DUST_LIMIT_SATS = 1000;

export interface BtcBalance {
  confirmedSats: number;
  mempoolSats: number;
  totalSats: number;
}

export interface AlkaneBalance {
  /** "block:tx" */
  alkaneId: string;
  balance: bigint;
}

export interface WalletBalances {
  btc: BtcBalance;
  alkanes: AlkaneBalance[];
  /** Espo spendable-outpoint cache (espo data source only) — reused for coin selection. */
  espoCache: EspoUtxoCache | null;
}

function sortAlkanes(balances: Map<string, bigint>): AlkaneBalance[] {
  return Array.from(balances, ([alkaneId, balance]) => ({ alkaneId, balance }))
    .filter((a) => a.balance > 0n)
    .sort((a, b) => a.alkaneId.localeCompare(b.alkaneId));
}

/** Single entrypoint: BTC + alkanes via the network's data source. */
export async function fetchWalletBalances(
  network: string,
  address: string,
): Promise<WalletBalances> {
  if (getAlkanesDataSource(network) === 'espo') {
    const cache = await fetchSpendableOutpointsViaEspo(network, [address]);
    let confirmedSats = 0;
    for (const u of cache.utxos) confirmedSats += u.value;
    return {
      // Espo serves the spendable (confirmed) view; there is no mempool split.
      btc: { confirmedSats, mempoolSats: 0, totalSats: confirmedSats },
      alkanes: sortAlkanes(cache.balances),
      espoCache: cache,
    };
  }

  const [btc, alkanes] = await Promise.all([
    fetchBtcBalanceViaEsplora(network, address),
    fetchAlkaneBalancesViaMetashrew(network, address),
  ]);
  return { btc, alkanes, espoCache: null };
}

async function fetchBtcBalanceViaEsplora(network: string, address: string): Promise<BtcBalance> {
  const utxos = await getAddressUtxos(network, address, AbortSignal.timeout(15_000));
  let confirmedSats = 0;
  let mempoolSats = 0;
  for (const u of utxos) {
    if (u.status?.confirmed) confirmedSats += u.value;
    else mempoolSats += u.value;
  }
  return { confirmedSats, mempoolSats, totalSats: confirmedSats + mempoolSats };
}

async function fetchAlkaneBalancesViaMetashrew(
  network: string,
  address: string,
): Promise<AlkaneBalance[]> {
  const utxos = await getAddressUtxos(network, address, AbortSignal.timeout(15_000));
  const dustUtxos = utxos.filter((u) => u.value <= DUST_LIMIT_SATS);
  if (dustUtxos.length === 0) return [];

  // Per-outpoint retry with backoff — a single transient failure must not
  // silently undercount (same rationale as the subfrost-app implementation).
  const fetchWithRetry = async (txid: string, vout: number): Promise<ProtoruneBalanceEntry[]> => {
    const RETRY_DELAYS = [0, 500, 1500];
    let lastErr: unknown;
    for (const delay of RETRY_DELAYS) {
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      try {
        const resp = await getProtorunesByOutpoint(network, txid, vout, AbortSignal.timeout(15_000));
        return resp?.balance_sheet?.cached?.balances ?? [];
      } catch (e) {
        lastErr = e;
      }
    }
    throw new Error(`protorunesbyoutpoint(${txid}:${vout}) failed after retries: ${lastErr}`);
  };

  const settled = await Promise.allSettled(dustUtxos.map((u) => fetchWithRetry(u.txid, u.vout)));

  const aggregate = new Map<string, bigint>();
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue;
    for (const b of r.value) {
      const amount = BigInt(String(b.amount ?? 0));
      if (amount === 0n) continue;
      const key = `${String(b.block)}:${String(b.tx)}`;
      aggregate.set(key, (aggregate.get(key) ?? 0n) + amount);
    }
  }

  return sortAlkanes(aggregate);
}
