/**
 * Entry point. Chooses a storage backend from the environment and starts the
 * server. One process serves both the API/WebSocket and the built web client,
 * so a deployment is a single URL.
 *
 *   TURSO_DATABASE_URL set  -> hosted mode, data in Turso (Render)
 *   unset                   -> local file, data in COPSE_DB (offline / hotspot)
 */

import { RETENTION_MS } from '@copse/protocol';
import { createServer } from './server.ts';
import { SqliteStore } from './store-sqlite.ts';
import { TursoStore } from './store-turso.ts';
import type { Store } from './store.ts';

/** Delete expired messages hourly, and once at startup to catch downtime gaps. */
const SWEEP_INTERVAL_MS = 1000 * 60 * 60;

const port = Number(process.env.PORT ?? 4040);
const invite = process.env.COPSE_INVITE ?? '';
const staticDir = process.env.COPSE_STATIC;

function chooseStore(): { store: Store; where: string } {
  // Trim the env values: a token pasted into a hosting dashboard almost always
  // arrives with a trailing newline, and an Authorization header rejects any
  // whitespace ("Header 'authorization' has invalid value"). Trimming here makes
  // a sloppy paste harmless.
  const url = process.env.TURSO_DATABASE_URL?.trim();
  const token = process.env.TURSO_AUTH_TOKEN?.trim();
  if (url) {
    return { store: new TursoStore(url, token), where: `Turso (${new URL(url).host})` };
  }
  const path = process.env.COPSE_DB ?? './copse.db';
  return { store: new SqliteStore(path), where: `local file (${path})` };
}

const { store, where } = chooseStore();
await store.init();

// Enforce the 7-day retention: sweep now (a restart may have spanned the window)
// and then hourly. Deletion is real - expired ciphertext leaves the database.
async function sweep(): Promise<void> {
  try {
    const removed = await store.sweepExpired(Date.now() - RETENTION_MS);
    if (removed > 0) console.log(`swept ${removed} expired message(s)`);
  } catch (err) {
    console.error('retention sweep failed:', err);
  }
}
await sweep();
setInterval(sweep, SWEEP_INTERVAL_MS);

if (!invite) {
  console.warn('COPSE_INVITE is unset - registration is closed. Set it to allow new accounts.');
}

const app = createServer({
  store,
  invite,
  staticDir,
  secureCookie: process.env.NODE_ENV === 'production',
});

const server = Bun.serve({
  port,
  fetch: app.fetch,
  websocket: app.websocket,
});

console.log(`Copse on http://localhost:${server.port}  ·  storage: ${where}`);
