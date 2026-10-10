/**
 * Cloudflare Pages Function — POST /api/subscribe
 *
 * Adds an email address to the FIKRA newsletter audience in Resend and sends a
 * short welcome email.
 *
 * Environment variables (set in the Cloudflare Pages dashboard):
 *   RESEND_API_KEY        — required
 *   RESEND_AUDIENCE_ID    — the Resend audience to add contacts to
 *   CONTACT_FROM_EMAIL    — verified sender for the welcome email
 *
 * Requires a Resend Audience (Dashboard → Audiences). If it is not configured
 * the endpoint returns 503 rather than silently dropping the address.
 */

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<unknown>;
}

interface D1Database {
  prepare(sql: string): D1PreparedStatement;
}

interface Env {
  RESEND_API_KEY?: string;
  RESEND_AUDIENCE_ID?: string;
  CONTACT_FROM_EMAIL?: string;
  TURNSTILE_SECRET_KEY?: string;
  DB?: D1Database;
}

interface Ctx {
  request: Request;
  env: Env;
}

const MAX_FIELD_LENGTH = 400;
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

const hits = new Map<string, number[]>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function clean(value: unknown): string {
  if (typeof value !== 'string') return '';
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
    return json({ ok: false, error: 'Too many requests. Please try later.' }, 429);
  }

  let data: Record<string, unknown>;
  try {
    data = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: 'Invalid request.' }, 400);
  }

  // Honeypot.
  if (clean(data._gotcha)) {
    return json({ ok: true });
  }

  const email = clean(data.email);
  const firstName = clean(data.first_name);
  const consent = clean(data.consent);

  if (!email || !isEmail(email) || !consent) {
    return json({ ok: false, error: 'Please provide a valid email and tick the consent box.' }, 400);
  }

  // Optional Turnstile verification when configured.
  if (env.TURNSTILE_SECRET_KEY) {
    const token = clean(data['cf-turnstile-response']);
    if (!token) return json({ ok: false, error: 'Verification required.' }, 400);
    const verify = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip }),
    });
    const result = (await verify.json()) as { success?: boolean };
    if (!result.success) return json({ ok: false, error: 'Verification failed.' }, 400);
  }

  const apiKey = env.RESEND_API_KEY;
  const audienceId = env.RESEND_AUDIENCE_ID;

  if (!apiKey || !audienceId) {
    console.error('subscribe: not configured (missing RESEND_API_KEY / RESEND_AUDIENCE_ID)');
    return json(
      { ok: false, error: 'Sign-up is not fully set up yet. Please contact us directly.' },
      503,
    );
  }

  const addRes = await fetch(`https://api.resend.com/audiences/${audienceId}/contacts`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email,
      first_name: firstName || undefined,
      unsubscribed: false,
    }),
  });

  // 409 means the address is already on the list — treat as success.
  if (!addRes.ok && addRes.status !== 409) {
    console.error('subscribe: add failed', addRes.status, await addRes.text());
    return json({ ok: false, error: 'Could not sign you up. Please try again.' }, 502);
  }

  // Keep a local record too (best effort).
  if (env.DB) {
    try {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO subscribers (email, first_name) VALUES (?, ?)`,
      )
        .bind(email, firstName || null)
        .run();
    } catch (error) {
      console.error('subscribe: db insert failed', error);
    }
  }

  // Welcome email (best effort — never fail the signup because of it).
  if (env.CONTACT_FROM_EMAIL) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: env.CONTACT_FROM_EMAIL,
          to: [email],
          subject: 'Thanks for signing up to FIKRA updates',
          text: [
            `Hello${firstName ? ` ${firstName}` : ''},`,
            '',
            'Thank you for signing up to FIKRA updates. You will hear from us when',
            'there is something worth sharing — new cohorts, events and openings.',
            '',
            'You can unsubscribe at any time from the link in any email we send.',
            '',
            '— FIKRA',
          ].join('\n'),
        }),
      });
    } catch (error) {
      console.error('subscribe: welcome email failed', error);
    }
  }

  return json({ ok: true });
}

export function onRequestGet(): Response {
  return json({ ok: false, error: 'Method not allowed.' }, 405);
}
