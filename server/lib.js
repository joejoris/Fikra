/**
 * Shared helpers for the FIKRA API server (Render web service).
 *
 * Mirrors the behaviour of the previous Cloudflare Pages Functions so the
 * frontend needs no changes: same endpoints, same validation messages,
 * same rate limits.
 */
import crypto from 'node:crypto';

const MAX_FIELD_LENGTH = 4000;

export function clean(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, MAX_FIELD_LENGTH);
}

export function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function safeFileName(name) {
  return (
    String(name)
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_{2,}/g, '_')
      .slice(0, 80) || 'file'
  );
}

/** In-memory sliding-window rate limiter. Per process — on multi-instance
 *  deploys use a shared store (Redis) if abuse becomes a problem. */
export function createRateLimiter(max, windowMs) {
  const hits = new Map();
  return function limited(key) {
    const now = Date.now();
    const windowStart = now - windowMs;
    const recent = (hits.get(key) ?? []).filter((t) => t > windowStart);
    recent.push(now);
    hits.set(key, recent);
    return recent.length > max;
  };
}

export async function verifyTurnstile(secret, token, ip) {
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret, response: token, remoteip: ip }),
    });
    const result = await res.json();
    return result.success === true;
  } catch {
    return false;
  }
}

export async function sendResend(apiKey, payload) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  let text = '';
  try {
    text = await res.text();
  } catch {
    text = '';
  }
  return { ok: res.ok, status: res.status, text };
}

/** Signed inbox cookie value derived from the shared password. */
export function inboxToken(password) {
  return crypto
    .createHmac('sha256', password)
    .update('fikra-inbox-v1')
    .digest('base64url');
}

export function getCookie(req, name) {
  const header = req.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return null;
}

/** Wrap async Express handlers so rejections reach the error middleware. */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
