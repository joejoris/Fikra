/**
 * Cloudflare Pages Function — POST /api/rsvp
 *
 * Receives RSVPs from the events page, records them in the D1 inbox
 * (form_name = "rsvp") and sends:
 *   1. a notification email to FIKRA, and
 *   2. a confirmation email to the attendee.
 *
 * Environment variables (set in the Cloudflare Pages dashboard):
 *   RESEND_API_KEY        — required to actually send mail
 *   CONTACT_TO_EMAIL      — where RSVP notifications are delivered
 *   CONTACT_FROM_EMAIL    — verified sender, e.g. "FIKRA Website <website@domain>"
 *   TURNSTILE_SECRET_KEY  — optional Cloudflare Turnstile secret
 * Bindings (optional):
 *   DB                    — D1 database (see schema/submissions.sql)
 *
 * If RESEND_API_KEY is missing the endpoint returns 503 rather than silently
 * dropping registrations.
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
  CONTACT_TO_EMAIL?: string;
  CONTACT_FROM_EMAIL?: string;
  TURNSTILE_SECRET_KEY?: string;
  DB?: D1Database;
}

interface Ctx {
  request: Request;
  env: Env;
}

const MAX_FIELD_LENGTH = 400;
const MAX_GUESTS = 20;
const RATE_LIMIT_MAX = 10; // RSVPs per window
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

  const eventSlug = clean(data.event_slug);
  const eventTitle = clean(data.event_title) || 'a FIKRA event';
  const name = clean(data.name);
  const email = clean(data.email);
  const guests = Number(data.guests);
  const consent = clean(data.consent);

  if (!eventSlug || !name || !email || !isEmail(email) || !consent) {
    return json(
      { ok: false, error: 'Please provide your name, a valid email, and tick the consent box.' },
      400,
    );
  }
  if (!Number.isInteger(guests) || guests < 1 || guests > MAX_GUESTS) {
    return json({ ok: false, error: 'Please enter a number of attendees between 1 and 20.' }, 400);
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
  const to = env.CONTACT_TO_EMAIL;
  const from = env.CONTACT_FROM_EMAIL;

  if (!apiKey || !to || !from) {
    console.error('rsvp: email is not configured (missing RESEND_API_KEY / CONTACT_TO_EMAIL / CONTACT_FROM_EMAIL)');
    return json(
      { ok: false, error: 'Registration is not fully set up yet. Please contact us directly.' },
      503,
    );
  }

  // Notify FIKRA (required for the request to succeed).
  const notify = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: email,
      subject: `[FIKRA website] RSVP — ${eventTitle} — ${name}`,
      text: [
        `Event: ${eventTitle}`,
        `Event code: ${eventSlug}`,
        `Name: ${name}`,
        `Email: ${email}`,
        `Attendees (including this person): ${guests}`,
      ].join('\n'),
    }),
  });

  if (!notify.ok) {
    console.error('rsvp: notify failed', notify.status, await notify.text());
    return json({ ok: false, error: 'Could not register you. Please try again.' }, 502);
  }

  // Record the RSVP in the inbox (best effort — never fail the request).
  if (env.DB) {
    try {
      await env.DB.prepare(
        `INSERT INTO submissions (form_name, name, email, program, message)
         VALUES ('rsvp', ?, ?, ?, ?)`,
      )
        .bind(
          name,
          email,
          eventSlug,
          `Event: ${eventTitle}\nAttendees: ${guests}`,
        )
        .run();
    } catch (error) {
      console.error('rsvp: db insert failed', error);
    }
  }

  // Confirmation email to the attendee (best effort).
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
        subject: `You are registered: ${eventTitle} — FIKRA`,
        text: [
          `Hello ${name},`,
          '',
          `Thanks for registering for ${eventTitle}.`,
          '',
          `We have noted ${guests} ${guests === 1 ? 'attendee' : 'attendees'} (including you).`,
          `If your plans change, please let us know so we can free your spot.`,
          '',
          'We look forward to seeing you there.',
          '',
          '— FIKRA',
        ].join('\n'),
      }),
    });
  } catch (error) {
    console.error('rsvp: confirmation email failed', error);
  }

  return json({ ok: true });
}

export function onRequestGet(): Response {
  return json({ ok: false, error: 'Method not allowed.' }, 405);
}