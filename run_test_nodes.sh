#!/usr/bin/env bash
#
# Starts two test surtur nodes on :3007 and :3008 (the whitelist in
# frontend/surtur.config.ts points at these). Each node takes ONE cli
# flag — its config.json — which holds all its settings; edit
# surtur-node/config.node1.json / config.node2.json to change anything.
# Storage is embedded SQLite (one file per node under surtur-node/data/).

set -euo pipefail
cd "$(dirname "$0")"

pnpm --filter @surtur/node start --config config.node1.json &
NODE1=$!
pnpm --filter @surtur/node start --config config.node2.json &
NODE2=$!

trap 'kill "$NODE1" "$NODE2" 2>/dev/null' INT TERM EXIT
wait
