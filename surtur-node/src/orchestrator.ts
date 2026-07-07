/**
 * Orchestrator sync — the node bootstraps its peer list and DAO configs
 * from the main orchestrator (the frontend's Next.js API) and stores them
 * in MySQL, so it keeps operating from the local copy when the
 * orchestrator is unreachable.
 */

import type { OrchestratorInfo } from '@surtur/shared';
import { ORCHESTRATOR_SYNC_MS, ORCHESTRATOR_URL, SELF_URL } from './config';
import { replacePeers, upsertDao } from './db';

export async function syncFromOrchestrator(): Promise<void> {
  const res = await fetch(ORCHESTRATOR_URL, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`orchestrator ${res.status}`);
  const info = (await res.json()) as OrchestratorInfo;
  const peers = (info.nodes ?? [])
    .map((u) => u.replace(/\/$/, ''))
    .filter((u) => u !== SELF_URL);
  await replacePeers(peers);
  for (const dao of info.daos ?? []) {
    await upsertDao(dao);
  }
  console.log(`[orchestrator-sync] pulled ${peers.length} peers, ${info.daos?.length ?? 0} daos from ${ORCHESTRATOR_URL}`);
}

export function startOrchestratorSync(): void {
  const attempt = () =>
    syncFromOrchestrator().catch((e) =>
      console.warn(`[orchestrator-sync] fetch failed (using local cache): ${e?.message ?? e}`),
    );
  void attempt();
  setInterval(attempt, ORCHESTRATOR_SYNC_MS);
}
