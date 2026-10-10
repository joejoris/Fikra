-- FIKRA submissions inbox — Cloudflare D1 schema
--
-- Create the database and apply this file:
--   npx wrangler d1 create fikra-submissions
--   npx wrangler d1 execute fikra-submissions --remote --file=./schema/submissions.sql
--
-- Then bind it to the Pages project as `DB` (Dashboard → Settings → Functions →
-- D1 database bindings, or the [[d1_databases]] block in wrangler.toml).

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
  files TEXT,                               -- JSON: [{ name, url }]
  status TEXT NOT NULL DEFAULT 'new'        -- 'new' | 'handled'
);

CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions (status);

CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  email TEXT NOT NULL UNIQUE,
  first_name TEXT
);
