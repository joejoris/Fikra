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

/**
 * Time-trap: the browser stamps `_loadedAt` when the page loads. Submissions
 * stamped less than ~2s ago (or with a clock impossibly far in the future)
 * are bots. A missing stamp means JavaScript is off — always allow those.
 */
export function tooFast(loadedAt) {
  if (loadedAt == null || loadedAt === '') return false;
  const stamped = Number(loadedAt);
  if (!Number.isFinite(stamped)) return true;
  const age = Date.now() - stamped;
  return age < 2000 || age > 1000 * 60 * 60 * 24 * 30;
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

// ---------------------------------------------------------------------------
// Optional member accounts (email + password) for the community features
// ---------------------------------------------------------------------------

export const MEMBER_COOKIE = 'fikra_member';
const MEMBER_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function sessionSecret() {
  return process.env.SESSION_SECRET || process.env.INBOX_PASSWORD || 'fikra-dev-secret';
}

/** Hash a password with a per-user random salt (scrypt, built into Node). */
export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, salt, hash) {
  try {
    const candidate = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

/** Signed, expiring session token for a member id. */
export function memberToken(id) {
  const exp = Date.now() + MEMBER_MAX_AGE * 1000;
  const payload = `${id}.${exp}`;
  const sig = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function readMemberToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [id, exp, sig] = parts;
  const expected = crypto.createHmac('sha256', sessionSecret()).update(`${id}.${exp}`).digest('base64url');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (Number(exp) < Date.now()) return null;
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function memberCookieHeader(req, value, maxAge = MEMBER_MAX_AGE) {
  const secure = req.secure ? '; Secure' : '';
  return `${MEMBER_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=${maxAge}`;
}

/** The logged-in member id for this request, or null. */
export function currentMemberId(req) {
  return readMemberToken(getCookie(req, MEMBER_COOKIE));
}

/** Stable, anonymous key for rate limits and "one like per visitor". */
export function anonKey(ip) {
  return 'ip:' + crypto.createHash('sha256').update(String(ip ?? '')).digest('hex').slice(0, 32);
}

/**
 * Very small starter spam screen. Not a substitute for moderation — it only
 * catches the obvious (link spam and a few keywords). Extend the list as
 * needed. Titles/bodies are still shown only after a person posts them.
 */
const SPAM_TERMS = [
  'viagra', 'cialis', 'casino', 'porn', 'xxx', 'sexcam', 'sex cam',
  'free bitcoin', 'crypto giveaway', 'loan offer', 'work from home',
  'make money fast', 'seo services', 'rank your website',
];

export function looksSpammy(text) {
  const lower = String(text).toLowerCase();
  if (SPAM_TERMS.some((term) => lower.includes(term))) return true;
  const links = (lower.match(/https?:\/\//g) ?? []).length;
  if (links > 2) return true;
  if (/(.)\1{12,}/.test(lower)) return true; // aaaaaaaaaaaa
  return false;
}
