# Surtur monorepo

- `frontend/` — the Next.js dapp (port 3002). Also hosts the orchestrator
  API (`/api/orchestrator`) that surtur nodes bootstrap from.
- `shared/` — `@surtur/shared`: canonical proposal hashing, BIP-322
  signature verification and the zod validation shared by the frontend and
  surtur nodes.
- `surtur-node/` — `@surtur/node`: a whitelisted p2p replication node
  (Express + embedded SQLite). See `surtur-node/README.md`.

```bash
pnpm install
pnpm dev        # frontend on :3002
pnpm node:dev        # one surtur node (embedded SQLite, no server needed)
./run_test_nodes.sh  # the two-node test network (:3007, :3008)
```
