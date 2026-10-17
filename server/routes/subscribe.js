/**
 * POST /api/subscribe — newsletter sign-ups.
 *
 * The address is always recorded locally first (the subscribers table is the
 * list when no external provider is configured). With Resend configured it is
 * also added to the audience. The welcome email is best effort. A sign-up is
 * never rejected because of a mail/provider problem.
 */
import { Router } from 'express';
import { asyncHandler, clean, createRateLimiter, isEmail, tooFast, verifyTurnstile } from '../lib.js';
import { mailProvider, sendMail } from '../mail.js';
import { insertSubscriberIgnore } from '../db.js';

export const subscribeRouter = Router();

const limited = createRateLimiter(5, 10 * 60 * 1000);

function json(res, body, status = 200) {
  return res.status(status).json(body);
}

function fallbackEmail() {
  return process.env.CONTACT_TO_EMAIL || 'fikrainnovator9@gmail.com';
}

subscribeRouter.post(
  '/api/subscribe',
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

    const email = clean(data.email);
    const firstName = clean(data.first_name);
    const consent = clean(data.consent);

    if (!email || !isEmail(email) || !consent) {
      return json(res, { ok: false, error: 'Please provide a valid email and tick the consent box.' }, 400);
    }

    if (process.env.TURNSTILE_SECRET_KEY) {
      const token = clean(data['cf-turnstile-response']);
      const verified = token && (await verifyTurnstile(process.env.TURNSTILE_SECRET_KEY, token, ip));
      if (!verified) {
        return json(res, { ok: false, error: token ? 'Verification failed. Please try again.' : 'Please complete the verification box.' }, 400);
      }
    }

    // 1) Record locally first — with Gmail/no provider this table *is* the list.
    let recorded = false;
    try {
      await insertSubscriberIgnore(email, firstName || null);
      recorded = true;
    } catch (error) {
      console.error('subscribe: could not save subscriber', error);
    }

    // 2) Also add to the Resend audience when configured (best effort).
    const provider = mailProvider();
    const audienceId = process.env.RESEND_AUDIENCE_ID;
    if (provider === 'resend' && audienceId) {
      try {
        const addRes = await fetch(`https://api.resend.com/audiences/${audienceId}/contacts`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            email,
            first_name: firstName || undefined,
            unsubscribed: false,
          }),
        });
        if (!addRes.ok && addRes.status !== 409) {
          let text = '';
          try {
            text = await addRes.text();
          } catch {
            text = '';
          }
          console.error('subscribe: audience add failed', addRes.status, text);
        }
      } catch (error) {
        console.error('subscribe: audience add error', error);
      }
    }

    // The only true failure: we could not store the address at all.
    if (!recorded) {
      return json(
        res,
        {
          ok: false,
          error: `We could not save your sign-up just now. Please email us at ${fallbackEmail()} and we will add you.`,
        },
        502,
      );
    }

    // 3) Welcome email (best effort).
    if (provider && process.env.CONTACT_FROM_EMAIL) {
      try {
        await sendMail({
          from: process.env.CONTACT_FROM_EMAIL,
          to: [email],
          subject: 'Thanks for signing up to FIKRA updates',
          text: [
            `Hello${firstName ? ` ${firstName}` : ''},`,
            '',
            'Thank you for signing up to FIKRA updates. You will hear from us when',
            'there is something worth sharing — new cohorts, events and openings.',
            '',
            'You can unsubscribe at any time from the link in any email we send.',
            '',
            '— FIKRA',
          ].join('\n'),
        });
      } catch (error) {
        console.error('subscribe: welcome email failed', error);
      }
    }

    return json(res, { ok: true });
  }),
);

subscribeRouter.get('/api/subscribe', (req, res) => json(res, { ok: false, error: 'Method not allowed.' }, 405));
