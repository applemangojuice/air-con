# Sample property data

Ready-to-import CSVs shaped exactly like the open-data feeds the importer
(`../import-intel.mjs`) reads. They cover the same SW16/SW17 streets as the
app's built-in demo dataset, so an imported book looks familiar. Use them to
exercise the full import pipeline against your own Supabase without waiting on
the real (registration-gated, large) government downloads.

| File | Feed | Importer command |
| --- | --- | --- |
| `epc-certificates.csv` | EPC register (the backbone — one record per address) | `node scripts/import-intel.mjs epc scripts/sample-data/epc-certificates.csv --outcodes SW16,SW17` |
| `planning.csv` | Planning applications (loft / extension flags) | `node scripts/import-intel.mjs planning scripts/sample-data/planning.csv --outcodes SW16,SW17` |
| `constraints.csv` | Conservation / listed / Article 4, by postcode | `node scripts/import-intel.mjs constraints scripts/sample-data/constraints.csv` |

Run them **in that order** (EPC first — planning and constraints only enrich
records that already exist), then open `/ops/intel` and hit **Recompute
scores**.

Regenerate or scale these files with `node scripts/make-sample-data.mjs`
(deterministic; `--count 300` for a bigger set). Full walkthrough:
[docs/loading-data.md](../../../../docs/loading-data.md).
