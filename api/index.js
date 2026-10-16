/**
 * Vercel serverless entry point.
 *
 * Vercel maps this file to /api/index and `vercel.json` rewrites the public
 * routes (/api/*, /inbox, /donate/return) here with their original path
 * preserved, so the very same Express app — and therefore the exact same
 * validation, rate limiting and inbox behaviour — serves them.
 *
 * Serverless has no persistent disk, so DATABASE_URL (Supabase Postgres) is
 * required in production. The database is connected lazily on the first query.
 */
import app from '../server/app.js';

export default app;
