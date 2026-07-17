# The Property Intelligence Engine

One master record per residential property, keyed on UPRN, built from open
data plus our own audits. When a customer types their address the platform
already knows the house; when we plan a mailing we pick exactly which doors
to hit and every letter carries a personalised page.

```
Address → Property intel → Archetype → Install template → Materials → Labour → Fixed price
```

Live surfaces:

- **Funnel prefill**: the address step offers every known address for the
  postcode; picking one pre-answers the house step from public records.
- **Per-address landing pages** (`/a/<property id>`, sample at `/a/demo`):
  the page each mailed letter points at. What we know, the proposed system,
  an indicative price, and a CTA into the prefilled funnel.
- **Analytics platform** (`/ops/intel`, basic auth): coverage stats, install
  pattern distribution, target-list filters, mailing CSV export with
  personalised URLs, campaign tagging, and the business case for any list.

Everything works in demo mode with a deterministic SW16/SW17 sample, so the
whole loop is walkable before a single row is imported.

> **Just want to try the importer?** Ready-made sample CSVs in the exact
> format below live in `apps/web/scripts/sample-data/` (regenerate or scale
> them with `node scripts/make-sample-data.mjs`). They let you run the full
> import → recompute pipeline against your own Supabase without waiting on the
> real downloads. See [loading-data.md](./loading-data.md) for the walkthrough.

## Where to get the data (in order)

### 1. EPC register (the backbone). Do this first.

- Go to **https://epc.opendatacommunities.org/** and register (free, instant).
- Download the bulk **domestic certificates** for the boroughs covering
  SW16/SW17: **Lambeth**, **Wandsworth**, plus **Merton** and **Croydon** for
  the fringes. Each download is a zip with a `certificates.csv`.
- Rows since ~2021 include the **UPRN**; the importer keys on it and falls
  back to a stable synthetic address key when it's missing.
- Import (from `apps/web`, with Supabase env vars in `.env.local`):

  ```bash
  node scripts/import-intel.mjs epc path/to/certificates.csv --outcodes SW16,SW17
  ```

  The newest certificate per address wins. Re-running is safe: planning,
  constraints, audits and marketing state on existing records survive.

### 2. Planning applications (loft conversions, extensions)

- **Planning London Datahub** on the London Datastore
  (https://data.london.gov.uk/dataset/planning-london-datahub) has every
  London application; filter to Lambeth/Wandsworth and export CSV.
- Alternatively the national beta at **https://www.planning.data.gov.uk/**
  (dataset: *planning applications*), or the borough portals themselves
  (Lambeth and Wandsworth both run Idox with CSV export on search results).
- Shape the CSV to columns `address, postcode, description` (rename in a
  spreadsheet if needed). The importer greps descriptions for lofts,
  dormers, rear/side extensions and garage conversions:

  ```bash
  node scripts/import-intel.mjs planning applications.csv --outcodes SW16,SW17
  ```

### 3. Conservation areas, listed buildings, Article 4

- **https://www.planning.data.gov.uk/** datasets: *conservation-area*,
  *listed-building*, *article-4-direction* (GeoJSON/CSV downloads).
- **Historic England** National Heritage List open data for listed buildings:
  https://historicengland.org.uk/listing/the-list/data-downloads/
- v1 keeps this simple with a postcode-level CSV you prepare once:
  `postcode, conservation_area, listed_building, article_4` (true/false).
  Lambeth and Wandsworth both publish conservation-area maps you can read
  postcodes off; a street is in or out.

  ```bash
  node scripts/import-intel.mjs constraints constraints.csv
  ```

### 4. UPRN backbone (optional, later)

- **OS Open UPRN** (free): every UPRN with coordinates,
  https://www.ordnancesurvey.co.uk/products/os-open-uprn
- **ONS UPRN Directory (ONSUD)** links UPRNs to postcodes and areas.
- Full address text per UPRN needs **AddressBase** (paid licence) or the
  GetAddress-style APIs we already stub at `/api/addresses`. The EPC file
  covers most addressed homes in practice, so this can wait.

### 5. Street imagery (manual audit fuel)

Google Street View / Google Maps / Bing Maps, viewed manually while
auditing. Record findings per property (front garden, side access, condenser
spot, board location if visible through the porch). The audit fields already
exist on the record (`intel.audit`); an ops audit form is the next build.
Keep it manual and proprietary: this layer is the moat.

### 6. Nice-to-have later

- **Land Registry Price Paid** (free CSV): ownership churn signals for
  marketing timing.
- **VOA council tax bands** (free): a wealth proxy per address.
- **EPC API** (same registration) for incremental nightly pulls instead of
  bulk re-downloads.

## How it fits together

- `packages/domain/src/intelligence.ts`: the `PropertyIntel` type and the
  pure functions: `classifyProperty` (EPC profile → archetype + confidence,
  manual audit always wins), `prefillFromIntel` (funnel answers),
  `defaultConfigFromIntel` (proposed system → engine → indicative price),
  `scoreMarketing` (priority band + reasons), `businessCase` (mailing maths).
  All tested in `intelligence.test.ts`.
- `supabase/migrations/0006_property_intelligence.sql`: `properties` (JSONB
  snapshot as truth + flat columns for filters) and `property_assessments`
  (append-only log of every import and audit).
- `apps/web/scripts/import-intel.mjs`: the ETL. Dependency-light on purpose;
  it writes raw records, then the **Recompute scores** button on `/ops/intel`
  runs the classifier and priority scoring across the book.
- `apps/web/lib/intel-server.ts`: lookups, filtered queries, campaign
  tagging, and the demo dataset.

## The flywheel

Every completed installation should end with an assessment row
(`source: "install"`) carrying actual hours, materials and issues, and an
audit update on the property. That is what turns the templates from
estimates into statistics. The `property_assessments` table is ready for it;
wiring it to project completion is a later step.

## Privacy posture

Everything imported is open government data, and the per-address pages only
show what any EPC lookup site already shows. The letters and pages carry an
opt-out line; opting out sets `lead_status = excluded`, which drops the
property from every future list.
