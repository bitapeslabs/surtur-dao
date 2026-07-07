/**
 * Network configuration — mirrors subfrost-app/utils/getConfig.ts +
 * context/AlkanesSDKContext.tsx. All browser RPC goes through the local
 * direct upstream endpoints below (all of them send CORS headers).
 *
 * `devnet` is intentionally absent: the SUBFROST devnet runs in-browser
 * behind a fetch interceptor inside the subfrost app tab and is not
 * reachable from another origin.
 */

import * as bitcoin from 'bitcoinjs-lib';

export const SUPPORTED_NETWORKS = [
  'mainnet',
  'testnet',
  'signet',
  'regtest',
  'subfrost-regtest',
  'regtest-local',
  'oylnet',
] as const;

export type VendorNetwork = (typeof SUPPORTED_NETWORKS)[number];

export const DEFAULT_NETWORK: VendorNetwork = 'subfrost-regtest';

/** Map an arbitrary network name reported by SUBFROST to one we support. */
export function normalizeNetwork(network: string | undefined | null): VendorNetwork {
  if (network && (SUPPORTED_NETWORKS as readonly string[]).includes(network)) {
    return network as VendorNetwork;
  }
  return DEFAULT_NETWORK;
}

/**
 * Direct upstream endpoints — the browser talks to these itself (all of
 * them send CORS headers; the old Next.js /api/rpc proxy is gone).
 * Tables copied from the removed proxy route (subfrost-app parity).
 */
export const RPC_ENDPOINTS: Record<string, string> = {
  mainnet: 'https://mainnet.subfrost.io/v4/subfrost',
  testnet: 'https://testnet.subfrost.io/v4/5d37098b75581792a44b9d230d48aa75',
  signet: 'https://signet.subfrost.io/v4/5d37098b75581792a44b9d230d48aa75',
  regtest: 'https://regtest.subfrost.io/v4/5d37098b75581792a44b9d230d48aa75',
  'regtest-local': 'http://localhost:18888',
  'subfrost-regtest': 'https://regtest.subfrost.io/v4/5d37098b75581792a44b9d230d48aa75',
  oylnet: 'https://regtest.subfrost.io/v4/5d37098b75581792a44b9d230d48aa75',
};

// Bitcoin Core methods must hit the bitcoind/jsonrpc backend — sending
// `sendrawtransaction` through /v4/subfrost can hit an Esplora-style text
// response that surfaces as JSON-RPC -32603 "error decoding response body".
export const BITCOIN_RPC_ENDPOINTS: Record<string, string> = {
  mainnet: 'https://mainnet.subfrost.io/v4/jsonrpc',
  testnet: 'https://testnet.subfrost.io/v4/jsonrpc',
  signet: 'https://signet.subfrost.io/v4/jsonrpc',
  regtest: 'https://regtest.subfrost.io/v4/jsonrpc',
  'regtest-local': 'http://localhost:18888',
  'subfrost-regtest': 'https://regtest.subfrost.io/v4/jsonrpc',
  oylnet: 'https://regtest.subfrost.io/v4/jsonrpc',
};

export const BITCOIN_RPC_METHODS = new Set([
  'getblockcount',
  'getblockhash',
  'getblock',
  'getrawtransaction',
  'sendrawtransaction',
  'sendrawtransactions',
  'submitpackage',
  'generatetoaddress',
  'getrawmempool',
  'gettxout',
  'getmempoolinfo',
]);

/** Espo JSON-RPC — canon Espo on alkanode for mainnet. */
export const ESPO_MAINNET_JSONRPC = 'https://api.alkanode.com/rpc';

export function getEspoUrl(network: string): string {
  if (network === 'mainnet') return ESPO_MAINNET_JSONRPC;
  return `${(RPC_ENDPOINTS[network] || RPC_ENDPOINTS.regtest).replace(/\/$/, '')}/espo`;
}

/** Canon-espo REST base (get-alkane-details, SDK data_api_url). */
export function getDataApiUrl(network: string): string {
  if (network === 'mainnet') return 'https://oyl.alkanode.com';
  return RPC_ENDPOINTS[network] || RPC_ENDPOINTS.regtest;
}

/** JSON-RPC URL for a single method (bitcoin methods use their backend). */
export function getRpcUrl(network: string, method?: string): string {
  if (method && BITCOIN_RPC_METHODS.has(method)) {
    return BITCOIN_RPC_ENDPOINTS[network] || BITCOIN_RPC_ENDPOINTS.regtest;
  }
  return RPC_ENDPOINTS[network] || RPC_ENDPOINTS.regtest;
}

/** Same mapping as subfrost-app/lib/alkanes/helpers.ts:getBitcoinNetwork. */
export function getBitcoinNetwork(network: string): bitcoin.Network {
  switch (network) {
    case 'mainnet':
      return bitcoin.networks.bitcoin;
    case 'testnet':
    case 'signet':
      return bitcoin.networks.testnet;
    case 'regtest':
    case 'regtest-local':
    case 'subfrost-regtest':
    case 'oylnet':
      return bitcoin.networks.regtest;
    default:
      return bitcoin.networks.bitcoin;
  }
}

/** WebProvider preset names — same table as AlkanesSDKContext.tsx. */
export const NETWORK_TO_PROVIDER: Record<VendorNetwork, string> = {
  mainnet: 'mainnet',
  testnet: 'testnet',
  signet: 'signet',
  regtest: 'regtest',
  'regtest-local': 'regtest',
  oylnet: 'regtest',
  'subfrost-regtest': 'subfrost-regtest',
};

/**
 * AMM factory proxy per network — same values as subfrost-app
 * utils/getConfig.ts ALKANE_FACTORY_ID.
 */
export const ALKANE_FACTORY_IDS: Record<VendorNetwork, string> = {
  mainnet: '4:65522',
  testnet: '4:65522',
  signet: '4:65522',
  regtest: '4:65498',
  'subfrost-regtest': '4:65498',
  'regtest-local': '4:65522',
  oylnet: '4:65522',
};

/** Well-known alkane tokens (display only; unknown ids render as block:tx). */
export const KNOWN_ALKANES: Record<string, { symbol: string; name: string }> = {
  '2:0': { symbol: 'DIESEL', name: 'Diesel' },
  '32:0': { symbol: 'frBTC', name: 'Subfrost BTC' },
};

/** Alkane amounts use 8 decimals (same as subfrost-app toAlks default). */
export const ALKANE_DECIMALS = 8;

/** Tx link on the espo.sh explorer — same target subfrost-app's success notifications use. */
export function explorerTxUrl(txid: string): string {
  return `https://espo.sh/tx/${txid}`;
}

/** Address link on the espo.sh explorer (proposal transfer recipients). */
export function explorerAddressUrl(address: string): string {
  return `https://espo.sh/address/${encodeURIComponent(address)}`;
}
