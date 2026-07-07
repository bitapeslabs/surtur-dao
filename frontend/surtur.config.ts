/**
 * Surtur network configuration — the whitelist of surtur nodes. This is
 * the source of truth the orchestrator API gossips to the nodes AND the
 * list the frontend fans its reads/writes out to.
 *
 * Set NEXT_PUBLIC_SURTUR_NODES to a comma-separated list to override, or
 * to "local" to fall back to the localStorage store (no nodes, offline
 * dev).
 */

// Production network. For local testing set NEXT_PUBLIC_SURTUR_NODES to
// "http://localhost:3007,http://localhost:3008" (run_test_nodes.sh).
const DEFAULT_NODES = ['https://surtur.alkanode.com'];

const raw = process.env.NEXT_PUBLIC_SURTUR_NODES?.trim();

export const USE_LOCAL_STORE = raw === 'local';

export const SURTUR_NODES: string[] = USE_LOCAL_STORE
  ? []
  : raw
    ? raw.split(',').map((u) => u.trim().replace(/\/$/, '')).filter(Boolean)
    : DEFAULT_NODES;
