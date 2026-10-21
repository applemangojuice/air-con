/**
 * After a bulk EPC import: give every home its postcode centre and planning
 * constraints in one pass (postcodes 100 at a time, constraint areas once per
 * outcode), so picking a home on the quote form needs no outside calls.
 * Also recomputes each saved home's archetype and priority.
 *
 *   node --experimental-strip-types scripts/enrich-intel.mjs [--outcodes SW16,SW17] [--recheck]
 *
 *   --outcodes   only these outcodes (default: every home)
 *   --recheck    check homes that were already done (e.g. a year on, for new
 *                conservation areas)
 *
 * Supabase from env or .env.local; DATA_BACKEND=file for local data.
 */

import { enrichBook } from "../lib/property-bulk.ts";
import { scriptDb } from "./script-db.mjs";

const argv = process.argv.slice(2);
const i = argv.findIndex((a) => a === "--outcodes" || a.startsWith("--outcodes="));
const outcodes = i === -1 ? [] : String(argv[i].split("=")[1] || argv[i + 1] || "").split(",").map((s) => s.trim()).filter(Boolean);

const db = await scriptDb();
const report = await enrichBook(
  db,
  { outcodes, recheck: argv.includes("--recheck") },
  {
    log: (l) => console.log(`  ${l}`),
    // Only to point at a stand-in during testing.
    postcodesBase: process.env.POSTCODES_IO_BASE || undefined,
    planningBase: process.env.PLANNING_DATA_BASE || undefined,
  },
);
console.log(
  `Done. ${report.saved} homes saved: ${report.located} located, ${report.checked} checked for planning constraints (of ${report.needed} that needed it, ${report.scanned} in scope).`,
);
if (report.postcodesNotFound.length) console.log(`Postcodes postcodes.io didn't know (${report.postcodesNotFound.length}): ${report.postcodesNotFound.slice(0, 20).join(", ")}${report.postcodesNotFound.length > 20 ? " …" : ""}`);
if (report.outcodesWithoutConstraints.length) {
  console.log(`planning.data.gov.uk didn't answer for ${report.outcodesWithoutConstraints.join(", ")}: run again later (those homes get checked when picked meanwhile).`);
}
