# Architecture

**The Operating System for Residential Air Conditioning** — designed backwards
from the eventual business, built forwards from the quoting funnel.

## Stack decision

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | **Next.js (App Router)** | One framework serves every surface we'll ever need: SEO-rendered marketing + postcode landing pages, the interactive survey wizard, authenticated portals, API routes for the engine. First-class Vercel deploys with per-branch previews. |
| Hosting | **Vercel** | Zero-ops, preview deployments per PR, edge caching for marketing pages. |
| Data | **Supabase** | Postgres (relational core), Auth (customer/ops/installer roles later), Storage (survey photos, install photos), Row Level Security, Realtime (progress trackers, ops dashboards). One platform covers the first ~4 years of the roadmap. |
| Repo shape | **pnpm workspace monorepo** | Apps come and go; the domain packages are the asset. Shared types from database row to installer's phone screen. |
| Language | **TypeScript everywhere** | One type system across customer web, ops, installer app (React Native/Expo shares the domain package), and the engine. |

## Repository layout

```
air-con/
├── apps/
│   ├── web/                  # Customer-facing app (live)
│   │   ├── app/              #   marketing, /quote wizard, /q/[id] saved quotes,
│   │   │                     #   /ops/quotes review, /portal placeholder
│   │   ├── components/       #   site chrome + quote wizard components
│   │   └── lib/              #   draft persistence, photo registry, Supabase server client
│   └── mobile/               # iOS capture app (Expo/React Native, shares the domain pkg)
│       ├── app/              #   expo-router screens mirroring the web capture flow
│       ├── components/       #   native UI kit (Organic tokens) + guided photo capture
│       └── lib/              #   device drafts, submit-to-web-API client
├── packages/
│   └── domain/               # THE CORE ASSET (pure TS, zero runtime deps)
│       ├── types.ts          #   canonical Survey/Quote types, JSON-serialisable
│       ├── heatload.ts       #   room load estimation + unit sizing
│       ├── pricing.ts        #   deterministic fixed-price engine (versioned)
│       ├── confidence.ts     #   Installation Confidence Score
│       └── project.ts        #   the project workflow: stage machine, fees, SLA (pure reducer)
├── docs/
│   ├── capture-process.md    # design of the survey capture process (web + iOS)
│   └── project-workflow.md   # quote → install timeline: stages, fees, SLA, electrics
└── supabase/
    └── migrations/           # SQL migrations (source of truth for the schema)
```

Design system: the UI on both apps uses the **Organic** tokens from the
owner's Claude Design project (cream/sand ground, terracotta + sage accents,
Caprasimo/Figtree). Web: `apps/web/app/globals.css`; mobile:
`apps/mobile/lib/theme.ts`. Change the look by re-syncing those two files
from the design project.

### Planned growth (create these when the feature ships, not before)

```
apps/
├── ops/                      # internal: CRM, design studio, scheduling, procurement
│                             #   (start as /ops routes in web; split out when auth +
│                             #    deploy cadence diverge)
├── installer/                # Expo/React Native — offline-first job packs
└── portal/                   # customer portal (or a route group in web behind auth)
packages/
├── db/                       # generated Supabase types + typed query helpers
├── ui/                       # shared design system (extract once 2 apps exist)
└── templates/                # installation template library (the moat)
```

**Rule of thumb:** a new *app* only when auth model or deploy cadence diverges;
a new *package* only when two consumers exist. Until then, route groups and
folders.

## The three load-bearing decisions

### 1. The engine is a pure, versioned function

`generateQuote(survey) → quote` lives in `@aircon/domain` with **zero
dependencies** — no React, no Supabase, no I/O. Same survey in, same quote out.
Every persisted quote stores `{ engine_version, survey, quote }` as JSONB.

This is what makes the "knowledge loop" (Phase 10) possible: when real install
data shows a loft install takes 1.4× the estimate, you change a constant, bump
`ENGINE_VERSION`, and replay every historical survey to see exactly what the
rule change does to your book. The pricing rules become a tuned model, not
folklore. The same package will later hold heat-load refinement, template
matching and labour estimation — all fed by actuals.

### 2. Surveys are immutable snapshots, quotes are derived

The survey a customer submits is never mutated — revisions are new rows. Ops
tooling, design review, and eventually AI design all *derive* from the survey.
Denormalised columns (`total_gbp`, `confidence_score`, `postcode`) exist purely
for ops queries; the JSONB snapshot is the truth.

### 3. Clients never set prices

The browser runs the engine for instant feedback, but the API route **recomputes
the quote server-side** from the validated survey before persisting. The client
is a preview, not an authority. Photos upload directly to a private Storage
bucket via short-lived signed URLs (minted server-side), so multi-MB phone
photos never transit Vercel functions and no storage keys reach the browser.

## Security model (current phase)

- No Supabase keys in the browser. All persistence goes through Next API routes
  using the service-role key.
- `quote_requests` has RLS enabled with **no policies** — service role only.
- Photo bucket is private; uploads via signed URLs, reads (ops) via signed URLs
  later.
- When customer auth arrives (portal), switch to `@supabase/ssr` + RLS policies
  keyed on `auth.uid()`; the API-route pattern stays for anonymous funnel writes.

## Data model trajectory

`quote_requests` is deliberately a single wide table today. The known evolution:

1. **Portal/auth** → split `customers`, link quotes to `auth.users`.
2. ~~**Booking** → jobs table~~ **Shipped as `projects`** (migration 0005): a
   quote becomes a project running the six-stage machine in
   `@aircon/domain/project.ts` (`quote → floor-plan → final-quote →
   site-visit → delivery → installation`). Full JSONB snapshot as truth,
   every transition through the pure reducer, event log embedded. See
   [docs/project-workflow.md](./docs/project-workflow.md).
3. **Design review** → `designs` table, versioned, referencing the survey.
4. **Knowledge loop** → `install_actuals` keyed by project, joined back to the
   engine version that priced it.

The JSONB snapshots mean none of these migrations rewrite history.

## Conventions

- Money: integer GBP (VAT-inclusive) in the domain layer; format at the edge.
- All domain types JSON-serialisable — they cross the wire and into JSONB as-is.
- Brand is centralised in `apps/web/lib/brand.ts` (placeholder name today).
- Tests: `node --test` in packages (`pnpm test`); the engine has behavioural
  tests that double as documentation of pricing rules.

## Deploying

1. **Vercel**: import the repo, set *Root Directory* to `apps/web`
   (framework auto-detects; pnpm workspaces are handled natively).
2. **Supabase**: create a project, run `supabase/migrations/0001_quotes.sql`
   in the SQL editor (or `supabase db push`).
3. Set env vars in Vercel: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
4. No env vars → the site runs in **demo mode**: full quote flow works,
   nothing persists. Useful for previews.
