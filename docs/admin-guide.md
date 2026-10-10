# Admin guide

This guide is for FIKRA staff who update the website. You do not need to know
how to code to publish news, add a program, or update the team page.

## What you can edit yourself

| Content | Where it appears |
|---|---|
| **News** | The News page and the homepage |
| **Programs** | The Programs page and each program's own page |
| **Impact stories** | The Impact page and the homepage |
| **Team** | The Team page |

Everything else (organisation address, phone, donation link, homepage wording)
is set in a configuration file by whoever maintains the site.

## Drafts

News posts and impact stories have a **Draft** switch.

- **Draft on** → the item is saved but hidden from the live website.
- **Draft off** → the item is published.

Use drafts freely. Nothing shows on the public site until you turn the switch
off.

## How publishing works

The website is not a database you edit live. Your edits are saved as small text
files in the project's repository, and the site rebuilds automatically — usually
within a minute or two. You do not need to do anything to trigger the rebuild.

If a change does not appear after a few minutes, check that you pressed
**Publish** (not just Save), then contact whoever maintains the site.

## Editing locally (for the person setting things up)

Run:

```bash
npm run cms
```

Then open `http://localhost:4321/admin` while `npm run dev` is running. This uses
Decap's local backend — no login required, and changes are written straight to
your files.

## Setting up browser editing in production

By default Decap needs a way to authenticate with GitHub. Two common options:

### Option A — GitHub OAuth via a small auth proxy (recommended for Cloudflare)

1. Create a GitHub OAuth app under FIKRA's GitHub organisation.
2. Deploy an OAuth proxy (e.g. `vencax/netlify-cms-github-oauth-provider` or a
   Cloudflare Worker equivalent).
3. In `public/admin/config.yml`, set the backend to `github` and add
   `base_url` pointing at your proxy.

### Option B — Netlify Identity + Git Gateway

If the site is hosted on Netlify, enable Identity and Git Gateway, then set the
backend to `git-gateway`. Invite staff by email from the Netlify dashboard.

Either way, the repository in `public/admin/config.yml` (`repo:`) must be the one
FIKRA owns.

## Account ownership (important)

The domain, the Git repository, hosting, the CMS, and analytics must all be
created under accounts **FIKRA controls**, not personal accounts. Before the site
goes live, confirm FIKRA has owner access to every one of them and record the
credentials somewhere safe.

## Who to contact

Nominate one person at FIKRA as the site owner. They are the first point of
contact for questions and the only person who needs administrative access.
