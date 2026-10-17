/**
 * /inbox/community — moderation for the public community features.
 *
 * New comments, discussion topics and replies arrive as `pending` and are only
 * shown on the site once approved here. Live-chat messages publish immediately
 * (a chat that needs approval is not a chat) and are removed from the
 * "Published" list if needed. Protected by the same login as /inbox.
 */
import { Router } from 'express';
import { asyncHandler, getCookie, inboxToken } from '../lib.js';
import {
  countCommunity,
  deleteCommunityItem,
  listAllChatMessages,
  listAllComments,
  listAllReplies,
  listAllTopics,
  setCommunityStatus,
} from '../db.js';

export const moderationRouter = Router();

const COOKIE = 'fikra_inbox';

const STYLES = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: #f4f6f5; color: #17211f; }
  header { background: #0e6e6e; color: #fff; padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  header h1 { font-size: 18px; margin: 0; }
  header a { color: #fff; }
  main { max-width: 900px; margin: 0 auto; padding: 24px 20px 60px; }
  h2 { font-size: 16px; margin: 28px 0 10px; }
  h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: #5b6b66; margin: 18px 0 8px; }
  .card { background: #fff; border: 1px solid #dfe5e2; border-radius: 12px; padding: 12px 14px; margin-bottom: 10px; }
  .card.pending { border-color: #e6c98a; background: #fffdf6; }
  .meta { color: #5b6b66; font-size: 13px; }
  .body { white-space: pre-wrap; overflow-wrap: anywhere; margin: 6px 0 0; }
  .row { display: flex; gap: 8px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
  form { display: inline; }
  button { font: inherit; border: 0; border-radius: 8px; padding: 5px 12px; cursor: pointer; background: #b42318; color: #fff; }
  button.approve { background: #0e6e6e; }
  .actions { display: flex; gap: 6px; }
  .counts { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; font-size: 13px; }
  .counts .count { background: #fff; border: 1px solid #dfe5e2; border-radius: 999px; padding: 4px 10px; }
  .counts .count b { color: #0e6e6e; }
  .empty { background: #fff; border: 1px dashed #cfd8d4; border-radius: 12px; padding: 20px; text-align: center; color: #5b6b66; }
`;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(title, bodyContent) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(title)} — FIKRA</title><style>${STYLES}</style></head>
<body>${bodyContent}</body></html>`;
}

function isAuthed(req) {
  const password = process.env.INBOX_PASSWORD;
  if (!password) return false;
  return getCookie(req, COOKIE) === inboxToken(password);
}

function form(type, id, action, label, approve = false) {
  return `<form method="post" action="/inbox/community">
    <input type="hidden" name="type" value="${type}">
    <input type="hidden" name="id" value="${id}">
    <input type="hidden" name="action" value="${action}">
    <button type="submit"${approve ? ' class="approve"' : ''}>${label}</button>
  </form>`;
}

function card(kind, row, { pending = false, body } = {}) {
  const text = body ?? row.body ?? '';
  return `<article class="card${pending ? ' pending' : ''}">
    <div class="row">
      <div class="meta">${escapeHtml(row.created_at)} UTC · ${kind} #${row.id} · ${escapeHtml(row.author_name)}</div>
      <div class="actions">
        ${pending ? form(kind, row.id, 'approve', 'Approve', true) : ''}
        ${form(kind, row.id, 'delete', 'Delete')}
      </div>
    </div>
    <p class="body">${escapeHtml(text)}</p>
  </article>`;
}

function section(title, html, emptyText) {
  return `<h3>${escapeHtml(title)}</h3>${html || `<div class="empty">${escapeHtml(emptyText)}</div>`}`;
}

moderationRouter.get(
  '/inbox/community',
  asyncHandler(async (req, res) => {
    if (!process.env.INBOX_PASSWORD) {
      return res.status(503).type('text').send('INBOX_PASSWORD is not set.');
    }
    if (!isAuthed(req)) return res.redirect('/inbox');

    let counts;
    let pendingComments;
    let pendingTopics;
    let pendingReplies;
    let visibleComments;
    let visibleTopics;
    let visibleReplies;
    let allChat;
    try {
      [counts, pendingComments, pendingTopics, pendingReplies, visibleComments, visibleTopics, visibleReplies, allChat] =
        await Promise.all([
          countCommunity(),
          listAllComments('pending'),
          listAllTopics('pending'),
          listAllReplies('pending'),
          listAllComments('visible'),
          listAllTopics('visible'),
          listAllReplies('visible'),
          listAllChatMessages(),
        ]);
    } catch (error) {
      console.error('inbox/community: could not load', error);
      return res
        .status(503)
        .send(layout('Community moderation', '<main><div class="empty">The database is unavailable right now.</div></main>'));
    }

    const pendingCount =
      counts.pending.comments + counts.pending.topics + counts.pending.replies + counts.pending.chat;

    const pendingTopicsHtml = pendingTopics
      .map((t) => card('topic', t, { pending: true, body: t.title }))
      .join('');
    const pendingRepliesHtml = pendingReplies
      .map((r) => card('reply', r, { pending: true, body: `(topic #${r.topic_id}) ${r.body}` }))
      .join('');
    const pendingCommentsHtml = pendingComments
      .map((c) => card('comment', c, { pending: true, body: `(${c.page}) ${c.body}` }))
      .join('');

    const visibleTopicsHtml = visibleTopics
      .map((t) => card('topic', t, { body: `${t.title} — ${t.reply_count} replies` }))
      .join('');
    const visibleRepliesHtml = visibleReplies
      .map((r) => card('reply', r, { body: `(topic #${r.topic_id}) ${r.body}` }))
      .join('');
    const visibleCommentsHtml = visibleComments
      .map((c) => card('comment', c, { body: `(${c.page}) ${c.body}` }))
      .join('');
    const chatHtml = allChat.map((m) => card('chat', m)).join('');

    const body = `<header>
      <h1>Community moderation</h1>
      <div><a href="/inbox">← Back to inbox</a></div>
    </header>
    <main>
      <div class="counts">
        <span class="count">Waiting: <b>${pendingCount}</b></span>
        <span class="count">Comments: <b>${counts.pending.comments}</b> pending · ${counts.visible.comments} live</span>
        <span class="count">Topics: <b>${counts.pending.topics}</b> pending · ${counts.visible.topics} live</span>
        <span class="count">Replies: <b>${counts.pending.replies}</b> pending · ${counts.visible.replies} live</span>
        <span class="count">Chat: <b>${counts.visible.chat}</b> live</span>
      </div>

      <h2>Waiting for approval${pendingCount ? ` (${pendingCount})` : ''}</h2>
      ${
        pendingCount === 0
          ? '<div class="empty">Nothing waiting. New comments, topics and replies appear here.</div>'
          : `${section('Topics', pendingTopicsHtml, 'No topics waiting.')}
             ${section('Replies', pendingRepliesHtml, 'No replies waiting.')}
             ${section('Comments', pendingCommentsHtml, 'No comments waiting.')}`
      }

      <h2>Published</h2>
      ${section('Topics', visibleTopicsHtml, 'No published topics.')}
      ${section('Replies', visibleRepliesHtml, 'No published replies.')}
      ${section('Comments', visibleCommentsHtml, 'No published comments.')}
      ${section('Live chat', chatHtml, 'No chat messages.')}
    </main>`;

    return res.send(layout('Community moderation', body));
  }),
);

moderationRouter.post(
  '/inbox/community',
  asyncHandler(async (req, res) => {
    if (!isAuthed(req)) return res.redirect('/inbox');
    const type = String(req.body?.type ?? '');
    const id = Number(req.body?.id);
    const action = req.body?.action === 'approve' ? 'approve' : 'delete';
    if (!['comment', 'topic', 'reply', 'chat'].includes(type) || !Number.isInteger(id)) {
      return res.status(400).type('text').send('Bad request');
    }
    try {
      if (action === 'approve') {
        await setCommunityStatus(type, id, 'visible');
      } else {
        await deleteCommunityItem(type, id);
      }
    } catch (error) {
      console.error('inbox/community: update failed', error);
    }
    return res.redirect('/inbox/community');
  }),
);
