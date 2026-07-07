/**
 * Espo spendable-outpoints fetch — port of subfrost-app (branch
 * morkle-oyl-fix) queries/account.ts:fetchWalletUtxoCacheViaEspo + its
 * normalizers.
 *
 * One batched JSON-RPC POST straight to the espo endpoint with
 * `essentials.get_address_spendable_outpoints` per address returns the
 * spendable UTXO set WITH per-outpoint alkane balances inline — BTC balance,
 * alkane balances, and coin-selection candidates all come from this single
 * call (no dust-UTXO protorunesbyoutpoint fan-out).
 */

import { getEspoUrl } from './config';

export interface EspoUtxo {
  txid: string;
  vout: number;
  value: number;
  address: string;
  scriptPubKeyHex?: string;
  blockHeight?: number | null;
  confirmations: number;
  coinbase: boolean;
  alkanes: Array<{ block: number; tx: number; amount: bigint }>;
}

export interface EspoUtxoCache {
  utxos: EspoUtxo[];
  /** Aggregated alkane balances per "block:tx". */
  balances: Map<string, bigint>;
  height: number;
}

function parseEspoOutpoint(raw: unknown): { txid: string; vout: number } | null {
  if (typeof raw === 'string') {
    const [txid, voutRaw] = raw.split(':');
    const vout = Number(voutRaw);
    return txid && Number.isFinite(vout) ? { txid, vout } : null;
  }
  const obj = raw as any;
  const txid = String(obj?.txid ?? obj?.tx_id ?? obj?.transaction_id ?? '');
  const vout = Number(obj?.vout ?? obj?.index ?? obj?.n);
  return txid && Number.isFinite(vout) ? { txid, vout } : null;
}

function parseEspoAlkanes(raw: any): Array<{ block: number; tx: number; amount: bigint }> {
  const entries: any[] = Array.isArray(raw?.alkanes) ? raw.alkanes : [];
  return entries
    .map((entry: any) => {
      const id = String(entry?.alkane ?? entry?.alkaneId ?? entry?.alkane_id ?? entry?.id ?? '');
      const [blockRaw, txRaw] = id.split(':');
      const block = Number(entry?.block ?? entry?.alkaneId?.block ?? blockRaw);
      const tx = Number(entry?.tx ?? entry?.alkaneId?.tx ?? txRaw);
      const amount = BigInt(String(entry?.amount ?? entry?.balance ?? 0));
      if (!Number.isFinite(block) || !Number.isFinite(tx) || amount === 0n) return null;
      return { block, tx, amount };
    })
    .filter((x): x is { block: number; tx: number; amount: bigint } => x !== null);
}

function getUtxoValueSats(raw: any): number {
  const explicitSats = Number(
    raw?.satoshis ?? raw?.sats ?? raw?.value ?? raw?.txout?.value ?? raw?.prevout?.value ?? 0,
  );
  if (Number.isFinite(explicitSats) && explicitSats > 0) return explicitSats;

  const amount = raw?.amount;
  if (typeof amount === 'string' && amount.includes('.')) {
    const btc = Number(amount);
    return Number.isFinite(btc) ? Math.round(btc * 100_000_000) : 0;
  }
  const value = Number(amount ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function normalizeEspoSpendableOutpoint(raw: any, address: string): EspoUtxo | null {
  const parsed = parseEspoOutpoint(raw?.outpoint ?? raw);
  if (!parsed) return null;

  const value = getUtxoValueSats(raw);
  if (!Number.isFinite(value)) return null;

  return {
    txid: parsed.txid,
    vout: parsed.vout,
    value,
    address,
    scriptPubKeyHex:
      typeof raw?.script_pubkey_hex === 'string'
        ? raw.script_pubkey_hex
        : typeof raw?.scriptPubKeyHex === 'string'
          ? raw.scriptPubKeyHex
          : typeof raw?.script_pubkey === 'string'
            ? raw.script_pubkey
            : typeof raw?.txout?.script_pubkey_hex === 'string'
              ? raw.txout.script_pubkey_hex
              : undefined,
    blockHeight: raw?.block_height ?? null,
    confirmations: Number(raw?.confirmations ?? 0),
    coinbase: Boolean(raw?.coinbase),
    alkanes: parseEspoAlkanes(raw),
  };
}

export async function fetchSpendableOutpointsViaEspo(
  network: string,
  addresses: string[],
): Promise<EspoUtxoCache> {
  const requests = addresses.map((address, index) => ({
    jsonrpc: '2.0',
    id: `wallet-spendable-${index}`,
    method: 'essentials.get_address_spendable_outpoints',
    params: {
      address,
      omit_raw_tx: true,
    },
  }));

  const res = await fetch(getEspoUrl(network), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requests),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`essentials.get_address_spendable_outpoints batch ${res.status}`);

  const json = await res.json();
  const envelopes: any[] = Array.isArray(json) ? json : [json];
  const byId = new Map(envelopes.map((item) => [String(item?.id), item]));

  const utxos: EspoUtxo[] = [];
  let height = 0;
  for (const request of requests) {
    const envelope = byId.get(String(request.id));
    if (!envelope) throw new Error(`missing ESPO batch response for ${request.id}`);
    if (envelope.error) {
      throw new Error(
        `essentials.get_address_spendable_outpoints failed: ${envelope.error.message ?? envelope.error.code ?? 'rpc error'}`,
      );
    }
    const result = envelope.result;
    if (result?.ok === false) {
      throw new Error(
        `essentials.get_address_spendable_outpoints failed: ${result.error ?? 'rpc error'}`,
      );
    }

    const outpoints = Array.isArray(result?.outpoints)
      ? result.outpoints
      : Array.isArray(result?.spendable_outpoints)
        ? result.spendable_outpoints
        : Array.isArray(result?.spendableOutpoints)
          ? result.spendableOutpoints
          : Array.isArray(result?.data?.outpoints)
            ? result.data.outpoints
            : Array.isArray(result?.data?.spendable_outpoints)
              ? result.data.spendable_outpoints
              : Array.isArray(result)
                ? result
                : [];
    const address = request.params.address;
    height = Math.max(height, Number(result?.height ?? 0) || 0);
    for (const raw of outpoints) {
      const utxo = normalizeEspoSpendableOutpoint(raw, address);
      if (utxo) utxos.push(utxo);
    }
  }

  // Dedupe by outpoint, then aggregate alkane balances per (block, tx).
  const deduped = new Map<string, EspoUtxo>();
  for (const u of utxos) deduped.set(`${u.txid}:${u.vout}`, u);
  const all = Array.from(deduped.values());

  const balances = new Map<string, bigint>();
  for (const u of all) {
    for (const a of u.alkanes) {
      const id = `${a.block}:${a.tx}`;
      balances.set(id, (balances.get(id) ?? 0n) + a.amount);
    }
  }

  return { utxos: all, balances, height };
}
