/**
 * Lazy WASM WebProvider singleton — mirrors subfrost-app's
 * AlkanesSDKContext provider construction (dummy wallet + proxied URLs).
 *
 * The vendor app never holds keys: the provider's `walletCreate()` dummy
 * wallet only satisfies the SDK's "a wallet must be loaded" requirement so
 * `alkanesExecuteWithStrings` can build UNSIGNED PSBTs against the connected
 * SUBFROST address. The SUBFROST popup patches + signs them.
 *
 * The WASM module is imported dynamically so it never executes during SSR
 * (the wasm-bindgen glue runs `__wbindgen_start()` eagerly at module load).
 */

import {
  BITCOIN_RPC_ENDPOINTS,
  NETWORK_TO_PROVIDER,
  RPC_ENDPOINTS,
  getDataApiUrl,
  getEspoUrl,
  type VendorNetwork,
} from './config';

type WebProvider = import('./alkanes-web-sys/alkanes_web_sys').WebProvider;

const providers = new Map<string, Promise<WebProvider>>();

export function getWebProvider(network: VendorNetwork): Promise<WebProvider> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('WebProvider is browser-only'));
  }
  let cached = providers.get(network);
  if (!cached) {
    cached = (async () => {
      const mod = await import('./alkanes-web-sys/alkanes_web_sys');
      const provider = new mod.WebProvider(NETWORK_TO_PROVIDER[network] ?? 'mainnet', {
        jsonrpc_url: RPC_ENDPOINTS[network] || RPC_ENDPOINTS.regtest,
        bitcoin_rpc_url: BITCOIN_RPC_ENDPOINTS[network] || BITCOIN_RPC_ENDPOINTS.regtest,
        data_api_url: getDataApiUrl(network),
        // Espo JSON-RPC for the SDK's `utxo_source: 'espo'` coin selection
        // (mainnet only — same gating as subfrost-app's AlkanesSDKContext).
        ...(network === 'mainnet' ? { espo_rpc_url: getEspoUrl(network) } : {}),
      });
      provider.walletCreate();
      return provider;
    })();
    providers.set(network, cached);
    cached.catch(() => providers.delete(network));
  }
  return cached;
}
