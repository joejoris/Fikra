/**
 * FIKRA web app (Express).
 *
 * Serves the static Astro build (dist/) plus the JSON API and the private
 * inbox on the same origin, so the frontend needs no API base URL:
 *
 *   GET  /healthz          health check
 *   POST /api/contact      website forms (JSON or multipart + attachments)
 *   POST /api/subscribe    newsletter sign-ups
 *   POST /api/rsvp         event registrations
 *   GET  /api/files/:id    uploaded files (inbox login required)
 *   GET/POST /inbox        private submissions inbox
 *   GET/POST /inbox/community  community moderation (comments, board, chat)
 *   community API: /api/comments, /api/topics, /api/chat, /api/auth/*
 *
 * This module only builds and exports the Express app. `server/index.js`
 * runs it as a long-lived process (local dev, Render); `api/index.js` exports
 * it as a Vercel serverless function.
 *
 * Env:
 *   SERVE_DIR (default ./dist), DATABASE_URL (Postgres on Vercel; else local SQLite),
 *   mail: GMAIL_USER + GMAIL_APP_PASSWORD, or RESEND_API_KEY (+ RESEND_AUDIENCE_ID),
 *   plus CONTACT_TO_EMAIL, CONTACT_FROM_EMAIL, INBOX_PASSWORD, TURNSTILE_SECRET_KEY
 */
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { contactRouter } from './routes/contact.js';
import { subscribeRouter } from './routes/subscribe.js';
import { rsvpRouter } from './routes/rsvp.js';
import { inboxRouter } from './routes/inbox.js';
import { filesRouter } from './routes/files.js';
import { paypalRouter } from './routes/paypal.js';
import { mpesaRouter } from './routes/mpesa.js';
import { authRouter } from './routes/auth.js';
import { communityRouter } from './routes/community.js';
import { moderationRouter } from './routes/moderation.js';
import { dmRouter } from './routes/dm.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const SERVE_DIR = process.env.SERVE_DIR
  ? resolve(process.env.SERVE_DIR)
  : join(root, 'dist');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Security headers (previously public/_headers on Cloudflare Pages).
// On Vercel the static pages are served by the platform, so the same headers
// are also declared in vercel.json for `/(.*)`.
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
      "connect-src 'self' https://cloudflareinsights.com https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com",
  );
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// API responses must never be cached by the browser or an intermediary —
// signed-in state, chat, comments and direct messages all live under /api,
// and a stale cached copy makes features look broken.
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.get('/healthz', (req, res) => res.type('text').send('ok'));

app.use(contactRouter);
app.use(subscribeRouter);
app.use(rsvpRouter);
app.use(inboxRouter);
app.use(moderationRouter);
app.use(filesRouter);
app.use(paypalRouter);
app.use(mpesaRouter);
app.use(authRouter);
app.use(communityRouter);
app.use(dmRouter);

// Unknown API route: always JSON, never the HTML 404 page (the browser forms
// parse the response as JSON and would otherwise show a generic error).
app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, error: 'This address is not available.' });
});

// Static site (built by `npm run build`). API routes above take precedence.
// `dotfiles: 'allow'` so /.well-known/* (e.g. security.txt) is served.
// On Vercel this is served by the platform, and this middleware simply finds
// nothing to do.
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
      return res.status(413).json({ ok: false, error: 'That submission is too large. Please use a smaller file.' });
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

export default app;
