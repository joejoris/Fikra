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
  documents/        Downloadable PDFs (constitution, reports, policies)
  favicon.svg, og-default.svg, robots.txt
  manifest.webmanifest, sw.js  PWA-lite: installable shell + offline support
src/
  components/       Reusable UI pieces (Header, Footer, cards, Form…)
  content/          Editable content (programs, news, impact, team, faq, events, documents, newsletters, testimonials)
  content.config.ts Content schemas — the rules each entry must follow
  layouts/          BaseLayout (head, SEO, header, footer)
  lib/site.ts       Organisation details, nav, stats, donation settings
  pages/            One file per page/route
  scripts/forms.ts  Client-side form handling
  styles/global.css Design tokens + base styles
scripts/
  generate-og.mjs   Per-page OG images, rebuilt before every build
  generate-icons.mjs  PNG favicons + app icons, rebuilt before every build
server/             Node API + inbox, served on the same origin as the site
  app.js            Express app (static dist + API + security headers)
  index.js          Long-lived entry point (local dev / Render)
  db.js             Postgres (DATABASE_URL) or local SQLite (./data/app.db)
  routes/           contact, subscribe, rsvp, inbox, files
api/
  index.js          Vercel serverless entry point (exports the Express app)
vercel.json         Vercel config: build, rewrites to the function, security headers
render.yaml         Optional Render blueprint (alternative host to Vercel)
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
- **Donation:** add one or more giving methods to `DONATION.methods` in
  `src/lib/site.ts` when a payment link or bank account exists.
- **Team, programs, news, stories, FAQ, events, documents:** replace placeholder
  `[CONFIRM]` content.
- **Social image:** replace `public/og-default.svg` with a 1200×630 PNG/JPG.
- **Forms:** configure email delivery (see below).

## Forms and email delivery

Forms POST to `/api/contact`, handled by the Node server (`server/`), which
runs on the same origin as the site. To make them deliver mail you must set
these environment variables in the hosting dashboard (and in `.dev.vars` for
local testing):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Supabase Postgres connection string (leave unset for local SQLite) |
| `RESEND_API_KEY` | API key for [Resend](https://resend.com) — mail provider option 1 |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | Gmail address + App Password — mail provider option 2 (no Resend needed) |
| `CONTACT_TO_EMAIL` | Inbox that receives submissions |
| `CONTACT_FROM_EMAIL` | Verified sender address |
| `RESEND_AUDIENCE_ID` | Resend Audience for newsletter sign-ups |
| `INBOX_PASSWORD` | Password for the private `/inbox` page |
| `TURNSTILE_SECRET_KEY` | Optional — Cloudflare Turnstile spam protection (set `PUBLIC_TURNSTILE_SITE_KEY` too, or forms break) |
| `PUBLIC_TURNSTILE_SITE_KEY` | Turnstile widget site key — renders the challenge on all forms |
| `PUBLIC_FORM_ENDPOINT` | Where the browser posts (default `/api/contact`) |
| `PUBLIC_ANALYTICS_SRC` / `PUBLIC_ANALYTICS_DOMAIN` | Optional cookie-free analytics (Plausible-style) |
| `PUBLIC_CF_WEB_ANALYTICS_TOKEN` | Optional — Cloudflare Web Analytics beacon token (free, cookieless) |

Every valid submission is stored **before** any email is attempted, so a mail
problem can never lose an enquiry or show the visitor a dead-end error:

- **No mail provider set** — submissions (contact, RSVP) are saved to the inbox
  and newsletter sign-ups to the subscribers table; the visitor still sees
  success. Set a provider to also get notification and acknowledgement emails.
- **Provider configured but failing** (bad key, provider outage) — the
  submission is saved and the visitor still sees success; the error is logged.

Every valid submission also gets an automatic acknowledgement email once a
provider is set. **Test a real submission, including the spam folder, before
launch.**

Submissions are stored in Postgres in production (`DATABASE_URL`) and in a local
SQLite file (`./data/app.db`, gitignored) when it is unset.

### Newsletter

The footer and homepage sign-up forms post to `/api/subscribe`. With Resend
configured, the address joins a Resend Audience (`RESEND_AUDIENCE_ID`) and
gets a welcome email; with Gmail configured, the signup is recorded locally
(subscribers table, exportable via the inbox CSV) and gets the same welcome
email. Past editions live in `src/content/newsletters/` and are listed on the
public archive at `/newsletter`.

### Donations (PayPal)

Online giving runs through PayPal's Orders API (`server/routes/paypal.js`):

- The donate page shows a **Give with PayPal** panel only when the server has
  `PAYPAL_CLIENT_ID` + `PAYPAL_SECRET` set (checked live via
  `/api/donate/paypal/status`); otherwise it stays hidden.
- Donor picks an amount → server creates the order → donor approves on PayPal →
  PayPal returns to `/donate/return` → server captures → donor lands on
  `/donate/thanks?status=success` (or `cancelled`/`failed` variants).
- Completed gifts are recorded in the submissions inbox (`form_name`
  `donation`) and the donor gets a thank-you email. The
  `PAYMENT.CAPTURE.COMPLETED` webhook (`/api/donate/paypal/webhook`, needs
  `PAYPAL_WEBHOOK_ID`) records the same gift with dedupe, as a safety net.
- Start in `PAYPAL_MODE=sandbox` with PayPal sandbox business + personal
  test accounts before touching live money.

### Donations (M-Pesa)

Kenyan donors can give through an M-Pesa STK push (`server/routes/mpesa.js`):

- The donate page shows a **Give with M-Pesa** panel only when the server has
  the Daraja credentials (`MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`,
  `MPESA_SHORTCODE`, `MPESA_PASSKEY`); otherwise it stays hidden.
- Donor enters a Safaricom number + KES amount → server sends the STK push →
  donor approves with their M-Pesa PIN → the page polls
  `/api/donate/mpesa/result` and lands on `/donate/thanks?status=success`.
- Daraja's async callback (`/api/donate/mpesa/callback`) records completed
  gifts in the inbox (`form_name` `donation`), idempotent by checkout ID.
  Callbacks need a public HTTPS URL, so end-to-end testing happens on the
  deployed site (Vercel/Render), not localhost.
- Start in `MPESA_MODE=sandbox` with Daraja test credentials before live money.

### Event RSVP

Events without an external registration link show a built-in RSVP form posting
to `/api/rsvp`. FIKRA gets a notification email, the attendee gets a
confirmation email, and the registration lands in the inbox with source `rsvp`.

### Submissions inbox

Every form submission is emailed *and* recorded in the database. Staff can
review them at `/inbox`, protected by `INBOX_PASSWORD`. The
inbox can be filtered by source (contact, volunteer, partner, member, rsvp)
with per-source counts, and the whole list can be downloaded with **Export
CSV** for backups.

### File uploads

The membership form accepts up to two files (PDF/Word/PowerPoint/image, 2 MB
each). Files are stored in the database, attached to the notification email,
and downloadable from the inbox (login required).

### Testing forms locally

`npm run preview` serves the static site only — it does not run the API.
To test everything end-to-end locally (no accounts needed — SQLite, with mail
calls skipped when no provider is set), build first and run the Node server,
which serves `dist/` and the API on one origin:

```bash
npm run build
npm run server
```

Copy `.dev.vars.example` to `.dev.vars` and fill in values to send real mail
locally. `PUBLIC_FORM_ENDPOINT` is only used by the browser and defaults to
`/api/contact`, which the server provides.

### Additional features

- **Event calendar** (`/events`) with an `.ics` feed and "add to Google Calendar"
  links, plus event structured data — and a built-in RSVP form per event.
- **FAQ** (`/faq`) with FAQPage structured data.
- **Search** (`/search`) — a small client-side index at `/search-index.json`.
- **RSS** at `/rss.xml` and NGO JSON-LD on every page.
- **Document downloads** (`/documents`) for governance documents and reports.
- **Newsletter archive** (`/newsletter`) of past editions.
- **Testimonials** collection, shown on the home and impact pages when present.
- **Per-page share images**: `npm run build` auto-generates OG PNGs for news
  and program pages (`scripts/generate-og.mjs`); pages fall back to
  `og-default.svg` if generation is skipped.
- **Donation thank-you page** (`/donate/thanks`) — point the giving provider's
  return URL at `DONATION.thanksUrl`.
- **Security headers** (CSP, HSTS, clickjacking guards) set by the server on
  every response.
- **Cookie-free analytics**: Cloudflare Web Analytics beacon via
  `PUBLIC_CF_WEB_ANALYTICS_TOKEN`, or a Plausible-style script via
  `PUBLIC_ANALYTICS_SRC` / `PUBLIC_ANALYTICS_DOMAIN`.
- **PWA-lite**: web manifest plus a small offline-first service worker.
- **Announcement bar**: set `ANNOUNCEMENT` in `src/lib/site.ts` to show a
  dismissible banner on every page; empty text hides it.
- **Share buttons** on news and program pages, plus a copy-link button.
- **Favicon pack**: PNG icons (including Apple touch icon) generated from the
  SVG before every build.
- **Accessibility statement** at `/accessibility`, linked from the footer.
- **Newsletter**, **submissions inbox** and **file uploads** (above).

## Deployment

The site runs on [Vercel](https://vercel.com): the static Astro build is served
by the platform, and the API + inbox run as one serverless function
(`api/index.js`, via `vercel.json` rewrites for `/api/*`, `/inbox` and
`/donate/return`).

- **Import the repo** at Vercel; it will use `buildCommand: npm run build` and
  `outputDirectory: dist` from `vercel.json`.
- **Database (required)**: serverless functions have no persistent disk, so set
  `DATABASE_URL` to a Supabase Postgres connection string. Prefer Supabase's
  **transaction pooler** string (port `6543`) for serverless. Without it, form
  and inbox data cannot be stored and visitors get an "email us directly"
  message instead of a saved submission.
- **Login page for Supabase**: if you use Supabase Auth elsewhere, ignore this —
  the app only needs the raw Postgres connection string.
- Set the remaining secrets in **Project → Settings → Environment Variables**
  (`GMAIL_USER` + `GMAIL_APP_PASSWORD` **or** `RESEND_API_KEY` (+
  `RESEND_AUDIENCE_ID`), `CONTACT_TO_EMAIL`, `CONTACT_FROM_EMAIL`,
  `INBOX_PASSWORD`, `TURNSTILE_SECRET_KEY`).

`render.yaml` is kept as an optional alternative host (a long-lived web service
running `node server/index.js`); Vercel does not use it.

## Accessibility and performance

- Semantic HTML, visible focus styles, a skip link, `prefers-reduced-motion`.
- System fonts only — no web-font downloads.
- Minimal JavaScript: pages are static HTML; only forms ship a small script.

## Licence / ownership

All accounts — domain, Git repository, hosting, CMS, analytics — must be created
under **FIKRA's** ownership. See [docs/admin-guide.md](docs/admin-guide.md).
