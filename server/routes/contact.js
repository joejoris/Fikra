/**
 * POST /api/contact — website forms (JSON or multipart with attachments).
 *
 * Files are stored in the database and attached to the notification email.
 * Same validation messages and limits as before.
 *
 * The submission is saved to the inbox *before* any email is attempted, so a
 * mail problem (no provider configured, provider down, bad credentials) can
 * never lose an enquiry or produce a dead-end error for the visitor.
 */
import { Router } from 'express';
import multer from 'multer';
import { asyncHandler, clean, createRateLimiter, isEmail, safeFileName, tooFast, verifyTurnstile } from '../lib.js';
import { mailProvider, sendMail } from '../mail.js';
import { insertFile, insertSubmission, updateSubmissionFiles } from '../db.js';

export const contactRouter = Router();

const MAX_FILES = 2;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const ALLOWED_FILE_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png',
  'image/jpeg',
];

const limited = createRateLimiter(5, 10 * 60 * 1000);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES + 1, fieldSize: 1024 * 1024 },
});

function json(res, body, status = 200) {
  return res.status(status).json(body);
}

/** Public address visitors can write to if we truly cannot take their message. */
function fallbackEmail() {
  return process.env.CONTACT_TO_EMAIL || 'fikrainnovator@gmail.com';
}

contactRouter.post(
  '/api/contact',
  (req, res, next) => {
    upload.array('attachments', MAX_FILES + 1)(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return json(res, { ok: false, error: 'An attached file is larger than 2 MB.' }, 400);
        }
        if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
          return json(res, { ok: false, error: `Please attach at most ${MAX_FILES} files.` }, 400);
        }
        return json(res, { ok: false, error: 'Invalid request.' }, 400);
      }
      next();
    });
  },
  asyncHandler(async (req, res) => {
    const ip = req.ip ?? 'unknown';
    if (limited(ip)) {
      return json(res, { ok: false, error: 'Too many submissions. Please try again in a few minutes.' }, 429);
    }

    const data = { ...(req.body ?? {}) };
    const uploads = req.files ?? [];

    // Honeypot — bots fill hidden fields. Pretend success, send nothing.
    if (clean(data._gotcha)) {
      return json(res, { ok: true });
    }

    // Time-trap — instant submissions are bots.
    if (tooFast(data._loadedAt)) {
      return json(res, { ok: false, error: 'Please wait a moment and try again.' }, 400);
    }

    const name = clean(data.name);
    const email = clean(data.email);
    const phone = clean(data.phone);
    const organisation = clean(data.organisation);
    const interest = clean(data.interest);
    const program = clean(data.program);
    const message = clean(data.message);
    const formName = clean(data._formName) || 'website form';
    const consent = clean(data.consent);

    if (!name || !email || !isEmail(email) || !consent) {
      return json(res, { ok: false, error: 'Please provide your name, a valid email and consent.' }, 400);
    }

    if (uploads.length > MAX_FILES) {
      return json(res, { ok: false, error: `Please attach at most ${MAX_FILES} files.` }, 400);
    }
    for (const file of uploads) {
      if (file.size > MAX_FILE_BYTES) {
        return json(res, { ok: false, error: `"${file.originalname}" is larger than 2 MB.` }, 400);
      }
      if (file.mimetype && !ALLOWED_FILE_TYPES.includes(file.mimetype)) {
        return json(res, { ok: false, error: `"${file.originalname}" is not an accepted file type.` }, 400);
      }
    }

    if (process.env.TURNSTILE_SECRET_KEY) {
      const token = clean(data['cf-turnstile-response']);
      const verified = token && (await verifyTurnstile(process.env.TURNSTILE_SECRET_KEY, token, ip));
      if (!verified) {
        return json(res, { ok: false, error: token ? 'Verification failed. Please try again.' : 'Please complete the verification box.' }, 400);
      }
    }

    const provider = mailProvider();
    const to = process.env.CONTACT_TO_EMAIL;
    const from = process.env.CONTACT_FROM_EMAIL;

    // 1) Save the submission first — the inbox is the source of truth, so a
    //    mail failure below never loses the enquiry.
    let recorded = false;
    try {
      const id = await insertSubmission({
        form_name: formName,
        name,
        email,
        phone: phone || null,
        organisation: organisation || null,
        interest: interest || null,
        program: program || null,
        message: message || null,
        files: null,
      });
      recorded = true;
      if (uploads.length > 0 && id != null) {
        const records = [];
        for (const file of uploads) {
          const fileId = await insertFile(
            id,
            file.originalname,
            file.mimetype || 'application/octet-stream',
            file.buffer,
          );
          records.push({ name: file.originalname, fileId });
        }
        await updateSubmissionFiles(id, JSON.stringify(records));
      }
    } catch (error) {
      console.error('contact: could not save submission to inbox', error);
    }

    // 2) Notify FIKRA (best effort — the visitor is never blocked by mail).
    let notified = false;
    if (provider && to && from) {
      const lines = [
        `Form: ${formName}`,
        `Name: ${name}`,
        `Email: ${email}`,
        phone && `Phone: ${phone}`,
        organisation && `Organisation: ${organisation}`,
        interest && `Interest: ${interest}`,
        program && `Program: ${program}`,
        '',
        message || '(no message)',
      ].filter(Boolean);
      if (uploads.length > 0) {
        lines.push('', 'Attachments:', ...uploads.map((file) => `- ${file.originalname} (attached)`));
      }
      const sent = await sendMail({
        from,
        to: [to],
        reply_to: email,
        subject: `[FIKRA website] ${formName} — ${name}`,
        text: lines.join('\n'),
        attachments: uploads.length
          ? uploads.map((file) => ({
              filename: safeFileName(file.originalname),
              content: file.buffer.toString('base64'),
            }))
          : undefined,
      });
      notified = sent.ok;
      if (!sent.ok) {
        console.error('contact: notification email failed', sent.status, sent.text);
      }
    } else {
      console.error(
        'contact: email is not configured — submission saved to the inbox only ' +
          '(set GMAIL_USER + GMAIL_APP_PASSWORD or RESEND_API_KEY)',
      );
    }

    // The only genuine failure: we could not save it AND could not email it.
    if (!recorded && !notified) {
      return json(
        res,
        {
          ok: false,
          error: `We could not send your message just now. Please email us directly at ${fallbackEmail()} and we will get back to you.`,
        },
        502,
      );
    }

    // 3) Acknowledge to the submitter (best effort).
    if (provider && from) {
      try {
        await sendMail({
          from,
          to: [email],
          reply_to: to || fallbackEmail(),
          subject: 'We received your message — FIKRA',
          text: [
            `Hello ${name},`,
            '',
            'Thank you for getting in touch with FIKRA. This is just to confirm that',
            'your message has reached us, and we will reply as soon as we can.',
            '',
            'For your records, here is what you sent:',
            '',
            message || '(no message)',
            '',
            '— FIKRA',
          ].join('\n'),
        });
      } catch (error) {
        console.error('contact: auto-reply failed', error);
      }
    }

    return json(res, { ok: true });
  }),
);

contactRouter.get('/api/contact', (req, res) => json(res, { ok: false, error: 'Method not allowed.' }, 405));
