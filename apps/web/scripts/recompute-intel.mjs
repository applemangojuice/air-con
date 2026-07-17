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
 * .env.local). Mirrors recomputeAction() in app/ops/intel/actions.ts and the
 * denormaliseIntel() mapping in lib/intel-server.ts — keep them in step.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { classifyProperty, scoreMarketing, normaliseAddress } from "@aircon/domain";

/* -- env (same .env.local pickup as import-intel.mjs) -- */
if (!process.env.SUPABASE_URL && existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or fill apps/web/.env.local).");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

/** Flat columns derived from the intel snapshot. Mirrors denormaliseIntel. */
function denormalise(intel) {
  const cls = classifyProperty(intel);
  const priority = scoreMarketing(intel);
  return {
    uprn: intel.uprn ?? null,
    address_line: intel.address.line1,
    address_key: `${normaliseAddress(intel.address.line1)} ${intel.address.postcode.replace(/\s+/g, "")}`,
    postcode: intel.address.postcode,
    outcode: intel.address.outcode,
    archetype_id: cls.archetypeId ?? null,
    archetype_confidence: cls.confidence,
    planning_risk: cls.planningRisk,
    has_loft_conversion: intel.planning.loftConversion,
    epc_rating: intel.epc?.currentRating ?? null,
    floor_area_m2: intel.epc?.totalFloorAreaM2 ? Math.round(intel.epc.totalFloorAreaM2) : null,
    audited: Boolean(intel.audit),
    priority_score: priority.score,
    priority_band: priority.band,
    lead_status: intel.marketing.leadStatus,
    campaign: intel.marketing.campaign ?? null,
    updated_at: new Date().toISOString(),
    intel,
  };
}

const page = 500;
let from = 0;
let updated = 0;
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
  for (const row of data) {
    const { error: upErr } = await supabase
      .from("properties")
      .update(denormalise(row.intel))
      .eq("id", row.id);
    if (!upErr) updated++;
    else console.warn(`update ${row.id} failed:`, upErr.message);
  }
  process.stdout.write(`\r${from + data.length} scanned, ${updated} recomputed`);
  if (data.length < page) break;
  from += page;
}
console.log(`\nDone. Recomputed ${updated} properties.`);
