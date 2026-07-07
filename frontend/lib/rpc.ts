/**
 * Thin JSON-RPC helpers — adapted from subfrost-app/lib/alkanes/rpc.ts.
 * Browser-only; calls the upstream gateways directly (they send CORS).
 */

import { getRpcUrl } from './config';

export class JsonRpcError extends Error {
  code: number;
  data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(`[JSON-RPC ${code}] ${message}`);
    this.name = 'JsonRpcError';
    this.code = code;
    this.data = data;
  }
}

async function jsonRpcCall<T = unknown>(
  network: string,
  method: string,
  params: unknown,
  signal?: AbortSignal,
): Promise<T> {
  // The SDK's broadcast helper aliases to a plain-text backend — rewrite
  // to the JSON-RPC bitcoin method (same as the old proxy did).
  if (method === 'esplora_tx::broadcast') method = 'sendrawtransaction';
  const res = await fetch(getRpcUrl(network, method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${method}`);
  }
  const body = await res.json();
  if (body?.error) {
    throw new JsonRpcError(
      body.error.code ?? -1,
      body.error.message ?? 'Unknown JSON-RPC error',
      body.error.data,
    );
  }
  return body.result as T;
}

export interface EsploraUtxo {
  txid: string;
  vout: number;
  value: number;
  status?: { confirmed?: boolean; block_height?: number };
}

/** List UTXOs at an address (confirmed + mempool). */
export async function getAddressUtxos(
  network: string,
  address: string,
  signal?: AbortSignal,
): Promise<EsploraUtxo[]> {
  const result = await jsonRpcCall<unknown>(network, 'esplora_address::utxo', [address], signal);
  return Array.isArray(result) ? (result as EsploraUtxo[]) : [];
}

/** Raw transaction hex (needed for prevout scripts when building PSBTs). */
export async function getTxHex(
  network: string,
  txid: string,
  signal?: AbortSignal,
): Promise<string> {
  const result = await jsonRpcCall<unknown>(network, 'esplora_tx::hex', [txid], signal);
  if (typeof result !== 'string' || result.length === 0) {
    throw new Error(`esplora_tx::hex returned no hex for ${txid}`);
  }
  return result;
}

export interface ProtoruneBalanceEntry {
  block: number | string;
  tx: number | string;
  amount: number | string;
}

export interface ProtoruneOutpointResponse {
  balance_sheet?: { cached?: { balances: ProtoruneBalanceEntry[] } };
}

/** Alkane balances carried by a single (txid, vout). */
export async function getProtorunesByOutpoint(
  network: string,
  txid: string,
  vout: number,
  signal?: AbortSignal,
): Promise<ProtoruneOutpointResponse> {
  return jsonRpcCall<ProtoruneOutpointResponse>(
    network,
    'alkanes_protorunesbyoutpoint',
    [{ txid, vout, protocolTag: '1' }],
    signal,
  );
}

export interface AlkanesSimulateResult {
  execution?: {
    data?: string; // "0x" + hex
    error?: string | null;
  };
  status?: number;
  gasUsed?: number;
}

/**
 * Simulate a contract view call (same wire shape as subfrost-app
 * lib/alkanes/rpc.ts:alkanesSimulate — the gateway handles protobuf).
 * `inputs` = [opcode, ...args] as string-encoded u128s.
 */
export async function alkanesSimulate(
  network: string,
  target: string,
  inputs: string[],
  signal?: AbortSignal,
): Promise<AlkanesSimulateResult> {
  return jsonRpcCall<AlkanesSimulateResult>(
    network,
    'alkanes_simulate',
    [
      {
        target,
        inputs,
        alkanes: [],
        transaction: '0x',
        block: '0x',
        height: '1000000',
        txindex: 0,
        vout: 0,
      },
    ],
    signal,
  );
}

/** Current indexer height (`metashrew_height`). */
export async function getHeight(network: string, signal?: AbortSignal): Promise<number> {
  const result = await jsonRpcCall<unknown>(network, 'metashrew_height', [], signal);
  const height = typeof result === 'string' ? parseInt(result, 10) : Number(result);
  if (!Number.isFinite(height) || height <= 0) {
    throw new Error(`metashrew_height returned ${JSON.stringify(result)}`);
  }
  return height;
}

/** Broadcast a raw transaction; returns the txid. */
export async function broadcastTransaction(
  network: string,
  txHex: string,
  signal?: AbortSignal,
): Promise<string> {
  const result = await jsonRpcCall<unknown>(network, 'sendrawtransaction', [txHex], signal);
  if (typeof result !== 'string') {
    throw new Error(`sendrawtransaction returned unexpected result: ${JSON.stringify(result)}`);
  }
  return result;
}
