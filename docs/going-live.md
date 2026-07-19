# Going live (and checking it worked)

Everything ships on the `main` branch. Production is a Vercel project that
watches `main`; every merge auto-deploys. This page is the checklist —
and **`/ops/launch` is its live twin**: eight platform checks verified
against the running site plus the launch-day walk, each with the exact fix
when something's red. Start there.

## One-time setup

1. **Vercel**: vercel.com → Add New Project → import this GitHub repo.
   Set **Root Directory** to `apps/web`. Framework auto-detects (Next.js),
   pnpm workspaces are handled natively. First deploy happens on import.
2. **Supabase**: create a project, then run every file in
   `supabase/migrations/` in order (SQL editor, or `supabase db push`).
   As of now that's `0001` → `0008`. Note there are **two** `0006_*` files
   (`0006_draft_quotes.sql` and `0006_property_intelligence.sql`) — run both;
   they create independent tables. Re-running is safe — they use `if not
   exists`. **If you skip this step the site looks connected but saves
   nothing**, which is the single most common cause of "my data isn't there"
   (see Troubleshooting). New migrations get run the same way when they land.
3. **Environment variables** (Vercel → Project → Settings → Environment
   Variables). From `apps/web/.env.example`:
   - `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`: persistence on. Without
     them the site runs in demo mode (works, saves nothing).
   - `OPS_PASSWORD`: locks the admin console subpages. Browser prompts:
     any username, this password.
   - `GETADDRESS_API_KEY` (optional): address autofill for postcodes not
     yet in the property database. Free tier at getaddress.io.
   - `RESEND_API_KEY` + `EMAIL_FROM` + `NEXT_PUBLIC_APP_URL` (optional):
     quote emails.
4. **Data**: load the property book. The step-by-step is in
   [loading-data.md](./loading-data.md) — start with the committed sample
   CSVs to smoke-test the pipeline, then swap in the real EPC bulk downloads
   (source detail in [property-intelligence.md](./property-intelligence.md)).
   Hit **Recompute scores** on `/ops/intel` afterwards.

## How to check a deploy worked

1. Vercel dashboard → Deployments: the top entry should be `main`, status
   **Ready**, with the commit message you expect.
2. On the live site, walk the smoke list:
   - `/` loads with the Dang, It's Hot brand.
   - `/quote` gives a price in a couple of minutes.
   - `/p/demo` plays the whole install timeline.
   - `/a/demo` shows a per-address mailing page.
   - `/ops` shows the console; `/ops/intel`, `/ops/projects`,
     `/ops/quotes`, `/ops/templates` ask for the ops password, then load.
3. Data check (with Supabase connected): submit a test quote at `/quote`,
   then find it at `/ops/quotes`. Start its project from the saved quote
   page and find it at `/ops/projects`.
4. Automated version of step 2's funnel walk:
   `BASE_URL=https://your-domain pnpm --filter @aircon/web test:e2e`
   drives the whole funnel in a headless browser (needs a local
   Chromium; see the header of `apps/web/scripts/e2e-funnel.mjs`).

If a deploy is missing, the usual suspects: the Vercel project is watching
a different branch (should be `main`), or the build failed (open the
deployment's logs; `pnpm build` locally reproduces it).

## Troubleshooting: "it's not saving anything"

**Start at `/ops/status`.** It runs a live check of every table, storage
bucket and env var and tells you, in plain English, exactly what's missing
and how to fix it. Almost every "my data isn't there" report is one of these:

| Symptom | Cause | Fix |
| --- | --- | --- |
| Quotes don't save; funnel errors at the end | `quote_requests` table missing, or Supabase keys point at the wrong project | Run migrations `0001`–`0007`; verify `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` |
| `/q/<id>` "failing to load quote" | The quote never saved (see above), so there's no row | Fix saving first; old lost leads can't be recovered unless you had email alerts on |
| "Invalid path specified in URL" when uploading photos | The `survey-photos` storage bucket doesn't exist | Run migration `0001` (it creates the bucket) |
| **Property intelligence shows 0** | `properties` table is empty — the importer/seed never ran. The SW16/SW17 "dummy" homes only show in demo mode (no database) | On `/ops/intel`, click **Seed sample book**, or run the EPC importer (`docs/property-intelligence.md`) |
| Usage analytics page says "table missing" | Migration `0007` not run | Run `supabase/migrations/0007_analytics.sql` |

**The key idea:** the site only falls back to safe "demo mode" (works, saves
nothing) when Supabase is *unconfigured*. Once the keys are set but the schema
isn't migrated, reads return empty and writes fail — and *that* looks like
data loss. `/ops/status` exists so you never have to guess which it is.

**Don't lose leads while you fix it.** With Resend configured
(`RESEND_API_KEY` + `EMAIL_FROM`, optional `LEADS_NOTIFY_EMAIL`), every
submission emails the team, and any submission that *fails* to save emails a
"recover this by hand" alert with the customer's details. Turn this on before
sharing the site widely.

## Booking confirmations & the daily digest

With Resend configured, every **booking** emails the customer a written
confirmation (what happens next, price locked) and the team a 🎉 alert with
the ops link. A second cron (`/api/cron/digest`, 06:00 UTC) emails the team
one morning summary: yesterday's quotes, bookings, unfinished drafts and
traffic, plus the standing pipeline — quiet days included, so silence is
never ambiguous.

## Automated follow-up (abandoned quotes)

People who give their address and email but never finish are warm leads. With
`CRON_SECRET` set (any long random string) and Resend configured, a Vercel
cron (`apps/web/vercel.json`) runs daily at 10:00 UTC and sends **one**
friendly nudge to drafts that are 24 hours – 7 days old, then never emails
them again (`follow_up_sent_at`, migration `0008`). The Unfinished tab on
`/ops/quotes` shows the same list for manual follow-up.

## Uptime alarm

`.github/workflows/health-check.yml` probes `/api/health` daily and fails
the run (GitHub emails the watchers) if the database is degraded — i.e. the
site is up but data is being lost. Set the `SITE_URL` repository variable to
your live domain, and use **Run workflow** to test it any time.

## Usage analytics

`/ops/analytics` shows visitors, sessions, traffic sources, campaigns
(via `utm_*` tags on your links), geography and the quote funnel from landing
to saved. It's first-party and cookieless — a random id in the browser plus
Vercel's edge geo (country/region/city, never the raw IP), no third-party
trackers, nothing to consent to. Tag your mailing and ad links with
`?utm_source=…&utm_campaign=…` and they flow straight into the dashboard, and
every quote request stores the source it came from.

## The admin console

`/ops` is mission control: live modules (property intelligence, projects,
quote requests, template library, schedule, procurement, business case & P&L), the customer-side
pages for reference, and the not-built-yet roadmap. Also reachable from the "Prototype" strip at
the bottom of every page and the Platform column in the footer.
