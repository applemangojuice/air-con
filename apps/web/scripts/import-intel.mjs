/**
 * Property Intelligence importer. Feeds downloaded open-data CSVs into the
 * `properties` table, building one master record per property.
 *
 * Usage (from apps/web, with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set,
 * e.g. via .env.local):
 *
 *   node scripts/import-intel.mjs epc certificates.csv --outcodes SW16,SW17
 *   node scripts/import-intel.mjs planning applications.csv --outcodes SW16,SW17
 *   node scripts/import-intel.mjs constraints constraints.csv
 *
 * Dataset shapes (see docs/property-intelligence.md for where to get them):
 *  - epc: the EPC register bulk "certificates.csv" (one row per certificate;
 *    the newest certificate per address wins).
 *  - planning: CSV with columns address, postcode, description (free text;
 *    loft/extension keywords are extracted).
 *  - constraints: CSV with columns postcode (or address+postcode),
 *    conservation_area, listed_building, article_4 (true/false-ish values).
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/* ---------------- tiny CSV parser (quotes, commas, newlines) -------- */

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function toObjects(rows) {
  const header = rows[0].map((h) => h.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_"));
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

/* ---------------- address + vocabulary helpers (mirror the domain) --- */

const normaliseAddress = (line) => line.toUpperCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
const outcodeOf = (pc) => {
  const clean = pc.toUpperCase().replace(/\s+/g, "");
  return clean.length > 3 ? clean.slice(0, -3) : clean;
};
function syntheticId(line1, postcode) {
  const key = `${normaliseAddress(line1)} ${postcode.toUpperCase().replace(/\s+/g, "")}`;
  let hash = 5381;
  for (let i = 0; i < key.length; i++) hash = ((hash << 5) + hash + key.charCodeAt(i)) >>> 0;
  return `addr-${hash.toString(36)}-${key.replace(/[^A-Z0-9]/g, "").slice(0, 12).toLowerCase()}`;
}
const addressKey = (line1, postcode) =>
  `${normaliseAddress(line1)} ${postcode.toUpperCase().replace(/\s+/g, "")}`;

/* ---------------- args + client -------------------------------------- */

const [, , kind, filePath, ...rest] = process.argv;
const outcodesArg = rest.find((a, i) => rest[i - 1] === "--outcodes" || a.startsWith("--outcodes="));
const outcodes = (outcodesArg ?? "")
  .replace("--outcodes=", "")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

if (!kind || !filePath || !["epc", "planning", "constraints"].includes(kind)) {
  console.error("Usage: node scripts/import-intel.mjs <epc|planning|constraints> <file.csv> [--outcodes SW16,SW17]");
  process.exit(1);
}
if (!existsSync(filePath)) {
  console.error(`File not found: ${resolve(filePath)}`);
  process.exit(1);
}

// Pick up .env.local the way Next would, without adding a dependency.
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

const records = toObjects(parseCsv(readFileSync(filePath, "utf8")));
console.log(`${records.length} rows in ${filePath}`);

const inScope = (pc) => outcodes.length === 0 || outcodes.includes(outcodeOf(pc));
const first = (row, ...names) => {
  for (const n of names) if (row[n]) return row[n];
  return "";
};

/* ---------------- upsert helpers ------------------------------------- */

async function loadExistingByKey(keys) {
  const map = new Map();
  for (let i = 0; i < keys.length; i += 400) {
    const { data, error } = await supabase
      .from("properties")
      .select("id, address_key, intel")
      .in("address_key", keys.slice(i, i + 400));
    if (error) throw new Error(error.message);
    for (const row of data ?? []) map.set(row.address_key, row);
  }
  return map;
}

async function upsertBatch(rows, source) {
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await supabase.from("properties").upsert(chunk);
    if (error) throw new Error(`upsert failed: ${error.message}`);
    const { error: logError } = await supabase.from("property_assessments").insert(
      chunk.map((r) => ({ property_id: r.id, source, assessment: r.intel })),
    );
    if (logError) console.warn("assessment log failed:", logError.message);
    process.stdout.write(`\r${Math.min(i + 200, rows.length)}/${rows.length} saved`);
  }
  console.log("");
}

/**
 * The flat columns are recomputed by the app on every save; the importer
 * writes conservative values and the next app-side save trues them up. To
 * keep the importer dependency-light it does not run the TS classifier;
 * archetype/priority land as null/0 and /ops/intel offers "recompute".
 */
function baseColumns(intel) {
  return {
    id: intel.id,
    uprn: intel.uprn ?? null,
    address_line: intel.address.line1,
    address_key: addressKey(intel.address.line1, intel.address.postcode),
    postcode: intel.address.postcode,
    outcode: intel.address.outcode,
    epc_rating: intel.epc?.currentRating ?? null,
    floor_area_m2: intel.epc?.totalFloorAreaM2 ? Math.round(intel.epc.totalFloorAreaM2) : null,
    has_loft_conversion: intel.planning?.loftConversion ?? false,
    audited: Boolean(intel.audit),
    lead_status: intel.marketing?.leadStatus ?? "untouched",
    campaign: intel.marketing?.campaign ?? null,
    updated_at: new Date().toISOString(),
    intel,
  };
}

/* ---------------- dataset handlers ------------------------------------ */

if (kind === "epc") {
  // EPC register bulk download columns (certificates.csv).
  const byKey = new Map();
  let skipped = 0;
  for (const row of records) {
    const postcode = first(row, "POSTCODE");
    if (!postcode || !inScope(postcode)) {
      skipped++;
      continue;
    }
    const line1 = [first(row, "ADDRESS1"), first(row, "ADDRESS2")].filter(Boolean).join(", ") || first(row, "ADDRESS");
    if (!line1) {
      skipped++;
      continue;
    }
    const lodged = first(row, "LODGEMENT_DATE", "INSPECTION_DATE");
    const k = addressKey(line1, postcode);
    const prev = byKey.get(k);
    if (prev && prev.lodged >= lodged) continue; // keep the newest certificate

    const uprn = first(row, "UPRN");
    byKey.set(k, {
      lodged,
      intel: {
        id: uprn || syntheticId(line1, postcode),
        uprn: uprn || undefined,
        address: { line1, postcode, outcode: outcodeOf(postcode) },
        epc: {
          propertyType: first(row, "PROPERTY_TYPE"),
          builtForm: first(row, "BUILT_FORM"),
          constructionAgeBand: first(row, "CONSTRUCTION_AGE_BAND"),
          totalFloorAreaM2: Number(first(row, "TOTAL_FLOOR_AREA")) || undefined,
          habitableRooms: Number(first(row, "NUMBER_HABITABLE_ROOMS")) || undefined,
          wallDescription: first(row, "WALLS_DESCRIPTION"),
          roofDescription: first(row, "ROOF_DESCRIPTION"),
          glazingDescription: first(row, "WINDOWS_DESCRIPTION", "GLAZED_TYPE"),
          mainHeatDescription: first(row, "MAINHEAT_DESCRIPTION"),
          hotWaterDescription: first(row, "HOTWATER_DESCRIPTION"),
          currentRating: first(row, "CURRENT_ENERGY_RATING"),
          potentialRating: first(row, "POTENTIAL_ENERGY_RATING"),
          lodgedAt: lodged || undefined,
        },
        planning: { loftConversion: false, rearExtension: false, sideExtension: false, garageConversion: false },
        constraints: { conservationArea: false, listedBuilding: false, article4: false },
        marketing: { leadStatus: "untouched" },
      },
    });
  }

  // Merge with existing rows so planning/constraints/audit survive re-imports.
  const keys = [...byKey.keys()];
  const existing = await loadExistingByKey(keys);
  const rows = keys.map((k) => {
    const fresh = byKey.get(k).intel;
    const prior = existing.get(k)?.intel;
    if (prior) {
      fresh.planning = prior.planning ?? fresh.planning;
      fresh.constraints = prior.constraints ?? fresh.constraints;
      fresh.audit = prior.audit;
      fresh.marketing = prior.marketing ?? fresh.marketing;
      fresh.id = existing.get(k).id; // never re-key an existing property
    }
    return baseColumns(fresh);
  });
  console.log(`${rows.length} properties in scope (${skipped} rows skipped)`);
  await upsertBatch(rows, "epc-import");
} else if (kind === "planning") {
  // Generic planning CSV: ADDRESS (or SITE_ADDRESS), POSTCODE, DESCRIPTION.
  const FLAG_PATTERNS = [
    ["loftConversion", /loft|dormer|roof extension|mansard/i],
    ["rearExtension", /rear extension|single storey rear|double storey rear/i],
    ["sideExtension", /side extension|side return/i],
    ["garageConversion", /garage conversion|conversion of garage/i],
  ];
  const updates = new Map();
  for (const row of records) {
    const postcode = first(row, "POSTCODE");
    const address = first(row, "ADDRESS", "SITE_ADDRESS", "DEVELOPMENT_ADDRESS");
    const description = first(row, "DESCRIPTION", "PROPOSAL", "DEVELOPMENT_DESCRIPTION");
    if (!postcode || !address || !inScope(postcode)) continue;
    const k = addressKey(address, postcode);
    const entry = updates.get(k) ?? { count: 0, flags: {} };
    entry.count++;
    for (const [flag, re] of FLAG_PATTERNS) if (re.test(description)) entry.flags[flag] = true;
    updates.set(k, entry);
  }
  const existing = await loadExistingByKey([...updates.keys()]);
  const rows = [];
  let unmatched = 0;
  for (const [k, entry] of updates) {
    const row = existing.get(k);
    if (!row) {
      unmatched++;
      continue; // planning rows only enrich known properties
    }
    const intel = row.intel;
    intel.planning = {
      loftConversion: Boolean(intel.planning?.loftConversion || entry.flags.loftConversion),
      rearExtension: Boolean(intel.planning?.rearExtension || entry.flags.rearExtension),
      sideExtension: Boolean(intel.planning?.sideExtension || entry.flags.sideExtension),
      garageConversion: Boolean(intel.planning?.garageConversion || entry.flags.garageConversion),
      applicationCount: (intel.planning?.applicationCount ?? 0) + entry.count,
    };
    rows.push(baseColumns(intel));
  }
  console.log(`${rows.length} properties enriched (${unmatched} addresses not in the book yet)`);
  await upsertBatch(rows, "planning-import");
} else if (kind === "constraints") {
  // Constraints by postcode (or by address when an ADDRESS column exists):
  // POSTCODE, CONSERVATION_AREA, LISTED_BUILDING, ARTICLE_4.
  const truthy = (v) => /^(1|y|yes|true)$/i.test(v);
  const byPostcode = new Map();
  for (const row of records) {
    const postcode = first(row, "POSTCODE").toUpperCase().replace(/\s+/g, "");
    if (!postcode) continue;
    byPostcode.set(postcode, {
      conservationArea: truthy(first(row, "CONSERVATION_AREA")),
      listedBuilding: truthy(first(row, "LISTED_BUILDING")),
      article4: truthy(first(row, "ARTICLE_4", "ARTICLE4")),
    });
  }
  const { data, error } = await supabase.from("properties").select("id, postcode, intel").limit(100000);
  if (error) throw new Error(error.message);
  const rows = [];
  for (const row of data ?? []) {
    const c = byPostcode.get(row.postcode.toUpperCase().replace(/\s+/g, ""));
    if (!c) continue;
    const intel = row.intel;
    intel.constraints = {
      conservationArea: Boolean(intel.constraints?.conservationArea || c.conservationArea),
      listedBuilding: Boolean(intel.constraints?.listedBuilding || c.listedBuilding),
      article4: Boolean(intel.constraints?.article4 || c.article4),
    };
    rows.push(baseColumns(intel));
  }
  console.log(`${rows.length} properties updated with constraints`);
  await upsertBatch(rows, "constraints-import");
}

console.log("Done. Open /ops/intel and hit Recompute to refresh archetypes and priority scores.");
