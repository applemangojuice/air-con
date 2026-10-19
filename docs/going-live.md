# Going live (and checking it worked)

> **Founders: start with [START-HERE-TOMORROW.md](./START-HERE-TOMORROW.md).**
> It's the same set-up as a plain-English checklist with exact clicks, time
> estimates and screenshots, and it goes on to settings, staff, the
> catalogue, the four pilot households and what to do when something goes
> wrong. This page is the technical reference behind it. The day-to-day
> guides are in [guides/](./guides/).

This is the checklist for putting the pilot platform in front of real
customers and installers. **`/ops/launch` is its live twin**: once you can
sign in, it checks every setting, secret and table against the running site,
red, amber or green, each with the exact fix. Do the one-time setup below,
sign in as the first admin, then work down `/ops/launch` until it's green.

The pilot platform lives on the `claude/pilot-ops` branch until it's merged
into `main` (START-HERE step 1: GitHub → Pull requests → New pull request →
base `main` ← compare `claude/pilot-ops` → Merge). Vercel deploys whichever
branch its production environment watches (Vercel → Project → Settings →
Git → Production Branch, normally `main`).

## One-time setup

1. **Vercel**: vercel.com → Add New Project → import this GitHub repo.
   Set **Root Directory** to `apps/web`. Framework auto-detects (Next.js);
   pnpm workspaces are handled natively. `apps/web/vercel.json` pins the
   functions to **London (`lhr1`)**: every click makes several database round
   trips one after another, so the functions must sit next to the database.

2. **Supabase**: create a project in **London (eu-west-2)**, the same place
   as the functions (if you pick another region, change `regions` in
   `apps/web/vercel.json` to the Vercel region nearest it). Then bring the
   database up to date. Which way depends on where you start:

   - **The live database already runs the original site** (quotes,
     projects: migrations `0001` to `0009`). Paste
     **`supabase/pilot-upgrade.sql`** once:
     1. supabase.com → your project → **SQL Editor** → **New query**.
     2. Paste the whole file, click **Run**. If Supabase warns about a
        "destructive operation", confirm: one line swaps in a fresh copy of
        a safety check. No data goes.
     3. "Success. No rows returned" means done.
     4. New query → paste **`supabase/check-schema.sql`** → **Run**. It says
        "All present", or names what's missing. It only reads.
   - **A brand-new, empty project.** Run `0001` → `0002` → `0003` → `0004` →
     `0005` → **both** `0006` files (`0006_draft_quotes.sql` and
     `0006_property_intelligence.sql`) → `0007` → `0008` → `0009` from
     `supabase/migrations/`, one at a time the same way, then
     `supabase/pilot-upgrade.sql`, then the check.

   `pilot-upgrade.sql` is `0010` to `0013` in one go, and it says what each
   does at the top. `0010` is the pilot platform itself: the staff and
   sign-in tables, every project record (surveys, designs, proposals,
   orders, invoices, payments, documents…) and the `project-media` bucket.
   **Without it nobody can sign in.** `0011` sets each storage bucket's size
   limit and file types; `0012` makes the sign-in limits count once for the
   whole site; `0013` makes the database refuse two households on one pilot
   number and two invoices from one click. It all runs as one transaction,
   so if it stops, nothing changed. If it stops with "Two households share a
   pilot number", give one of them another number on its project page, then
   run it again. **Re-running it is always safe.** If you skip it the site
   looks connected but can't save; `/login` says so, and so do the deploy
   logs (`[schema] The database is missing …`).

   Later upgrades, without the SQL editor: **GitHub → Actions → "Apply
   database upgrade" → Run workflow** (`.github/workflows/apply-migrations.yml`;
   the one-time setup, a `SUPABASE_DB_URL` secret, is at the top of that
   file). It runs the same file, then the same check.

3. **Environment variables** (Vercel → Project → Settings → Environment
   Variables, Production). `apps/web/.env.example` lists them all with their
   values left **blank**: fill in your own, never paste the file as it is.

   Required before the first real customer:

   | Variable | What it's for | How to get it |
   | --- | --- | --- |
   | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | The database. Without them the site is in demo mode and saves nothing. | Supabase → Settings → API |
   | `SESSION_SECRET` | Signs every sign-in. Missing, under 32 characters, or a template value: production signs **nobody** in. | `openssl rand -hex 32` |
   | `ADMIN_EMAILS` | The first sign-in from one of these (comma separated) creates its admin account. The only way to get the first admin. | Your own addresses |
   | `RESEND_API_KEY`, `EMAIL_FROM` | Sign-in links, the proposal email (pre-contract information and the cancellation form, which must reach the customer on a durable medium), the contract copy, every update. Without email a live deployment refuses to issue proposals. Every email's **Reply-To is the company email in Settings**, so it must be a monitored inbox: the acceptance email asks customers who want an early start to reply with the exact words, and that reply is the legal evidence. | Resend; verify the `EMAIL_FROM` domain there first |
   | `NEXT_PUBLIC_APP_URL` | The live domain (`https://…`): every link in every email. | Your domain |
   | `CRON_SECRET` | The scheduled jobs in `apps/web/vercel.json`: daily ops (survey and day-before reminders, proposal expiry, outbox retries, aftercare), the morning digest and the abandoned-quote follow-up. Without it they all answer 401. | `openssl rand -hex 32` |

   Optional:

   - **Card payments**: `STRIPE_SECRET_KEY` (`sk_test_…` first, then
     `sk_live_…`) and `STRIPE_WEBHOOK_SECRET`. In Stripe → Developers →
     Webhooks add the endpoint `https://<your-domain>/api/stripe/webhook`
     for `checkout.session.completed`,
     `checkout.session.async_payment_succeeded`,
     `checkout.session.async_payment_failed`, `charge.refunded`,
     `charge.refund.updated`, `charge.dispute.created` and
     `charge.dispute.closed`; its signing secret is `STRIPE_WEBHOOK_SECRET`.
     Money is only ever recorded from that verified webhook. **Refund card
     payments in Stripe's dashboard**: the refund is recorded on the money
     page by itself (with a credit note so it isn't asked for again) and the
     team gets an email; recording it by hand as well is refused. A dispute
     (chargeback) is an urgent team email with its deadline. Without Stripe,
     bank transfers are recorded by hand.
   - **SMS**: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`.
     Without them texts are stored as "demo, not sent" in `/ops/messages`;
     customers still get every email.
   - **Break-glass**: `OPS_PASSWORD`, at least 20 characters
     (`openssl rand -base64 24`). `/login` then also accepts an
     `ADMIN_EMAILS` address plus this password, for a 12-hour admin session
     (logged and rate limited), for when email is down. It is not a password
     wall in front of the console: everyone else signs in by magic link.
     Leave it unset if you don't want it.
   - `LEADS_NOTIFY_EMAIL` (where lead alerts go), `GETADDRESS_API_KEY`
     (address autofill). The video walkthrough endpoints (the iOS capture
     app, not part of the pilot) are off in production unless
     `VIDEO_SURVEYS_ENABLED=1`; only then do `OPENAI_API_KEY` /
     `ANTHROPIC_API_KEY` matter.

   Never set `ALLOW_DEMO_LOGIN`, `DEMO_DEPLOYMENT`, `DATA_BACKEND` or
   `LOCAL_DATA_DIR` on the live business: they're for demo deployments and
   local development (`.env.example` keeps them commented out). As a
   backstop, demo sign-in and the demo seed refuse themselves on any
   database holding a real quote, customer or team member, whatever the
   settings say, and `/ops/launch` goes red until the settings are removed.

   Redeploy after changing any of them (Vercel → Deployments → Redeploy).

4. **First sign-in**: open `/login`, enter one of the `ADMIN_EMAILS`
   addresses, and click the emailed link. That creates your admin account.
   Add the rest of the team on `/ops/staff`.

5. **Work down `/ops/launch`** until every row is green: the database and
   buckets, the secrets, email and its domain, the Schedule 2 company
   details in Settings (proposals can't be issued without them), payment
   details, the catalogue's prices (a proposal with unpriced cost lines
   needs the costs typed in or an admin's override before it can issue),
   and the team's F-gas and Part P qualifications.

6. **Data** (optional): load the property book. The step-by-step is in
   [loading-data.md](./loading-data.md); hit **Recompute scores** on
   `/ops/intel` afterwards.

## How to check a deploy worked

1. Vercel → Deployments: the top production entry is **Ready**, on the
   commit you expect.
2. `/api/health` answers `{"status":"ok", …}` with HTTP 200. `degraded`
   (503) means a table, column or bucket is missing; `demo` (503 in
   production) means no database is connected and nothing is being saved.
3. Sign in at `/login` and open `/ops/status`: every table, bucket and
   variable, with what each one is for.
4. Walk the smoke list:
   - `/` loads with the Dang, It's Hot brand; `/quote` gives a price.
   - `/ops` shows the console (signed in); `/ops/launch` is all green.
   - Submit a test quote at `/quote`, find it at `/ops/quotes`, start its
     project, and find it on the board at `/ops/projects`.
5. Automated version of the funnel walk:
   `BASE_URL=https://your-domain pnpm --filter @aircon/web test:e2e`
   (needs a local Chromium; see the header of `apps/web/scripts/e2e-funnel.mjs`).

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `/login` says "The database isn't set up for sign-in yet" | Supabase is connected but the pilot upgrade (or an earlier file) hasn't been run | Paste `supabase/pilot-upgrade.sql` into the SQL Editor (step 2), reload. `supabase/check-schema.sql` names anything still missing |
| "We couldn't send a link just now" | Email isn't configured or the `EMAIL_FROM` domain isn't verified; the server log says which | Check `RESEND_API_KEY` / `EMAIL_FROM` and the domain in Resend |
| Nobody can sign in, even with the right link | `SESSION_SECRET` missing, too short, or still a template value | Set it with `openssl rand -hex 32`, redeploy |
| No admin account and no way to make one | `ADMIN_EMAILS` empty | Set it, redeploy, sign in with one of those addresses |
| Quotes don't save; the funnel errors at the end | Supabase keys wrong, or migrations not run | Check `/api/health`, then `/ops/status` |
| "Invalid path specified in URL" uploading photos | A storage bucket is missing | Migration `0001` creates survey photos, `0004` videos, `0010` project media |
| A bucket shows "No file size or type limits" in `/api/health` | Migration `0011` hasn't been run | Run `supabase/pilot-upgrade.sql` (it includes `0011`) |
| "mime type … is not supported" uploading | The file isn't a type the bucket stores | Photos (JPEG, PNG, WebP, HEIC), PDFs and MP4/.mov only (0011) |
| Reminders, expiries and the digest never happen | `CRON_SECRET` missing (the crons answer 401) | Set it, redeploy |
| `pilot-upgrade.sql` (or `0013_unique_guards.sql`) stops with "Two households share a pilot number" | Two projects were tagged with the same pilot number before 0013 | Nothing was changed. Change one on its project page (the Pilot box), then run it again |
| "We couldn't read the business settings just now, so nothing was saved" | The database didn't answer when an invoice, proposal, contract, receipt or booking needed the settings (pages show the defaults meanwhile; writes never use them) | Try again in a moment; if it keeps happening, check `/ops/status` |
| `/ops/launch` shows "Shared sign-in limits" amber | Migration `0012` hasn't been run, so each server instance counts sign-in requests on its own | Run `supabase/pilot-upgrade.sql` (it includes `0012`) |
| A refund made in Stripe doesn't appear on the money page | The webhook isn't sent `charge.refunded` | Add `charge.refunded` and `charge.refund.updated` to the endpoint in Stripe (step 3); Stripe resends recent events from its dashboard |
| Pages feel slow (a second or more per click) | The functions and the database are far apart | Put Supabase and `regions` in `apps/web/vercel.json` in the same place (London by default) |
| Property intelligence shows 0 | The property book hasn't been loaded | `/ops/intel` → **Seed sample book**, or the importer ([property-intelligence.md](./property-intelligence.md)) |

**The key idea:** the site only falls back to demo mode (works, saves
nothing) when Supabase is *unconfigured*. Once the keys are set but the
schema isn't migrated, writes fail, which looks like data loss. `/login`,
`/api/health`, `/ops/status`, `/ops/launch` and the deploy log all check
the schema the same way, so they say so plainly instead.

If you're locked out with the schema missing, an `ADMIN_EMAILS` address
plus the break-glass password (if `OPS_PASSWORD` is set) still opens the
console as a temporary admin, so `/ops/status` can show what's missing.

## Daily digest and automations

With Resend and `CRON_SECRET` set, the Vercel crons in `apps/web/vercel.json`
run: **daily ops** (16:00 UTC: survey and day-before reminders, proposal
expiry, outbox retries, aftercare check-ins), the **morning digest** (06:00
UTC: what needs doing today, who owes us what), and the **abandoned-quote
follow-up** (10:00 UTC: one nudge to drafts 24 hours to 7 days old, then
never again). Each can also be run by hand from `/ops/messages`.

## Uptime alarm

`.github/workflows/health-check.yml` probes `/api/health` daily and fails
the run (GitHub emails the watchers) unless the live site answers `ok`:
a degraded schema or a site in demo mode both fail it. Set the `SITE_URL`
repository variable to your live domain, and use **Run workflow** to test it.

## Usage analytics

`/ops/analytics` shows visitors, sessions, traffic sources, campaigns (via
`utm_*` tags on your links), geography and the quote funnel from landing to
saved. It's first-party and cookieless: a random id in the browser plus
Vercel's edge geo (never the raw IP). Keeping that id on someone's device is
still storage the law covers, so the privacy notice explains it and anyone
can turn analytics off (`/privacy#analytics`, linked from every footer; a
browser's Global Privacy Control signal counts as off). Expect the numbers to
undercount those visitors.
