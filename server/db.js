/**
 * Storage for the FIKRA API server.
 *
 * Two backends behind one interface:
 * - Postgres when DATABASE_URL is set (Supabase, used in production on Vercel/Render).
 * - Local SQLite file (./data/app.db) otherwise — for local development only.
 *
 * Serverless note: Vercel/Render functions have no persistent disk, so
 * DATABASE_URL is required there. `node:sqlite` is imported lazily so the
 * module loads fine on runtimes where it is unavailable.
 *
 * SQL is written with `?` placeholders and translated to $1, $2… for pg.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let mode = null; // 'pg' | 'sqlite'
let pool = null;
let sqlite = null;
let initPromise = null;

const DDL_PG = `
CREATE TABLE IF NOT EXISTS submissions (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  form_name TEXT NOT NULL,
  name TEXT,
  email TEXT,
  phone TEXT,
  organisation TEXT,
  interest TEXT,
  program TEXT,
  message TEXT,
  files TEXT,
  status TEXT NOT NULL DEFAULT 'new'
);
CREATE INDEX IF NOT EXISTS idx_submissions_id ON submissions (id DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions (status);
CREATE TABLE IF NOT EXISTS subscribers (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  email TEXT NOT NULL UNIQUE,
  first_name TEXT
);
CREATE TABLE IF NOT EXISTS files (
  id SERIAL PRIMARY KEY,
  submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  bytes BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`;

const DDL_SQLITE = `
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  form_name TEXT NOT NULL,
  name TEXT,
  email TEXT,
  phone TEXT,
  organisation TEXT,
  interest TEXT,
  program TEXT,
  message TEXT,
  files TEXT,
  status TEXT NOT NULL DEFAULT 'new'
);
CREATE INDEX IF NOT EXISTS idx_submissions_id ON submissions (id DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions (status);
CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  email TEXT NOT NULL UNIQUE,
  first_name TEXT
);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  bytes BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`;

function pgSql(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${(i += 1)}`);
}

function poolConfig() {
  const connectionString = process.env.DATABASE_URL;
  const isLocal = /(?:localhost|127\.0\.0\.1)/.test(connectionString ?? '');
  return {
    connectionString,
    // Serverless functions must not open a pool per instance; Supabase's
    // transaction pooler (port 6543) is designed for this.
    max: process.env.VERCEL ? 1 : 10,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  };
}

async function doInit(poolOverride) {
  if (poolOverride || process.env.DATABASE_URL) {
    mode = 'pg';
    pool = poolOverride ?? new Pool(poolConfig());
    // A dying idle client must never take the process down.
    if (typeof pool.on === 'function') {
      pool.on('error', (error) => console.error('db: idle pool client error', error));
    }
    await pool.query(DDL_PG);
    console.log('db: connected to Postgres');
  } else {
    if (process.env.VERCEL) {
      throw new Error(
        'DATABASE_URL is required on Vercel — serverless functions have no persistent disk. ' +
          'Set it to your Supabase Postgres connection string.',
      );
    }
    const { DatabaseSync } = await import('node:sqlite');
    mode = 'sqlite';
    const dir = join(root, 'data');
    mkdirSync(dir, { recursive: true });
    sqlite = new DatabaseSync(join(dir, 'app.db'));
    sqlite.exec(DDL_SQLITE);
    console.log('db: using local SQLite (./data/app.db)');
  }
  return mode;
}

/**
 * Connect and ensure the schema exists. Safe to call on every request: it
 * connects once per process and retries if a previous attempt failed (for
 * example while Postgres was paused or the network blipped).
 */
export async function initDb(poolOverride = null) {
  if (mode) return mode;
  if (poolOverride) return doInit(poolOverride);
  if (!initPromise) {
    initPromise = doInit().catch((error) => {
      initPromise = null; // allow a later request to retry
      throw error;
    });
  }
  return initPromise;
}

export function dbMode() {
  return mode;
}

function displayDate(value) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 19).replace('T', ' ');
  }
  return value;
}

export async function insertSubmission(fields) {
  await initDb();
  const sql = `INSERT INTO submissions
     (form_name, name, email, phone, organisation, interest, program, message, files)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const params = [
    fields.form_name,
    fields.name ?? null,
    fields.email ?? null,
    fields.phone ?? null,
    fields.organisation ?? null,
    fields.interest ?? null,
    fields.program ?? null,
    fields.message ?? null,
    fields.files ?? null,
  ];
  if (mode === 'pg') {
    const res = await pool.query(pgSql(sql) + ' RETURNING id', params);
    return res.rows[0]?.id ?? null;
  }
  const result = sqlite.prepare(sql).run(...params);
  return result.lastInsertRowid != null ? Number(result.lastInsertRowid) : null;
}

export async function insertSubscriberIgnore(email, firstName) {
  await initDb();
  if (mode === 'pg') {
    await pool.query(
      'INSERT INTO subscribers (email, first_name) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING',
      [email, firstName ?? null],
    );
    return;
  }
  sqlite.prepare('INSERT OR IGNORE INTO subscribers (email, first_name) VALUES (?, ?)').run(email, firstName ?? null);
}

export async function listSubmissions(formName, limit = 200) {
  await initDb();
  let rows;
  if (mode === 'pg') {
    const res = formName
      ? await pool.query('SELECT * FROM submissions WHERE form_name = $1 ORDER BY id DESC LIMIT $2', [
          formName,
          limit,
        ])
      : await pool.query('SELECT * FROM submissions ORDER BY id DESC LIMIT $1', [limit]);
    rows = res.rows;
  } else {
    rows = formName
      ? sqlite.prepare('SELECT * FROM submissions WHERE form_name = ? ORDER BY id DESC LIMIT ?').all(formName, limit)
      : sqlite.prepare('SELECT * FROM submissions ORDER BY id DESC LIMIT ?').all(limit);
  }
  return rows.map((row) => ({ ...row, created_at: displayDate(row.created_at) }));
}

/** Submissions created since the start of the current month (UTC). */
export async function countThisMonth() {
  await initDb();
  if (mode === 'pg') {
    const res = await pool.query(
      "SELECT COUNT(*) AS count FROM submissions WHERE created_at >= date_trunc('month', NOW())",
    );
    return Number(res.rows[0]?.count ?? 0);
  }
  const row = sqlite
    .prepare("SELECT COUNT(*) AS count FROM submissions WHERE created_at >= date('now', 'start of month')")
    .get();
  return Number(row?.count ?? 0);
}

export async function countByForm() {
  await initDb();
  if (mode === 'pg') {
    const res = await pool.query(
      'SELECT form_name, COUNT(*) AS count FROM submissions GROUP BY form_name ORDER BY form_name',
    );
    return res.rows;
  }
  return sqlite
    .prepare('SELECT form_name, COUNT(*) AS count FROM submissions GROUP BY form_name ORDER BY form_name')
    .all();
}

/** True when any submission message already contains the fragment (donation dedupe). */
export async function submissionExists(fragment) {
  await initDb();
  if (mode === 'pg') {
    const res = await pool.query("SELECT 1 FROM submissions WHERE message LIKE '%' || $1 || '%' LIMIT 1", [
      fragment,
    ]);
    return res.rows.length > 0;
  }
  const row = sqlite
    .prepare("SELECT 1 AS found FROM submissions WHERE message LIKE '%' || ? || '%' LIMIT 1")
    .get(fragment);
  return Boolean(row);
}

export async function setSubmissionStatus(id, status) {
  await initDb();
  const n = Number(id);
  if (!Number.isInteger(n)) return;
  if (mode === 'pg') {
    await pool.query('UPDATE submissions SET status = $1 WHERE id = $2', [status, n]);
    return;
  }
  sqlite.prepare('UPDATE submissions SET status = ? WHERE id = ?').run(status, n);
}

export async function updateSubmissionFiles(id, filesJson) {
  await initDb();
  const n = Number(id);
  if (!Number.isInteger(n)) return;
  if (mode === 'pg') {
    await pool.query('UPDATE submissions SET files = $1 WHERE id = $2', [filesJson, n]);
    return;
  }
  sqlite.prepare('UPDATE submissions SET files = ? WHERE id = ?').run(filesJson, n);
}

export async function insertFile(submissionId, name, mime, bytes) {
  await initDb();
  if (mode === 'pg') {
    const res = await pool.query(
      'INSERT INTO files (submission_id, name, mime, bytes) VALUES ($1, $2, $3, $4) RETURNING id',
      [submissionId, name, mime, bytes],
    );
    return res.rows[0]?.id ?? null;
  }
  const result = sqlite
    .prepare('INSERT INTO files (submission_id, name, mime, bytes) VALUES (?, ?, ?, ?)')
    .run(submissionId, name, mime, bytes);
  return result.lastInsertRowid != null ? Number(result.lastInsertRowid) : null;
}

export async function getFile(id) {
  await initDb();
  const n = Number(id);
  if (!Number.isInteger(n)) return null;
  if (mode === 'pg') {
    const res = await pool.query('SELECT id, name, mime, bytes FROM files WHERE id = $1 LIMIT 1', [n]);
    return res.rows[0] ?? null;
  }
  const row = sqlite.prepare('SELECT id, name, mime, bytes FROM files WHERE id = ? LIMIT 1').get(n);
  return row ?? null;
}
