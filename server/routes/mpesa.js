/**
 * M-Pesa donations via the Safaricom Daraja API (STK push / C2B).
 *
 *   GET  /api/donate/mpesa/status     { enabled } — public
 *   POST /api/donate/mpesa/stk        { phone, amount } → STK push to the phone
 *   GET  /api/donate/mpesa/result?id= { completed: true|false } — donor polls this
 *   POST /api/donate/mpesa/callback   Daraja async callback (public URL required)
 *
 * Env: MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET (required for everything but
 *   status), MPESA_SHORTCODE, MPESA_PASSKEY, MPESA_MODE=sandbox|live
 *   (default sandbox).
 *
 * Completed gifts are recorded in the submissions inbox (form_name 'donation')
 * keyed by CheckoutRequestID, so retries and double-callbacks stay idempotent.
 */
import { Router } from 'express';
import { asyncHandler, clean, createRateLimiter } from '../lib.js';
import { insertSubmission, submissionExists } from '../db.js';

export const mpesaRouter = Router();

const MIN_AMOUNT = 1;
const MAX_AMOUNT = 500000; // KES per-transaction ceiling
const stkLimited = createRateLimiter(10, 10 * 60 * 1000);

function configured() {
  return Boolean(
    process.env.MPESA_CONSUMER_KEY &&
      process.env.MPESA_CONSUMER_SECRET &&
      process.env.MPESA_SHORTCODE &&
      process.env.MPESA_PASSKEY,
  );
}

function base() {
  return process.env.MPESA_MODE === 'live'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';
}

function json(res, body, status = 200) {
  return res.status(status).json(body);
}

/** Normalize Kenyan numbers to 254XXXXXXXXX, or null when invalid. */
export function normalizePhone(raw) {
  const digits = String(raw ?? '').replace(/[\s+\-()]/g, '');
  const match = digits.match(/^(?:254|0)([17]\d{8})$/);
  return match ? `254${match[1]}` : null;
}

function parseAmount(value) {
  const amount = Math.floor(Number(value));
  if (!Number.isInteger(amount)) return null;
  if (amount < MIN_AMOUNT || amount > MAX_AMOUNT) return null;
  return amount;
}

let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function accessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) return cachedToken;
  const credentials = Buffer.from(
    `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`,
  ).toString('base64');
  const res = await fetch(`${base()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { authorization: `Basic ${credentials}` },
  });
  if (!res.ok) {
    throw new Error(`mpesa token failed: ${res.status}`);
  }
  const data = await res.json();
  cachedToken = data.access_token;
  // Tokens last ~1h; refresh a little early.
  cachedTokenExpiresAt = Date.now() + (Number(data.expires_in) || 3300) * 1000 - 5 * 60 * 1000;
  return cachedToken;
}

function stkPassword(timestamp) {
  return Buffer.from(
    `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`,
  ).toString('base64');
}

function timestampNow() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(
    d.getUTCHours(),
  )}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

mpesaRouter.get('/api/donate/mpesa/status', (req, res) =>
  json(res, { enabled: configured(), currency: 'KES', mode: process.env.MPESA_MODE === 'live' ? 'live' : 'sandbox' }),
);

mpesaRouter.post(
  '/api/donate/mpesa/stk',
  asyncHandler(async (req, res) => {
    const ip = req.ip ?? 'unknown';
    if (stkLimited(ip)) {
      return json(res, { ok: false, error: 'Too many requests. Please try later.' }, 429);
    }

    const phone = normalizePhone(req.body?.phone);
    if (!phone) {
      return json(res, { ok: false, error: 'Please enter a valid Safaricom number (e.g. 0712 345 678).' }, 400);
    }

    const amount = parseAmount(req.body?.amount);
    if (amount == null) {
      return json(
        res,
        { ok: false, error: `Please enter an amount between ${MIN_AMOUNT} and ${MAX_AMOUNT} KES.` },
        400,
      );
    }

    if (!configured()) {
      console.error('mpesa: not configured (missing MPESA_* credentials)');
      return json(res, { ok: false, error: 'M-Pesa giving is not set up yet. Please contact us directly.' }, 503);
    }

    const origin = `${req.protocol}://${req.get('host')}`;
    const timestamp = timestampNow();
    let stk;
    try {
      const token = await accessToken();
      const response = await fetch(`${base()}/mpesa/stkpush/v1/processrequest`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          BusinessShortCode: process.env.MPESA_SHORTCODE,
          Password: stkPassword(timestamp),
          Timestamp: timestamp,
          TransactionType: 'CustomerPayBillOnline',
          Amount: amount,
          PartyA: phone,
          PartyB: process.env.MPESA_SHORTCODE,
          PhoneNumber: phone,
          CallBackURL: `${origin}/api/donate/mpesa/callback`,
          AccountReference: 'FIKRA',
          TransactionDesc: 'Donation to FIKRA',
        }),
      });
      stk = await response.json();
    } catch (error) {
      console.error('mpesa: stk push failed', error);
      return json(res, { ok: false, error: 'Could not reach M-Pesa. Please try again.' }, 502);
    }

    if (stk?.ResponseCode !== '0' || !stk?.CheckoutRequestID) {
      console.error('mpesa: stk rejected', JSON.stringify(stk));
      const message =
        clean(stk?.errorMessage) || clean(stk?.ResponseDescription) || 'M-Pesa rejected the request.';
      return json(res, { ok: false, error: message }, 502);
    }

    return json(res, { ok: true, checkoutRequestId: stk.CheckoutRequestID });
  }),
);

mpesaRouter.get(
  '/api/donate/mpesa/result',
  asyncHandler(async (req, res) => {
    const id = clean(req.query.id);
    if (!id) {
      return json(res, { ok: false, error: 'Missing request reference.' }, 400);
    }
    return json(res, { ok: true, completed: await submissionExists(id) });
  }),
);

mpesaRouter.post(
  '/api/donate/mpesa/callback',
  asyncHandler(async (req, res) => {
    // Always acknowledge quickly — Daraja retries on anything else.
    if (!configured()) {
      return json(res, { ResultCode: 1, ResultDesc: 'Not configured.' });
    }

    try {
      const cb = req.body?.Body?.stkCallback;
      if (!cb?.CheckoutRequestID) {
        return json(res, { ResultCode: 1, ResultDesc: 'Bad callback.' });
      }

      // Idempotent: Daraja may deliver twice.
      if (await submissionExists(cb.CheckoutRequestID)) {
        return json(res, { ResultCode: 0, ResultDesc: 'Already recorded.' });
      }

      if (Number(cb.ResultCode) !== 0) {
        console.log('mpesa: payment not completed', cb.ResultCode, clean(cb.ResultDesc));
        return json(res, { ResultCode: 0, ResultDesc: 'Noted.' });
      }

      const items = cb.CallbackMetadata?.Item ?? [];
      const meta = Object.fromEntries(items.map((item) => [item?.Name, item?.Value]));
      const amount = meta.Amount ?? '?';
      const receipt = meta.MpesaReceiptNumber ?? 'unknown';
      const phone = normalizePhone(meta.PhoneNumber) ?? clean(meta.PhoneNumber);

      await insertSubmission({
        form_name: 'donation',
        name: null,
        email: null,
        phone,
        organisation: null,
        interest: null,
        program: null,
        message: [
          `M-Pesa donation ${amount} KES`,
          `Receipt: ${receipt}`,
          `Checkout: ${cb.CheckoutRequestID}`,
        ].join('\n'),
        files: null,
      });
    } catch (error) {
      console.error('mpesa: callback handling failed', error);
    }

    return json(res, { ResultCode: 0, ResultDesc: 'Accepted.' });
  }),
);
