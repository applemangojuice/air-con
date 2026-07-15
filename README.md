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
- **Ops review** (`/ops/quotes` + `/ops/projects`): incoming surveys and
  in-flight installations (issue final quotes, record site-visit outcomes,
  dispatch equipment, assign installers), behind basic auth (`OPS_PASSWORD`).
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

## Deploy

Vercel (root directory: `apps/web`) + Supabase. Full steps in
[ARCHITECTURE.md](./ARCHITECTURE.md#deploying).
