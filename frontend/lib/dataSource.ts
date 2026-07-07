/**
 * Alkanes data-source switch — port of subfrost-app (branch morkle-oyl-fix)
 * lib/alkanes/dataSource.ts.
 *
 * 'espo' reads spendable outpoints + alkane balances from the Espo indexer
 * (alkanode) in one batched call; 'metashrew' uses the esplora UTXO list +
 * per-outpoint protorunesbyoutpoint fan-out. Mainnet defaults to Espo;
 * non-mainnet networks stay on metashrew (no Espo deployment).
 */

export type AlkanesDataSource = 'metashrew' | 'espo';

function normalizeDataSource(value: string | undefined): AlkanesDataSource | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'metashrew' || normalized === 'espo') return normalized;
  return null;
}

export function getAlkanesDataSource(network?: string): AlkanesDataSource {
  const configured =
    normalizeDataSource(
      process.env.NEXT_PUBLIC_ALKANES_DATA_SOURCE ??
        process.env.NEXT_PUBLIC_ALKANES_UTXO_SOURCE ??
        process.env.NEXT_PUBLIC_UTXO_SOURCE,
    ) ?? 'espo';

  if (configured === 'espo' && network && network !== 'mainnet') {
    return 'metashrew';
  }

  return configured;
}
