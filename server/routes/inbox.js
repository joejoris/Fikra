/**
 * /inbox — private submissions list with handled toggle, source filter and
 * CSV export. Protected by a signed cookie derived from INBOX_PASSWORD.
 *
 * Same behaviour as before; file links now point at /api/files/:id, which
 * requires this same login.
 */
import { Router } from 'express';
import { asyncHandler, getCookie, inboxToken } from '../lib.js';
import { countByForm, countThisMonth, listSubmissions, setSubmissionStatus } from '../db.js';

export const inboxRouter = Router();

const COOKIE = 'fikra_inbox';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLES = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: #f4f6f5; color: #17211f; }
  header { background: #0e6e6e; color: #fff; padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  header h1 { font-size: 18px; margin: 0; }
  header .meta { font-size: 13px; opacity: .9; }
  header a { color: #fff; }
  main { max-width: 900px; margin: 0 auto; padding: 24px 20px 60px; }
  .badge { display: inline-block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; padding: 3px 8px; border-radius: 999px; }
  .badge.new { background: #fde8c8; color: #8a4b00; }
  .badge.handled { background: #d9e9e4; color: #0e5a4a; }
  .badge.form { background: #e6e9f5; color: #2b3a8a; }
  .card { background: #fff; border: 1px solid #dfe5e2; border-radius: 12px; padding: 16px 18px; margin-bottom: 14px; }
  .card h2 { font-size: 16px; margin: 0 0 2px; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  dl { display: grid; grid-template-columns: 130px 1fr; gap: 4px 12px; margin: 10px 0 0; font-size: 14px; }
  dt { color: #5b6b66; }
  dd { margin: 0; overflow-wrap: anywhere; }
  pre { white-space: pre-wrap; font: inherit; margin: 8px 0 0; }
  form.inline { display: inline; }
  button { font: inherit; border: 0; border-radius: 8px; padding: 6px 12px; cursor: pointer; background: #0e6e6e; color: #fff; }
  button.secondary { background: #e3eae7; color: #17211f; }
  .empty { background: #fff; border: 1px dashed #cfd8d4; border-radius: 12px; padding: 28px; text-align: center; color: #5b6b66; }
  .login { max-width: 340px; margin: 60px auto; background: #fff; border: 1px solid #dfe5e2; border-radius: 12px; padding: 24px; }
  .login label { display: block; font-weight: 600; margin-bottom: 6px; }
  .login input { width: 100%; padding: 10px; border: 1px solid #cfd8d4; border-radius: 8px; font: inherit; }
  .login button { width: 100%; margin-top: 12px; padding: 10px; }
  .error { color: #b42318; font-size: 14px; margin-top: 10px; }
  .toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; font-size: 14px; }
  .toolbar select { padding: 8px 10px; border: 1px solid #cfd8d4; border-radius: 8px; font: inherit; background: #fff; }
  .counts { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; font-size: 13px; }
  .counts .count { background: #fff; border: 1px solid #dfe5e2; border-radius: 999px; padding: 4px 10px; }
  .counts .count b { color: #0e6e6e; }
`;

function layout(title, bodyContent) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} — FIKRA</title><style>${STYLES}</style></head>
<body>${bodyContent}</body></html>`;
}

function loginPage(error) {
  return layout(
    'Inbox login',
    `<div class="login">
      <h1 style="margin:0 0 4px;font-size:18px">FIKRA inbox</h1>
      <p style="margin:0 0 16px;color:#5b6b66;font-size:14px">Enter the inbox password to continue.</p>
      <form method="post" action="/inbox">
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" autofocus required>
        <button type="submit">Sign in</button>
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
      </form>
    </div>`,
  );
}

function dbUnavailable() {
  return layout(
    'Inbox',
    `<header><h1>FIKRA inbox</h1></header><main><div class="empty">
      The submissions database is unavailable right now. Please try again shortly.
    </div></main>`,
  );
}

function isAuthed(req) {
  const password = process.env.INBOX_PASSWORD;
  if (!password) return false;
  return getCookie(req, COOKIE) === inboxToken(password);
}

function cookieHeader(req, value, maxAge) {
  const secure = req.secure ? '; Secure' : '';
  return `${COOKIE}=${value}; Path=/; HttpOnly${secure}; SameSite=Strict; Max-Age=${maxAge}`;
}

function submissionCard(row) {
  let files = [];
  if (row.files) {
    try {
      files = JSON.parse(row.files);
    } catch {
      files = [];
    }
  }

  const fields = [
    ['Form', row.form_name],
    ['Name', row.name],
    ['Email', row.email],
    ['Phone', row.phone],
    ['Organisation', row.organisation],
    ['Interest', row.interest],
    ['Program', row.program],
  ];

  const handled = row.status === 'handled';

  return `<article class="card">
    <div class="row" style="justify-content:space-between">
      <div class="row">
        <span class="badge ${handled ? 'handled' : 'new'}">${handled ? 'Handled' : 'New'}</span>
        <span class="badge form">${escapeHtml(row.form_name)}</span>
        <span class="meta" style="color:#5b6b66;font-size:13px">${escapeHtml(row.created_at)} UTC · #${row.id}</span>
      </div>
      <form class="inline" method="post" action="/inbox">
        <input type="hidden" name="id" value="${row.id}">
        <input type="hidden" name="action" value="${handled ? 'new' : 'handled'}">
        <button class="${handled ? 'secondary' : ''}" type="submit">${handled ? 'Mark as new' : 'Mark handled'}</button>
      </form>
    </div>
    <dl>
      ${fields
        .filter(([, value]) => value)
        .map(
          ([label, value]) =>
            `<dt>${escapeHtml(label)}</dt><dd>${
              label === 'Email'
                ? `<a href="mailto:${escapeHtml(value)}">${escapeHtml(value)}</a>`
                : escapeHtml(value)
            }</dd>`,
        )
        .join('')}
    </dl>
    ${row.message ? `<pre>${escapeHtml(row.message)}</pre>` : ''}
    ${
      files.length
        ? `<p style="margin:12px 0 0;font-size:14px">${files
            .map((file) =>
              file.fileId
                ? `<a href="/api/files/${file.fileId}">${escapeHtml(file.name)}</a>`
                : escapeHtml(file.name),
            )
            .join(' · ')}</p>`
        : ''
    }
  </article>`;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

inboxRouter.get(
  '/inbox',
  asyncHandler(async (req, res) => {
    if (req.query.logout !== undefined) {
      res.setHeader('Set-Cookie', cookieHeader(req, '', 0));
      return res.redirect('/inbox');
    }

    if (!process.env.INBOX_PASSWORD) {
      return res.status(503).send(
        layout(
          'Inbox',
          `<header><h1>FIKRA inbox</h1></header><main><div class="empty">
            Set the <code>INBOX_PASSWORD</code> environment variable to enable the inbox.
          </div></main>`,
        ),
      );
    }

    if (!isAuthed(req)) {
      return res.send(loginPage());
    }

    if (req.query.export === 'csv') {
      let rows;
      try {
        rows = await listSubmissions(null, 100000);
      } catch (error) {
        console.error('inbox: csv export failed', error);
        return res.status(503).send(dbUnavailable());
      }
      const header = [
        'id', 'created_at', 'form_name', 'status', 'name', 'email',
        'phone', 'organisation', 'interest', 'program', 'message', 'files',
      ];
      const lines = rows.map((row) =>
        [
          row.id, row.created_at, row.form_name, row.status, row.name,
          row.email, row.phone, row.organisation, row.interest,
          row.program, row.message, row.files,
        ]
          .map(csvCell)
          .join(','),
      );
      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="fikra-submissions-${stamp}.csv"`);
      res.setHeader('Cache-Control', 'no-store');
      return res.send(String.fromCharCode(0xfeff) + [header.join(','), ...lines].join('\r\n'));
    }

    const formName = String(req.query.form ?? '').trim() || null;
    let results;
    let formCounts;
    let monthCount;
    try {
      results = await listSubmissions(formName);
      formCounts = await countByForm();
      monthCount = await countThisMonth();
    } catch (error) {
      console.error('inbox: could not load submissions', error);
      return res.status(503).send(dbUnavailable());
    }
    const newCount = results.filter((row) => row.status !== 'handled').length;

    const option = (value, count) =>
      `<option value="${escapeHtml(value)}"${formName === value ? ' selected' : ''}>${escapeHtml(value)} (${count})</option>`;

    const body = `<header>
      <div><h1>FIKRA inbox</h1><div class="meta">${results.length} shown · ${newCount} to handle</div></div>
      <div class="row">
        <a href="/inbox/community">Community</a>
        <a href="/inbox${formName ? `?form=${encodeURIComponent(formName)}&` : '?'}export=csv">Export CSV</a>
        <a href="/inbox?logout=1">Sign out</a>
      </div>
    </header>
    <main>
      <div class="counts">
        <span class="count">To handle: <b>${newCount}</b></span>
        <span class="count">This month: <b>${monthCount}</b></span>
        ${formCounts
          .map(
            (row) =>
              `<a class="count" style="text-decoration:none;color:inherit" href="/inbox?form=${encodeURIComponent(
                row.form_name,
              )}">${escapeHtml(row.form_name)}: <b>${row.count}</b></a>`,
          )
          .join('')}
      </div>
      <form class="toolbar" method="get" action="/inbox">
        <label for="form-filter">Source</label>
        <select id="form-filter" name="form" onchange="this.form.submit()">
          <option value="">All sources</option>
          ${formCounts.map((row) => option(row.form_name, row.count)).join('')}
        </select>
        ${formName ? `<a href="/inbox" style="font-size:13px">Clear filter</a>` : ''}
      </form>
      ${results.length ? results.map(submissionCard).join('') : '<div class="empty">No submissions yet.</div>'}
    </main>`;

    return res.send(layout('Inbox', body));
  }),
);

inboxRouter.post(
  '/inbox',
  asyncHandler(async (req, res) => {
    if (!process.env.INBOX_PASSWORD) {
      return res.status(503).send(loginPage('The inbox is not configured.'));
    }

    const password = req.body?.password;
    if (typeof password === 'string') {
      if (password === process.env.INBOX_PASSWORD) {
        res.setHeader('Set-Cookie', cookieHeader(req, inboxToken(password), COOKIE_MAX_AGE));
        return res.redirect('/inbox');
      }
      return res.send(loginPage('Incorrect password.'));
    }

    if (!isAuthed(req)) {
      return res.send(loginPage());
    }

    const id = Number(req.body?.id);
    const action = req.body?.action;
    if (!Number.isInteger(id) || (action !== 'handled' && action !== 'new')) {
      return res.status(400).send('Bad request');
    }

    try {
      await setSubmissionStatus(id, action);
    } catch (error) {
      console.error('inbox: could not update status', error);
      return res.status(503).send(dbUnavailable());
    }
    return res.redirect('/inbox');
  }),
);
