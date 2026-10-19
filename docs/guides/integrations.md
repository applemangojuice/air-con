# Outside services: what each one does, and what it costs

Every service the app talks to: what it's for, whether you need it for the
pilots, where its keys come from, what happens without it (demo), in test
(sandbox) and for real (live), and the monthly cost. Costs come from
[../research/services-and-costs.md](../research/services-and-costs.md),
researched 18 October 2026; anything marked *unverified* must be checked on
the supplier's own pricing page before you rely on it.

Keys go in **Vercel → your project → Settings → Environment Variables**
(tick **Production**), then **Deployments → ⋯ → Redeploy**. The full list
with notes is `apps/web/.env.example`. Never paste a key into an email, a
chat or GitHub.

**How to tell what mode you're in.** Signed in to the office pages, a strip
across the top names anything not fully live: **DEMO** (no database:
nothing is saved), **LOCAL DATA**, **EMAIL DEMO**, **SMS DEMO**,
**PAYMENTS DEMO** or **TEST MODE**. On the live business with everything
set up, the strip disappears (or shows only SMS DEMO if you've skipped
texts). `/ops/launch` and `/ops/status` say the same in more detail.

## At a glance

| Service | For | Needed for the pilots? | Per month |
| --- | --- | --- | --- |
| [Vercel](#vercel-the-website) | The website, its functions and the daily jobs | **Required** | $20 (Pro) |
| [Supabase](#supabase-database-and-photos) | Database, photos and documents, backups | **Required** | $25 (Pro) |
| [Resend](#resend-email) | Every email | **Required** | $0 (Free) |
| [Twilio](#twilio-texts) | Reminder and on-my-way texts | Optional | ≈ $5 *unverified* |
| [Stripe](#stripe-card-payments) | Card payments | Optional | Per payment *unverified* |
| [getAddress.io](#getaddressio-address-lookup) | Address autofill on the website quote form | Optional | *unverified* |
| [postcodes.io](#postcodesio-postcode-check) | Postcode check on the quote form | Built in | $0 |
| [GitHub](#github-code-health-check-database-button) | The code, the daily health check, the database button | Required (already in use) | $0 |
| [Your domain and DNS](#your-domain-and-dns) | The web address and email sending | Required | Your registrar's fee |
| [Sentry](#not-connected-sentry-openai-anthropic-epc) | Error alerts | Not connected | $0 |

**Total: about $45 a month plus texts, so at most about $50.** Not
included: card fees, the domain, and any UK VAT added to these US-billed
services (not checked).

## The app's own settings (no outside account)

| Key | What it is | How to make it |
| --- | --- | --- |
| `SESSION_SECRET` | Signs every sign-in and upload link. Missing, under 32 characters or a template value: nobody can sign in | Mac Terminal: `openssl rand -hex 32`. Changing it signs everyone out |
| `CRON_SECRET` | Lets Vercel's daily jobs in; without it they're refused and no reminders, expiries, aftercare or morning email happen | `openssl rand -hex 32` |
| `ADMIN_EMAILS` | Your email(s), comma separated. The first sign-in from one creates its admin account | You |
| `NEXT_PUBLIC_APP_URL` | The live address, `https://…` with no slash at the end. Every link in every email | Your domain. Redeploy after changing |
| `LEADS_NOTIFY_EMAIL` | Where team alerts and the morning email go. Recommended | A watched inbox |
| `OPS_PASSWORD` | Break-glass: an `ADMIN_EMAILS` address plus this password signs in for 12 hours when email is down. Recommended for launch day, while your email domain verifies. At least 20 characters, or it's off | `openssl rand -base64 24` |

**Never set on the live site:** `ALLOW_DEMO_LOGIN`, `DEMO_DEPLOYMENT`,
`DATA_BACKEND`, `LOCAL_DATA_DIR`, `LOCAL_MAX_ROWS`. They're for demos and a
developer's computer. As a backstop, demo sign-in refuses itself on any
database holding a real customer, and `/ops/launch` turns red.

---

## Vercel (the website)

- **Does:** runs the website and the office and field apps, and three daily
  jobs (`apps/web/vercel.json`): the morning email at 06:00 UTC, the
  website quote follow-up at 10:00 UTC, and the daily run (reminders,
  proposal expiry, message retries, aftercare) at 16:00 UTC. The functions
  run in London (`lhr1`), next to the database.
- **Required.** Already in use.
- **Keys:** none of its own; it's where all the other keys live.
- **Plan:** **Pro, $20 a month** (includes $20 of usage). The free Hobby plan
  is for non-commercial use (secondary source), and its scheduled-job limits
  weren't verified. Pilot traffic should stay inside the included usage.
- **Demo / live:** previews of other branches are separate deployments;
  only the Production one (from `main`) runs the daily jobs.

## Supabase (database and photos)

- **Does:** stores every record (quotes, projects, surveys, designs,
  proposals, orders, invoices, payments, messages, staff, settings) and
  every file in three private stores: `survey-photos`, `survey-videos` and
  `project-media` (survey and install photos, signatures, certificates).
- **Required.** Keys: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, from
  **Supabase → Project Settings → API**. The service-role key opens the whole
  database: only ever in Vercel.
- **Without it:** the site runs in demo mode: the quote form works but
  nothing is saved, and nobody can sign in. `/api/health` says `demo`.
- **Keys set but database not upgraded:** the site looks connected but can't
  save. `/login`, `/ops/status`, `/ops/launch` and the deploy log all say so.
  Fix: paste `supabase/pilot-upgrade.sql` into the SQL Editor (see
  [../START-HERE-TOMORROW.md](../START-HERE-TOMORROW.md), step 3).
- **Plan:** **Pro, $25 a month** before the first family's photos: daily
  backups kept 7 days, 8 GB database, 100 GB files, uploads up to 500 GB,
  never paused. Leave the spend cap on. The Free plan has no backups, a 50 MB
  upload limit, a 1 GB file limit, and pauses after a week of low activity:
  fine for trying things, not for customers.
- **Note:** backups cover the database, not the files. The app never deletes
  customer photos; keep it that way.
- **Database changes later:** GitHub → **Actions** → **Apply database
  upgrade** → **Run workflow** (one-time secret `SUPABASE_DB_URL`; the
  instructions are at the top of `.github/workflows/apply-migrations.yml`).

## Resend (email)

- **Does:** every email: sign-in links, survey bookings and reminders, the
  proposal (the legal pre-contract information and cancellation form), the
  contract, invoices, receipts, install updates, the handover pack,
  aftercare, team alerts and the morning email.
- **Required.** Keys: `RESEND_API_KEY` (resend.com → **API Keys** →
  **Create API key**) and `EMAIL_FROM`, e.g.
  `Dang It's Hot <hello@yourdomain.co.uk>`, on a domain verified in
  resend.com → **Domains** (add the DNS records it shows at your domain
  registrar, then **Verify**; this can take a few hours).
- **Replies** go to the company email in **Settings**, not the `EMAIL_FROM`
  address. Make it a watched inbox: early-start confirmations arrive there.
- **Without it (demo):** every email is written and kept in **Messages** as
  "Demo, not sent". On the live site, proposals refuse to issue (the law
  needs the customer to receive them), and nobody can get a sign-in link
  (break-glass only).
- **Plan:** **Free**: 3,000 emails a month, 100 a day, one domain (secondary
  source). Pilot months need about 300. Paid tiers *unverified*.

## Twilio (texts)

- **Does:** the survey reminder and install day-before texts, "on my way"
  texts with an arrival time, and the "a change needs your OK" text.
- **Optional.** Keys: `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`
  (twilio.com → **Console** → **Account info**) and `TWILIO_FROM`: the
  sender name `DangItsHot` (letters only, up to 11) or a Twilio number like
  `+447700900000`. A sender name can't receive replies, so every text gives
  your phone number and says texts aren't read.
- **Without it (demo):** texts are written and kept in **Messages** as "Demo,
  not sent". On-my-way messages go by email instead. Families still get
  every email. `/ops/launch` shows amber, which is fine.
- **Cost:** pay as you go. About 60 texts a pilot month; the price per text
  is *unverified*: budget $5. Keep texts short (the app does): over 160
  characters counts as two.
- **Check before switching on** (*unverified*): Twilio's UK rules for a
  sender name, and whether `DangItsHot` needs registering with the UK
  SenderID Protection Registry.

## Stripe (card payments)

- **Does:** a "Pay by card" button on the family's payment page (Stripe's
  own checkout page). Payments are recorded only from Stripe's signed
  confirmation (the webhook), never from the family landing back on our
  site. Refunds and disputes made in Stripe are recorded by themselves.
- **Optional.** Without it, families pay by **bank transfer**, which you
  record by hand once you see it. Bank transfer is the recommended default
  for balances anyway (no fee).
- **Keys:** `STRIPE_SECRET_KEY` (stripe.com → **Developers** → **API
  keys**) and `STRIPE_WEBHOOK_SECRET`: **Developers** → **Webhooks** → **Add
  endpoint** → `https://<your-domain>/api/stripe/webhook` with the events
  `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed`, `charge.refunded`,
  `charge.refund.updated`, `charge.dispute.created`,
  `charge.dispute.closed` → copy its **Signing secret** (`whsec_…`).
- **Test (sandbox):** an `sk_test_…` key. The strip says **TEST MODE**; use
  Stripe's test card numbers; no money moves.
- **Live:** an `sk_live_…` key and a live-mode webhook.
- **Demo (no keys):** card is simply not offered on the live site. On a demo
  or developer copy there's a **Simulate card payment (DEMO — no money
  moves)** button instead.
- **Cost:** no monthly fee (*unverified*); a fee per payment, *unverified*,
  remembered as about 1.5% + 20p for UK cards: roughly £45 on a £3,000
  payment. Untick **Card (Stripe)** in **Settings → Payments** until it's set
  up.

## getAddress.io (address lookup)

- **Does:** fills in the address list on the public quote form once a
  postcode is typed. Known addresses come from the app's own property data
  first.
- **Optional.** Key: `GETADDRESS_API_KEY` from getaddress.io. Without it,
  people type their address. Not used by the New pilot form (you type it).
- **Cost:** free and paid tiers *unverified*.

## postcodes.io (postcode check)

- **Does:** checks a postcode is real on the quote form. A free public
  service; no key, no account, no cost.

## GitHub (code, health check, database button)

- **Does:** holds the code (Vercel deploys from `main`), and runs three
  buttons under **Actions**:
  - **Health check**: daily at 07:00 UTC, checks the live `/api/health`;
    GitHub emails you if it isn't `ok`. Set the repository variable
    `SITE_URL` (**Settings** → **Secrets and variables** → **Actions** →
    **Variables**) to your live address; press **Run workflow** once to test.
  - **Apply database upgrade**: runs `supabase/pilot-upgrade.sql` and the
    schema check (needs the `SUPABASE_DB_URL` secret).
  - **Load property data**: the marketing property book (not needed for the
    pilots).
- **Cost:** free at this size (2,000 minutes a month on a private repository;
  the daily check uses about 31).

## Your domain and DNS

- The web address customers use (`NEXT_PUBLIC_APP_URL`), added in Vercel →
  **Project** → **Domains**, and the email domain verified in Resend. Both are
  set where your domain is registered.
- **Cost:** your registrar's yearly fee.

## Not connected: Sentry, OpenAI, Anthropic, EPC

- **Sentry** (error alerts): recommended by the research (free Developer
  plan) but **not built in**. Errors show in **Vercel → Logs**, and
  `/api/health` plus the GitHub health check catch a broken database.
- **OpenAI / Anthropic**: only for the phone video-walkthrough app, which is
  not part of the pilots and is off on the live site unless
  `VIDEO_SURVEYS_ENABLED=1`.
- **EPC Open Data** (`EPC_API_EMAIL`, `EPC_API_KEY`): only for loading the
  marketing property book through GitHub Actions. Free sign-up. Not needed
  for the pilots.
