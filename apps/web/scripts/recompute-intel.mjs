/**
 * Headless "Recompute scores" for the Property Intelligence book.
 *
 * The importer writes raw records and leaves the derived fields (archetype,
 * priority band/score, planning risk) for the app to compute — normally you'd
 * click "Recompute scores" on /ops/intel. This script does the same thing from
 * the command line so the whole import can run unattended in CI (GitHub
 * Actions) with nobody opening a browser.
 *
 * It reuses the REAL domain logic (classifyProperty + scoreMarketing) rather
 * than reimplementing it, so results are identical to the button. Node strips
 * the TypeScript at load time, hence the flag:
 *
 *   node --experimental-strip-types scripts/recompute-intel.mjs
 *
 * Run from apps/web with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set (or in
 * .env.local), or DATA_BACKEND=file for local data. The columns come from
 * propertyRow() in the domain, the same mapping the app saves with.
 */

import { propertyRow } from "@aircon/domain";
import { scriptDb } from "./script-db.mjs";

const supabase = await scriptDb();

// A page at a time, saved in one upsert per page (one request per 500 homes,
// not one per home: a borough-sized book recomputes in a minute or two).
const page = 500;
let from = 0;
let updated = 0;
const nowIso = new Date().toISOString();
for (;;) {
  const { data, error } = await supabase
    .from("properties")
    .select("id, intel")
    .order("id")
    .range(from, from + page - 1);
  if (error) {
    console.error("recompute query failed:", error.message);
    process.exit(1);
  }
  if (!data || data.length === 0) break;
  const { error: upErr } = await supabase.from("properties").upsert(data.map((row) => propertyRow({ ...row.intel, id: row.id }, nowIso)));
  if (upErr) {
    console.error(`recompute save failed at ${from}:`, upErr.message);
    process.exit(1);
  }
  updated += data.length;
  process.stdout.write(`\r${updated} recomputed`);
  if (data.length < page) break;
  from += page;
}
console.log(`\nDone. Recomputed ${updated} properties.`);
