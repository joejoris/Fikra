/**
 * Dependency-free form handling for FIKRA.
 *
 * Progressive enhancement: forms have a real `action`/`method`, so they work
 * without JavaScript. This script upgrades them to fetch + inline feedback.
 */

const THANKS_PATH = '/thanks';
const CONTACT_EMAIL = 'fikrainnovator@gmail.com';

type Status = 'idle' | 'sending' | 'success' | 'error';

function setStatus(el: HTMLElement | null, state: Status, message: string) {
  if (!el) return;
  el.textContent = message;
  el.dataset.state = state;
  el.classList.toggle('text-primary', state === 'success');
  el.classList.toggle('text-red-600', state === 'error');
}

function collect(form: HTMLFormElement): Record<string, string> {
  const data = new FormData(form);
  const payload: Record<string, string> = {};
  for (const [key, value] of data.entries()) {
    if (typeof value === 'string' && value.trim() !== '') {
      payload[key] = value.trim();
    }
  }
  return payload;
}

/** POST with one retry when the connection itself fails (server restarting). */
async function send(
  endpoint: string,
  form: HTMLFormElement,
  payload: Record<string, string>,
  multipart: boolean,
): Promise<Response> {
  const attempt = () =>
    multipart
      ? fetch(endpoint, {
          method: 'POST',
          headers: { accept: 'application/json' },
          body: new FormData(form),
        })
      : fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(payload),
        });

  try {
    return await attempt();
  } catch {
    // A dropped connection or a cold start — wait briefly and try once more.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return attempt();
  }
}

async function submit(form: HTMLFormElement) {
  const statusEl = form.querySelector<HTMLElement>('[data-status]');
  const button = form.querySelector<HTMLButtonElement>('[data-submit]');
  const endpoint = form.getAttribute('action') || '/api/contact';
  const inline = form.dataset.success === 'inline';
  const multipart = form.hasAttribute('data-multipart') || !!form.querySelector('input[type="file"]');

  const payload = collect(form);

  // Honeypot filled => silently pretend success, send nothing.
  if (payload._gotcha) {
    if (inline) {
      setStatus(statusEl, 'success', form.dataset.successMessage ?? 'Thank you.');
    } else {
      window.location.assign(THANKS_PATH);
    }
    return;
  }

  // Basic client guard for the consent checkbox (novalidate disables native UI).
  if (!form.reportValidity()) return;

  setStatus(statusEl, 'sending', 'Sending…');
  if (button) {
    button.disabled = true;
    button.dataset.label = button.textContent ?? '';
    button.textContent = 'Sending…';
  }

  try {
    let res: Response;
    try {
      res = await send(endpoint, form, payload, multipart);
    } catch {
      // fetch threw even after the retry — we never reached the server.
      throw new Error(
        `We could not reach the server. Please check your connection and try again, or email us at ${CONTACT_EMAIL}.`,
      );
    }

    if (!res.ok) {
      // Surface the server's specific message (validation, rate limit, etc.)
      // instead of a generic failure where one exists.
      let message = `We could not send this just now. Please try again in a moment, or email us at ${CONTACT_EMAIL}.`;
      try {
        const data = await res.json();
        if (data && typeof data.error === 'string' && data.error.trim()) {
          message = data.error.trim();
        }
      } catch {
        // Non-JSON error page (e.g. a proxy error) — keep the message above.
      }
      throw new Error(message);
    }

    if (inline) {
      setStatus(statusEl, 'success', form.dataset.successMessage ?? 'Thank you.');
      form.reset();
    } else {
      setStatus(statusEl, 'success', 'Thank you — redirecting…');
      window.location.assign(THANKS_PATH);
    }
  } catch (error) {
    console.error(error);
    setStatus(
      statusEl,
      'error',
      error instanceof Error && error.message
        ? error.message
        : `We could not send this just now. Please try again, or email us at ${CONTACT_EMAIL}.`,
    );
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = button.dataset.label ?? 'Send';
    }
  }
}

export function initForms() {
  const forms = document.querySelectorAll<HTMLFormElement>('form[data-form]');
  forms.forEach((form) => {
    if (form.dataset.initialized === 'true') return;
    form.dataset.initialized = 'true';

    const loadedAt = form.querySelector<HTMLInputElement>('[data-loaded-at]');
    if (loadedAt) loadedAt.value = String(Date.now());

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void submit(form);
    });
  });
}
