# @surtur/node

A surtur node: one member of the whitelisted p2p network that stores and
replicates Surtur proposals and votes.

## How it works

- **Bootstrap** — on boot (and every minute) the node fetches the main
  orchestrator (`ORCHESTRATOR_URL`, the frontend's `/api/orchestrator`) for
  the whitelisted peer list and the DAO configurations/thresholds, and
  caches both in its embedded SQLite database (`node:sqlite`, a single
  file — no database server to run). It keeps operating from that local
  copy if the orchestrator goes down.
- **Writes** — the frontend POSTs signed proposal/vote bundles to every
  whitelisted node. Each POST is validated (shared zod shapes, sha256
  proposal id integrity, BIP-322 signatures, DAO thresholds via espo's
  versioned RPC) and then relayed to all known peers. A node that already
  has the record acknowledges `known: true` and does not re-relay, which
  terminates the gossip.
- **Reads** — the frontend queries all nodes in parallel and unions the
  results, so a record is visible as long as ONE node has it.
- **Verdicts** — when an open proposal's end block passes, the node
  computes passed/rejected from its stored votes + espo pinned at the end
  block and persists it (past-block data is immutable).

## Running

All settings live in one JSON file passed as the only CLI flag:

```bash
cp config.example.json config.json   # port / selfUrl / databaseFile / orchestratorUrl
pnpm --filter @surtur/node dev -- --config config.json
```

For the local two-node test network the repo root has `run_test_nodes.sh`
(nodes on :3007 and :3008, one SQLite file each under `data/`).
