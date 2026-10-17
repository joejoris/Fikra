/**
 * GitHub OAuth endpoints for the Decap CMS admin (/admin).
 *
 * Decap's `github` backend opens a popup at:
 *   {base_url}/{auth_endpoint}?provider=github&site_id=…
 * We send the editor to GitHub, then hand the access token back to the CMS
 * window using Decap's documented postMessage handshake:
 *   popup -> opener : "authorizing:github"
 *   opener -> popup : "authorizing:github"
 *   popup -> opener : "authorization:github:success:{token,provider}"
 *
 * Required env:
 *   GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET
 * Optional:
 *   GITHUB_OAUTH_SCOPES  (default "repo,user")
 *   SITE_URL             (defaults to the production site URL)
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { asyncHandler } from '../lib.js';

export const cmsAuthRouter = Router();

const COOKIE = 'fikra_cms_state';
const DEFAULT_SITE = 'https://fikra-gen-innovators.vercel.app';

const clientId = () => process.env.GITHUB_OAUTH_CLIENT_ID || '';
const clientSecret = () => process.env.GITHUB_OAUTH_CLIENT_SECRET || '';
const scopes = () => process.env.GITHUB_OAUTH_SCOPES || 'repo,user';
const siteUrl = () => (process.env.SITE_URL || DEFAULT_SITE).replace(/\/+$/, '');
const enabled = () => Boolean(clientId() && clientSecret());

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function htmlPage(title, message) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:34rem;margin:15vh auto;padding:0 1.25rem;color:#0b1f33;line-height:1.5}
h1{font-size:1.35rem}a{color:#0e6e6e}</style></head>
<body><h1>${title}</h1><p>${message}</p></body></html>`;
}

/** Lets the admin page explain itself when OAuth is not configured yet. */
cmsAuthRouter.get('/api/cms/status', (req, res) => {
  res.json({ ok: true, enabled: enabled() });
});

cmsAuthRouter.get('/api/cms/auth', (req, res) => {
  if (!enabled()) {
    return res
      .status(503)
      .type('html')
      .send(
        htmlPage(
          'Content admin is not set up yet',
          'A maintainer needs to add GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET, then reload this page.',
        ),
      );
  }
  const state = crypto.randomBytes(16).toString('hex');
  res.setHeader('Set-Cookie', `${COOKIE}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', clientId());
  url.searchParams.set('redirect_uri', `${siteUrl()}/api/cms/callback`);
  url.searchParams.set('scope', scopes());
  url.searchParams.set('state', state);
  res.redirect(url.toString());
});

cmsAuthRouter.get(
  '/api/cms/callback',
  asyncHandler(async (req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    if (!enabled()) {
      return res
        .status(503)
        .type('html')
        .send(htmlPage('Content admin is not set up yet', 'GitHub OAuth is not configured.'));
    }
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if (!code || !state || state !== cookies(req)[COOKIE]) {
      return res
        .status(400)
        .type('html')
        .send(
          htmlPage(
            'Sign-in failed',
            'The response from GitHub was incomplete or did not match. Please close this window and try again from /admin.',
          ),
        );
    }

    let token = '';
    try {
      const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          client_id: clientId(),
          client_secret: clientSecret(),
          code,
          redirect_uri: `${siteUrl()}/api/cms/callback`,
        }),
      });
      const data = await response.json();
      token = typeof data.access_token === 'string' ? data.access_token : '';
      if (!token) throw new Error(data.error_description || data.error || 'no access token');
    } catch (error) {
      console.error('cms-auth: token exchange failed', error);
      return res
        .status(502)
        .type('html')
        .send(
          htmlPage(
            'Sign-in failed',
            'GitHub did not return an access token. Please close this window and try again.',
          ),
        );
    }

    const payload = JSON.stringify({ token, provider: 'github' }).replace(/</g, '\\u003c');
    res.type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Signing in…</title></head>
<body>
<p>Signing in… you can close this window.</p>
<script>
(function () {
  var data = ${payload};
  function receiveMessage(e) {
    try {
      if (window.opener) {
        window.opener.postMessage('authorization:github:success:' + JSON.stringify(data), e.origin);
      }
    } catch (err) {}
    window.removeEventListener('message', receiveMessage, false);
  }
  window.addEventListener('message', receiveMessage, false);
  if (window.opener) window.opener.postMessage('authorizing:github', '*');
})();
</script>
</body></html>`);
  }),
);
