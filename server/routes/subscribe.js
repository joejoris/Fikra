/**
 * POST /api/subscribe — newsletter sign-ups (Resend Audience + welcome email).
 */
import { Router } from 'express';
import { asyncHandler, clean, createRateLimiter, isEmail, sendResend, verifyTurnstile } from '../lib.js';
import { insertSubscriberIgnore } from '../db.js';

export const subscribeRouter = Router();

const limited = createRateLimiter(5, 10 * 60 * 1000);

function json(res, body, status = 200) {
  return res.status(status).json(body);
}

subscribeRouter.post(
  '/api/subscribe',
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
        return json(res, { ok: false, error: token ? 'Verification failed.' : 'Verification required.' }, 400);
      }
    }

    const apiKey = process.env.RESEND_API_KEY;
    const audienceId = process.env.RESEND_AUDIENCE_ID;

    if (!apiKey || !audienceId) {
      console.error('subscribe: not configured (missing RESEND_API_KEY / RESEND_AUDIENCE_ID)');
      return json(res, { ok: false, error: 'Sign-up is not fully set up yet. Please contact us directly.' }, 503);
    }

    const addRes = await fetch(`https://api.resend.com/audiences/${audienceId}/contacts`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email,
        first_name: firstName || undefined,
        unsubscribed: false,
      }),
    });

    // 409 means the address is already on the list — treat as success.
    if (!addRes.ok && addRes.status !== 409) {
      let text = '';
      try {
        text = await addRes.text();
      } catch {
        text = '';
      }
      console.error('subscribe: add failed', addRes.status, text);
      return json(res, { ok: false, error: 'Could not sign you up. Please try again.' }, 502);
    }

    // Keep a local record too (best effort).
    try {
      await insertSubscriberIgnore(email, firstName || null);
    } catch (error) {
      console.error('subscribe: db insert failed', error);
    }

    // Welcome email (best effort).
    if (process.env.CONTACT_FROM_EMAIL) {
      try {
        await sendResend(apiKey, {
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
