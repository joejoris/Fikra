/**
 * Community API — comments + likes, discussion board, live chat.
 *
 *   GET  /api/comments?page=…        list comments for a page
 *   POST /api/comments               { page, body, name?, email? }
 *   POST /api/comments/:id/like      toggle like (member, or one-per-visitor)
 *   GET  /api/topics                 list discussion topics
 *   POST /api/topics                 { title, body, name?, email? }
 *   GET  /api/topics/:id             one topic + its replies
 *   POST /api/topics/:id/replies     { body, name?, email? }
 *   GET  /api/chat?after=<id>        chat messages (polling)
 *   POST /api/chat                   { body, name?, email? }
 *
 * Posting works two ways: signed-in members post as themselves; guests post
 * with a name and email. Everything is shown immediately and can be removed
 * from /inbox/community (the user's chosen "publish, delete later" model).
 */
import { Router } from 'express';
import {
  anonKey,
  asyncHandler,
  clean,
  createRateLimiter,
  currentMemberId,
  isEmail,
  looksSpammy,
  tooFast,
} from '../lib.js';
import {
  getMember,
  getTopic,
  insertChat,
  insertComment,
  insertReply,
  insertTopic,
  listChat,
  listComments,
  listTopics,
  toggleCommentLike,
} from '../db.js';

export const communityRouter = Router();

const MAX_BODY = 2000;
const MAX_TITLE = 140;

const commentLimit = createRateLimiter(15, 10 * 60 * 1000);
const topicLimit = createRateLimiter(6, 10 * 60 * 1000);
const replyLimit = createRateLimiter(20, 10 * 60 * 1000);
const chatLimit = createRateLimiter(40, 2 * 60 * 1000);

function fail(res, status, error) {
  return res.status(status).json({ ok: false, error });
}

/**
 * Resolve who is posting. A signed-in member wins; otherwise a guest must
 * supply a name and email.
 */
async function resolvePoster(req) {
  const memberId = currentMemberId(req);
  if (memberId) {
    const member = await getMember(memberId);
    if (member) {
      return { member_id: member.id, author_name: member.name, author_email: member.email };
    }
  }
  const name = clean(req.body?.name).slice(0, 60);
  const email = clean(req.body?.email).toLowerCase();
  if (!name || !isEmail(email)) return null;
  return { member_id: null, author_name: name, author_email: email };
}

function rateLimit(res, limiter, req) {
  if (limiter(req.ip ?? 'unknown')) {
    return fail(res, 429, 'Too many posts just now. Please slow down and try again in a few minutes.');
  }
  return null;
}

// --- Comments + likes -------------------------------------------------------

communityRouter.get(
  '/api/comments',
  asyncHandler(async (req, res) => {
    const page = clean(req.query.page).slice(0, 200);
    if (!page) return fail(res, 400, 'Missing page.');
    const viewer = currentMemberId(req) ? `m:${currentMemberId(req)}` : anonKey(req.ip);
    const comments = await listComments(page, viewer);
    return res.json({ ok: true, comments });
  }),
);

communityRouter.post(
  '/api/comments',
  asyncHandler(async (req, res) => {
    if (rateLimit(res, commentLimit, req)) return;
    const page = clean(req.body?.page).slice(0, 200);
    const body = clean(req.body?.body).slice(0, MAX_BODY);
    if (!page || !body) return fail(res, 400, 'Please write a comment before posting.');
    if (tooFast(req.body?._loadedAt)) return fail(res, 400, 'Please wait a moment and try again.');
    if (looksSpammy(body)) return fail(res, 400, 'That looks like spam, so it was not posted.');

    const poster = await resolvePoster(req);
    if (!poster) return fail(res, 400, 'Please add your name and a valid email, or sign in.');

    const id = await insertComment({ page, body, ...poster });
    if (id == null) return fail(res, 502, 'We could not post your comment just now. Please try again.');
    return res.json({
      ok: true,
      comment: {
        id: Number(id),
        created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
        author_name: poster.author_name,
        body,
        likes: 0,
        liked: false,
        is_member: poster.member_id != null,
      },
    });
  }),
);

communityRouter.post(
  '/api/comments/:id/like',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return fail(res, 400, 'Unknown comment.');
    const liker = currentMemberId(req) ? `m:${currentMemberId(req)}` : anonKey(req.ip);
    const likes = await toggleCommentLike(id, liker);
    if (likes == null) return fail(res, 404, 'Unknown comment.');
    return res.json({ ok: true, likes });
  }),
);

// --- Discussion board -------------------------------------------------------

communityRouter.get(
  '/api/topics',
  asyncHandler(async (req, res) => {
    const topics = await listTopics();
    return res.json({ ok: true, topics });
  }),
);

communityRouter.post(
  '/api/topics',
  asyncHandler(async (req, res) => {
    if (rateLimit(res, topicLimit, req)) return;
    const title = clean(req.body?.title).slice(0, MAX_TITLE);
    const body = clean(req.body?.body).slice(0, MAX_BODY);
    if (!title || !body) return fail(res, 400, 'Please add a title and a message.');
    if (tooFast(req.body?._loadedAt)) return fail(res, 400, 'Please wait a moment and try again.');
    if (looksSpammy(`${title} ${body}`)) return fail(res, 400, 'That looks like spam, so it was not posted.');

    const poster = await resolvePoster(req);
    if (!poster) return fail(res, 400, 'Please add your name and a valid email, or sign in.');

    const id = await insertTopic({ title, body, ...poster });
    if (id == null) return fail(res, 502, 'We could not post that just now. Please try again.');
    return res.json({ ok: true, id: Number(id) });
  }),
);

communityRouter.get(
  '/api/topics/:id',
  asyncHandler(async (req, res) => {
    const topic = await getTopic(Number(req.params.id));
    if (!topic) return fail(res, 404, 'That topic no longer exists.');
    return res.json({ ok: true, topic });
  }),
);

communityRouter.post(
  '/api/topics/:id/replies',
  asyncHandler(async (req, res) => {
    if (rateLimit(res, replyLimit, req)) return;
    const body = clean(req.body?.body).slice(0, MAX_BODY);
    if (!body) return fail(res, 400, 'Please write a reply.');
    if (looksSpammy(body)) return fail(res, 400, 'That looks like spam, so it was not posted.');

    const poster = await resolvePoster(req);
    if (!poster) return fail(res, 400, 'Please add your name and a valid email, or sign in.');

    const id = await insertReply(Number(req.params.id), { body, ...poster });
    if (id == null) return fail(res, 404, 'That topic no longer exists.');
    return res.json({ ok: true, id: Number(id) });
  }),
);

// --- Live chat --------------------------------------------------------------

communityRouter.get(
  '/api/chat',
  asyncHandler(async (req, res) => {
    const after = req.query.after != null && req.query.after !== '' ? Number(req.query.after) : null;
    const messages = await listChat(Number.isInteger(after) ? after : null);
    return res.json({ ok: true, messages });
  }),
);

communityRouter.post(
  '/api/chat',
  asyncHandler(async (req, res) => {
    if (rateLimit(res, chatLimit, req)) return;
    const body = clean(req.body?.body).slice(0, MAX_BODY);
    if (!body) return fail(res, 400, 'Please type a message.');
    if (looksSpammy(body)) return fail(res, 400, 'That looks like spam, so it was not sent.');

    const poster = await resolvePoster(req);
    if (!poster) return fail(res, 400, 'Please add your name and a valid email, or sign in.');

    const id = await insertChat({ body, ...poster });
    if (id == null) return fail(res, 502, 'We could not send that just now. Please try again.');
    return res.json({
      ok: true,
      message: {
        id: Number(id),
        created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
        author_name: poster.author_name,
        body,
      },
    });
  }),
);
