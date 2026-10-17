/**
 * Private direct messages — available only to signed-in members.
 *
 *   GET  /api/dm/members?q=…      find people to message (name/email)
 *   GET  /api/dm/conversations    people you have messaged, with unread counts
 *   GET  /api/dm/:memberId        a thread with one member (marks it read)
 *   POST /api/dm/:memberId        { body } — send a private message
 *
 * Guests cannot use DMs; the client shows a sign-in prompt instead.
 */
import { Router } from 'express';
import { asyncHandler, clean, createRateLimiter, currentMemberId, looksSpammy } from '../lib.js';
import {
  getMember,
  insertDm,
  listDmConversations,
  listDmThread,
  markDmRead,
  searchMembers,
} from '../db.js';

export const dmRouter = Router();

const MAX_BODY = 2000;
const dmLimit = createRateLimiter(40, 5 * 60 * 1000);

function fail(res, status, error) {
  return res.status(status).json({ ok: false, error });
}

function requireMember(req) {
  return currentMemberId(req);
}

dmRouter.get(
  '/api/dm/members',
  asyncHandler(async (req, res) => {
    const me = requireMember(req);
    if (!me) return fail(res, 401, 'Please sign in to send private messages.');
    const q = clean(req.query.q).slice(0, 60);
    if (q.length < 2) return res.json({ ok: true, members: [] });
    const members = await searchMembers(q, me);
    return res.json({ ok: true, members });
  }),
);

dmRouter.get(
  '/api/dm/conversations',
  asyncHandler(async (req, res) => {
    const me = requireMember(req);
    if (!me) return fail(res, 401, 'Please sign in to send private messages.');
    const conversations = await listDmConversations(me);
    return res.json({ ok: true, conversations });
  }),
);

dmRouter.get(
  '/api/dm/:memberId',
  asyncHandler(async (req, res) => {
    const me = requireMember(req);
    if (!me) return fail(res, 401, 'Please sign in to send private messages.');
    const otherId = Number(req.params.memberId);
    const other = Number.isInteger(otherId) ? await getMember(otherId) : null;
    if (!other || Number(other.id) === Number(me)) return fail(res, 404, 'That member could not be found.');
    const messages = await listDmThread(me, otherId);
    await markDmRead(me, otherId);
    return res.json({ ok: true, member: { id: Number(other.id), name: other.name }, messages });
  }),
);

dmRouter.post(
  '/api/dm/:memberId',
  asyncHandler(async (req, res) => {
    const me = requireMember(req);
    if (!me) return fail(res, 401, 'Please sign in to send private messages.');
    if (dmLimit(req.ip ?? 'unknown')) {
      return fail(res, 429, 'Too many messages just now. Please slow down.');
    }
    const otherId = Number(req.params.memberId);
    const other = Number.isInteger(otherId) ? await getMember(otherId) : null;
    if (!other || Number(other.id) === Number(me)) return fail(res, 404, 'That member could not be found.');
    const body = clean(req.body?.body).slice(0, MAX_BODY);
    if (!body) return fail(res, 400, 'Please write a message.');
    if (looksSpammy(body)) return fail(res, 400, 'That looks like spam, so it was not sent.');
    const id = await insertDm(me, otherId, body);
    if (id == null) return fail(res, 502, 'We could not send that just now. Please try again.');
    return res.json({
      ok: true,
      message: {
        id: Number(id),
        created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
        mine: true,
        body,
      },
    });
  }),
);
