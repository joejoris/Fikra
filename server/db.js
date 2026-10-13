/**
 * Storage for the FIKRA API server.
 *
 * Two backends behind one interface:
 * - Postgres when DATABASE_URL is set (Supabase, production on Render).
 * - Local SQLite file (./data/app.db) otherwise — no setup needed.
 *
 * SQL is written with `?` placeholders and translated to $1, $2… for pg.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';

const { Pool } = pg;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let mode = null; // 'pg' | 'sqlite'
let pool = null;
let sqlite = null;

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

export async function initDb(poolOverride = null) {
  if (mode) return mode;
  if (poolOverride || process.env.DATABASE_URL) {
    mode = 'pg';
    pool = poolOverride ?? new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(DDL_PG);
    console.log('db: connected to Postgres');
  } else {
    mode = 'sqlite';
    const dir = join(root, 'data');
    mkdirSync(dir, { recursive: true });
    sqlite = new DatabaseSync(join(dir, 'app.db'));
    sqlite.exec(DDL_SQLITE);
    console.log('db: using local SQLite (./data/app.db)');
  }
  return mode;
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

export async function countByForm() {
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

export async function setSubmissionStatus(id, status) {
  const n = Number(id);
  if (!Number.isInteger(n)) return;
  if (mode === 'pg') {
    await pool.query('UPDATE submissions SET status = $1 WHERE id = $2', [status, n]);
    return;
  }
  sqlite.prepare('UPDATE submissions SET status = ? WHERE id = ?').run(status, n);
}

export async function updateSubmissionFiles(id, filesJson) {
  const n = Number(id);
  if (!Number.isInteger(n)) return;
  if (mode === 'pg') {
    await pool.query('UPDATE submissions SET files = $1 WHERE id = $2', [filesJson, n]);
    return;
  }
  sqlite.prepare('UPDATE submissions SET files = ? WHERE id = ?').run(filesJson, n);
}

export async function insertFile(submissionId, name, mime, bytes) {
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
  const n = Number(id);
  if (!Number.isInteger(n)) return null;
  if (mode === 'pg') {
    const res = await pool.query('SELECT id, name, mime, bytes FROM files WHERE id = $1 LIMIT 1', [n]);
    return res.rows[0] ?? null;
  }
  const row = sqlite.prepare('SELECT id, name, mime, bytes FROM files WHERE id = ? LIMIT 1').get(n);
  return row ?? null;
}
