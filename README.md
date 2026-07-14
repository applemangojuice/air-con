# air-con — the operating system for residential air conditioning

Fixed-price quoting with customer self-survey is **live**; the rest of the
platform (CRM, design studio, installer app, monitoring) has placeholder
surfaces and a data model already shaped for it. See
[ARCHITECTURE.md](./ARCHITECTURE.md) for the why behind everything.

## What works today

- **Marketing site** (`/`) — postcode capture into the quote funnel.
- **Fixed-price quote funnel** (`/quote`) — six-step mobile-first self-survey:
  address → property → rooms (with photos) → outdoor unit → electrics → contact,
  ending in an instant fixed price with finance options, an Installation
  Confidence Score, and a full price breakdown. Drafts auto-save to the device.
- **Pricing engine** (`packages/domain`) — deterministic, versioned, tested.
- **Persistence** — quotes + photos into Supabase when configured; graceful
  demo mode when not.
- **Placeholders** — `/portal` (customer), `/ops` (internal modules), `/how-it-works`.

## Run it

```bash
pnpm install
pnpm dev            # http://localhost:3000
pnpm test           # domain engine tests
pnpm build          # production build (also typechecks)
```

Runs in demo mode with no configuration. To persist quotes, copy
`apps/web/.env.example` to `apps/web/.env.local` and fill in your Supabase
project, then run `supabase/migrations/0001_quotes.sql` against it.

## Deploy

Vercel (root directory: `apps/web`) + Supabase. Full steps in
[ARCHITECTURE.md](./ARCHITECTURE.md#deploying).
