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
);
CREATE TABLE IF NOT EXISTS members (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS comments (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  page TEXT NOT NULL,
  member_id INTEGER,
  author_name TEXT NOT NULL,
  author_email TEXT,
  body TEXT NOT NULL,
  likes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'visible'
);
CREATE INDEX IF NOT EXISTS idx_comments_page ON comments (page, id);
CREATE TABLE IF NOT EXISTS comment_likes (
  comment_id INTEGER NOT NULL,
  liker TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (comment_id, liker)
);
CREATE TABLE IF NOT EXISTS topics (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  member_id INTEGER,
  author_name TEXT NOT NULL,
  author_email TEXT,
  reply_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'visible'
);
CREATE TABLE IF NOT EXISTS topic_replies (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  topic_id INTEGER NOT NULL,
  member_id INTEGER,
  author_name TEXT NOT NULL,
  author_email TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'visible'
);
CREATE INDEX IF NOT EXISTS idx_replies_topic ON topic_replies (topic_id, id);
CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  member_id INTEGER,
  author_name TEXT NOT NULL,
  author_email TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'visible'
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_id ON chat_messages (id);`;

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
);
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  page TEXT NOT NULL,
  member_id INTEGER,
  author_name TEXT NOT NULL,
  author_email TEXT,
  body TEXT NOT NULL,
  likes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'visible'
);
CREATE INDEX IF NOT EXISTS idx_comments_page ON comments (page, id);
CREATE TABLE IF NOT EXISTS comment_likes (
  comment_id INTEGER NOT NULL,
  liker TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (comment_id, liker)
);
CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_activity TEXT NOT NULL DEFAULT (datetime('now')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  member_id INTEGER,
  author_name TEXT NOT NULL,
  author_email TEXT,
  reply_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'visible'
);
CREATE TABLE IF NOT EXISTS topic_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  topic_id INTEGER NOT NULL,
  member_id INTEGER,
  author_name TEXT NOT NULL,
  author_email TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'visible'
);
CREATE INDEX IF NOT EXISTS idx_replies_topic ON topic_replies (topic_id, id);
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  member_id INTEGER,
  author_name TEXT NOT NULL,
  author_email TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'visible'
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_id ON chat_messages (id);`;

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

// ---------------------------------------------------------------------------
// Community: comments + likes, discussion board, live chat, optional accounts
// ---------------------------------------------------------------------------

/** Run a query and return the rows (works for both backends). */
async function rows(sql, params = []) {
  await initDb();
  if (mode === 'pg') return (await pool.query(pgSql(sql), params)).rows;
  return sqlite.prepare(sql).all(...params);
}

/** Run a query and return the first row, or null. */
async function row(sql, params = []) {
  return (await rows(sql, params))[0] ?? null;
}

/** Run a write (INSERT/UPDATE/DELETE) for its side effect. */
async function exec(sql, params = []) {
  await initDb();
  if (mode === 'pg') {
    await pool.query(pgSql(sql), params);
    return;
  }
  sqlite.prepare(sql).run(...params);
}

/** Run an INSERT and return the new id (both backends). */
async function insert(sql, params = []) {
  await initDb();
  if (mode === 'pg') {
    const res = await pool.query(pgSql(sql) + ' RETURNING id', params);
    return res.rows[0]?.id ?? null;
  }
  const result = sqlite.prepare(sql).run(...params);
  return result.lastInsertRowid != null ? Number(result.lastInsertRowid) : null;
}

export async function createMember(name, email, passwordHash, salt) {
  await initDb();
  if (mode === 'pg') {
    const res = await pool.query(
      `INSERT INTO members (name, email, password_hash, salt) VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING RETURNING id`,
      [name, email, passwordHash, salt],
    );
    return res.rows[0]?.id ?? null;
  }
  const result = sqlite
    .prepare('INSERT OR IGNORE INTO members (name, email, password_hash, salt) VALUES (?, ?, ?, ?)')
    .run(name, email, passwordHash, salt);
  return result.changes > 0 ? Number(result.lastInsertRowid) : null;
}

export async function findMemberByEmail(email) {
  return row('SELECT id, name, email, password_hash, salt FROM members WHERE email = ? LIMIT 1', [email]);
}

export async function getMember(id) {
  const n = Number(id);
  if (!Number.isInteger(n)) return null;
  return row('SELECT id, name, email FROM members WHERE id = ? LIMIT 1', [n]);
}

function commentView(r, likedIds) {
  return {
    id: Number(r.id),
    created_at: displayDate(r.created_at),
    author_name: r.author_name,
    body: r.body,
    likes: Number(r.likes ?? 0),
    liked: likedIds.has(Number(r.id)),
    is_member: r.member_id != null,
  };
}

export async function listComments(page, viewer) {
  const items = await rows(
    "SELECT id, created_at, author_name, body, likes, member_id FROM comments WHERE page = ? AND status = 'visible' ORDER BY id ASC LIMIT 500",
    [page],
  );
  let likedIds = new Set();
  if (viewer) {
    const liked = await rows('SELECT comment_id FROM comment_likes WHERE liker = ?', [viewer]);
    likedIds = new Set(liked.map((r) => Number(r.comment_id)));
  }
  return items.map((r) => commentView(r, likedIds));
}

export async function insertComment(fields) {
  return insert(
    'INSERT INTO comments (page, member_id, author_name, author_email, body, status) VALUES (?, ?, ?, ?, ?, ?)',
    [fields.page, fields.member_id ?? null, fields.author_name, fields.author_email ?? null, fields.body, fields.status ?? 'pending'],
  );
}

export async function commentLikeCount(id) {
  const r = await row('SELECT likes FROM comments WHERE id = ? LIMIT 1', [Number(id)]);
  return Number(r?.likes ?? 0);
}

/** Toggle a like for `liker`; returns the new like count. */
export async function toggleCommentLike(commentId, liker) {
  await initDb();
  const n = Number(commentId);
  if (!Number.isInteger(n)) return null;
  if (mode === 'pg') {
    const existing = await pool.query('SELECT 1 FROM comment_likes WHERE comment_id = $1 AND liker = $2', [n, liker]);
    if (existing.rows.length > 0) {
      await pool.query('DELETE FROM comment_likes WHERE comment_id = $1 AND liker = $2', [n, liker]);
      await pool.query('UPDATE comments SET likes = GREATEST(likes - 1, 0) WHERE id = $1', [n]);
    } else {
      await pool.query('INSERT INTO comment_likes (comment_id, liker) VALUES ($1, $2) ON CONFLICT DO NOTHING', [n, liker]);
      await pool.query('UPDATE comments SET likes = likes + 1 WHERE id = $1', [n]);
    }
  } else {
    const existing = sqlite.prepare('SELECT 1 FROM comment_likes WHERE comment_id = ? AND liker = ?').get(n, liker);
    if (existing) {
      sqlite.prepare('DELETE FROM comment_likes WHERE comment_id = ? AND liker = ?').run(n, liker);
      sqlite.prepare('UPDATE comments SET likes = CASE WHEN likes > 0 THEN likes - 1 ELSE 0 END WHERE id = ?').run(n);
    } else {
      sqlite.prepare('INSERT OR IGNORE INTO comment_likes (comment_id, liker) VALUES (?, ?)').run(n, liker);
      sqlite.prepare('UPDATE comments SET likes = likes + 1 WHERE id = ?').run(n);
    }
  }
  return commentLikeCount(n);
}

export async function listTopics() {
  const items = await rows(
    "SELECT id, created_at, last_activity, title, body, author_name, reply_count, member_id FROM topics WHERE status = 'visible' ORDER BY last_activity DESC LIMIT 100",
  );
  return items.map((r) => ({
    id: Number(r.id),
    created_at: displayDate(r.created_at),
    last_activity: displayDate(r.last_activity),
    title: r.title,
    body: r.body,
    author_name: r.author_name,
    reply_count: Number(r.reply_count ?? 0),
    is_member: r.member_id != null,
  }));
}

export async function insertTopic(fields) {
  return insert(
    'INSERT INTO topics (title, body, member_id, author_name, author_email, status) VALUES (?, ?, ?, ?, ?, ?)',
    [fields.title, fields.body, fields.member_id ?? null, fields.author_name, fields.author_email ?? null, fields.status ?? 'pending'],
  );
}

export async function getTopic(id) {
  const n = Number(id);
  if (!Number.isInteger(n)) return null;
  const t = await row(
    'SELECT id, created_at, last_activity, title, body, author_name, reply_count FROM topics WHERE id = ? LIMIT 1',
    [n],
  );
  if (!t) return null;
  const replies = await rows(
    "SELECT id, created_at, author_name, body FROM topic_replies WHERE topic_id = ? AND status = 'visible' ORDER BY id ASC LIMIT 500",
    [n],
  );
  return {
    id: Number(t.id),
    created_at: displayDate(t.created_at),
    last_activity: displayDate(t.last_activity),
    title: t.title,
    body: t.body,
    author_name: t.author_name,
    reply_count: Number(t.reply_count ?? 0),
    replies: replies.map((r) => ({
      id: Number(r.id),
      created_at: displayDate(r.created_at),
      author_name: r.author_name,
      body: r.body,
    })),
  };
}

export async function insertReply(topicId, fields) {
  const n = Number(topicId);
  if (!Number.isInteger(n)) return null;
  // reply_count is incremented only when a reply becomes visible (see
  // setCommunityStatus), so pending replies are not counted in the board.
  return insert(
    'INSERT INTO topic_replies (topic_id, member_id, author_name, author_email, body, status) VALUES (?, ?, ?, ?, ?, ?)',
    [n, fields.member_id ?? null, fields.author_name, fields.author_email ?? null, fields.body, fields.status ?? 'pending'],
  );
}

export async function listChat(afterId = null) {
  let items;
  if (afterId != null && Number.isInteger(Number(afterId))) {
    items = await rows(
      "SELECT id, created_at, author_name, body FROM chat_messages WHERE id > ? AND status = 'visible' ORDER BY id ASC LIMIT 200",
      [Number(afterId)],
    );
  } else {
    const recent = await rows(
      "SELECT id, created_at, author_name, body FROM chat_messages WHERE status = 'visible' ORDER BY id DESC LIMIT 100",
    );
    items = recent.reverse();
  }
  return items.map((r) => ({
    id: Number(r.id),
    created_at: displayDate(r.created_at),
    author_name: r.author_name,
    body: r.body,
  }));
}

export async function insertChat(fields) {
  return insert('INSERT INTO chat_messages (member_id, author_name, author_email, body, status) VALUES (?, ?, ?, ?, ?)', [
    fields.member_id ?? null,
    fields.author_name,
    fields.author_email ?? null,
    fields.body,
    fields.status ?? 'visible',
  ]);
}

// --- Moderation helpers (used by the /inbox community view) ---

export async function listAllComments(status = null) {
  const cols = 'id, created_at, page, author_name, body, likes, status';
  const items = status
    ? await rows(`SELECT ${cols} FROM comments WHERE status = ? ORDER BY id DESC LIMIT 500`, [status])
    : await rows(`SELECT ${cols} FROM comments ORDER BY id DESC LIMIT 500`);
  return items.map((r) => ({ ...r, created_at: displayDate(r.created_at) }));
}

export async function listAllTopics(status = null) {
  const cols = 'id, created_at, title, author_name, reply_count, status';
  const items = status
    ? await rows(`SELECT ${cols} FROM topics WHERE status = ? ORDER BY id DESC LIMIT 500`, [status])
    : await rows(`SELECT ${cols} FROM topics ORDER BY id DESC LIMIT 500`);
  return items.map((r) => ({ ...r, created_at: displayDate(r.created_at) }));
}

export async function listAllReplies(status = null) {
  const cols = 'id, created_at, topic_id, author_name, body, status';
  const items = status
    ? await rows(`SELECT ${cols} FROM topic_replies WHERE status = ? ORDER BY id DESC LIMIT 500`, [status])
    : await rows(`SELECT ${cols} FROM topic_replies ORDER BY id DESC LIMIT 500`);
  return items.map((r) => ({ ...r, created_at: displayDate(r.created_at) }));
}

export async function listAllChatMessages(status = null) {
  const cols = 'id, created_at, author_name, body, status';
  const items = status
    ? await rows(`SELECT ${cols} FROM chat_messages WHERE status = ? ORDER BY id DESC LIMIT 500`, [status])
    : await rows(`SELECT ${cols} FROM chat_messages ORDER BY id DESC LIMIT 500`);
  return items.map((r) => ({ ...r, created_at: displayDate(r.created_at) }));
}

const COMMUNITY_TABLES = {
  comment: 'comments',
  topic: 'topics',
  reply: 'topic_replies',
  chat: 'chat_messages',
};

/** Delete a single community item (comment, topic + its replies, reply, or chat message). */
export async function deleteCommunityItem(type, id) {
  const table = COMMUNITY_TABLES[type];
  const n = Number(id);
  if (!table || !Number.isInteger(n)) return false;
  await initDb();
  if (type === 'comment') {
    await exec('DELETE FROM comment_likes WHERE comment_id = ?', [n]);
  }
  if (type === 'topic') {
    await exec('DELETE FROM topic_replies WHERE topic_id = ?', [n]);
  }
  if (type === 'reply') {
    const reply = await row('SELECT topic_id, status FROM topic_replies WHERE id = ? LIMIT 1', [n]);
    if (reply && reply.status === 'visible') {
      if (mode === 'pg') {
        await pool.query('UPDATE topics SET reply_count = GREATEST(reply_count - 1, 0) WHERE id = $1', [reply.topic_id]);
      } else {
        sqlite
          .prepare('UPDATE topics SET reply_count = CASE WHEN reply_count > 0 THEN reply_count - 1 ELSE 0 END WHERE id = ?')
          .run(reply.topic_id);
      }
    }
  }
  await exec(`DELETE FROM ${table} WHERE id = ?`, [n]);
  return true;
}

/** Approve (or re-hide) a community item. Approving a reply updates the board. */
export async function setCommunityStatus(type, id, status) {
  const table = COMMUNITY_TABLES[type];
  const n = Number(id);
  if (!table || !Number.isInteger(n)) return false;
  if (type === 'reply' && status === 'visible') {
    const reply = await row('SELECT topic_id FROM topic_replies WHERE id = ? LIMIT 1', [n]);
    if (reply) {
      if (mode === 'pg') {
        await pool.query("UPDATE topics SET reply_count = reply_count + 1, last_activity = NOW() WHERE id = $1", [reply.topic_id]);
      } else {
        sqlite
          .prepare("UPDATE topics SET reply_count = reply_count + 1, last_activity = datetime('now') WHERE id = ?")
          .run(reply.topic_id);
      }
    }
  }
  await exec(`UPDATE ${table} SET status = ? WHERE id = ?`, [status, n]);
  return true;
}

export async function countCommunity() {
  const one = async (table, status) =>
    Number((await row(`SELECT COUNT(*) AS n FROM ${table} WHERE status = ?`, [status]))?.n ?? 0);
  const [cv, tv, rv, mv, cp, tp, rp, mp] = await Promise.all([
    one('comments', 'visible'),
    one('topics', 'visible'),
    one('topic_replies', 'visible'),
    one('chat_messages', 'visible'),
    one('comments', 'pending'),
    one('topics', 'pending'),
    one('topic_replies', 'pending'),
    one('chat_messages', 'pending'),
  ]);
  return {
    visible: { comments: cv, topics: tv, replies: rv, chat: mv },
    pending: { comments: cp, topics: tp, replies: rp, chat: mp },
  };
}
