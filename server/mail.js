/**
 * Outgoing mail for the FIKRA server, via one of two providers:
 *
 * - Resend, when RESEND_API_KEY is set (newsletters also join RESEND_AUDIENCE_ID).
 * - Gmail SMTP, when GMAIL_USER + GMAIL_APP_PASSWORD are set (Google account →
 *   Security → 2-Step Verification → App passwords). Newsletters are recorded
 *   locally (subscribers table) since there is no external list.
 *
 * sendMail() picks whichever is configured (Resend first) and returns
 * { ok, status, text } either way. Attachments: [{ filename, content }] where
 * content is a base64 string or a Buffer.
 */
import nodemailer from 'nodemailer';

export function mailProvider() {
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) return 'gmail';
  return null;
}

let gmailTransporter = null;

function gmail() {
  if (!gmailTransporter) {
    gmailTransporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
  }
  return gmailTransporter;
}

export async function sendMail(payload) {
  const provider = mailProvider();
  if (provider === 'gmail') {
    try {
      await gmail().sendMail({
        from: payload.from,
        to: Array.isArray(payload.to) ? payload.to.join(', ') : payload.to,
        replyTo: payload.reply_to,
        subject: payload.subject,
        text: payload.text,
        attachments: (payload.attachments ?? []).map((file) => ({
          filename: file.filename,
          content: Buffer.isBuffer(file.content)
            ? file.content
            : Buffer.from(file.content, 'base64'),
        })),
      });
      return { ok: true, status: 200, text: '' };
    } catch (error) {
      return { ok: false, status: 502, text: String(error?.message ?? error) };
    }
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.RESEND_API_KEY}`,
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

/** Backwards-compatible Resend-only send used where Resend is mandatory. */
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
