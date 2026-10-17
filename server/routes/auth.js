/**
 * Optional member accounts for the community features.
 *
 *   POST /api/auth/signup   { name, email, password }
 *   POST /api/auth/login    { email, password }
 *   POST /api/auth/logout
 *   GET  /api/auth/me       -> { ok, member | null }
 *
 * Accounts are optional: guests can still comment and chat with just a name
 * and email. Passwords are hashed with scrypt; the session is a signed,
 * HttpOnly cookie. No email verification (there is no configured mailer by
 * default) — keep that in mind before treating an account as trusted.
 */
import { Router } from 'express';
import {
  asyncHandler,
  clean,
  createRateLimiter,
  currentMemberId,
  hashPassword,
  isEmail,
  memberCookieHeader,
  memberToken,
  verifyPassword,
} from '../lib.js';
import { createMember, findMemberByEmail, getMember } from '../db.js';

export const authRouter = Router();

const signupLimit = createRateLimiter(8, 10 * 60 * 1000);
const loginLimit = createRateLimiter(12, 10 * 60 * 1000);

function publicMember(m) {
  return m ? { id: Number(m.id), name: m.name, email: m.email } : null;
}

authRouter.post(
  '/api/auth/signup',
  asyncHandler(async (req, res) => {
    if (signupLimit(req.ip ?? 'unknown')) {
      return res.status(429).json({ ok: false, error: 'Too many attempts. Please try again later.' });
    }
    const name = clean(req.body?.name).slice(0, 60);
    const email = clean(req.body?.email).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!name || !isEmail(email) || password.length < 8) {
      return res.status(400).json({
        ok: false,
        error: 'Please enter your name, a valid email, and a password of at least 8 characters.',
      });
    }

    const { salt, hash } = hashPassword(password);
    const id = await createMember(name, email, hash, salt);
    if (!id) {
      return res.status(409).json({ ok: false, error: 'That email is already registered. Try signing in instead.' });
    }
    res.setHeader('Set-Cookie', memberCookieHeader(req, memberToken(id)));
    return res.json({ ok: true, member: { id: Number(id), name, email } });
  }),
);

authRouter.post(
  '/api/auth/login',
  asyncHandler(async (req, res) => {
    if (loginLimit(req.ip ?? 'unknown')) {
      return res.status(429).json({ ok: false, error: 'Too many attempts. Please try again later.' });
    }
    const email = clean(req.body?.email).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const member = email ? await findMemberByEmail(email) : null;
    if (!member || !verifyPassword(password, member.salt, member.password_hash)) {
      return res.status(401).json({ ok: false, error: 'Email or password is incorrect.' });
    }
    res.setHeader('Set-Cookie', memberCookieHeader(req, memberToken(member.id)));
    return res.json({ ok: true, member: publicMember(member) });
  }),
);

authRouter.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', memberCookieHeader(req, '', 0));
  return res.json({ ok: true });
});

authRouter.get(
  '/api/auth/me',
  asyncHandler(async (req, res) => {
    const id = currentMemberId(req);
    if (!id) return res.json({ ok: true, member: null });
    const member = await getMember(id);
    return res.json({ ok: true, member: publicMember(member) });
  }),
);
