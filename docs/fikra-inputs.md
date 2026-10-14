# FIKRA input checklist

Everything below is needed from FIKRA. Items marked **(blocking)** hold up work
until they are answered. Send answers in whatever form is easiest — bullet
points are fine.

## Needed now (discovery)

- [ ] **(blocking)** What is the site's single most important job — showcase
      programs, attract partners and donors, recruit members, or all three?
- [x] Language: English only (decided).
- [ ] **(blocking)** Who is the one person at FIKRA who consolidates feedback and
      gives final approval on content and documents? Name them.
- [ ] Brand assets: logo file, colours, fonts — or confirm none exist and we
      design fresh ones.
- [ ] Photos: do authentic photos exist? If so, share them. If not, this must be
      captured before design is finished.
- [ ] Domain: has it been purchased, and in whose account?
- [ ] Donation provider: which service, and does FIKRA have an account? (A stub
      link is acceptable for launch; the choice is still needed.)

## For the website

- [ ] Real organisation details: full registered name, address, email, phone,
      registration number.
- [ ] Social media accounts that actually exist (remove the rest).
- [ ] Program details: names, who each is for, duration, location, status.
- [ ] Team: names, roles, short bios, photos, and permission to publish.
- [ ] Verified statistics for the homepage and Impact page.
- [ ] At least one real news item for launch.
- [ ] Impact stories: real, consented accounts — or leave them as drafts.
- [ ] Confirmation of who monitors the inbox that form submissions go to.
- [ ] Newsletter: go-ahead to collect email addresses, and who will send updates.
- [ ] Documents to publish: constitution, strategic plan, annual reports, policies
      (PDFs), and in which categories.
- [ ] FAQ: any answers only FIKRA can give (cost, location, eligibility).
- [ ] Events: any confirmed dates, venues and registration links to publish.
- [ ] Testimonials: 2–3 short consented quotes from founders, mentors or partners.
- [ ] First newsletter edition: the text of one past update for the archive.
- [ ] Donation: once a provider is chosen, set its return URL to `/donate/thanks`.
- [ ] PayPal: business account created; REST API app credentials
      (`PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`); webhook added for
      `PAYMENT.CAPTURE.COMPLETED` (`PAYPAL_WEBHOOK_ID`); currency confirmed.
- [ ] Uploads: attachments are stored in the database and emailed — no decision needed.

## For the organisational documents

- [ ] **Constitution:** founding member list, intended legal status and
      jurisdiction, proposed board size.
- [ ] **Strategic plan:** current programs, baseline numbers (however rough),
      funding situation, top 3–4 priorities for 2026–2028.
- [ ] **Org chart:** who currently does what, and which roles are planned.
- [ ] **Staff handbook:** actual employment and leave practices (we will not
      invent these), code-of-conduct expectations, and whether FIKRA runs youth
      programs requiring safeguarding policies.

## Accounts to create under FIKRA ownership

- [ ] Domain registrar
- [ ] Git repository (GitHub organisation)
- [ ] Hosting (Render blueprint in `render.yaml`)
- [ ] Analytics
- [ ] Email sending provider (e.g. Resend) and the receiving inbox
- [ ] Resend Audience (for newsletter sign-ups)
- [ ] Supabase project (submissions inbox + uploads)

## Review gates

Each document needs a scheduled review window, or the work stalls silently.
Proposed: a fixed weekly slot with the nominated approver, and a single
consolidated round of feedback per document.
