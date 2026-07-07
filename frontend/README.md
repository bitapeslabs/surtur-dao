# Surtur

DAO governing the DIESEL reserves. Built on the same stack and design
language as the vendor (snowfort) demo app: connects to a SUBFROST wallet
through the [`subfrost-connect`](./subfrost-connect) SDK, shows the
connected account's portfolio, and adds DAO **proposals** in place of the
swap flow.

## Pages

- **/proposals** — paginated list of proposals, newest first, with a
  New-proposal CTA.
- **/proposals/new** — create a proposal: title, markdown body
  ([Milkdown](https://milkdown.dev) Crepe editor), and a list of
  **Transfers** — each a DIESEL amount + recipient address the DAO
  reserves would pay out if the proposal passes. Requires a connected
  wallet (the author).
- **/proposals/[id]** — proposal detail: read-only markdown render plus
  the transfer list with a total.
- **/portfolio** — BTC + alkane balances for the connected account, with
  inline Send (unsigned PSBT built locally, signed via the SUBFROST
  popup, then finalized and broadcast). Same as the vendor app.

## Data layer

All proposal reads/writes go through the `DaoStore` interface in
[`lib/dao/store.ts`](lib/dao/store.ts). The current implementation
persists to `localStorage` (`surtur:proposals`); swapping in a real
backend later is a one-file change in `getDaoStore()`. Voting, proposal
lifecycle, and on-chain execution are intentionally out of scope for the
skeleton.

## Run locally

```bash
# 1. Start the subfrost app (default: http://localhost:3000)
cd ../subfrost-app && pnpm install && pnpm dev

# 2. Start Surtur on port 3002
pnpm install
pnpm dev   # http://localhost:3002
```

Set the **SUBFROST app origin** in the header settings popover (gear icon,
shown while disconnected), then **Connect wallet**.
