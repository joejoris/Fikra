/**
 * Cloudflare Pages Function — POST /api/contact
 *
 * Receives JSON submissions from the site forms, does basic validation and
 * spam protection, then forwards the message by email (via Resend).
 *
 * Environment variables (set in the Cloudflare Pages dashboard):
 *   RESEND_API_KEY      — required to actually send mail
 *   CONTACT_TO_EMAIL    — where submissions are delivered
 *   CONTACT_FROM_EMAIL  — verified sender, e.g. "FIKRA Website <website@domain>"
 *   TURNSTILE_SECRET_KEY — optional Cloudflare Turnstile secret
 *
 * If RESEND_API_KEY is missing the endpoint returns 503 rather than silently
 * dropping submissions.
 */

interface Env {
  RESEND_API_KEY?: string;
  CONTACT_TO_EMAIL?: string;
  CONTACT_FROM_EMAIL?: string;
  TURNSTILE_SECRET_KEY?: string;
}

interface Ctx {
  request: Request;
  env: Env;
}

const MAX_FIELD_LENGTH = 4000;
const RATE_LIMIT_MAX = 5; // submissions
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

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

export async function onRequestPost(context: Ctx): Promise<Response> {
  const { request, env } = context;

  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  if (rateLimited(ip)) {
    return json({ ok: false, error: 'Too many submissions. Please try later.' }, 429);
  }

  let data: Record<string, unknown>;
  try {
    data = (await request.json()) as Record<string, unknown>;
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
      text: lines.join('\n'),
    }),
  });

  if (!res.ok) {
    console.error('contact: send failed', res.status, await res.text());
    return json({ ok: false, error: 'Could not send your message. Please try again.' }, 502);
  }

  return json({ ok: true });
}

// Reject non-POST methods on this route.
export function onRequestGet(): Response {
  return json({ ok: false, error: 'Method not allowed.' }, 405);
}
