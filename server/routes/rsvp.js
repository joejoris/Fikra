/**
 * POST /api/rsvp — event registrations.
 * The RSVP is recorded in the submissions inbox *before* any email is
 * attempted, so a mail/provider problem can never lose a registration or
 * block the attendee. Notification + confirmation emails are best effort.
 */
import { Router } from 'express';
import { asyncHandler, clean, createRateLimiter, isEmail, tooFast, verifyTurnstile } from '../lib.js';
import { mailProvider, sendMail } from '../mail.js';
import { insertSubmission } from '../db.js';

export const rsvpRouter = Router();

const MAX_GUESTS = 20;
const limited = createRateLimiter(10, 10 * 60 * 1000);

function json(res, body, status = 200) {
  return res.status(status).json(body);
}

function fallbackEmail() {
  return process.env.CONTACT_TO_EMAIL || 'fikrainnovator@gmail.com';
}

rsvpRouter.post(
  '/api/rsvp',
  asyncHandler(async (req, res) => {
    const ip = req.ip ?? 'unknown';
    if (limited(ip)) {
      return json(res, { ok: false, error: 'Too many requests. Please try again in a few minutes.' }, 429);
    }

    const data = req.body && typeof req.body === 'object' ? req.body : {};

    // Honeypot.
    if (clean(data._gotcha)) {
      return json(res, { ok: true });
    }

    // Time-trap — instant submissions are bots.
    if (tooFast(data._loadedAt)) {
      return json(res, { ok: false, error: 'Please wait a moment and try again.' }, 400);
    }

    const eventSlug = clean(data.event_slug);
    const eventTitle = clean(data.event_title) || 'a FIKRA event';
    const name = clean(data.name);
    const email = clean(data.email);
    const guests = Number(data.guests);
    const consent = clean(data.consent);

    if (!eventSlug || !name || !email || !isEmail(email) || !consent) {
      return json(
        res,
        { ok: false, error: 'Please provide your name, a valid email, and tick the consent box.' },
        400,
      );
    }
    if (!Number.isInteger(guests) || guests < 1 || guests > MAX_GUESTS) {
      return json(res, { ok: false, error: 'Please enter a number of attendees between 1 and 20.' }, 400);
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

    // 1) Record the RSVP first (best effort, but before any email).
    let recorded = false;
    try {
      await insertSubmission({
        form_name: 'rsvp',
        name,
        email,
        phone: null,
        organisation: null,
        interest: null,
        program: eventSlug,
        message: `Event: ${eventTitle}\nAttendees: ${guests}`,
        files: null,
      });
      recorded = true;
    } catch (error) {
      console.error('rsvp: could not save registration to inbox', error);
    }

    // 2) Notify FIKRA (best effort).
    let notified = false;
    if (provider && to && from) {
      const notify = await sendMail({
        from,
        to: [to],
        reply_to: email,
        subject: `[FIKRA website] RSVP — ${eventTitle} — ${name}`,
        text: [
          `Event: ${eventTitle}`,
          `Event code: ${eventSlug}`,
          `Name: ${name}`,
          `Email: ${email}`,
          `Attendees (including this person): ${guests}`,
        ].join('\n'),
      });
      notified = notify.ok;
      if (!notify.ok) {
        console.error('rsvp: notification email failed', notify.status, notify.text);
      }
    } else {
      console.error(
        'rsvp: email is not configured — registration saved to the inbox only ' +
          '(set GMAIL_USER + GMAIL_APP_PASSWORD or RESEND_API_KEY)',
      );
    }

    // The only genuine failure: we could not record it AND could not email it.
    if (!recorded && !notified) {
      return json(
        res,
        {
          ok: false,
          error: `We could not register you just now. Please email us at ${fallbackEmail()} and we will add you to the list.`,
        },
        502,
      );
    }

    // 3) Confirmation email to the attendee (best effort).
    if (provider && from) {
      try {
        await sendMail({
          from,
          to: [email],
          reply_to: to || fallbackEmail(),
          subject: `You are registered: ${eventTitle} — FIKRA`,
          text: [
            `Hello ${name},`,
            '',
            `Thanks for registering for ${eventTitle}.`,
            '',
            `We have noted ${guests} ${guests === 1 ? 'attendee' : 'attendees'} (including you).`,
            'If your plans change, please let us know so we can free your spot.',
            '',
            'We look forward to seeing you there.',
            '',
            '— FIKRA',
          ].join('\n'),
        });
      } catch (error) {
        console.error('rsvp: confirmation email failed', error);
      }
    }

    return json(res, { ok: true });
  }),
);

rsvpRouter.get('/api/rsvp', (req, res) => json(res, { ok: false, error: 'Method not allowed.' }, 405));
