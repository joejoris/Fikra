/**
 * FIKRA web server (Render web service).
 *
 * Serves the static Astro build (dist/) plus the JSON API and the private
 * inbox on the same origin, so the frontend needs no API base URL:
 *
 *   GET  /healthz          health check (Render)
 *   POST /api/contact      website forms (JSON or multipart + attachments)
 *   POST /api/subscribe    newsletter sign-ups
 *   POST /api/rsvp         event registrations
 *   GET  /api/files/:id    uploaded files (inbox login required)
 *   GET/POST /inbox        private submissions inbox
 *
 * Env:
 *   PORT, SERVE_DIR (default ./dist), DATABASE_URL (Postgres; else local SQLite),
 *   mail: GMAIL_USER + GMAIL_APP_PASSWORD, or RESEND_API_KEY (+ RESEND_AUDIENCE_ID),
 *   plus CONTACT_TO_EMAIL, CONTACT_FROM_EMAIL, INBOX_PASSWORD, TURNSTILE_SECRET_KEY
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { initDb } from './db.js';
import { contactRouter } from './routes/contact.js';
import { subscribeRouter } from './routes/subscribe.js';
import { rsvpRouter } from './routes/rsvp.js';
import { inboxRouter } from './routes/inbox.js';
import { filesRouter } from './routes/files.js';
import { paypalRouter } from './routes/paypal.js';
import { mpesaRouter } from './routes/mpesa.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Never let a stray async error take the process down. On Render a crash means
// every visitor gets a 502 Bad Gateway until the service restarts; logging and
// carrying on keeps the site and its API answering.
process.on('unhandledRejection', (reason) => {
  console.error('server: unhandled promise rejection', reason);
});
process.on('uncaughtException', (error) => {
  console.error('server: uncaught exception', error);
});

// Local development convenience: load .dev.vars (KEY=VALUE lines) when present.
// Production (Render) provides real environment variables instead.
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

const SERVE_DIR = process.env.SERVE_DIR ?? join(root, 'dist');
const PORT = Number(process.env.PORT ?? 3000);

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Security headers (previously public/_headers on Cloudflare Pages).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; " +
      "form-action 'self'; img-src 'self' data:; font-src 'self' data:; " +
      "style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com https://challenges.cloudflare.com; " +
      "connect-src 'self'; frame-src https://challenges.cloudflare.com",
  );
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

app.get('/healthz', (req, res) => res.type('text').send('ok'));

app.use(contactRouter);
app.use(subscribeRouter);
app.use(rsvpRouter);
app.use(inboxRouter);
app.use(filesRouter);
app.use(paypalRouter);
app.use(mpesaRouter);

// Unknown API route: always JSON, never the HTML 404 page (the browser forms
// parse the response as JSON and would otherwise show a generic error).
app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, error: 'This address is not available.' });
});

// Static site (built by `npm run build`). API routes above take precedence.
// `dotfiles: 'allow'` so /.well-known/* (e.g. security.txt) is served.
if (existsSync(SERVE_DIR)) {
  app.use(express.static(SERVE_DIR, { index: 'index.html', extensions: ['html'], dotfiles: 'allow' }));
} else {
  console.warn(`server: static dir not found (${SERVE_DIR}) — run npm run build first`);
}

app.use((req, res) => {
  const notFound = join(SERVE_DIR, '404.html');
  if (existsSync(notFound)) {
    return res.status(404).sendFile(notFound);
  }
  return res.status(404).type('text').send('Not found');
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // Malformed JSON body from a client: a clear 400, not a generic 500.
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    if (req.path.startsWith('/api/')) {
      return res.status(400).json({ ok: false, error: 'Invalid request. Please try again.' });
    }
    return res.status(400).type('text').send('Bad request');
  }
  if (err?.type === 'entity.too.large') {
    if (req.path.startsWith('/api/')) {
      return res.status(413).json({ ok: false, error: 'That submission is too large.' });
    }
    return res.status(413).type('text').send('Too large');
  }

  console.error('server: unhandled error', err);
  if (req.path.startsWith('/api/')) {
    return res
      .status(500)
      .json({ ok: false, error: 'We hit a problem on our side. Please try again in a moment.' });
  }
  return res.status(500).type('text').send('We hit a problem on our side. Please try again.');
});

await (async () => {
  try {
    await initDb();
  } catch (error) {
    // Never crash the whole site for a database outage: pages still serve,
    // API routes fail loudly (500) until the database recovers. Fix the
    // DATABASE_URL / database status and redeploy or restart.
    console.error('db: startup connection failed — serving without a database.', error);
  }
})();

const server = app.listen(PORT, () => {
  console.log(`fikra server listening on :${PORT} (serving ${SERVE_DIR})`);
});
server.on('error', (error) => {
  console.error(`server: could not listen on :${PORT}`, error);
});
