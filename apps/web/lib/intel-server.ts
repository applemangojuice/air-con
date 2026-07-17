import type { SupabaseClient } from "@supabase/supabase-js";
import {
  classifyProperty,
  emptyMarketing,
  normaliseAddress,
  outcodeOf,
  scoreMarketing,
  syntheticId,
  type PropertyIntel,
} from "@aircon/domain";
import { getServiceClient } from "./supabase-server";

/**
 * Server-side access to the Property Intelligence Engine. The JSONB `intel`
 * snapshot is the truth; the flat columns exist for the analytics filters
 * and are recomputed on every save. With no database configured everything
 * falls back to a deterministic demo dataset covering SW16 and SW17, so the
 * whole platform is explorable before any data is imported.
 */

export function denormaliseIntel(intel: PropertyIntel) {
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

export async function saveIntel(supabase: SupabaseClient, intel: PropertyIntel): Promise<boolean> {
  const { error } = await supabase
    .from("properties")
    .upsert({ id: intel.id, ...denormaliseIntel(intel) });
  if (error) console.error("property save failed:", error.message);
  return !error;
}

/** How many properties are in the real book. null when unconfigured/unreachable. */
export async function countProperties(): Promise<number | null> {
  const supabase = getServiceClient();
  if (!supabase) return null;
  const { count, error } = await supabase
    .from("properties")
    .select("*", { count: "exact", head: true });
  if (error) {
    console.error("property count failed:", error.message);
    return null;
  }
  return count ?? 0;
}

/**
 * Seeds the real `properties` table with the SW16/SW17 sample book — the same
 * ~240 believable homes the site shows in demo mode. Gives Property
 * Intelligence something to explore before the EPC importer has run, so it
 * never sits at a bare "0". Upserts, so it's safe to run twice and never
 * clobbers real imported data (ids are stable per address).
 */
export async function seedSampleBook(): Promise<{ inserted: number; error?: string }> {
  const supabase = getServiceClient();
  if (!supabase) return { inserted: 0, error: "No database configured" };

  const rows = demoDataset().map((intel) => ({ id: intel.id, ...denormaliseIntel(intel) }));
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await supabase.from("properties").upsert(chunk);
    if (error) return { inserted, error: error.message };
    inserted += chunk.length;
  }
  return { inserted };
}

export async function loadIntel(id: string): Promise<PropertyIntel | null> {
  // "/a/demo" and friends: a rich sample property that always exists.
  if (id === "demo") {
    const sample = demoDataset();
    return sample.find((p) => p.audit && p.planning.loftConversion) ?? sample[0] ?? null;
  }
  const supabase = getServiceClient();
  if (!supabase) return demoDataset().find((p) => p.id === id) ?? null;
  const { data } = await supabase.from("properties").select("intel").eq("id", id).single();
  return (data?.intel as PropertyIntel) ?? null;
}

/** Known addresses for a postcode, for the funnel's address picker. */
export async function addressesForPostcode(
  postcode: string,
): Promise<{ id: string; line1: string }[]> {
  const clean = postcode.toUpperCase().replace(/\s+/g, "");
  const supabase = getServiceClient();
  if (!supabase) {
    return demoDataset()
      .filter((p) => p.address.postcode.replace(/\s+/g, "") === clean)
      .map((p) => ({ id: p.id, line1: p.address.line1 }))
      .sort((a, b) => a.line1.localeCompare(b.line1, "en", { numeric: true }));
  }
  const spaced = clean.length > 3 ? `${clean.slice(0, -3)} ${clean.slice(-3)}` : clean;
  const { data } = await supabase
    .from("properties")
    .select("id, address_line")
    .in("postcode", [clean, spaced])
    .order("address_line")
    .limit(60);
  return (data ?? []).map((r) => ({ id: r.id, line1: r.address_line }));
}

/* ------------------------------------------------------------------ */
/* Analytics queries                                                   */
/* ------------------------------------------------------------------ */

export interface IntelFilters {
  outcode?: string;
  band?: string;
  archetypeId?: string;
  leadStatus?: string;
  planningRisk?: string;
  auditedOnly?: boolean;
}

export interface IntelRow {
  id: string;
  address_line: string;
  postcode: string;
  outcode: string;
  archetype_id: string | null;
  archetype_confidence: number;
  planning_risk: string;
  has_loft_conversion: boolean;
  epc_rating: string | null;
  floor_area_m2: number | null;
  audited: boolean;
  priority_score: number;
  priority_band: string;
  lead_status: string;
  campaign: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFilters(query: any, f: IntelFilters): any {
  if (f.outcode) query = query.eq("outcode", f.outcode);
  if (f.band) query = query.eq("priority_band", f.band);
  if (f.archetypeId) query = query.eq("archetype_id", f.archetypeId);
  if (f.leadStatus) query = query.eq("lead_status", f.leadStatus);
  if (f.planningRisk) query = query.eq("planning_risk", f.planningRisk);
  if (f.auditedOnly) query = query.eq("audited", true);
  return query;
}

function rowFromIntel(intel: PropertyIntel): IntelRow {
  const d = denormaliseIntel(intel);
  return {
    id: intel.id,
    address_line: d.address_line,
    postcode: d.postcode,
    outcode: d.outcode,
    archetype_id: d.archetype_id,
    archetype_confidence: d.archetype_confidence,
    planning_risk: d.planning_risk,
    has_loft_conversion: d.has_loft_conversion,
    epc_rating: d.epc_rating,
    floor_area_m2: d.floor_area_m2,
    audited: d.audited,
    priority_score: d.priority_score,
    priority_band: d.priority_band,
    lead_status: d.lead_status,
    campaign: d.campaign,
  };
}

function matchesFilters(row: IntelRow, f: IntelFilters): boolean {
  if (f.outcode && row.outcode !== f.outcode) return false;
  if (f.band && row.priority_band !== f.band) return false;
  if (f.archetypeId && row.archetype_id !== f.archetypeId) return false;
  if (f.leadStatus && row.lead_status !== f.leadStatus) return false;
  if (f.planningRisk && row.planning_risk !== f.planningRisk) return false;
  if (f.auditedOnly && !row.audited) return false;
  return true;
}

/** Filtered rows for the analytics table and mailing export. */
export async function queryIntel(f: IntelFilters, limit = 5000): Promise<IntelRow[]> {
  const supabase = getServiceClient();
  if (!supabase) {
    return demoDataset()
      .map(rowFromIntel)
      .filter((r) => matchesFilters(r, f))
      .sort((a, b) => b.priority_score - a.priority_score)
      .slice(0, limit);
  }
  const { data, error } = await applyFilters(
    supabase
      .from("properties")
      .select(
        "id, address_line, postcode, outcode, archetype_id, archetype_confidence, planning_risk, has_loft_conversion, epc_rating, floor_area_m2, audited, priority_score, priority_band, lead_status, campaign",
      ),
    f,
  )
    .order("priority_score", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("intel query failed:", error.message);
    return [];
  }
  return (data ?? []) as IntelRow[];
}

/** Mark a filtered set as part of a campaign (mailing sent). */
export async function tagCampaign(
  ids: string[],
  campaign: string,
  leadStatus: string,
): Promise<number> {
  const supabase = getServiceClient();
  if (!supabase) return ids.length; // demo: pretend, nothing persists
  let updated = 0;
  // Update the snapshot too, chunked to keep payloads sane.
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data } = await supabase.from("properties").select("id, intel").in("id", chunk);
    for (const row of data ?? []) {
      const intel = row.intel as PropertyIntel;
      intel.marketing.campaign = campaign;
      intel.marketing.leadStatus = leadStatus as PropertyIntel["marketing"]["leadStatus"];
      intel.marketing.lastContactAt = new Date().toISOString();
      if (await saveIntel(supabase, intel)) updated++;
    }
  }
  return updated;
}

/* ------------------------------------------------------------------ */
/* Demo dataset: SW16 + SW17 without a database                        */
/* ------------------------------------------------------------------ */

/** Tiny seeded PRNG so the demo dataset is identical on every render. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEMO_STREETS: { name: string; outcode: "SW16" | "SW17"; kind: "victorian" | "thirties" | "mixed" }[] = [
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

let demoCache: PropertyIntel[] | null = null;

/** ~240 believable SW16/SW17 properties. Deterministic: same every time. */
export function demoDataset(): PropertyIntel[] {
  if (demoCache) return demoCache;
  const rand = mulberry32(161717);
  const list: PropertyIntel[] = [];

  DEMO_STREETS.forEach((street, streetIdx) => {
    const unit = `${street.outcode} ${streetIdx % 2 === 0 ? 1 : 2}${"ABCDEFGHJ"[streetIdx % 9]}${"ABCDEFGHJ"[(streetIdx + 3) % 9]}`;
    for (let house = 1; house <= 24; house++) {
      const r = rand();
      const victorian = street.kind === "victorian" || (street.kind === "mixed" && r < 0.5);
      const isFlat = r > 0.88;
      const endTerrace = house % 12 === 1;
      const line1 = `${house} ${street.name}`;
      const postcode = unit;
      const floorArea = Math.round(
        (victorian ? 95 : 88) + rand() * (victorian ? 55 : 40) - (isFlat ? 35 : 0),
      );
      const habitable = Math.max(3, Math.round(floorArea / 22));
      const loft = !isFlat && rand() < (victorian ? 0.3 : 0.18);
      const rear = !isFlat && rand() < 0.25;
      const conservation = street.kind === "victorian" && streetIdx % 3 === 0;

      const intel: PropertyIntel = {
        id: syntheticId(line1, postcode),
        uprn: `1000${(streetIdx + 1) * 10000 + house * 17}`,
        address: { line1, postcode, outcode: outcodeOf(postcode) },
        epc: {
          propertyType: isFlat ? "Flat" : "House",
          builtForm: isFlat
            ? "Mid-Terrace"
            : victorian
              ? endTerrace
                ? "End-Terrace"
                : "Mid-Terrace"
              : "Semi-Detached",
          constructionAgeBand: victorian
            ? "England and Wales: 1900-1929"
            : "England and Wales: 1930-1949",
          totalFloorAreaM2: Math.max(45, floorArea),
          habitableRooms: habitable,
          wallDescription: victorian ? "Solid brick, as built" : "Cavity wall, as built",
          glazingDescription: rand() < 0.8 ? "Fully double glazed" : "Partial double glazing",
          mainHeatDescription: "Boiler and radiators, mains gas",
          currentRating: "DECDBE"[Math.floor(rand() * 6)] ?? "D",
          potentialRating: "C",
          lodgedAt: "2023-05-14",
        },
        planning: {
          loftConversion: loft,
          rearExtension: rear,
          sideExtension: false,
          garageConversion: false,
          applicationCount: loft || rear ? 2 : 0,
        },
        constraints: {
          conservationArea: conservation,
          listedBuilding: conservation && house === 1,
          article4: false,
        },
        marketing: emptyMarketing(),
      };

      // A slice of the book is already audited: our proprietary layer.
      if (house % 8 === 3) {
        const cls = classifyProperty(intel);
        intel.audit = {
          archetypeId: cls.archetypeId,
          difficulty: loft ? "complex" : "standard",
          condenserPosition: "Rear wall, ground level, east of the kitchen door",
          pipeRoute: victorian
            ? "Rear riser beside the soil stack, boxed at first floor"
            : "Side passage riser, direct through-wall to bedrooms",
          electricalNotes: "Modern board in hallway, spare way confirmed from Street View porch photo",
          notes: "Classic street pattern, matches template",
          confidence: 88,
          auditedAt: "2026-06-20T10:00:00.000Z",
          auditor: "MH",
        };
      }
      list.push(intel);
    }
  });

  demoCache = list;
  return list;
}
