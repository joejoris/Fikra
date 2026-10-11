/**
 * Cloudflare Pages Function — /inbox
 *
 * A small, private inbox listing every form submission recorded in D1, with a
 * handled/unhandled toggle. Protected by a signed cookie derived from the
 * INBOX_PASSWORD environment variable.
 *
 * This is intentionally minimal. For real deployments, put /inbox (and
 * /api/files) behind Cloudflare Access, which gives you SSO, audit logs and
 * removes the need for a shared password.
 *
 * Environment variables:
 *   INBOX_PASSWORD    — required; the shared password for the inbox
 * Bindings:
 *   DB                — D1 database (see schema/submissions.sql)
 */

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = unknown>(): Promise<T | null>;
}

interface D1Database {
  prepare(sql: string): D1PreparedStatement;
}

interface Env {
  INBOX_PASSWORD?: string;
  DB?: D1Database;
}

interface Ctx {
  request: Request;
  env: Env;
}

interface Submission {
  id: number;
  created_at: string;
  form_name: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  organisation: string | null;
  interest: string | null;
  program: string | null;
  message: string | null;
  files: string | null;
  status: string;
}

const COOKIE = 'fikra_inbox';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function html(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function expectedToken(password: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode('fikra-inbox-v1'));
  return base64Url(new Uint8Array(signature));
}

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

async function isAuthed(request: Request, env: Env): Promise<boolean> {
  if (!env.INBOX_PASSWORD) return false;
  const token = getCookie(request, COOKIE);
  if (!token) return false;
  return token === (await expectedToken(env.INBOX_PASSWORD));
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

function layout(title: string, bodyContent: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} — FIKRA</title><style>${STYLES}</style></head>
<body>${bodyContent}</body></html>`;
}

function loginPage(error?: string): string {
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

function submissionCard(row: Submission): string {
  let files: { name: string; url: string | null }[] = [];
  if (row.files) {
    try {
      files = JSON.parse(row.files) as typeof files;
    } catch {
      files = [];
    }
  }

  const fields: [string, string | null][] = [
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
              file.url
                ? `<a href="${escapeHtml(file.url)}">${escapeHtml(file.name)}</a>`
                : `${escapeHtml(file.name)} (emailed)`,
            )
            .join(' · ')}</p>`
        : ''
    }
  </article>`;
}

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Stream every submission as a CSV download (backup/export for the team). */
async function exportCsv(env: Env): Promise<Response> {
  if (!env.DB) return html('Database not configured', 503);

  const { results } = await env.DB.prepare(
    `SELECT * FROM submissions ORDER BY created_at ASC`,
  ).all<Submission>();

  const header = [
    'id',
    'created_at',
    'form_name',
    'status',
    'name',
    'email',
    'phone',
    'organisation',
    'interest',
    'program',
    'message',
    'files',
  ];
  const rows = results.map((row) =>
    [
      row.id,
      row.created_at,
      row.form_name,
      row.status,
      row.name,
      row.email,
      row.phone,
      row.organisation,
      row.interest,
      row.program,
      row.message,
      row.files,
    ]
      .map(csvCell)
      .join(','),
  );

  const content = '\uFEFF' + [header.join(','), ...rows].join('\r\n');
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(content, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="fikra-submissions-${stamp}.csv"`,
      'cache-control': 'no-store',
    },
  });
}

async function listPage(env: Env, formName: string | null): Promise<Response> {
  if (!env.DB) {
    return html(
      layout(
        'Inbox',
        `<header><h1>FIKRA inbox</h1></header><main><div class="empty">
          The inbox database is not connected yet. Create a D1 database and bind it
          as <code>DB</code> (see schema/submissions.sql and wrangler.toml).
        </div></main>`,
      ),
      503,
    );
  }

  const statement = formName
    ? env.DB.prepare(
        `SELECT * FROM submissions WHERE form_name = ? ORDER BY created_at DESC LIMIT 200`,
      ).bind(formName)
    : env.DB.prepare(`SELECT * FROM submissions ORDER BY created_at DESC LIMIT 200`);
  const { results } = await statement.all<Submission>();

  const { results: formCounts } = await env.DB.prepare(
    `SELECT form_name, COUNT(*) AS count FROM submissions GROUP BY form_name ORDER BY form_name`,
  ).all<{ form_name: string; count: number }>();

  const newCount = results.filter((row) => row.status !== 'handled').length;

  const option = (value: string, count: number) =>
    `<option value="${escapeHtml(value)}"${formName === value ? ' selected' : ''}>${
      escapeHtml(value)
    } (${count})</option>`;

  const body = `<header>
      <div><h1>FIKRA inbox</h1><div class="meta">${results.length} shown · ${newCount} to handle</div></div>
      <div class="row">
        <a href="/inbox${formName ? `?form=${encodeURIComponent(formName)}&` : '?'}export=csv">Export CSV</a>
        <a href="/inbox?logout=1">Sign out</a>
      </div>
    </header>
    <main>
      <div class="counts">
        <span class="count">To handle: <b>${newCount}</b></span>
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
        ${
          formName
            ? `<a href="/inbox" style="font-size:13px">Clear filter</a>`
            : ''
        }
      </form>
      ${
        results.length
          ? results.map(submissionCard).join('')
          : '<div class="empty">No submissions yet.</div>'
      }
    </main>`;

  return html(layout('Inbox', body));
}

export async function onRequestGet(context: Ctx): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);

  if (url.searchParams.get('logout')) {
    return html('', 302, {
      location: '/inbox',
      'set-cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
    });
  }

  if (!env.INBOX_PASSWORD) {
    return html(
      layout(
        'Inbox',
        `<header><h1>FIKRA inbox</h1></header><main><div class="empty">
          Set the <code>INBOX_PASSWORD</code> environment variable to enable the inbox.
        </div></main>`,
      ),
      503,
    );
  }

  if (!(await isAuthed(request, env))) {
    return html(loginPage());
  }

  if (url.searchParams.get('export') === 'csv') {
    return exportCsv(env);
  }

  const formName = (url.searchParams.get('form') || '').trim() || null;
  return listPage(env, formName);
}

export async function onRequestPost(context: Ctx): Promise<Response> {
  const { request, env } = context;

  if (!env.INBOX_PASSWORD) {
    return html(loginPage('The inbox is not configured.'), 503);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return html('Bad request', 400);
  }

  // Login.
  const password = form.get('password');
  if (typeof password === 'string') {
    if (password === env.INBOX_PASSWORD) {
      const token = await expectedToken(env.INBOX_PASSWORD);
      return html('', 302, {
        location: '/inbox',
        'set-cookie': `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE}`,
      });
    }
    return html(loginPage('Incorrect password.'));
  }

  // Actions require an authenticated session.
  if (!(await isAuthed(request, env))) {
    return html(loginPage());
  }

  const id = Number(form.get('id'));
  const action = form.get('action');
  if (!env.DB || !Number.isInteger(id) || (action !== 'handled' && action !== 'new')) {
    return html('Bad request', 400);
  }

  await env.DB.prepare(`UPDATE submissions SET status = ? WHERE id = ?`)
    .bind(action, id)
    .run();

  return html('', 302, { location: '/inbox' });
}
