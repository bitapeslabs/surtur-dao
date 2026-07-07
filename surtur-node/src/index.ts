/**
 * surtur-node — one node of the whitelisted p2p replication network behind
 * the Surtur frontend. Peers + DAO configs bootstrap from the main
 * orchestrator (the frontend's /api/orchestrator) and are cached in MySQL;
 * every accepted POST is relayed to all known peers so the network
 * converges even when a client reaches only one node.
 */

import express from 'express';
import cors from 'cors';
import { PORT, SELF_URL } from './config';
import { migrate } from './db';
import { startOrchestratorSync } from './orchestrator';
import { router } from './routes';

async function main() {
  await migrate();
  startOrchestratorSync();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '25mb' }));
  app.use(router);

  app.listen(PORT, () => {
    console.log(`[surtur-node] listening on :${PORT} (${SELF_URL})`);
  });
}

main().catch((e) => {
  console.error('[surtur-node] fatal:', e);
  process.exit(1);
});
