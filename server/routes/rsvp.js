/**
 * POST /api/rsvp — event registrations.
 * Notifies FIKRA, confirms to the attendee, records in the submissions inbox.
 */
import { Router } from 'express';
import { asyncHandler, clean, createRateLimiter, isEmail, sendResend, tooFast, verifyTurnstile } from '../lib.js';
import { insertSubmission } from '../db.js';

export const rsvpRouter = Router();

const MAX_GUESTS = 20;
const limited = createRateLimiter(10, 10 * 60 * 1000);

function json(res, body, status = 200) {
  return res.status(status).json(body);
}

rsvpRouter.post(
  '/api/rsvp',
  asyncHandler(async (req, res) => {
    const ip = req.ip ?? 'unknown';
    if (limited(ip)) {
      return json(res, { ok: false, error: 'Too many requests. Please try later.' }, 429);
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
        return json(res, { ok: false, error: token ? 'Verification failed.' : 'Verification required.' }, 400);
      }
    }

    const apiKey = process.env.RESEND_API_KEY;
    const to = process.env.CONTACT_TO_EMAIL;
    const from = process.env.CONTACT_FROM_EMAIL;

    if (!apiKey || !to || !from) {
      console.error('rsvp: email is not configured (missing RESEND_API_KEY / CONTACT_TO_EMAIL / CONTACT_FROM_EMAIL)');
      return json(
        res,
        { ok: false, error: 'Registration is not fully set up yet. Please contact us directly.' },
        503,
      );
    }

    const notify = await sendResend(apiKey, {
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

    if (!notify.ok) {
      console.error('rsvp: notify failed', notify.status, notify.text);
      return json(res, { ok: false, error: 'Could not register you. Please try again.' }, 502);
    }

    // Record the RSVP in the inbox (best effort).
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
    } catch (error) {
      console.error('rsvp: db insert failed', error);
    }

    // Confirmation email to the attendee (best effort).
    try {
      await sendResend(apiKey, {
        from,
        to: [email],
        reply_to: to,
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

    return json(res, { ok: true });
  }),
);

rsvpRouter.get('/api/rsvp', (req, res) => json(res, { ok: false, error: 'Method not allowed.' }, 405));
