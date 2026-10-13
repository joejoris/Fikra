/**
 * POST /api/contact — website forms (JSON or multipart with attachments).
 *
 * Files are stored in the database and attached to the notification email.
 * Same validation messages and limits as before.
 */
import { Router } from 'express';
import multer from 'multer';
import { asyncHandler, clean, createRateLimiter, isEmail, safeFileName, sendResend, verifyTurnstile } from '../lib.js';
import { insertFile, insertSubmission, updateSubmissionFiles } from '../db.js';

export const contactRouter = Router();

const MAX_FILES = 2;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
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

contactRouter.post(
  '/api/contact',
  (req, res, next) => {
    upload.array('attachments', MAX_FILES + 1)(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return json(res, { ok: false, error: 'An attached file is larger than 8 MB.' }, 400);
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
      return json(res, { ok: false, error: 'Too many submissions. Please try later.' }, 429);
    }

    const data = { ...(req.body ?? {}) };
    const uploads = req.files ?? [];

    // Honeypot — bots fill hidden fields. Pretend success, send nothing.
    if (clean(data._gotcha)) {
      return json(res, { ok: true });
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
        return json(res, { ok: false, error: `"${file.originalname}" is larger than 8 MB.` }, 400);
      }
      if (file.mimetype && !ALLOWED_FILE_TYPES.includes(file.mimetype)) {
        return json(res, { ok: false, error: `"${file.originalname}" is not an accepted file type.` }, 400);
      }
    }

    if (process.env.TURNSTILE_SECRET_KEY) {
      const token = clean(data['cf-turnstile-response']);
      const verified = token && (await verifyTurnstile(process.env.TURNSTILE_SECRET_KEY, token, ip));
      if (!verified) {
        return json(res, { ok: false, error: token ? 'Verification failed.' : 'Verification required.' }, 400);
      }
    }

    const apiKey = process.env.RESEND_API_KEY;
    const to = process.env.CONTACT_TO_EMAIL;
    const from = process.env.CONTACT_FROM_EMAIL;

    if (!apiKey || !to || !from) {
      console.error('contact: email is not configured (missing RESEND_API_KEY / CONTACT_TO_EMAIL / CONTACT_FROM_EMAIL)');
      return json(res, { ok: false, error: 'This form is not fully set up yet. Please email us directly.' }, 503);
    }

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

    const attachments = uploads.map((file) => ({
      filename: safeFileName(file.originalname),
      content: file.buffer.toString('base64'),
    }));

    const bodyLines = lines.slice();
    if (uploads.length > 0) {
      bodyLines.push('', 'Attachments:', ...uploads.map((file) => `- ${file.originalname} (attached)`));
    }

    const sent = await sendResend(apiKey, {
      from,
      to: [to],
      reply_to: email,
      subject: `[FIKRA website] ${formName} — ${name}`,
      text: bodyLines.join('\n'),
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    if (!sent.ok) {
      console.error('contact: send failed', sent.status, sent.text);
      return json(res, { ok: false, error: 'Could not send your message. Please try again.' }, 502);
    }

    // Record the submission for the inbox (best effort).
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
      console.error('contact: db insert failed', error);
    }

    // Acknowledge to the submitter (best effort).
    try {
      await sendResend(apiKey, {
        from,
        to: [email],
        reply_to: to,
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

    return json(res, { ok: true });
  }),
);

contactRouter.get('/api/contact', (req, res) => json(res, { ok: false, error: 'Method not allowed.' }, 405));
