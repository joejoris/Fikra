/**
 * PayPal donations via the Orders v2 API (no SDK).
 *
 *   GET  /api/donate/paypal/status    { enabled, currency } — public
 *   POST /api/donate/paypal/create    { amount } → { approvalUrl }
 *   GET  /donate/return               PayPal redirects here after approval;
 *                                     we capture and redirect to /donate/thanks
 *   POST /api/donate/paypal/webhook   PAYMENT.CAPTURE.COMPLETED → inbox record
 *
 * Env: PAYPAL_CLIENT_ID, PAYPAL_SECRET (required for everything but status),
 *   PAYPAL_MODE=sandbox|live (default sandbox), PAYPAL_CURRENCY (default USD),
 *   PAYPAL_BRAND (default FIKRA), PAYPAL_WEBHOOK_ID (required for webhooks).
 *
 * Completed donations are recorded in the submissions inbox (form_name
 * 'donation') so staff see them next to every other lead.
 */
import { Router } from 'express';
import {
  asyncHandler,
  clean,
  createRateLimiter,
  isEmail,
  sendResend,
} from '../lib.js';
import { insertSubmission, submissionExists } from '../db.js';

export const paypalRouter = Router();

const MIN_AMOUNT = 1;
const MAX_AMOUNT = 100000;
const createLimited = createRateLimiter(10, 10 * 60 * 1000);

function configured() {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_SECRET);
}

function mode() {
  return process.env.PAYPAL_MODE === 'live' ? 'live' : 'sandbox';
}

function base() {
  return mode() === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

function currency() {
  return (process.env.PAYPAL_CURRENCY || 'USD').toUpperCase();
}

let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function accessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) return cachedToken;
  const credentials = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`,
  ).toString('base64');
  const res = await fetch(`${base()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${credentials}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    throw new Error(`paypal token failed: ${res.status}`);
  }
  const data = await res.json();
  cachedToken = data.access_token;
  // Tokens last ~9h; refresh a little early.
  cachedTokenExpiresAt = Date.now() + (Number(data.expires_in) || 32000) * 1000 - 5 * 60 * 1000;
  return cachedToken;
}

async function paypalFetch(path, { method = 'GET', body } = {}) {
  const token = await accessToken();
  const res = await fetch(`${base()}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

function originOf(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function json(res, body, status = 200) {
  return res.status(status).json(body);
}

function parseAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  const rounded = Math.round(amount * 100) / 100;
  if (rounded < MIN_AMOUNT || rounded > MAX_AMOUNT) return null;
  return rounded;
}

async function recordDonation({ name, email, amount, currencyCode, captureId, orderId }) {
  const reference = `PayPal capture ${captureId}`;
  try {
    if (await submissionExists(reference)) return;
    await insertSubmission({
      form_name: 'donation',
      name: name || null,
      email: email || null,
      phone: null,
      organisation: null,
      interest: null,
      program: null,
      message: [`PayPal donation ${amount} ${currencyCode}`, reference, `Order: ${orderId}`].join('\n'),
      files: null,
    });
  } catch (error) {
    console.error('paypal: inbox record failed', error);
  }
}

function payerName(payer) {
  const given = payer?.name?.given_name ?? '';
  const surname = payer?.name?.surname ?? '';
  return `${given} ${surname}`.trim() || null;
}

paypalRouter.get('/api/donate/paypal/status', (req, res) =>
  json(res, { enabled: configured(), currency: currency(), mode: mode() }),
);

paypalRouter.post(
  '/api/donate/paypal/create',
  asyncHandler(async (req, res) => {
    const ip = req.ip ?? 'unknown';
    if (createLimited(ip)) {
      return json(res, { ok: false, error: 'Too many requests. Please try later.' }, 429);
    }

    const amount = parseAmount(req.body?.amount);
    if (amount == null) {
      return json(
        res,
        { ok: false, error: `Please enter an amount between ${MIN_AMOUNT} and ${MAX_AMOUNT}.` },
        400,
      );
    }

    if (!configured()) {
      console.error('paypal: not configured (missing PAYPAL_CLIENT_ID / PAYPAL_SECRET)');
      return json(res, { ok: false, error: 'Online giving is not set up yet. Please contact us directly.' }, 503);
    }

    const origin = originOf(req);
    let created;
    try {
      created = await paypalFetch('/v2/checkout/orders', {
        method: 'POST',
        body: {
          intent: 'CAPTURE',
          purchase_units: [
            {
              description: 'Donation to FIKRA',
              custom_id: 'fikra-donation',
              amount: { currency_code: currency(), value: amount.toFixed(2) },
            },
          ],
          application_context: {
            brand_name: process.env.PAYPAL_BRAND || 'FIKRA',
            return_url: `${origin}/donate/return`,
            cancel_url: `${origin}/donate/thanks?status=cancelled`,
            user_action: 'PAY_NOW',
          },
        },
      });
    } catch (error) {
      console.error('paypal: create failed', error);
      return json(res, { ok: false, error: 'Could not start the payment. Please try again.' }, 502);
    }

    if (!created.ok) {
      console.error('paypal: create rejected', created.status, JSON.stringify(created.data));
      return json(res, { ok: false, error: 'Could not start the payment. Please try again.' }, 502);
    }

    const approvalUrl = created.data?.links?.find((link) => link.rel === 'approve')?.href;
    if (!approvalUrl) {
      console.error('paypal: no approval link', JSON.stringify(created.data));
      return json(res, { ok: false, error: 'Could not start the payment. Please try again.' }, 502);
    }

    return json(res, { ok: true, approvalUrl });
  }),
);

paypalRouter.get(
  '/donate/return',
  asyncHandler(async (req, res) => {
    const thanks = (status) => res.redirect(`/donate/thanks?status=${status}`);
    const orderId = clean(req.query.token);

    if (!orderId || !configured()) {
      return thanks('failed');
    }

    let captured;
    try {
      captured = await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
        method: 'POST',
      });
    } catch (error) {
      console.error('paypal: capture failed', error);
      return thanks('failed');
    }

    if (!captured.ok) {
      console.error('paypal: capture rejected', captured.status, JSON.stringify(captured.data));
      return thanks('failed');
    }

    const capture = captured.data?.purchase_units?.[0]?.payments?.captures?.[0];
    if (!capture || capture.status !== 'COMPLETED') {
      console.error('paypal: capture incomplete', JSON.stringify(captured.data));
      return thanks('failed');
    }

    const payer = captured.data?.payer ?? {};
    const email = isEmail(payer.email_address ?? '') ? payer.email_address : null;
    await recordDonation({
      name: payerName(payer),
      email,
      amount: capture.amount?.value ?? '?',
      currencyCode: capture.amount?.currency_code ?? currency(),
      captureId: capture.id,
      orderId,
    });

    // Thank-you email to the donor (best effort).
    if (email && process.env.RESEND_API_KEY && process.env.CONTACT_FROM_EMAIL) {
      try {
        await sendResend(process.env.RESEND_API_KEY, {
          from: process.env.CONTACT_FROM_EMAIL,
          to: [email],
          subject: 'Thank you for your gift — FIKRA',
          text: [
            `Hello${payer?.name?.given_name ? ` ${payer.name.given_name}` : ''},`,
            '',
            `Thank you for your gift of ${capture.amount?.value} ${capture.amount?.currency_code} to FIKRA.`,
            'Your support helps a young founder turn an idea into income.',
            '',
            `PayPal transaction: ${capture.id}`,
            '',
            '— FIKRA',
          ].join('\n'),
        });
      } catch (error) {
        console.error('paypal: thank-you email failed', error);
      }
    }

    return thanks('success');
  }),
);

paypalRouter.post(
  '/api/donate/paypal/webhook',
  asyncHandler(async (req, res) => {
    if (!configured() || !process.env.PAYPAL_WEBHOOK_ID) {
      return json(res, { ok: false, error: 'Webhooks are not configured.' }, 503);
    }

    const event = req.body;
    let verified;
    try {
      verified = await paypalFetch('/v1/notifications/verify-webhook-signature', {
        method: 'POST',
        body: {
          transmission_id: req.headers['paypal-transmission-id'],
          transmission_time: req.headers['paypal-transmission-time'],
          cert_url: req.headers['paypal-cert-url'],
          auth_algo: req.headers['paypal-auth-algo'],
          transmission_sig: req.headers['paypal-transmission-sig'],
          webhook_id: process.env.PAYPAL_WEBHOOK_ID,
          webhook_event: event,
        },
      });
    } catch (error) {
      console.error('paypal: webhook verify failed', error);
      return json(res, { ok: false, error: 'Verification failed.' }, 502);
    }

    if (!verified.ok || verified.data?.verification_status !== 'SUCCESS') {
      console.error('paypal: webhook bad signature', verified.status, JSON.stringify(verified.data));
      return json(res, { ok: false, error: 'Invalid signature.' }, 403);
    }

    if (event?.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      const resource = event.resource ?? {};
      const email = isEmail(resource?.payer?.email_address ?? '') ? resource.payer.email_address : null;
      await recordDonation({
        name: payerName(resource?.payer),
        email,
        amount: resource.amount?.value ?? '?',
        currencyCode: resource.amount?.currency_code ?? currency(),
        captureId: resource.id,
        orderId: resource.supplementary_data?.related_ids?.order_id ?? resource.id,
      });
    }

    return json(res, { ok: true });
  }),
);
