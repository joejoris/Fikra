# FIKRA website

A fast, low-bandwidth website for FIKRA, built as a **static** site with
[Astro](https://astro.build) and [Tailwind CSS](https://tailwindcss.com). Content
is edited through a browser-based CMS ([Decap](https://decapcms.org)) that saves
changes back to this repository; every save rebuilds and republishes the site.

There is no database and no server to maintain. Forms are handled by one small
serverless function.

## Quick start

```bash
npm install
npm run dev        # start the local dev server (http://localhost:4321)
npm run build      # build the static site into dist/
npm run preview    # preview the built site locally
npm run check      # type-check Astro + TypeScript
```

## Project structure

```
public/
  admin/            Decap CMS (the staff editing interface)
  favicon.svg, og-default.svg, robots.txt
src/
  components/       Reusable UI pieces (Header, Footer, cards, Form…)
  content/          Editable content (programs, news, impact, team)
  content.config.ts Content schemas — the rules each entry must follow
  layouts/          BaseLayout (head, SEO, header, footer)
  lib/site.ts       Organisation details, nav, stats, donation settings
  pages/            One file per page/route
  scripts/forms.ts  Client-side form handling
  styles/global.css Design tokens + base styles
functions/api/      Cloudflare Pages Function that receives form submissions
docs/               Admin guide, launch checklist, FIKRA input checklist
```

## Editing content

Content lives in `src/content/` as Markdown with a frontmatter block. You can
edit it in two ways:

1. **Through the CMS** (recommended for staff): run `npm run cms` for local
   editing, or use `/admin` on the deployed site once OAuth is set up. See
   [docs/admin-guide.md](docs/admin-guide.md).
2. **Directly in the repo**: edit the Markdown files and commit.

The rules for each content type — required fields, allowed values — are defined
in `src/content.config.ts`. If a field is wrong, the build fails with a message
telling you exactly what.

## Things to change before launch

These are tracked in [docs/fikra-inputs.md](docs/fikra-inputs.md). At minimum:

- **Domain:** update `site` in `astro.config.mjs` and
  `Sitemap:` in `public/robots.txt`.
- **Organisation details:** `src/lib/site.ts` (name, address, email, phone,
  registration number, social links, stats).
- **Donation:** set `DONATION.configured` / `provider` / `url` in
  `src/lib/site.ts` when a payment link exists.
- **Team, programs, news, stories:** replace placeholder `[CONFIRM]` content.
- **Social image:** replace `public/og-default.svg` with a 1200×630 PNG/JPG.
- **Forms:** configure email delivery (see below).

## Forms and email delivery

Forms POST to `/api/contact`, handled by `functions/api/contact.ts`. To make
them deliver mail you must set these environment variables in the hosting
dashboard (and in `.env` for local testing):

| Variable | Purpose |
|---|---|
| `RESEND_API_KEY` | API key for [Resend](https://resend.com) (or swap the provider) |
| `CONTACT_TO_EMAIL` | Inbox that receives submissions |
| `CONTACT_FROM_EMAIL` | Verified sender address |
| `TURNSTILE_SECRET_KEY` | Optional — Cloudflare Turnstile spam protection |
| `PUBLIC_FORM_ENDPOINT` | Where the browser posts (default `/api/contact`) |
| `PUBLIC_ANALYTICS_SRC` / `PUBLIC_ANALYTICS_DOMAIN` | Optional cookie-free analytics |

Until `RESEND_API_KEY` is set, the endpoint returns a clear "not fully set up"
message rather than silently discarding submissions. **Test a real submission,
including the spam folder, before launch.**

## Deployment

The site is designed for Cloudflare Pages (free tier):

- Build command: `npm run build`
- Output directory: `dist`
- `functions/` is deployed automatically as Pages Functions.

Vercel/Netlify work too, but the form function would need porting to that
platform's function format.

## Accessibility and performance

- Semantic HTML, visible focus styles, a skip link, `prefers-reduced-motion`.
- System fonts only — no web-font downloads.
- Minimal JavaScript: pages are static HTML; only forms ship a small script.

## Licence / ownership

All accounts — domain, Git repository, hosting, CMS, analytics — must be created
under **FIKRA's** ownership. See [docs/admin-guide.md](docs/admin-guide.md).
