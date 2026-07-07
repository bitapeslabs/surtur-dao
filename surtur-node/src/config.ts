/**
 * Node configuration — everything comes from ONE json file passed on the
 * command line:
 *
 *   surtur-node --config config.json
 *
 * (also accepted as the first positional argument; defaults to
 * ./config.json). Relative paths inside the file — the database file —
 * resolve against the config file's own directory.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

const configSchema = z.object({
  /** Port this node listens on. */
  port: z.number().int().positive(),
  /** This node's public URL — excluded when relaying to peers. */
  selfUrl: z.url(),
  /** Embedded SQLite database file (created automatically). */
  databaseFile: z.string().min(1),
  /** The main orchestrator (the frontend's /api/orchestrator). */
  orchestratorUrl: z.url(),
  /** How often to re-sync peers + DAO configs from the orchestrator. */
  orchestratorSyncMs: z.number().int().positive().default(60_000),
  /** Timeout for relay posts to peers. */
  relayTimeoutMs: z.number().int().positive().default(10_000),
});

function configPathFromArgv(): string {
  const argv = process.argv.slice(2);
  const flag = argv.indexOf('--config');
  if (flag !== -1 && argv[flag + 1]) return argv[flag + 1];
  const positional = argv.find((a) => !a.startsWith('-'));
  return positional ?? './config.json';
}

const configPath = resolve(process.cwd(), configPathFromArgv());

function loadConfig() {
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf8');
  } catch {
    console.error(`[surtur-node] cannot read config file: ${configPath}`);
    console.error('usage: surtur-node --config <config.json>  (see config.example.json)');
    process.exit(1);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    console.error(`[surtur-node] config file is not valid JSON: ${configPath}`);
    process.exit(1);
  }
  const parsed = configSchema.safeParse(json);
  if (!parsed.success) {
    console.error(`[surtur-node] invalid config: ${configPath}`);
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
    process.exit(1);
  }
  return parsed.data;
}

const config = loadConfig();

export const PORT = config.port;
export const SELF_URL = config.selfUrl.replace(/\/$/, '');
export const DATABASE_FILE = resolve(dirname(configPath), config.databaseFile);
export const ORCHESTRATOR_URL = config.orchestratorUrl;
export const ORCHESTRATOR_SYNC_MS = config.orchestratorSyncMs;
export const RELAY_TIMEOUT_MS = config.relayTimeoutMs;
