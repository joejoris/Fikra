# Launch checklist

Work through this before the site goes public. Nothing here is optional unless
marked.

## Content

- [ ] Every `[CONFIRM]` placeholder is replaced with real information
      (search the project for `[CONFIRM]` and `[N]`).
- [ ] Team page shows real people with their permission.
- [ ] Programs are accurate and each status (`open` / `coming-soon` / `closed`)
      is correct.
- [ ] At least one real news post is published (drafts hidden).
- [ ] Impact stories are real, verified and consented — or left as drafts.
- [ ] All statistics on the homepage and Impact page are verified. Do not publish
      invented numbers.
- [ ] Photos are authentic and used with permission.
- [ ] Privacy policy reviewed and aligned with applicable data-protection law.

## Configuration

- [ ] `site` in `astro.config.mjs` set to the real domain.
- [ ] `Sitemap:` URL in `public/robots.txt` set to the real domain.
- [ ] `src/lib/site.ts` updated: legal name, address, email, phone, social links,
      registration number.
- [ ] Donation methods added in `src/lib/site.ts` (or left clearly as "coming
      soon").
- [ ] `public/og-default.svg` replaced with a 1200×630 PNG/JPG.
- [ ] Amharic (if launching it) reviewed by an Amharic speaker; the language
      switcher and `/am/` pages checked.

## Forms and email

- [ ] `RESEND_API_KEY`, `CONTACT_TO_EMAIL`, `CONTACT_FROM_EMAIL` set in hosting.
- [ ] Newsletter: `RESEND_AUDIENCE_ID` set and a test sign-up confirmed.
- [ ] Submissions inbox: D1 database created, schema applied, `DB` bound, strong
      `INBOX_PASSWORD` set, and `/inbox` tested.
- [ ] Uploads: decide between R2 (`FILES` binding) and email attachments; test a
      file upload end-to-end, including a large file and a disallowed type.
- [ ] SPF/DKIM configured for the sending domain (or mail may go to spam).
- [ ] Each form tested end-to-end: contact, volunteer, partner, member, program
      interest, newsletter.
- [ ] Confirmation that submissions arrive in the FIKRA inbox — **check the spam
      folder too**.
- [ ] Honeypot confirmed to work; rate limiting confirmed to respond with 429
      after repeated submissions.
- [ ] Optional: Turnstile enabled if spam becomes a problem.

## Other features

- [ ] Documents page: each published document opens correctly and the file names
      are sensible.
- [ ] Events page: dates are correct, and the `.ics` feed and "add to Google
      Calendar" links work.
- [ ] Search returns sensible results; RSS feed validates.
- [ ] `/inbox` and `/api/files` are protected (Cloudflare Access recommended).

## Deployment

- [ ] Repository, domain, hosting, CMS and analytics all owned by FIKRA.
- [ ] Domain connected and HTTPS valid.
- [ ] `npm run build` succeeds with no errors.
- [ ] Analytics active (cookie-free) and receiving page views.
- [ ] Site submitted to Google Search Console; `sitemap-index.xml` accepted.

## Quality checks

- [ ] Lighthouse: performance ≥ 90 and accessibility ≥ 90 on the homepage.
- [ ] Homepage initial load under 100 KB (check the network panel).
- [ ] Tested on a real phone on a throttled/slow connection.
- [ ] Tested in Chrome, Firefox, Safari and on iOS + Android.
- [ ] Keyboard navigation works; focus is always visible.
- [ ] 404 page works for a bad URL.
- [ ] All links on every page checked for 404s.

## Handover

- [ ] Admin guide shared with staff (`docs/admin-guide.md`).
- [ ] **Two** staff members trained to publish a news post unaided.
- [ ] Credentials list handed to FIKRA's nominated site owner.
- [ ] Backup/export explained: the Git repository is the backup.
