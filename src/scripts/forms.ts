/**
 * Dependency-free form handling for FIKRA.
 *
 * Progressive enhancement: forms have a real `action`/`method`, so they work
 * without JavaScript. This script upgrades them to fetch + inline feedback.
 */

const THANKS_PATH = '/thanks';

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
    const res = multipart
      ? await fetch(endpoint, {
          method: 'POST',
          headers: { accept: 'application/json' },
          body: new FormData(form),
        })
      : await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(payload),
        });

    if (!res.ok) {
      // Surface the server's specific message (validation, rate limit,
      // not-configured) instead of a generic failure where one exists.
      let message = 'Sorry, something went wrong. Please try again, or email us directly.';
      try {
        const data = await res.json();
        if (data && typeof data.error === 'string' && data.error.trim()) {
          message = data.error.trim();
        }
      } catch {
        // Non-JSON error page (proxy 502, etc.) — keep the generic message.
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
        : 'Sorry, something went wrong. Please try again, or email us directly.',
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
