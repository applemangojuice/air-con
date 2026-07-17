/**
 * Sample-data generator for the Property Intelligence importer.
 *
 * Produces three CSVs shaped exactly like the open-data feeds the importer
 * (scripts/import-intel.mjs) reads, so you can exercise the whole pipeline
 * against your own Supabase before touching the real (large, registration-
 * gated) EPC / planning / constraints downloads:
 *
 *   - epc-certificates.csv  -> `import-intel.mjs epc ...`         (the backbone)
 *   - planning.csv          -> `import-intel.mjs planning ...`    (loft/extension flags)
 *   - constraints.csv       -> `import-intel.mjs constraints ...` (conservation/listed/A4)
 *
 * The rows are coherent with the app's built-in demo dataset (same SW16/SW17
 * streets), so an imported book looks like the demo you already know. Output
 * is deterministic (seeded), so re-running gives byte-identical files.
 *
 * Usage (from apps/web):
 *
 *   node scripts/make-sample-data.mjs                 # ~200 EPC rows -> scripts/sample-data/
 *   node scripts/make-sample-data.mjs --count 300     # 300 houses/street (3000 rows) for load testing
 *   node scripts/make-sample-data.mjs --out /tmp/data # write somewhere else
 *
 * This writes CSVs only. It touches no database and needs no env vars. Feed
 * the files to import-intel.mjs (which needs Supabase creds) when ready.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/* ---------------- args ------------------------------------------------ */

const argv = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i === -1) return fallback;
  const inline = argv[i].split("=")[1];
  return inline ?? argv[i + 1] ?? fallback;
};

const HOUSES_PER_STREET = Math.max(1, Number(argValue("count", "20")) || 20);
const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(argValue("out", resolve(here, "sample-data")));

/* ---------------- deterministic PRNG (mirrors the app demo) ----------- */

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(161717);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

/* ---------------- streets (mirror lib/intel-server.ts) ---------------- */

const STREETS = [
  { name: "Larkhall Rise", outcode: "SW16", kind: "thirties" },
  { name: "Ellison Road", outcode: "SW16", kind: "victorian" },
  { name: "Braxted Park", outcode: "SW16", kind: "thirties" },
  { name: "Hitherfield Road", outcode: "SW16", kind: "victorian" },
  { name: "Mount Ephraim Lane", outcode: "SW16", kind: "mixed" },
  { name: "Fishponds Road", outcode: "SW17", kind: "victorian" },
  { name: "Ansell Road", outcode: "SW17", kind: "victorian" },
  { name: "Brudenell Road", outcode: "SW17", kind: "mixed" },
  { name: "Ashvale Road", outcode: "SW17", kind: "thirties" },
  { name: "Selkirk Road", outcode: "SW17", kind: "victorian" },
];

// One believable postcode per street (stable per street index).
const postcodeFor = (streetIdx, outcode) =>
  `${outcode} ${streetIdx % 2 === 0 ? 1 : 2}${"ABCDEFGHJ"[streetIdx % 9]}${"ABCDEFGHJ"[(streetIdx + 3) % 9]}`;

/* ---------------- CSV writer (RFC-4180-ish quoting) ------------------- */

const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (header, rows) =>
  [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";

/* ---------------- build the book ------------------------------------- */

const properties = []; // internal model we derive all three CSVs from

STREETS.forEach((street, streetIdx) => {
  const postcode = postcodeFor(streetIdx, street.outcode);
  for (let house = 1; house <= HOUSES_PER_STREET; house++) {
    const r = rand();
    const victorian = street.kind === "victorian" || (street.kind === "mixed" && r < 0.5);
    const isFlat = r > 0.88;
    const endTerrace = house % 12 === 1;
    const floorArea = Math.max(
      45,
      Math.round((victorian ? 95 : 88) + rand() * (victorian ? 55 : 40) - (isFlat ? 35 : 0)),
    );
    const loft = !isFlat && rand() < (victorian ? 0.3 : 0.18);
    const rear = !isFlat && rand() < 0.25;
    const side = !isFlat && rand() < 0.1;
    const garage = !isFlat && !victorian && rand() < 0.08;
    const conservation = street.kind === "victorian" && streetIdx % 3 === 0;

    properties.push({
      line1: `${house} ${street.name}`,
      postcode,
      outcode: street.outcode,
      // 100-series synthetic UPRN, stable and unique per house.
      uprn: `1000${(streetIdx + 1) * 10000 + house * 17}`,
      isFlat,
      victorian,
      endTerrace,
      floorArea,
      habitableRooms: Math.max(3, Math.round(floorArea / 22)),
      loft,
      rear,
      side,
      garage,
      conservation,
      listed: conservation && house === 1,
    });
  }
});

/* ---------------- 1. EPC certificates.csv ---------------------------- */
// Columns the importer reads (see import-intel.mjs `kind === "epc"`).

const epcHeader = [
  "ADDRESS1", "ADDRESS2", "POSTCODE", "PROPERTY_TYPE", "BUILT_FORM",
  "CONSTRUCTION_AGE_BAND", "TOTAL_FLOOR_AREA", "NUMBER_HABITABLE_ROOMS",
  "WALLS_DESCRIPTION", "ROOF_DESCRIPTION", "WINDOWS_DESCRIPTION",
  "MAINHEAT_DESCRIPTION", "HOTWATER_DESCRIPTION", "CURRENT_ENERGY_RATING",
  "POTENTIAL_ENERGY_RATING", "LODGEMENT_DATE", "UPRN",
];
const ratings = ["C", "D", "D", "E", "D", "E"];
const epcRows = properties.map((p) => [
  p.line1,
  "", // ADDRESS2 empty: keeps line1 == ADDRESS1 so planning/constraints keys match
  p.postcode,
  p.isFlat ? "Flat" : "House",
  p.isFlat ? "Mid-Terrace" : p.victorian ? (p.endTerrace ? "End-Terrace" : "Mid-Terrace") : "Semi-Detached",
  p.victorian ? "England and Wales: 1900-1929" : "England and Wales: 1930-1949",
  p.floorArea,
  p.habitableRooms,
  p.victorian ? "Solid brick, as built, no insulation (assumed)" : "Cavity wall, as built, insulated (assumed)",
  p.isFlat ? "(another dwelling above)" : "Pitched, 250 mm loft insulation",
  rand() < 0.8 ? "Fully double glazed" : "Partial double glazing",
  "Boiler and radiators, mains gas",
  "From main system",
  pick(ratings),
  "C",
  "2023-05-14",
  p.uprn,
]);

/* ---------------- 2. planning.csv ----------------------------------- */
// ADDRESS, POSTCODE, DESCRIPTION. Only enriches EPC-loaded properties, so
// the addresses here are drawn from the same book.

const planningHeader = ["ADDRESS", "POSTCODE", "DESCRIPTION"];
const planningRows = [];
for (const p of properties) {
  if (p.loft)
    planningRows.push([p.line1, p.postcode, "Loft conversion with rear dormer and two rooflights to front elevation"]);
  if (p.rear)
    planningRows.push([p.line1, p.postcode, "Single storey rear extension following demolition of existing conservatory"]);
  if (p.side)
    planningRows.push([p.line1, p.postcode, "Side return extension and internal alterations at ground floor"]);
  if (p.garage)
    planningRows.push([p.line1, p.postcode, "Conversion of integral garage to habitable room"]);
}

/* ---------------- 3. constraints.csv -------------------------------- */
// One row per postcode: POSTCODE, CONSERVATION_AREA, LISTED_BUILDING, ARTICLE_4.

const constraintsHeader = ["POSTCODE", "CONSERVATION_AREA", "LISTED_BUILDING", "ARTICLE_4"];
const byPostcode = new Map();
for (const p of properties) {
  const cur = byPostcode.get(p.postcode) ?? { conservation: false, listed: false };
  cur.conservation = cur.conservation || p.conservation;
  cur.listed = cur.listed || p.listed;
  byPostcode.set(p.postcode, cur);
}
const constraintsRows = [...byPostcode.entries()].map(([postcode, c]) => [
  postcode,
  c.conservation ? "yes" : "no",
  c.listed ? "yes" : "no",
  "no", // no Article 4 in the sample; flip a row to "yes" to see it flow through
]);

/* ---------------- write --------------------------------------------- */

mkdirSync(OUT_DIR, { recursive: true });
const write = (name, header, rows) => {
  const path = resolve(OUT_DIR, name);
  writeFileSync(path, toCsv(header, rows));
  console.log(`  ${name.padEnd(24)} ${String(rows.length).padStart(5)} rows`);
  return path;
};

console.log(`Writing sample data to ${OUT_DIR}`);
write("epc-certificates.csv", epcHeader, epcRows);
write("planning.csv", planningHeader, planningRows);
write("constraints.csv", constraintsHeader, constraintsRows);
console.log(
  "\nNext (from apps/web, with Supabase creds in .env.local):\n" +
    "  node scripts/import-intel.mjs epc scripts/sample-data/epc-certificates.csv --outcodes SW16,SW17\n" +
    "  node scripts/import-intel.mjs planning scripts/sample-data/planning.csv --outcodes SW16,SW17\n" +
    "  node scripts/import-intel.mjs constraints scripts/sample-data/constraints.csv\n" +
    "Then open /ops/intel and hit Recompute.",
);
