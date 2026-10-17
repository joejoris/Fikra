/**
 * Community client: optional accounts, comments + likes, discussion board and
 * live chat. Dependency-free (like forms.ts) and safe by construction — all
 * user text is inserted with textContent, never innerHTML.
 *
 * Each feature finds its own container by a data attribute, so a page can
 * include any combination.
 */

type Member = { id: number; name: string; email: string };
type Comment = {
  id: number;
  created_at: string;
  author_name: string;
  body: string;
  likes: number;
  liked: boolean;
  is_member: boolean;
};
type Topic = {
  id: number;
  created_at: string;
  last_activity: string;
  title: string;
  body: string;
  author_name: string;
  reply_count: number;
};
type Reply = { id: number; created_at: string; author_name: string; body: string };
type ChatMessage = { id: number; created_at: string; author_name: string; body: string };

const LOADED_AT = String(Date.now());

let me: Member | null = null;
let meLoaded: Promise<void> | null = null;

async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: any = {};
  try {
    data = await res.json();
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || 'Something went wrong. Please try again in a moment.');
  }
  return data as T;
}

function loadMe(): Promise<void> {
  if (!meLoaded) {
    meLoaded = api<{ member: Member | null }>('/api/auth/me')
      .then((d) => {
        me = d.member ?? null;
      })
      .catch(() => {
        me = null;
      });
  }
  return meLoaded;
}

function on(el: HTMLElement, event: string, handler: (ev: Event) => void) {
  el.addEventListener(event, (ev) => {
    ev.preventDefault();
    handler(ev);
  });
}

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

function setStatus(el: HTMLElement | null, message: string, state: 'idle' | 'ok' | 'error' = 'idle') {
  if (!el) return;
  el.textContent = message;
  el.dataset.state = state;
  el.classList.toggle('text-primary', state === 'ok');
  el.classList.toggle('text-red-600', state === 'error');
}

/** Show guest name/email fields only when nobody is signed in. */
function syncGuestFields(scope: HTMLElement) {
  scope.querySelectorAll<HTMLElement>('[data-guest-fields]').forEach((field) => {
    field.hidden = me != null;
  });
}

function dispatchAuth(member: Member | null) {
  document.dispatchEvent(new CustomEvent('fikra:auth', { detail: { member } }));
}

/** Keep a component's guest fields in sync when the account state changes. */
function watchAuth(root: HTMLElement) {
  document.addEventListener('fikra:auth', (event) => {
    me = (event as CustomEvent<{ member: Member | null }>).detail?.member ?? null;
    syncGuestFields(root);
  });
}

export async function initAccount() {
  const root = document.querySelector<HTMLElement>('[data-account]');
  if (!root) return;
  await loadMe();

  const nameEl = root.querySelector<HTMLElement>('[data-account-name]');
  const statusEl = root.querySelector<HTMLElement>('[data-auth-status]');
  const loginForm = root.querySelector<HTMLFormElement>('[data-auth-form="login"]');
  const signupForm = root.querySelector<HTMLFormElement>('[data-auth-form="signup"]');

  const reflect = () => {
    root.querySelectorAll<HTMLElement>('[data-account-guest]').forEach((element) => {
      element.hidden = me != null;
    });
    root.querySelectorAll<HTMLElement>('[data-account-user]').forEach((element) => {
      element.hidden = me == null;
    });
    if (nameEl && me) nameEl.textContent = me.name;
  };
  reflect();

  root.querySelectorAll<HTMLElement>('[data-account-show]').forEach((button) => {
    on(button, 'click', () => {
      const which = button.dataset.accountShow;
      if (loginForm) loginForm.hidden = which !== 'login';
      if (signupForm) signupForm.hidden = which !== 'signup';
    });
  });

  const submitAuth = (form: HTMLFormElement, endpoint: string) =>
    on(form, 'submit', async () => {
      const data = Object.fromEntries(new FormData(form).entries());
      setStatus(statusEl, 'Please wait…');
      try {
        const result = await api<{ member: Member }>(endpoint, data);
        me = result.member;
        reflect();
        dispatchAuth(me);
        form.reset();
        setStatus(statusEl, 'You are signed in.', 'ok');
      } catch (error) {
        setStatus(statusEl, error instanceof Error ? error.message : 'Could not sign in.', 'error');
      }
    });

  if (loginForm) submitAuth(loginForm, '/api/auth/login');
  if (signupForm) submitAuth(signupForm, '/api/auth/signup');

  const logout = root.querySelector<HTMLElement>('[data-account-logout]');
  if (logout) {
    on(logout, 'click', async () => {
      try {
        await api('/api/auth/logout', {});
      } catch {
        /* ignore */
      }
      me = null;
      reflect();
      dispatchAuth(me);
      setStatus(statusEl, 'You are signed out.', 'ok');
    });
  }
}

// --- Comments ---------------------------------------------------------------

export async function initComments() {
  const root = document.querySelector<HTMLElement>('[data-comments]');
  if (!root) return;
  const page = root.dataset.page;
  if (!page) return;

  const list = root.querySelector<HTMLElement>('[data-comment-list]');
  const form = root.querySelector<HTMLFormElement>('[data-comment-form]');
  const statusEl = root.querySelector<HTMLElement>('[data-comment-status]');
  const countEl = root.querySelector<HTMLElement>('[data-comment-count]');

  await loadMe();
  syncGuestFields(root);
  watchAuth(root);

  const render = (comments: Comment[]) => {
    if (!list) return;
    list.textContent = '';
    if (countEl) countEl.textContent = comments.length ? String(comments.length) : '';
    if (comments.length === 0) {
      list.append(node('p', 'text-sm text-muted', 'No comments yet. Be the first to share your thoughts.'));
      return;
    }
    for (const comment of comments) {
      const card = node('article', 'rounded-[var(--radius-card)] border border-border bg-surface p-5');
      const head = node('div', 'flex flex-wrap items-center gap-2');
      const author = node('span', 'font-semibold text-ink', comment.author_name);
      head.append(author);
      if (comment.is_member) {
        head.append(node('span', 'rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary', 'Member'));
      }
      head.append(node('time', 'text-xs text-muted', `${comment.created_at} UTC`));
      card.append(head);
      card.append(node('p', 'mt-2 whitespace-pre-wrap text-ink-soft', comment.body));

      const like = node('button', 'mt-3 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm font-medium text-ink-soft hover:border-primary/40 hover:text-primary');
      like.type = 'button';
      const heart = node('span', '', comment.liked ? '♥' : '♡');
      like.append(heart, node('span', '', String(comment.likes)));
      on(like, 'click', async () => {
        try {
          const result = await api<{ likes: number }>(`/api/comments/${comment.id}/like`, {});
          comment.likes = result.likes;
          comment.liked = !comment.liked;
          heart.textContent = comment.liked ? '♥' : '♡';
          (like.lastElementChild as HTMLElement).textContent = String(comment.likes);
        } catch (error) {
          setStatus(statusEl, error instanceof Error ? error.message : 'Could not like that.', 'error');
        }
      });
      card.append(like);
      list.append(card);
    }
  };

  const load = async () => {
    try {
      const data = await api<{ comments: Comment[] }>(`/api/comments?page=${encodeURIComponent(page)}`);
      render(data.comments);
    } catch (error) {
      if (list) list.textContent = '';
      if (list) list.append(node('p', 'text-sm text-muted', 'Comments could not be loaded right now.'));
    }
  };

  if (form) {
    form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-loaded-at]').forEach((input) => {
      input.value = LOADED_AT;
    });
    on(form, 'submit', async () => {
      if (!form.reportValidity()) return;
      const data = Object.fromEntries(new FormData(form).entries());
      data.page = page;
      data._loadedAt = LOADED_AT;
      const button = form.querySelector<HTMLButtonElement>('[data-comment-submit]');
      if (button) button.disabled = true;
      setStatus(statusEl, 'Posting…');
      try {
        const result = await api<{ comment: Comment }>('/api/comments', data);
        const textarea = form.querySelector<HTMLTextAreaElement>('[name="body"]');
        if (textarea) textarea.value = '';
        setStatus(statusEl, 'Thanks — your comment is awaiting review and will appear once approved.', 'ok');
        const current = await api<{ comments: Comment[] }>(`/api/comments?page=${encodeURIComponent(page)}`);
        render(current.comments);
        void result;
      } catch (error) {
        setStatus(statusEl, error instanceof Error ? error.message : 'Could not post your comment.', 'error');
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  await load();
}

// --- Discussion board -------------------------------------------------------

export async function initBoard() {
  const root = document.querySelector<HTMLElement>('[data-board]');
  if (!root) return;

  const list = root.querySelector<HTMLElement>('[data-topic-list]');
  const form = root.querySelector<HTMLFormElement>('[data-topic-form]');
  const statusEl = root.querySelector<HTMLElement>('[data-topic-status]');

  await loadMe();
  syncGuestFields(root);
  watchAuth(root);

  const renderTopic = (topic: Topic) => {
    const card = node('article', 'rounded-[var(--radius-card)] border border-border bg-surface p-5');
    const head = node('div', 'flex flex-wrap items-center justify-between gap-2');
    head.append(node('h3', 'font-bold text-ink', topic.title));
    head.append(node('span', 'text-xs text-muted', `${topic.reply_count} ${topic.reply_count === 1 ? 'reply' : 'replies'}`));
    card.append(head);
    card.append(node('p', 'mt-1 text-xs text-muted', `${topic.author_name} · ${topic.created_at} UTC`));
    card.append(node('p', 'mt-3 whitespace-pre-wrap text-ink-soft', topic.body));

    const replies = node('div', 'mt-4 space-y-3 border-t border-border pt-4');
    card.append(replies);
    const replyForm = node('form', 'mt-4 space-y-2');
    const replyInput = node('textarea', 'w-full rounded-lg border border-border bg-bg p-2 text-sm');
    (replyInput as HTMLTextAreaElement).name = 'body';
    (replyInput as HTMLTextAreaElement).rows = 2;
    (replyInput as HTMLTextAreaElement).placeholder = 'Write a reply…';
    (replyInput as HTMLTextAreaElement).required = true;
    replyForm.append(replyInput);
    const replyButtons = node('div', 'flex items-center gap-3');
    const replyBtn = node('button', 'rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-white');
    replyBtn.type = 'submit';
    replyBtn.textContent = 'Reply';
    const replyStatus = node('p', 'text-sm text-muted');
    replyButtons.append(replyBtn, replyStatus);
    replyForm.append(replyButtons);
    card.append(replyForm);

    const renderReplies = (items: Reply[]) => {
      replies.textContent = '';
      for (const reply of items) {
        const row = node('div', 'text-sm');
        row.append(node('span', 'font-semibold text-ink', reply.author_name + ' '));
        row.append(node('span', 'text-xs text-muted', reply.created_at + ' UTC'));
        row.append(node('p', 'mt-0.5 whitespace-pre-wrap text-ink-soft', reply.body));
        replies.append(row);
      }
    };

    const loadReplies = async () => {
      try {
        const data = await api<{ topic: Topic & { replies: Reply[] } }>(`/api/topics/${topic.id}`);
        renderReplies(data.topic.replies);
      } catch {
        replies.textContent = '';
        replies.append(node('p', 'text-sm text-muted', 'Replies could not be loaded.'));
      }
    };

    on(replyForm, 'submit', async () => {
      const data = Object.fromEntries(new FormData(replyForm).entries());
      replyBtn.disabled = true;
      setStatus(replyStatus, 'Posting…');
      try {
        await api(`/api/topics/${topic.id}/replies`, data);
        replyInput.value = '';
        setStatus(replyStatus, 'Thanks — your reply is awaiting review.', 'ok');
        await loadReplies();
      } catch (error) {
        setStatus(replyStatus, error instanceof Error ? error.message : 'Could not post reply.', 'error');
      } finally {
        replyBtn.disabled = false;
      }
    });

    void loadReplies();
    return card;
  };

  const load = async () => {
    if (!list) return;
    try {
      const data = await api<{ topics: Topic[] }>('/api/topics');
      list.textContent = '';
      if (data.topics.length === 0) {
        list.append(node('p', 'text-sm text-muted', 'No discussions yet. Start the first one above.'));
        return;
      }
      for (const topic of data.topics) list.append(renderTopic(topic));
    } catch {
      list.textContent = '';
      list.append(node('p', 'text-sm text-muted', 'Discussions could not be loaded right now.'));
    }
  };

  if (form) {
    on(form, 'submit', async () => {
      if (!form.reportValidity()) return;
      const data = Object.fromEntries(new FormData(form).entries());
      data._loadedAt = LOADED_AT;
      const button = form.querySelector<HTMLButtonElement>('[data-topic-submit]');
      if (button) button.disabled = true;
      setStatus(statusEl, 'Posting…');
      try {
        await api('/api/topics', data);
        form.reset();
        setStatus(statusEl, 'Thanks — your topic is awaiting review and will appear once approved.', 'ok');
        await load();
      } catch (error) {
        setStatus(statusEl, error instanceof Error ? error.message : 'Could not post your topic.', 'error');
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  await load();
}

// --- Live chat (one shared room, rendered inline and in the site-wide widget) -
//
// Chat is a single public room: everyone sees every message. We keep one poll
// loop that feeds every chat list on the page, so the /community room and the
// floating widget stay in sync without duplicate requests. New messages from
// other people trigger a chime and a browser notification when the tab is in
// the background or the widget is closed.

let chatStarted = false;
let chatLastId = 0;
const chatLists: HTMLElement[] = [];
let unreadCount = 0;

function chatPanel(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-chat-panel]');
}

/** True when a chat view is on screen (inline room, or the widget is open). */
function chatVisible(): boolean {
  const panel = chatPanel();
  return panel ? !panel.hidden : document.documentElement.contains(document.querySelector('[data-chat]'));
}

function nextChatCursor(): number | null {
  return chatLastId > 0 ? chatLastId : null;
}

function ding() {
  try {
    const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const store = Ctx as unknown as { instance?: AudioContext };
    const ctx = store.instance ?? new Ctx();
    store.instance = ctx;
    if (ctx.state === 'suspended') void ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = 720;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc.start();
    osc.stop(ctx.currentTime + 0.26);
  } catch {
    /* sound is a nicety */
  }
}

function requestNotifyPermission() {
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  } catch {
    /* ignore */
  }
}

function alertNewMessage(message: ChatMessage) {
  ding();
  try {
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      const note = new Notification(`New message from ${message.author_name}`, {
        body: message.body,
        tag: 'fikra-chat',
      });
      note.onclick = () => window.focus();
    }
  } catch {
    /* notifications are optional */
  }
}

function showUnreadBadge() {
  document.querySelectorAll<HTMLElement>('[data-chat-badge]').forEach((badge) => {
    badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
    badge.hidden = unreadCount === 0;
  });
}

function renderChatMessage(message: ChatMessage) {
  for (const list of chatLists) {
    const row = node('div', 'text-sm');
    const head = node('div', 'flex items-center gap-2');
    head.append(node('span', 'font-semibold text-ink', message.author_name));
    head.append(node('span', 'text-xs text-muted', message.created_at.slice(11, 16)));
    row.append(head);
    row.append(node('p', 'whitespace-pre-wrap text-ink-soft', message.body));
    list.append(row);
    list.scrollTop = list.scrollHeight;
  }
}

let chatPolling = false;
async function pollChat(after: number | null) {
  if (chatPolling) return;
  chatPolling = true;
  try {
    const data = await api<{ messages: ChatMessage[] }>(`/api/chat${after != null ? `?after=${after}` : ''}`);
    if (after == null) {
      for (const list of chatLists) list.textContent = '';
      chatLastId = 0;
    }
    const fresh = data.messages.filter((message) => message.id > chatLastId);
    for (const message of fresh) {
      renderChatMessage(message);
      chatLastId = Math.max(chatLastId, message.id);
    }
    // Only alert for genuinely new messages that arrived after the first load.
    if (after != null && fresh.length > 0 && !chatVisible()) {
      unreadCount += fresh.length;
      showUnreadBadge();
      alertNewMessage(fresh[fresh.length - 1]);
    }
  } catch {
    /* stay quiet on transient network errors */
  } finally {
    chatPolling = false;
  }
}

function scheduleChatPoll() {
  const delay = !document.hidden && chatVisible() ? 2500 : document.hidden ? 15000 : 10000;
  window.setTimeout(async () => {
    await pollChat(nextChatCursor());
    scheduleChatPoll();
  }, delay);
}

function wireChatForm(form: HTMLFormElement, root: HTMLElement) {
  const statusEl = root.querySelector<HTMLElement>('[data-chat-status]');
  on(form, 'submit', async () => {
    if (!form.reportValidity()) return;
    const input = form.querySelector<HTMLInputElement | HTMLTextAreaElement>('[name="body"]');
    const data = Object.fromEntries(new FormData(form).entries());
    if (input) input.value = '';
    try {
      await api('/api/chat', data);
      setStatus(statusEl, '');
      await pollChat(nextChatCursor());
    } catch (error) {
      if (input) input.value = String(data.body ?? '');
      setStatus(statusEl, error instanceof Error ? error.message : 'Could not send.', 'error');
    }
  });
}

function initChatWidget() {
  const widget = document.querySelector<HTMLElement>('[data-chat-widget]');
  if (!widget) return;
  const toggle = widget.querySelector<HTMLElement>('[data-chat-toggle]');
  const close = widget.querySelector<HTMLElement>('[data-chat-close]');
  const panel = widget.querySelector<HTMLElement>('[data-chat-panel]');

  const open = () => {
    if (panel) panel.hidden = false;
    unreadCount = 0;
    showUnreadBadge();
    requestNotifyPermission();
    const list = panel?.querySelector<HTMLElement>('[data-chat-list]');
    if (list) list.scrollTop = list.scrollHeight;
    panel?.querySelector<HTMLElement>('[name="body"]')?.focus();
    void pollChat(nextChatCursor());
  };
  const shut = () => {
    if (panel) panel.hidden = true;
  };

  if (toggle) on(toggle, 'click', () => (panel && panel.hidden ? open() : shut()));
  if (close) on(close, 'click', shut);
}

export async function initChat() {
  const roots = Array.from(document.querySelectorAll<HTMLElement>('[data-chat]'));
  const widget = document.querySelector<HTMLElement>('[data-chat-widget]');
  if (roots.length === 0 && !widget) return;
  if (chatStarted) return;
  chatStarted = true;

  await loadMe();

  for (const root of roots) {
    const list = root.querySelector<HTMLElement>('[data-chat-list]');
    if (list && !chatLists.includes(list)) chatLists.push(list);
    const form = root.querySelector<HTMLFormElement>('[data-chat-form]');
    if (form) wireChatForm(form, root);
    syncGuestFields(root);
    watchAuth(root);
  }

  initChatWidget();
  showUnreadBadge();

  await pollChat(null);
  scheduleChatPoll();

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void pollChat(nextChatCursor());
  });
}

export function initCommunity() {
  void initAccount();
  void initComments();
  void initBoard();
  void initChat();
}
