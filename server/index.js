/**
 * Long-lived server entry point (local development, Render, any container).
 *
 * Vercel does not use this file — see ../api/index.js. Both share the same
 * Express app from ./app.js.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import app, { SERVE_DIR } from './app.js';
import { initDb } from './db.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Never let a stray async error take the process down. A crash means every
// visitor gets a 502 Bad Gateway until the service restarts; logging and
// carrying on keeps the site and its API answering.
process.on('unhandledRejection', (reason) => {
  console.error('server: unhandled promise rejection', reason);
});
process.on('uncaughtException', (error) => {
  console.error('server: uncaught exception', error);
});

// Local development convenience: load .dev.vars (KEY=VALUE lines) when present.
// Production provides real environment variables instead.
try {
  const varsPath = join(root, '.dev.vars');
  if (existsSync(varsPath)) {
    for (const line of readFileSync(varsPath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key && !(key in process.env)) process.env[key] = value;
    }
  }
} catch {
  // No local vars file — environment variables (if any) apply as-is.
}

const PORT = Number(process.env.PORT ?? 3000);

const server = app.listen(PORT, () => {
  console.log(`fikra server listening on :${PORT} (serving ${SERVE_DIR})`);
});
server.on('error', (error) => {
  console.error(`server: could not listen on :${PORT}`, error);
});

await (async () => {
  try {
    await initDb();
  } catch (error) {
    // Never crash the whole site for a database outage: pages still serve and
    // API routes fail gracefully until the database recovers. Fix the
    // DATABASE_URL / database status and redeploy or restart.
    console.error('db: startup connection failed — serving without a database.', error);
  }
})();
