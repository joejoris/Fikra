/**
 * Storage for the FIKRA API server.
 *
 * Two backends behind one interface:
 * - MongoDB when MONGODB_URI is set (MongoDB Atlas, production on Render).
 * - Local SQLite file (./data/app.db) otherwise — no setup needed.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Binary, MongoClient, ObjectId } from 'mongodb';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let mode = null; // 'mongo' | 'sqlite'
let mongoDb = null;
let mongoClient = null;
let sqlite = null;

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

export async function initDb() {
  if (mode) return mode;
  if (process.env.MONGODB_URI) {
    mode = 'mongo';
    mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    mongoDb = mongoClient.db();
    await mongoDb.collection('subscribers').createIndex({ email: 1 }, { unique: true });
    await mongoDb.collection('submissions').createIndex({ form_name: 1 });
    await mongoDb.collection('submissions').createIndex({ status: 1 });
    console.log('db: connected to MongoDB');
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

function displayId(value) {
  return value != null ? String(value) : value;
}

export async function insertSubmission(fields) {
  if (mode === 'mongo') {
    const res = await mongoDb.collection('submissions').insertOne({
      form_name: fields.form_name,
      name: fields.name ?? null,
      email: fields.email ?? null,
      phone: fields.phone ?? null,
      organisation: fields.organisation ?? null,
      interest: fields.interest ?? null,
      program: fields.program ?? null,
      message: fields.message ?? null,
      files: fields.files ?? null,
      status: 'new',
      created_at: new Date(),
    });
    return res.insertedId.toHexString();
  }
  const result = sqlite
    .prepare(
      `INSERT INTO submissions
         (form_name, name, email, phone, organisation, interest, program, message, files)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      fields.form_name,
      fields.name ?? null,
      fields.email ?? null,
      fields.phone ?? null,
      fields.organisation ?? null,
      fields.interest ?? null,
      fields.program ?? null,
      fields.message ?? null,
      fields.files ?? null,
    );
  return result.lastInsertRowid != null ? Number(result.lastInsertRowid) : null;
}

export async function insertSubscriberIgnore(email, firstName) {
  if (mode === 'mongo') {
    try {
      await mongoDb
        .collection('subscribers')
        .insertOne({ email, first_name: firstName ?? null, created_at: new Date() });
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
    return;
  }
  sqlite
    .prepare('INSERT OR IGNORE INTO subscribers (email, first_name) VALUES (?, ?)')
    .run(email, firstName ?? null);
}

function shapeSubmission(doc) {
  return {
    id: doc._id != null ? displayId(doc._id) : doc.id,
    created_at: displayDate(doc.created_at),
    form_name: doc.form_name,
    status: doc.status,
    name: doc.name,
    email: doc.email,
    phone: doc.phone,
    organisation: doc.organisation,
    interest: doc.interest,
    program: doc.program,
    message: doc.message,
    files: doc.files,
  };
}

export async function listSubmissions(formName, limit = 200) {
  if (mode === 'mongo') {
    const filter = formName ? { form_name: formName } : {};
    const docs = await mongoDb
      .collection('submissions')
      .find(filter)
      .sort({ _id: -1 })
      .limit(limit)
      .toArray();
    return docs.map(shapeSubmission);
  }
  const rows = formName
    ? sqlite.prepare('SELECT * FROM submissions WHERE form_name = ? ORDER BY id DESC LIMIT ?').all(formName, limit)
    : sqlite.prepare('SELECT * FROM submissions ORDER BY id DESC LIMIT ?').all(limit);
  return rows;
}

export async function countByForm() {
  if (mode === 'mongo') {
    const groups = await mongoDb
      .collection('submissions')
      .aggregate([{ $group: { _id: '$form_name', count: { $sum: 1 } } }, { $sort: { _id: 1 } }])
      .toArray();
    return groups.map((g) => ({ form_name: g._id, count: g.count }));
  }
  return sqlite
    .prepare('SELECT form_name, COUNT(*) AS count FROM submissions GROUP BY form_name ORDER BY form_name')
    .all();
}

function toSubmissionKey(id) {
  if (mode === 'mongo') {
    return ObjectId.isValid(id) ? new ObjectId(id) : null;
  }
  const n = Number(id);
  return Number.isInteger(n) ? n : null;
}

export async function setSubmissionStatus(id, status) {
  const key = toSubmissionKey(id);
  if (key == null) return;
  if (mode === 'mongo') {
    await mongoDb.collection('submissions').updateOne({ _id: key }, { $set: { status } });
    return;
  }
  sqlite.prepare('UPDATE submissions SET status = ? WHERE id = ?').run(status, key);
}

export async function updateSubmissionFiles(id, filesJson) {
  const key = toSubmissionKey(id);
  if (key == null) return;
  if (mode === 'mongo') {
    await mongoDb.collection('submissions').updateOne({ _id: key }, { $set: { files: filesJson } });
    return;
  }
  sqlite.prepare('UPDATE submissions SET files = ? WHERE id = ?').run(filesJson, key);
}

export async function insertFile(submissionId, name, mime, bytes) {
  if (mode === 'mongo') {
    const res = await mongoDb.collection('files').insertOne({
      submission_id: submissionId,
      name,
      mime,
      bytes: new Binary(bytes),
      created_at: new Date(),
    });
    return res.insertedId.toHexString();
  }
  const result = sqlite
    .prepare('INSERT INTO files (submission_id, name, mime, bytes) VALUES (?, ?, ?, ?)')
    .run(submissionId, name, mime, bytes);
  return result.lastInsertRowid != null ? Number(result.lastInsertRowid) : null;
}

export async function getFile(id) {
  if (mode === 'mongo') {
    if (!ObjectId.isValid(id)) return null;
    const doc = await mongoDb.collection('files').findOne({ _id: new ObjectId(id) });
    if (!doc) return null;
    return { name: doc.name, mime: doc.mime, bytes: Buffer.from(doc.bytes.buffer) };
  }
  const n = Number(id);
  if (!Number.isInteger(n)) return null;
  const row = sqlite.prepare('SELECT id, name, mime, bytes FROM files WHERE id = ? LIMIT 1').get(n);
  return row ?? null;
}
