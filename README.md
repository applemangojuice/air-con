# air-con: the operating system for residential air conditioning

Fixed-price quoting with customer self-survey is **live**; the rest of the
platform (CRM, design studio, installer app, monitoring) has placeholder
surfaces and a data model already shaped for it. See
[ARCHITECTURE.md](./ARCHITECTURE.md) for the why behind everything.

## What works today

- **Marketing site** (`/`): postcode capture into the quote funnel.
- **Fixed-price quote funnel** (`/quote`): six-step mobile-first self-survey:
  address (live postcode validation) → property → rooms (with photos) →
  outdoor unit → electrics → contact, ending in an instant fixed price with
  finance options, an Installation Confidence Score, and a full price
  breakdown. Drafts auto-save to the device.
- **Saved quotes** (`/q/[id]`): every submitted quote gets a permanent
  shareable link (optional email via Resend), and starts the project from
  there.
- **Project timeline** (`/p/[id]`, playable demo at `/p/demo`): the whole
  journey on one clickable horizontal timeline: quote → floor plan → final
  quote → £150 site visit → courier delivery → installation. Future stages
  are previewable with projected dates; customers book and move their own
  dates (escalating change fees), tick off installation prep, meet their
  installer, and track the electrical plan. Backed by a pure, tested stage
  reducer in the domain package. See
  [docs/project-workflow.md](./docs/project-workflow.md).
- **Property Intelligence Engine** (`/ops/intel` + `/a/[id]`): one master
  record per property (UPRN-keyed) built from EPC, planning and conservation
  open data plus manual audits. Prefills the quote funnel the moment a known
  address is picked, generates a personalised landing page per address for
  mailings, and powers the targeting analytics (filters, mailing CSV export,
  campaign tagging, business-case maths). Demo dataset covers SW16/SW17 with
  no database. **New here? [docs/loading-data.md](./docs/loading-data.md) is the
  start-to-finish guide for getting data in** (demo mode, sample CSVs, or real
  open-data downloads); [docs/property-intelligence.md](./docs/property-intelligence.md)
  has the per-source detail.
- **Ops review** (`/ops/quotes` + `/ops/projects`): incoming surveys and
  in-flight installations (issue final quotes, record site-visit outcomes,
  dispatch equipment, assign installers), behind basic auth (`OPS_PASSWORD`).
- **Scheduling & procurement** (`/ops/schedule` + `/ops/procurement`): live
  projects laid onto a six-week crew board (conflicts flagged, street
  batching surfaced) and turned into a weekly order book with per-install
  pick lists and order-by dates. Pure, tested planners in
  `packages/domain/src/operations.ts`.
- **Business case & P&L planner** (`/ops/finance`): assumptions in, monthly
  P&L out. Unit economics with CAC from the mailing channel, cost dials,
  breakeven month, cash trough and the funding ask, three scenarios, cash
  curve and CSV export. Plus the full seed case: bottom-up TAM/SAM/SOM,
  LTV:CAC with service-plan attach, round and dilution modelling, driver
  sensitivity on the ask, and a milestone road to Series A whose dates are
  computed from the live plan. Models in `packages/domain/src/finance.ts`
  and `investor.ts`, tested.
- **iOS capture app** (`apps/mobile`): Expo scaffold of the same survey flow
  with native camera capture and offline drafts, sharing the domain engine.
  See [docs/capture-process.md](./docs/capture-process.md) for the capture
  process design and the AR/RoomPlan roadmap.
- **Pricing engine** (`packages/domain`): deterministic, versioned, tested.
- **Persistence**: quotes + photos into Supabase when configured; graceful
  demo mode when not.
- **Placeholders**: `/portal` (customer), `/ops` (internal modules), `/how-it-works`.
- **Design**: the Organic design system (from the owner's Claude Design
  project) across web and mobile.

## Run it

```bash
pnpm install
pnpm dev            # web: http://localhost:3000
pnpm test           # domain engine tests
pnpm build          # production build (also typechecks)

# iOS capture app (needs Xcode or the Expo Go app)
cd apps/mobile
EXPO_PUBLIC_API_URL=http://<your-ip>:3000 pnpm start
```

Runs in demo mode with no configuration (including the full project
timeline at `/p/demo`). To persist quotes and projects, copy
`apps/web/.env.example` to `apps/web/.env.local` and fill in your Supabase
project, then run the files in `supabase/migrations/` against it in order.

To load property data (demo, ready-made sample CSVs, or real open-data
downloads), follow [docs/loading-data.md](./docs/loading-data.md).

## Deploy

Vercel (root directory: `apps/web`, watching `main`) + Supabase. Checklist
and smoke tests in [docs/going-live.md](./docs/going-live.md).
