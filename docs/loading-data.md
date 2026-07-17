# Loading the data (start here)

This is the practical guide to getting property data into the platform so you
can see the whole thing work. The data-heavy feature is the **Property
Intelligence Engine** — one master record per house, built from open
government data (EPC, planning, constraints). Everything else (the demo
dataset, the funnel prefill, the mailing pages, the analytics) sits on top of
that.

There are three ways in, fastest first. Pick the one that matches what you're
trying to do.

| You want to… | Do this | Needs a database? | Time |
| --- | --- | --- | --- |
| **Just see how it works** | Demo mode | No | 2 min |
| **Run the real import pipeline now** | Sample CSVs → importer | Yes (Supabase) | 15 min |
| **Load a real area for a campaign** | Open-data downloads → importer | Yes (Supabase) | a couple of hours |

---

## Path 1 — Demo mode (no download, no upload)

The app ships a deterministic ~240-property SW16/SW17 dataset baked into the
code. With no database configured, every property surface runs off it. This is
the fastest way to walk the whole loop.

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

Then browse:

- `/quote` — start a quote; on the address step, type **SW16 1AD** (or any
  demo postcode below) and you'll see known addresses offered and the house
  step pre-answered from the record.
- `/a/demo` — a per-address mailing landing page.
- `/ops/intel` — the analytics console (coverage, priority bands, target-list
  filters, mailing CSV export). Set `OPS_PASSWORD` in
  `apps/web/.env.local` to unlock the `/ops/*` pages; the browser prompts for
  any username + that password.

Demo postcodes: `SW16 1AD`, `SW16 2BE`, `SW16 1CF`, `SW16 2DG`, `SW16 1EH`,
`SW17 2FJ`, `SW17 1GA`, `SW17 2HB`, `SW17 1JC`, `SW17 2AD`.

Nothing here persists — that's the point. When you're ready to load real rows,
go to Path 2.

---

## Path 2 — Import the sample CSVs (real pipeline, instant data)

This exercises the exact production import path — `properties` and
`property_assessments` tables, the ETL importer, the recompute step — but with
ready-made sample files so you don't wait on the (registration-gated, large)
government downloads. The rows are coherent with the demo streets above, so the
imported book looks familiar.

### 2a. Stand up a database

1. Create a free project at [supabase.com](https://supabase.com).
2. Run **every** file in `supabase/migrations/` in order in the SQL editor
   (or `supabase db push`). The property tables live in
   `0006_property_intelligence.sql` — make sure that one runs. (Note there are
   two `0006_*` files; run both.)
3. Copy `apps/web/.env.example` to `apps/web/.env.local` and fill in
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Settings → API).
   Add `OPS_PASSWORD` too, so you can open `/ops/intel`.

### 2b. Generate the sample files (optional — they're already committed)

Committed copies live in `apps/web/scripts/sample-data/`. To regenerate them,
or to make a bigger set for load testing:

```bash
cd apps/web
node scripts/make-sample-data.mjs                # ~200 EPC rows
node scripts/make-sample-data.mjs --count 300    # 300 houses/street ≈ 3,000 rows
```

Output is deterministic (seeded), so re-running gives identical files. It
writes CSVs only — no database, no env vars needed.

### 2c. Import, in order

The importer runs from `apps/web` and reads your `.env.local`. **Order
matters**: EPC creates the property records; planning and constraints only
*enrich* records that already exist.

```bash
cd apps/web

# 1. EPC — the backbone. Creates one record per address.
node scripts/import-intel.mjs epc scripts/sample-data/epc-certificates.csv --outcodes SW16,SW17

# 2. Planning — flags lofts / extensions on known addresses.
node scripts/import-intel.mjs planning scripts/sample-data/planning.csv --outcodes SW16,SW17

# 3. Constraints — conservation area / listed / Article 4, by postcode.
node scripts/import-intel.mjs constraints scripts/sample-data/constraints.csv
```

You'll see per-step counts (`200 properties in scope`, `117 properties
enriched`, etc.).

### 2d. Recompute, then look

The importer writes the raw records but leaves the derived fields (archetype,
priority band) for the app to compute. Open **`/ops/intel`** and click
**Recompute scores** — that runs the classifier and priority scoring across the
book. Now the filters, priority bands, and business-case maths are live. Every
address also has a page at `/a/<id>` and prefills the funnel.

---

## Path 3 — Load a real area (the actual "extensive data")

Same importer, same three steps — you're just swapping the sample CSVs for real
downloads. Do it in the same order (EPC first). Full source-by-source detail,
including exact URLs and the CSV columns each importer expects, is in
[property-intelligence.md](./property-intelligence.md#where-to-get-the-data-in-order).
The short version:

1. **EPC register** — [epc.opendatacommunities.org](https://epc.opendatacommunities.org/)
   (free registration, instant). Download the **domestic certificates** for the
   boroughs covering your target outcodes — for SW16/SW17 that's **Lambeth** and
   **Wandsworth** (plus **Merton**/**Croydon** for the fringes). Each download
   is a zip containing `certificates.csv`. Import it with the `epc` command,
   passing your target outcodes to `--outcodes`.
2. **Planning applications** — the
   [Planning London Datahub](https://data.london.gov.uk/dataset/planning-london-datahub),
   the national beta at [planning.data.gov.uk](https://www.planning.data.gov.uk/),
   or the borough Idox portals. Shape to `address, postcode, description` and
   import with the `planning` command. The importer greps the descriptions for
   loft/dormer/extension/garage keywords.
3. **Constraints** — conservation areas, listed buildings and Article 4 from
   [planning.data.gov.uk](https://www.planning.data.gov.uk/) and
   [Historic England](https://historicengland.org.uk/listing/the-list/data-downloads/).
   For v1, prepare a postcode-level CSV `postcode, conservation_area,
   listed_building, article_4` and import with the `constraints` command.

Re-running is safe: the EPC importer keeps the newest certificate per address
and preserves any planning, constraints, audit and marketing state already on a
record. After a real import, hit **Recompute scores** again.

---

## Where the data lives (so you can trust it)

- **`properties`** — one row per house. The `intel` JSONB column is the truth
  (the `@aircon/domain` `PropertyIntel` type, stored as-is); the flat columns
  (`outcode`, `epc_rating`, `priority_band`, …) are denormalised for filters and
  recomputed on every save, so they can't drift.
- **`property_assessments`** — append-only log of every import and audit
  (`source: epc-import | planning-import | constraints-import | audit | install`).
  Nothing is destroyed; history accumulates.

Schema: `supabase/migrations/0006_property_intelligence.sql`. Importer:
`apps/web/scripts/import-intel.mjs`. Sample data + generator:
`apps/web/scripts/sample-data/` and `apps/web/scripts/make-sample-data.mjs`.

---

## Troubleshooting

- **`Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY`** — you're not in
  `apps/web`, or `.env.local` isn't filled in. The importer reads
  `apps/web/.env.local`.
- **`relation "properties" does not exist`** — the property-intelligence
  migration didn't run. Run `supabase/migrations/0006_property_intelligence.sql`.
- **`0 properties in scope`** — your `--outcodes` don't match the postcodes in
  the file, or the file's postcode column isn't named `POSTCODE`. Drop
  `--outcodes` to import everything, or fix the outcode list.
- **Planning says `N addresses not in the book yet`** — planning only enriches
  properties EPC already created. Import EPC first, and make sure the planning
  `address` text matches the EPC address for the same house.
- **Numbers look stale on `/ops/intel`** — click **Recompute scores**. The
  importer writes raw records; archetype and priority are computed app-side.
- **Everything's empty and you expected demo data** — you *have* Supabase
  configured (so it's reading the empty DB, not the demo set). Either import
  data, or unset the Supabase env vars to fall back to demo mode.
