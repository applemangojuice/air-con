# air-con: the operating system for residential air conditioning

> **Going live with the four pilots? Start with
> [docs/START-HERE-TOMORROW.md](./docs/START-HERE-TOMORROW.md).** The
> founder's checklist, step by step, plus guides for the office, the field
> team and what customers see ([docs/guides/](./docs/guides/)).

Dang, It's Hot: fixed-price quoting with customer self-survey, and the pilot
platform that runs each installation from the first survey to the last
payment. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the why behind
everything, and [docs/pilot-architecture.md](./docs/pilot-architecture.md)
for the pilot platform's technical contract.

## What works today

**The pilot platform** (`/ops`, `/field`, `/p/[id]`): one job, end to end,
for the four pilot homes.

- **Office** (`/ops`): the Board, each project's command centre, New pilot,
  the design studio (signed off by an F-gas technical lead), the proposal
  builder (costs, margin, pilot discount, VAT from settings), booking with
  certificate-checked crews, purchase orders, the compliance checklist,
  invoices and payments, the Messages log, Staff, Catalogue, Settings, the
  Pilots comparison, and `/ops/launch` (go-live checks).
  [Admin guide](./docs/guides/admin.md).
- **Field app** (`/field`, on a phone): the home survey with measured rooms
  and drawings on photos, the job pack, a three-day evidence runsheet with
  F-gas and Part P steps locked to qualified people, issues and variations,
  end-of-day updates, commissioning and handover. Work saves on the phone
  and syncs when there's signal. [Field guide](./docs/guides/field.md).
- **Customer project page** (`/p/[id]`, `/portal`): one next step at a time,
  the proposal drawn on their own photos, online acceptance with the
  cancellation information and early-start request, install dates, daily
  updates, documents, payments and aftercare. Sign-in by emailed link only.
  [What customers see](./docs/guides/customer-journey.md).
- **Messages**: 29 email and text types through one logged outbox,
  with daily reminders and aftercare; texts and card payments are optional
  ([integrations](./docs/guides/integrations.md)).
- Honest about the rest: [known limitations](./docs/guides/known-limitations.md),
  [approvals still needed](./docs/guides/approvals-required.md),
  [latest test results](./docs/guides/test-results.md).

**Also in the repo**

- **Fixed-price quote funnel** (`/quote`, `/q/[id]`): mobile-first
  self-survey to an instant price, a saved quote page, and the start of a
  project.
- **Property Intelligence Engine** (`/ops/intel`, `/a/[id]`): one record per
  property from EPC, planning and conservation open data; prefills the
  quote, powers mailings. Loading data: [docs/loading-data.md](./docs/loading-data.md).
- **Business case and P&L planner** (`/ops/finance`), **usage analytics**
  (`/ops/analytics`, cookieless), **system status** (`/ops/status`,
  `/api/health`, daily GitHub health check), and the abandoned-quote
  follow-up email.
- **iOS capture app** (`apps/mobile`): an Expo scaffold of the survey flow;
  not part of the pilots. See [docs/capture-process.md](./docs/capture-process.md).
- **Domain engine** (`packages/domain`): pricing, design, costing, proposal,
  project stages, install runsheet, money and comms rules: pure and tested.
- **Launch surface**: `/faq`, area pages, `/privacy`, `/terms`, SEO basics,
  security headers and rate limits. A fictional demo project at `/p/demo`.

## Run it

```bash
pnpm install
pnpm dev            # web: http://localhost:3000
pnpm test           # domain and web tests
pnpm build          # production build (also typechecks)

# iOS capture app (needs Xcode or the Expo Go app)
cd apps/mobile
EXPO_PUBLIC_API_URL=http://<your-ip>:3000 pnpm start
```

Runs with no configuration: in development the local data backend keeps
everything under `apps/web/.data`, and "Try as…" on `/login` signs you in as
a DEMO team member ("Load demo pilots" fills it with five fictional homes).
To use Supabase, copy `apps/web/.env.example` to `apps/web/.env.local`, fill
in your own values (they ship blank), run every file in
`supabase/migrations/` from `0001` to `0009` against the project in order
(both `0006` files), then `supabase/pilot-upgrade.sql` (`0010` to `0013` in
one go).

To load property data, follow [docs/loading-data.md](./docs/loading-data.md):
demo mode (no setup), a one-click **GitHub Actions** workflow that imports and
recomputes for you (no local commands), ready-made sample CSVs, or real
open-data downloads.

## Deploy

Vercel (root directory: `apps/web`, deploys `main`) + Supabase. The
founder's step-by-step is [docs/START-HERE-TOMORROW.md](./docs/START-HERE-TOMORROW.md);
the technical reference (the database upgrade, every variable, the Stripe
webhook, smoke tests and troubleshooting) is
[docs/going-live.md](./docs/going-live.md). After the first admin signs in,
`/ops/launch` checks the live site against it.
