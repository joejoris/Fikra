/**
 * Cloudflare Pages Function — POST /api/contact
 *
 * Receives submissions from the site forms (JSON or multipart/form-data),
 * does basic validation and spam protection, then forwards the message by
 * email (via Resend). File attachments (CVs, pitch decks) are stored in R2 when
 * the FILES binding is present, and otherwise sent as email attachments.
 *
 * Environment variables (set in the Cloudflare Pages dashboard):
 *   RESEND_API_KEY        — required to actually send mail
 *   CONTACT_TO_EMAIL      — where submissions are delivered
 *   CONTACT_FROM_EMAIL    — verified sender, e.g. "FIKRA Website <website@domain>"
 *   TURNSTILE_SECRET_KEY  — optional Cloudflare Turnstile secret
 * Bindings (optional):
 *   FILES                 — an R2 bucket for storing uploads
 *
 * If RESEND_API_KEY is missing the endpoint returns 503 rather than silently
 * dropping submissions.
 */

interface R2Bucket {
  put(
    key: string,
    value: ArrayBuffer | ReadableStream | string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<unknown>;
}

interface D1Database {
  prepare(sql: string): D1PreparedStatement;
}

interface Env {
  RESEND_API_KEY?: string;
  CONTACT_TO_EMAIL?: string;
  CONTACT_FROM_EMAIL?: string;
  TURNSTILE_SECRET_KEY?: string;
  FILES?: R2Bucket;
  DB?: D1Database;
}

interface Ctx {
  request: Request;
  env: Env;
}

const MAX_FIELD_LENGTH = 4000;
const RATE_LIMIT_MAX = 5; // submissions
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const MAX_FILES = 2;
const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB each
const ALLOWED_FILE_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png',
  'image/jpeg',
];

// Best-effort, per-isolate rate limiting. For durable limits across isolates,
// move this to Cloudflare KV or Durable Objects. See docs/launch-checklist.md.
const hits = new Map<string, number[]>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function clean(value: unknown): string {
  if (typeof value !== 'string') return '';
  // Strip control characters and clamp length.
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_FIELD_LENGTH);
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const recent = (hits.get(ip) ?? []).filter((t) => t > windowStart);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_LIMIT_MAX;
}

function safeFileName(name: string): string {
  return (
    name
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_{2,}/g, '_')
      .slice(0, 80) || 'file'
  );
}

async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function onRequestPost(context: Ctx): Promise<Response> {
  const { request, env } = context;

  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  if (rateLimited(ip)) {
    return json({ ok: false, error: 'Too many submissions. Please try later.' }, 429);
  }

  const contentType = request.headers.get('content-type') ?? '';
  const isMultipart = contentType.includes('multipart/form-data');

  const data: Record<string, unknown> = {};
  const files: File[] = [];

  try {
    if (isMultipart) {
      const form = await request.formData();
      for (const [key, value] of form.entries()) {
        if (typeof value === 'string') {
          data[key] = value;
        } else if (value instanceof File && value.size > 0) {
          files.push(value);
        }
      }
    } else {
      Object.assign(data, (await request.json()) as Record<string, unknown>);
    }
  } catch {
    return json({ ok: false, error: 'Invalid request.' }, 400);
  }

  // Honeypot — bots fill hidden fields. Pretend success, send nothing.
  if (clean(data._gotcha)) {
    return json({ ok: true });
  }

  const name = clean(data.name);
  const email = clean(data.email);
  const phone = clean(data.phone);
  const organisation = clean(data.organisation);
  const interest = clean(data.interest);
  const program = clean(data.program);
  const message = clean(data.message);
  const formName = clean(data._formName) || 'website form';
  const consent = clean(data.consent);

  if (!name || !email || !isEmail(email) || !consent) {
    return json({ ok: false, error: 'Please provide your name, a valid email and consent.' }, 400);
  }

  // Validate uploads before doing anything else.
  if (files.length > MAX_FILES) {
    return json({ ok: false, error: `Please attach at most ${MAX_FILES} files.` }, 400);
  }
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      return json({ ok: false, error: `“${file.name}” is larger than 8 MB.` }, 400);
    }
    if (file.type && !ALLOWED_FILE_TYPES.includes(file.type)) {
      return json({ ok: false, error: `“${file.name}” is not an accepted file type.` }, 400);
    }
  }

  // Optional Turnstile verification when configured.
  if (env.TURNSTILE_SECRET_KEY) {
    const token = clean(data['cf-turnstile-response']);
    if (!token) {
      return json({ ok: false, error: 'Verification required.' }, 400);
    }
    const verify = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip }),
      },
    );
    const result = (await verify.json()) as { success?: boolean };
    if (!result.success) {
      return json({ ok: false, error: 'Verification failed.' }, 400);
    }
  }

  const apiKey = env.RESEND_API_KEY;
  const to = env.CONTACT_TO_EMAIL;
  const from = env.CONTACT_FROM_EMAIL;

  if (!apiKey || !to || !from) {
    console.error('contact: email is not configured (missing RESEND_API_KEY / CONTACT_TO_EMAIL / CONTACT_FROM_EMAIL)');
    return json(
      { ok: false, error: 'This form is not fully set up yet. Please email us directly.' },
      503,
    );
  }

  const lines = [
    `Form: ${formName}`,
    `Name: ${name}`,
    `Email: ${email}`,
    phone && `Phone: ${phone}`,
    organisation && `Organisation: ${organisation}`,
    interest && `Interest: ${interest}`,
    program && `Program: ${program}`,
    '',
    message || '(no message)',
  ].filter(Boolean);

  const attachments: { filename: string; content: string }[] = [];
  const fileRecords: { name: string; url: string | null }[] = [];

  if (files.length > 0) {
    if (env.FILES) {
      // Store in R2 and link to them from the email.
      const origin = new URL(request.url).origin;
      for (const file of files) {
        const key = `${crypto.randomUUID()}-${safeFileName(file.name)}`;
        await env.FILES.put(key, await file.arrayBuffer(), {
          httpMetadata: { contentType: file.type || 'application/octet-stream' },
        });
        fileRecords.push({ name: file.name, url: `${origin}/api/files/${key}` });
      }
    } else {
      // No object storage configured — attach the files to the email instead.
      for (const file of files) {
        attachments.push({
          filename: file.name,
          content: await toBase64(file),
        });
        fileRecords.push({ name: file.name, url: null });
      }
    }
  }

  const bodyLines = lines.slice();
  if (fileRecords.length > 0) {
    bodyLines.push(
      '',
      'Attachments:',
      ...fileRecords.map((record) =>
        record.url ? `- ${record.name}: ${record.url}` : `- ${record.name} (attached)`,
      ),
    );
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: email,
      subject: `[FIKRA website] ${formName} — ${name}`,
      text: bodyLines.join('\n'),
      attachments: attachments.length > 0 ? attachments : undefined,
    }),
  });

  if (!res.ok) {
    console.error('contact: send failed', res.status, await res.text());
    return json({ ok: false, error: 'Could not send your message. Please try again.' }, 502);
  }

  // Record the submission for the inbox (best effort — never fail the request).
  if (env.DB) {
    try {
      await env.DB.prepare(
        `INSERT INTO submissions
           (form_name, name, email, phone, organisation, interest, program, message, files)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          formName,
          name,
          email,
          phone || null,
          organisation || null,
          interest || null,
          program || null,
          message || null,
          fileRecords.length > 0 ? JSON.stringify(fileRecords) : null,
        )
        .run();
    } catch (error) {
      console.error('contact: db insert failed', error);
    }
  }

  // Acknowledge to the submitter (best effort — never fail the request for this).
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [email],
        reply_to: to,
        subject: 'We received your message — FIKRA',
        text: [
          `Hello ${name},`,
          '',
          `Thank you for getting in touch with FIKRA. This is just to confirm that`,
          `your message has reached us, and we will reply as soon as we can.`,
          '',
          'For your records, here is what you sent:',
          '',
          message || '(no message)',
          '',
          '— FIKRA',
        ].join('\n'),
      }),
    });
  } catch (error) {
    console.error('contact: auto-reply failed', error);
  }

  return json({ ok: true });
}

// Reject non-POST methods on this route.
export function onRequestGet(): Response {
  return json({ ok: false, error: 'Method not allowed.' }, 405);
}
