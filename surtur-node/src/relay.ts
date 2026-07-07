/**
 * P2P relay — EVERY accepted POST is forwarded to all known peers
 * (fire-and-forget). Peers that already have the record answer
 * `known: true` and do NOT re-relay, which terminates the gossip: a client
 * only needs to reach one node for the whole network to converge.
 */

import { RELAY_TIMEOUT_MS } from './config';
import { listPeers } from './db';

export async function relayToPeers(path: string, body: unknown): Promise<void> {
  const peers = await listPeers().catch(() => [] as string[]);
  await Promise.allSettled(
    peers.map(async (peer) => {
      try {
        await fetch(`${peer}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
        });
      } catch (e) {
        console.warn(`[relay] ${peer}${path} failed: ${(e as Error)?.message ?? e}`);
      }
    }),
  );
}
