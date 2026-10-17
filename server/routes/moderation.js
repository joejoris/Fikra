/**
 * /inbox/community — moderation for the public community features.
 *
 * Lists every comment, discussion topic, reply and chat message, with a
 * delete button for each. Protected by the same inbox login/cookie as /inbox.
 * (The user chose a "publish immediately, delete later" model, so there is no
 * approval queue — this is where offending posts get removed.)
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
  .card { background: #fff; border: 1px solid #dfe5e2; border-radius: 12px; padding: 12px 14px; margin-bottom: 10px; }
  .meta { color: #5b6b66; font-size: 13px; }
  .body { white-space: pre-wrap; overflow-wrap: anywhere; margin: 6px 0 0; }
  .row { display: flex; gap: 8px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
  button { font: inherit; border: 0; border-radius: 8px; padding: 5px 12px; cursor: pointer; background: #b42318; color: #fff; }
  .counts { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; font-size: 13px; }
  .counts .count { background: #fff; border: 1px solid #dfe5e2; border-radius: 999px; padding: 4px 10px; }
  .empty { background: #fff; border: 1px dashed #cfd8d4; border-radius: 12px; padding: 20px; text-align: center; color: #5b6b66; }
  .login { max-width: 340px; margin: 60px auto; background: #fff; border: 1px solid #dfe5e2; border-radius: 12px; padding: 24px; }
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

function deleteForm(type, id) {
  return `<form method="post" action="/inbox/community">
    <input type="hidden" name="type" value="${type}">
    <input type="hidden" name="id" value="${id}">
    <button type="submit">Delete</button>
  </form>`;
}

function card(kind, row) {
  const when = escapeHtml(row.created_at);
  return `<article class="card">
    <div class="row">
      <div class="meta">${when} UTC · ${kind} #${row.id} · ${escapeHtml(row.author_name)}</div>
      ${deleteForm(kind, row.id)}
    </div>
    <p class="body">${escapeHtml(row.body)}</p>
  </article>`;
}

moderationRouter.get(
  '/inbox/community',
  asyncHandler(async (req, res) => {
    if (!process.env.INBOX_PASSWORD) {
      return res.status(503).type('text').send('INBOX_PASSWORD is not set.');
    }
    if (!isAuthed(req)) return res.redirect('/inbox');

    let counts;
    let comments;
    let topics;
    let replies;
    let chat;
    try {
      [counts, comments, topics, replies, chat] = await Promise.all([
        countCommunity(),
        listAllComments(),
        listAllTopics(),
        listAllReplies(),
        listAllChatMessages(),
      ]);
    } catch (error) {
      console.error('inbox/community: could not load', error);
      return res.status(503).send(layout('Community moderation', '<main><div class="empty">The database is unavailable right now.</div></main>'));
    }

    const topicRows = topics.map(
      (t) => `<article class="card">
        <div class="row">
          <div class="meta">${escapeHtml(t.created_at)} UTC · topic #${t.id} · ${escapeHtml(t.author_name)} · ${t.reply_count} replies</div>
          ${deleteForm('topic', t.id)}
        </div>
        <p class="body"><strong>${escapeHtml(t.title)}</strong></p>
      </article>`,
    );

    const body = `<header>
      <h1>Community moderation</h1>
      <div><a href="/inbox">← Back to inbox</a></div>
    </header>
    <main>
      <div class="counts">
        <span class="count">Comments: <b>${counts.comments}</b></span>
        <span class="count">Topics: <b>${counts.topics}</b></span>
        <span class="count">Replies: <b>${counts.replies}</b></span>
        <span class="count">Chat: <b>${counts.chat}</b></span>
      </div>

      <h2>Discussion topics</h2>
      ${topicRows.length ? topicRows.join('') : '<div class="empty">No topics yet.</div>'}

      <h2>Replies</h2>
      ${
        replies.length
          ? replies
              .map((r) => card('reply', { ...r, body: `(topic #${r.topic_id}) ${r.body}` }))
              .join('')
          : '<div class="empty">No replies yet.</div>'
      }

      <h2>Comments</h2>
      ${
        comments.length
          ? comments
              .map((c) => card('comment', { ...c, body: `(${c.page}) ${c.body}` }))
              .join('')
          : '<div class="empty">No comments yet.</div>'
      }

      <h2>Chat messages</h2>
      ${
        chat.length
          ? chat.map((m) => card('chat', m)).join('')
          : '<div class="empty">No chat messages yet.</div>'
      }
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
    if (!['comment', 'topic', 'reply', 'chat'].includes(type) || !Number.isInteger(id)) {
      return res.status(400).type('text').send('Bad request');
    }
    try {
      await deleteCommunityItem(type, id);
    } catch (error) {
      console.error('inbox/community: delete failed', error);
    }
    return res.redirect('/inbox/community');
  }),
);
