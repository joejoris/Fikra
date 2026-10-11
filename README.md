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
  _headers          Security headers (Cloudflare Pages)
  _redirects        Redirect rules (Cloudflare Pages)
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
functions/
  api/contact.ts    Form submissions (email + optional D1/R2)
  api/subscribe.ts  Newsletter sign-ups (Resend Audiences)
  api/rsvp.ts       Event registrations (notification + confirmation email + inbox)
  api/files/[key].ts Serves uploaded files from R2
  inbox.ts          Private submissions inbox (/inbox)
schema/             D1 database schema (submissions inbox)
wrangler.toml       Local Pages runtime + binding configuration
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

Forms POST to `/api/contact`, handled by `functions/api/contact.ts`. To make
them deliver mail you must set these environment variables in the hosting
dashboard (and in `.env` for local testing):

| Variable | Purpose |
|---|---|
| `RESEND_API_KEY` | API key for [Resend](https://resend.com) (or swap the provider) |
| `CONTACT_TO_EMAIL` | Inbox that receives submissions |
| `CONTACT_FROM_EMAIL` | Verified sender address |
| `RESEND_AUDIENCE_ID` | Resend Audience for newsletter sign-ups |
| `INBOX_PASSWORD` | Password for the private `/inbox` page |
| `TURNSTILE_SECRET_KEY` | Optional — Cloudflare Turnstile spam protection |
| `PUBLIC_FORM_ENDPOINT` | Where the browser posts (default `/api/contact`) |
| `PUBLIC_ANALYTICS_SRC` / `PUBLIC_ANALYTICS_DOMAIN` | Optional cookie-free analytics (Plausible-style) |
| `PUBLIC_CF_WEB_ANALYTICS_TOKEN` | Optional — Cloudflare Web Analytics beacon token (free, cookieless) |

Until `RESEND_API_KEY` is set, the endpoint returns a clear "not fully set up"
message rather than silently discarding submissions. Every valid submission also
gets an automatic acknowledgement email. **Test a real submission, including the
spam folder, before launch.**

Optional bindings (see `wrangler.toml`):

| Binding | Type | Enables |
|---|---|---|
| `DB` | D1 database | The `/inbox` submissions list (see `schema/submissions.sql`) |
| `FILES` | R2 bucket | Storing CVs/pitch decks. Without it, uploads are emailed instead |

### Newsletter

The footer and homepage sign-up forms post to `/api/subscribe`, which adds the
address to a Resend Audience (`RESEND_AUDIENCE_ID`) and sends a welcome email.
Past editions live in `src/content/newsletters/` and are listed on the public
archive at `/newsletter`.

### Event RSVP

Events without an external registration link show a built-in RSVP form posting
to `/api/rsvp`. FIKRA gets a notification email, the attendee gets a
confirmation email, and the registration lands in the inbox with source `rsvp`.

### Submissions inbox

Every form submission is emailed *and* recorded in D1 when the `DB` binding is
present. Staff can review them at `/inbox`, protected by `INBOX_PASSWORD`. The
inbox can be filtered by source (contact, volunteer, partner, member, rsvp)
with per-source counts, and the whole list can be downloaded with **Export
CSV** for backups. For a real deployment, put `/inbox` and `/api/files` behind
Cloudflare Access instead of sharing a password.

### File uploads

The membership form accepts up to two files (PDF/Word/PowerPoint/image, 8 MB
each). With the `FILES` R2 binding they are stored and linked from the email;
without it they are attached to the notification email.

### Testing forms locally

`npm run preview` serves the static site only — it does not run the
`functions/` handler. To test form submissions end-to-end locally, build first
and run the Pages runtime:

```bash
npm run build
npx wrangler pages dev dist
```

Set the environment variables above in a `.dev.vars` file (same format as
`.env`) so the function can send mail. `PUBLIC_FORM_ENDPOINT` is only used by the
browser and defaults to `/api/contact`, which wrangler serves.

To exercise the newsletter, inbox and uploads locally, create the D1 database and
apply the schema, then uncomment the bindings in `wrangler.toml`:

```bash
npx wrangler d1 create fikra-submissions
npx wrangler d1 execute fikra-submissions --local --file=./schema/submissions.sql
npx wrangler pages dev dist
```

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
- **Security headers + redirects** via `public/_headers` and `public/_redirects`
  (Cloudflare Pages).
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
