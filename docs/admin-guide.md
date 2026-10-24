# Admin guide

This guide is for FIKRA staff who update the website. You do not need to know
how to code to publish news or update the team, FAQ or events pages.

## What you can edit yourself

| Content | Where it appears |
|---|---|
| **News** | The News page and the homepage |
| **Impact stories** | The Impact page and the homepage |
| **Team** | The Team page |
| **FAQ** | The FAQ page |
| **Events** | The Events page and the `.ics` calendar feed. Leave the registration link empty to use the built-in RSVP form |
| **Documents** | The Documents & reports page (upload the PDF, then set the file) |
| **Newsletter editions** | The newsletter archive page (`/newsletter`) |
| **Testimonials** | Short quotes shown on the home and impact pages |

Everything else (organisation address, phone, donation link, homepage wording)
is set in a configuration file by whoever maintains the site.

## Drafts

News posts, impact stories, FAQ entries, events, documents, newsletter editions
and testimonials have a **Draft** switch.

- **Draft on** → the item is saved but hidden from the live website.
- **Draft off** → the item is published.

Use drafts freely. Nothing shows on the public site until you turn the switch
off.

## Documents

To publish a document: upload its PDF (Admin → Documents → choose a file), set
the category, and turn **Draft** off. The CMS stores the file in
`public/documents/` and links it on the Documents page.

## The submissions inbox

Every contact and membership form is emailed to the FIKRA inbox and also saved at
`https://<your-domain>/inbox`. Sign in with the password your site maintainer
sets. From there you can read submissions and mark each one **Handled** or
**New**. Use the **Source** filter to see only volunteer, partner, member, RSVP
or contact leads. Files attached to applications appear as links in the inbox.
**Export CSV** downloads the whole list as a spreadsheet — do this regularly so
you always have a backup outside the database.

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

Browser editing is built into the site: it runs its own small GitHub OAuth
endpoint (`server/routes/cms-auth.js`), so editors sign in with GitHub without
leaving the site. A maintainer does this one-time setup.

### One-time setup (maintainer)

1. Create a **GitHub OAuth App** at <https://github.com/settings/developers>
   (create it under the FIKRA organisation so FIKRA owns it):
   - **Application name:** FIKRA website admin
   - **Homepage URL:** `https://<your-domain>`
   - **Authorization callback URL:** `https://<your-domain>/api/cms/callback`
2. Copy the **Client ID**, then generate and copy a **Client secret**.
3. Add both to the hosting environment (Vercel → Project → Settings →
   Environment Variables) for **Production** and **Preview**:
   - `GITHUB_OAUTH_CLIENT_ID`
   - `GITHUB_OAUTH_CLIENT_SECRET`
   - `SITE_URL` (only if the site is not at the default URL)
4. Redeploy, open `https://<your-domain>/admin`, and click **Login with GitHub**.

### Who can edit

There are no separate CMS accounts. Only people with **write access to the
`joejoris/Fikra` GitHub repository** can publish — add editors as collaborators
on GitHub.

### If it says "not set up yet"

The OAuth keys are missing. Add them as in step 3 and redeploy.

## Account ownership (important)

The domain, the Git repository, hosting, the CMS, and analytics must all be
created under accounts **FIKRA controls**, not personal accounts. Before the site
goes live, confirm FIKRA has owner access to every one of them and record the
credentials somewhere safe.

## Who to contact

Nominate one person at FIKRA as the site owner. They are the first point of
contact for questions and the only person who needs administrative access.
