import {
  emptyConstraints,
  emptyMarketing,
  emptyPlanning,
  normaliseAddress,
  outcodeOf,
  syntheticId,
  type PropertyIntel,
} from "./intelligence.ts";

/**
 * Live property lookups: the open-data services a postcode is run through
 * when the property book doesn't know it yet, and the parsing that turns
 * their answers into a PropertyIntel record.
 *
 *  1. EPC register (MHCLG "Get energy performance of buildings data", the
 *     service that replaced epc.opendatacommunities.org on 30 May 2026).
 *     A postcode search lists every certificate at the postcode (address,
 *     UPRN, rating, date); the certificate itself carries the property type,
 *     built form, age band, floor area, rooms, walls and glazing.
 *  2. postcodes.io: the postcode's centre point and council.
 *  3. planning.data.gov.uk: conservation areas, Article 4 directions and
 *     listed-building outlines at that point.
 *
 * Pure: URLs are built and answers parsed here, the fetching lives in the
 * web app (apps/web/lib/property-lookup.ts). Every parser takes `unknown`
 * and never throws: an answer it doesn't recognise parses to nothing.
 */

export const EPC_API_BASE = "https://api.get-energy-performance-data.communities.gov.uk";
export const POSTCODES_IO_BASE = "https://api.postcodes.io";
export const PLANNING_DATA_BASE = "https://www.planning.data.gov.uk";

/** Planning datasets that restrict where an outdoor unit can go. */
export const CONSTRAINT_DATASETS = ["conservation-area", "article-4-direction-area", "listed-building-outline"] as const;

/* ------------------------------------------------------------------ */
/* Small normalisers                                                   */
/* ------------------------------------------------------------------ */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const keyOf = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");

/** A field by any of its spellings (camelCase, snake_case, kebab-case, UPPER). */
function pick(obj: Record<string, unknown>, ...names: string[]): unknown {
  const wanted = new Set(names.map(keyOf));
  for (const [k, v] of Object.entries(obj)) {
    if (wanted.has(keyOf(k)) && v !== null && v !== undefined && v !== "") return v;
  }
  return undefined;
}

/** A coded EPC value ({ value, description }) or a plain one, as text. */
function text(v: unknown): string | undefined {
  if (isObj(v)) return text(v.description ?? v.value);
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

function num(v: unknown): number | undefined {
  const t = text(v);
  if (t === undefined) return undefined;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** "22/02/2021", "2021-02-22" or "2021-02-22T…" → "2021-02-22". */
export function normaliseEpcDate(raw: unknown): string | undefined {
  const t = text(raw);
  if (!t) return undefined;
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const uk = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (uk) return `${uk[3]}-${uk[2]!.padStart(2, "0")}-${uk[1]!.padStart(2, "0")}`;
  return undefined;
}

/** "UPRN-000100023336956" or 100023336956 → "100023336956". Placeholders (all zeros) → undefined. */
export function normaliseUprn(raw: unknown): string | undefined {
  const t = text(raw);
  if (!t) return undefined;
  const digits = t.replace(/^UPRN-/i, "").replace(/\D/g, "").replace(/^0+/, "");
  return digits.length >= 3 && digits.length <= 14 ? digits : undefined;
}

/** "e" → "E"; anything that isn't a band → undefined. */
export function normaliseRating(raw: unknown): string | undefined {
  const t = text(raw)?.toUpperCase();
  return t && /^[A-G]$/.test(t) ? t : undefined;
}

/** "sw161ad" → "SW16 1AD". */
export function formatPostcode(raw: string): string {
  const clean = raw.toUpperCase().replace(/\s+/g, "");
  return clean.length > 3 ? `${clean.slice(0, -3)} ${clean.slice(-3)}` : clean;
}

/**
 * The address line the property book keys on: the first two address lines
 * joined, the same rule the bulk importer uses ("Flat 2, 12 Some Road"), so
 * a live lookup and a later import land on the same record.
 */
export function addressLineFrom(...parts: unknown[]): string {
  return parts
    .map((p) => text(p)?.replace(/\s+/g, " "))
    .filter((p): p is string => Boolean(p))
    .slice(0, 2)
    .join(", ");
}

/* ------------------------------------------------------------------ */
/* EPC coded values (RdSAP), for certificates that carry codes only    */
/* ------------------------------------------------------------------ */

const PROPERTY_TYPE_CODE: Record<string, string> = { "0": "House", "1": "Bungalow", "2": "Flat", "3": "Maisonette", "4": "Park home" };
const BUILT_FORM_CODE: Record<string, string> = {
  "1": "Detached",
  "2": "Semi-Detached",
  "3": "End-Terrace",
  "4": "Mid-Terrace",
  "5": "Enclosed End-Terrace",
  "6": "Enclosed Mid-Terrace",
};
/** RdSAP construction age band letters (England and Wales). */
const AGE_BAND_LETTER: Record<string, string> = {
  A: "England and Wales: before 1900",
  B: "England and Wales: 1900-1929",
  C: "England and Wales: 1930-1949",
  D: "England and Wales: 1950-1966",
  E: "England and Wales: 1967-1975",
  F: "England and Wales: 1976-1982",
  G: "England and Wales: 1983-1990",
  H: "England and Wales: 1991-1995",
  I: "England and Wales: 1996-2002",
  J: "England and Wales: 2003-2006",
  K: "England and Wales: 2007-2011",
  L: "England and Wales: 2012-2022",
  M: "England and Wales: 2023 onwards",
};

/** A coded field: its description when the certificate has one, else the code looked up. */
function coded(v: unknown, table: Record<string, string>): string | undefined {
  if (isObj(v) && typeof v.description === "string" && v.description.trim()) return v.description.trim();
  const t = text(v);
  if (t === undefined) return undefined;
  return table[t.toUpperCase()] ?? (/^\d+$/.test(t) || /^[A-M]$/i.test(t) ? undefined : t);
}

/* ------------------------------------------------------------------ */
/* 1. EPC: postcode search                                             */
/* ------------------------------------------------------------------ */

export interface EpcSearchHit {
  certificateNumber: string;
  line1: string;
  postcode: string;
  uprn?: string;
  registeredAt?: string;
  band?: string;
}

/** Every domestic certificate at a postcode, one page (a postcode never has 500). */
export function epcSearchUrl(postcode: string, base = EPC_API_BASE): string {
  const u = new URL("/api/domestic/search", base);
  u.searchParams.set("postcode", formatPostcode(postcode));
  u.searchParams.set("page_size", "500");
  return u.toString();
}

/**
 * The search answer, { data: [...], pagination }. Also reads the retired
 * API's { rows: [...] } shape, so old fixtures and caches still parse.
 */
export function parseEpcSearch(json: unknown): EpcSearchHit[] {
  const rows = isObj(json) ? (Array.isArray(json.data) ? json.data : Array.isArray(json.rows) ? json.rows : []) : [];
  const hits: EpcSearchHit[] = [];
  for (const row of rows) {
    if (!isObj(row)) continue;
    const certificateNumber = text(pick(row, "certificateNumber", "lmk-key", "assessment_id"));
    const line1 = addressLineFrom(pick(row, "addressLine1", "address1"), pick(row, "addressLine2", "address2"));
    const postcode = text(pick(row, "postcode"));
    if (!certificateNumber || !line1 || !postcode) continue;
    hits.push({
      certificateNumber,
      line1,
      postcode: formatPostcode(postcode),
      uprn: normaliseUprn(pick(row, "uprn")),
      registeredAt: normaliseEpcDate(pick(row, "registrationDate", "lodgement-date", "lodgementDate")),
      band: normaliseRating(pick(row, "currentEnergyEfficiencyBand", "current-energy-rating")),
    });
  }
  return hits;
}

const addressKey = (line1: string, postcode: string) => `${normaliseAddress(line1)} ${postcode.toUpperCase().replace(/\s+/g, "")}`;

/** One hit per home: the newest certificate wins (a re-assessment replaces the old one). */
export function latestHitPerAddress(hits: EpcSearchHit[]): EpcSearchHit[] {
  const byKey = new Map<string, EpcSearchHit>();
  for (const hit of hits) {
    const k = hit.uprn ? `uprn:${hit.uprn}` : addressKey(hit.line1, hit.postcode);
    const prev = byKey.get(k);
    if (!prev || (hit.registeredAt ?? "") > (prev.registeredAt ?? "")) byKey.set(k, hit);
  }
  return [...byKey.values()].sort((a, b) => a.line1.localeCompare(b.line1, "en", { numeric: true }));
}

/** A new record from a search hit: address, UPRN, rating and the certificate to fetch next. */
export function intelFromSearchHit(hit: EpcSearchHit, nowIso: string): PropertyIntel {
  return {
    id: hit.uprn ?? syntheticId(hit.line1, hit.postcode),
    ...(hit.uprn ? { uprn: hit.uprn } : {}),
    address: { line1: hit.line1, postcode: hit.postcode, outcode: outcodeOf(hit.postcode) },
    epc: {
      certificateNumber: hit.certificateNumber,
      ...(hit.band ? { currentRating: hit.band } : {}),
      ...(hit.registeredAt ? { lodgedAt: hit.registeredAt } : {}),
    },
    sources: { epc: { via: "live", detail: "summary", fetchedAt: nowIso } },
    planning: emptyPlanning(),
    constraints: emptyConstraints(),
    marketing: emptyMarketing(),
  };
}

/* ------------------------------------------------------------------ */
/* 1b. EPC: the certificate                                            */
/* ------------------------------------------------------------------ */

export function epcCertificateUrl(certificateNumber: string, base = EPC_API_BASE): string {
  const u = new URL("/api/certificate", base);
  u.searchParams.set("certificate_number", certificateNumber);
  return u.toString();
}

/** The certificate's "property_summary" rows ({ name: "wall", description }), by name. */
function summaryRow(doc: Record<string, unknown>, name: string): string | undefined {
  const rows = pick(doc, "property_summary", "propertySummary");
  if (!Array.isArray(rows)) return undefined;
  for (const r of rows) {
    if (isObj(r) && typeof r.name === "string" && r.name.toLowerCase() === name) return text(r.description);
  }
  return undefined;
}

function firstOf(v: unknown): string | undefined {
  if (Array.isArray(v)) return v.map((x) => text(x)).filter(Boolean).join(", ") || undefined;
  return text(v);
}

/**
 * The physical profile from one certificate. Reads the new service's JSON
 * ({ data: { property_type: { description }, built_form, … } }), plain rows
 * from the bulk CSV (PROPERTY_TYPE, BUILT_FORM, …) and the retired API's
 * kebab-case rows. undefined when it isn't a domestic certificate.
 */
export function epcFromCertificate(json: unknown): NonNullable<PropertyIntel["epc"]> | undefined {
  const doc = isObj(json) && isObj(json.data) ? json.data : json;
  if (!isObj(doc)) return undefined;

  const ageRaw = pick(doc, "construction_age_band", "property_age_band");
  let constructionAgeBand = coded(ageRaw, AGE_BAND_LETTER);
  if (!constructionAgeBand && isObj(ageRaw)) constructionAgeBand = coded(ageRaw.value, AGE_BAND_LETTER);

  const epc: NonNullable<PropertyIntel["epc"]> = {
    propertyType: coded(pick(doc, "property_type"), PROPERTY_TYPE_CODE),
    builtForm: coded(pick(doc, "built_form"), BUILT_FORM_CODE),
    constructionAgeBand,
    totalFloorAreaM2: num(pick(doc, "total_floor_area")),
    habitableRooms: num(pick(doc, "habitable_room_count", "number_habitable_rooms")),
    wallDescription: summaryRow(doc, "wall") ?? text(pick(doc, "walls_description")),
    roofDescription: summaryRow(doc, "roof") ?? text(pick(doc, "roof_description")),
    glazingDescription: text(pick(doc, "window_description", "windows_description")) ?? summaryRow(doc, "window"),
    mainHeatDescription: firstOf(pick(doc, "main_heating_descriptions", "mainheat_description")) ?? summaryRow(doc, "main_heating"),
    hotWaterDescription: text(pick(doc, "hot_water_description", "hotwater_description")),
    currentRating: normaliseRating(pick(doc, "current_energy_efficiency_band", "current_energy_rating")),
    potentialRating: normaliseRating(pick(doc, "potential_energy_efficiency_band", "potential_energy_rating")),
    lodgedAt: normaliseEpcDate(pick(doc, "date_of_registration", "lodgement_date", "registration_date", "inspection_date")),
    certificateNumber: text(pick(doc, "assessment_id", "certificate_number", "lmk-key")),
  };
  // Drop the gaps, so a merge never overwrites a known value with nothing.
  for (const k of Object.keys(epc) as (keyof typeof epc)[]) if (epc[k] === undefined) delete epc[k];
  return epc.propertyType || epc.builtForm || epc.totalFloorAreaM2 ? epc : undefined;
}

/* ------------------------------------------------------------------ */
/* 2. postcodes.io                                                     */
/* ------------------------------------------------------------------ */

export function postcodeLookupUrl(postcode: string, base = POSTCODES_IO_BASE): string {
  return new URL(`/postcodes/${encodeURIComponent(postcode.replace(/\s+/g, "").toUpperCase())}`, base).toString();
}

export interface PostcodePoint {
  latitude: number;
  longitude: number;
  district?: string;
}

export function parsePostcodeLookup(json: unknown): PostcodePoint | undefined {
  const r = isObj(json) && isObj(json.result) ? json.result : undefined;
  if (!r) return undefined;
  const latitude = typeof r.latitude === "number" ? r.latitude : NaN;
  const longitude = typeof r.longitude === "number" ? r.longitude : NaN;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
  return { latitude, longitude, ...(typeof r.admin_district === "string" ? { district: r.admin_district } : {}) };
}

/* ------------------------------------------------------------------ */
/* 3. planning.data.gov.uk                                             */
/* ------------------------------------------------------------------ */

/** Constraint areas that contain a point (the postcode's centre). */
export function planningConstraintsUrl(point: PostcodePoint, base = PLANNING_DATA_BASE): string {
  const u = new URL("/entity.json", base);
  u.searchParams.set("latitude", point.latitude.toFixed(6));
  u.searchParams.set("longitude", point.longitude.toFixed(6));
  for (const d of CONSTRAINT_DATASETS) u.searchParams.append("dataset", d);
  u.searchParams.set("exclude_field", "geometry");
  u.searchParams.set("limit", "50");
  return u.toString();
}

export interface ConstraintFinding {
  constraints: PropertyIntel["constraints"];
  /** What was found, for the office: "Conservation area: Streatham Hill". */
  names: string[];
}

/** The entity search answer, { entities: [{ dataset, name, reference }], count }. */
export function parsePlanningConstraints(json: unknown): ConstraintFinding | undefined {
  if (!isObj(json) || !Array.isArray(json.entities)) return undefined;
  return findingFromEntities(json.entities);
}

/** Constraint entities ({ dataset, name, reference }) as flags and names. */
export function findingFromEntities(entities: unknown[]): ConstraintFinding {
  const constraints = emptyConstraints();
  const names: string[] = [];
  for (const e of entities) {
    if (!isObj(e)) continue;
    const dataset = typeof e.dataset === "string" ? e.dataset : "";
    const name = text(e.name) ?? text(e.reference) ?? "unnamed";
    if (dataset === "conservation-area") {
      constraints.conservationArea = true;
      names.push(`Conservation area: ${name}`);
    } else if (dataset === "article-4-direction-area") {
      constraints.article4 = true;
      names.push(`Article 4 direction: ${name}`);
    } else if (dataset === "listed-building-outline" || dataset === "listed-building") {
      constraints.listedBuilding = true;
      names.push(`Listed building nearby: ${name}`);
    }
  }
  return { constraints, names: [...new Set(names)] };
}

/* ------------------------------------------------------------------ */
/* Bulk: many postcodes at once (the importer's enrichment step)       */
/* ------------------------------------------------------------------ */

/** postcodes.io takes up to 100 postcodes per POST /postcodes. */
export const POSTCODES_BULK_MAX = 100;

export function postcodesBulkRequest(postcodes: string[], base = POSTCODES_IO_BASE): { url: string; body: string } {
  return {
    url: new URL("/postcodes", base).toString(),
    body: JSON.stringify({ postcodes: postcodes.slice(0, POSTCODES_BULK_MAX).map(formatPostcode) }),
  };
}

/** { result: [{ query, result: { latitude, longitude, admin_district } | null }] } → formatted postcode → point. */
export function parsePostcodesBulk(json: unknown): Map<string, PostcodePoint> {
  const out = new Map<string, PostcodePoint>();
  if (!isObj(json) || !Array.isArray(json.result)) return out;
  for (const r of json.result) {
    if (!isObj(r) || typeof r.query !== "string") continue;
    const point = parsePostcodeLookup({ result: r.result });
    if (point) out.set(formatPostcode(r.query), point);
  }
  return out;
}

/** [west, south, east, north] around some points, padded (degrees) so edge postcodes' areas are caught. */
export type BBox = [number, number, number, number];

export function boundingBox(points: PostcodePoint[], padDeg = 0.005): BBox | undefined {
  if (points.length === 0) return undefined;
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const p of points) {
    w = Math.min(w, p.longitude);
    e = Math.max(e, p.longitude);
    s = Math.min(s, p.latitude);
    n = Math.max(n, p.latitude);
  }
  return [w - padDeg, s - padDeg, e + padDeg, n + padDeg];
}

/** Every constraint area intersecting a box, with its shape, a page (≤500) at a time. */
export function planningAreasUrl(bbox: BBox, offset = 0, base = PLANNING_DATA_BASE): string {
  const [w, s, e, n] = bbox.map((v) => v.toFixed(6));
  const u = new URL("/entity.geojson", base);
  for (const d of CONSTRAINT_DATASETS) u.searchParams.append("dataset", d);
  u.searchParams.set("geometry", `POLYGON((${w} ${s},${e} ${s},${e} ${n},${w} ${n},${w} ${s}))`);
  u.searchParams.set("geometry_relation", "intersects");
  u.searchParams.set("limit", "500");
  u.searchParams.set("offset", String(offset));
  return u.toString();
}

type Ring = [number, number][];
export interface PlanningArea {
  entity: string;
  dataset: string;
  name: string;
  /** Polygons, each an outer ring then holes, [lng, lat]. */
  polygons: Ring[][];
}

/** A FeatureCollection of constraint areas. Features without a Polygon/MultiPolygon are skipped. */
export function parsePlanningAreas(json: unknown): PlanningArea[] {
  if (!isObj(json) || !Array.isArray(json.features)) return [];
  const out: PlanningArea[] = [];
  for (const f of json.features) {
    if (!isObj(f) || !isObj(f.geometry) || !isObj(f.properties)) continue;
    const g = f.geometry as { type?: unknown; coordinates?: unknown };
    const polygons =
      g.type === "Polygon" ? [g.coordinates as Ring[]] : g.type === "MultiPolygon" ? (g.coordinates as Ring[][]) : null;
    if (!Array.isArray(polygons)) continue;
    const p = f.properties;
    out.push({
      entity: String(p.entity ?? p.reference ?? out.length),
      dataset: typeof p.dataset === "string" ? p.dataset : "",
      name: text(p.name) ?? text(p.reference) ?? "unnamed",
      polygons,
    });
  }
  return out;
}

function inRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Is the point inside the area (inside an outer ring and outside its holes)? */
export function pointInArea(point: PostcodePoint, area: PlanningArea): boolean {
  const x = point.longitude;
  const y = point.latitude;
  return area.polygons.some((rings) => Array.isArray(rings) && rings.length > 0 && inRing(x, y, rings[0]!) && !rings.slice(1).some((h) => inRing(x, y, h)));
}

/** The same finding the live per-home check gives, from areas fetched once for a whole district. */
export function constraintsAtPoint(areas: PlanningArea[], point: PostcodePoint): ConstraintFinding {
  return findingFromEntities(areas.filter((a) => pointInArea(point, a)).map((a) => ({ dataset: a.dataset, name: a.name })));
}

/* ------------------------------------------------------------------ */
/* Putting it together                                                 */
/* ------------------------------------------------------------------ */

export interface LookupNeeds {
  /** The certificate's detail (type, age, size) hasn't been fetched yet. */
  epcDetail: boolean;
  geo: boolean;
  constraints: boolean;
  any: boolean;
}

/**
 * What a record still lacks. Imported records (no `sources`) that already
 * carry a full EPC profile only need the constraint check.
 */
export function lookupNeeds(intel: PropertyIntel): LookupNeeds {
  const hasProfile = Boolean(intel.epc?.propertyType || intel.epc?.builtForm);
  const epcDetail = !hasProfile && Boolean(intel.epc?.certificateNumber);
  const geo = !intel.sources?.geo;
  const constraints = !intel.sources?.constraints;
  return { epcDetail, geo, constraints, any: epcDetail || geo || constraints };
}

/** A fetched certificate onto a record: fresh values win, gaps keep what was known. */
export function withCertificate(intel: PropertyIntel, epc: NonNullable<PropertyIntel["epc"]>, nowIso: string): PropertyIntel {
  return {
    ...intel,
    epc: { ...(intel.epc ?? {}), ...epc },
    sources: { ...intel.sources, epc: { via: "live", detail: "full", fetchedAt: nowIso } },
  };
}

export function withPoint(intel: PropertyIntel, point: PostcodePoint, nowIso: string): PropertyIntel {
  return { ...intel, sources: { ...intel.sources, geo: { ...point, fetchedAt: nowIso } } };
}

/** Constraints only ever add: an import that flagged a conservation area isn't undone by a miss at the postcode centre. */
export function withConstraints(intel: PropertyIntel, found: ConstraintFinding, nowIso: string): PropertyIntel {
  return {
    ...intel,
    constraints: {
      conservationArea: intel.constraints.conservationArea || found.constraints.conservationArea,
      listedBuilding: intel.constraints.listedBuilding || found.constraints.listedBuilding,
      article4: intel.constraints.article4 || found.constraints.article4,
    },
    sources: { ...intel.sources, constraints: { via: "planning-data", names: found.names, checkedAt: nowIso } },
  };
}

/**
 * A looked-up record onto what the book already holds for the same home.
 * The existing id, planning history, audit and marketing state always
 * survive; a newer certificate replaces an older one's summary.
 */
export function mergeLookedUp(existing: PropertyIntel | undefined, fresh: PropertyIntel): PropertyIntel {
  if (!existing) return fresh;
  const sameCert = existing.epc?.certificateNumber && existing.epc.certificateNumber === fresh.epc?.certificateNumber;
  const freshIsNewer = (fresh.epc?.lodgedAt ?? "") > (existing.epc?.lodgedAt ?? "");
  const keepExisting = Boolean(sameCert) || !freshIsNewer;
  const epc = keepExisting ? { ...(fresh.epc ?? {}), ...(existing.epc ?? {}) } : { ...(fresh.epc ?? {}) };
  const existingHasProfile = Boolean(existing.epc?.propertyType || existing.epc?.builtForm);
  // An imported record with a full profile has no epc source and needs none.
  const epcSource = keepExisting ? (existing.sources?.epc ?? (existingHasProfile ? undefined : fresh.sources?.epc)) : fresh.sources?.epc;
  const sources: NonNullable<PropertyIntel["sources"]> = { ...existing.sources };
  if (epcSource) sources.epc = epcSource;
  else delete sources.epc;
  return {
    ...existing,
    ...(existing.uprn ?? fresh.uprn ? { uprn: existing.uprn ?? fresh.uprn } : {}),
    epc,
    ...(Object.keys(sources).length ? { sources } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Bulk: one row of the EPC register's CSV files                       */
/* ------------------------------------------------------------------ */

export interface EpcBulkRow {
  /** UPRN when the row has one, else the normalised address and postcode: one home. */
  key: string;
  line1: string;
  postcode: string;
  uprn?: string;
  lodgedAt: string;
  epc: NonNullable<PropertyIntel["epc"]>;
}

/**
 * A row of the bulk domestic CSV (the national file, a council download
 * from the website, or the retired service's files) as one home's
 * certificate. undefined for a row with no address or postcode.
 */
export function epcBulkRow(row: Record<string, string>): EpcBulkRow | undefined {
  const postcodeRaw = text(pick(row, "POSTCODE"));
  const line1 = addressLineFrom(pick(row, "ADDRESS1"), pick(row, "ADDRESS2")) || text(pick(row, "ADDRESS")) || "";
  if (!postcodeRaw || !line1) return undefined;
  const postcode = formatPostcode(postcodeRaw);
  const uprn = normaliseUprn(pick(row, "UPRN"));
  const epc = epcFromCertificate(row) ?? {};
  const lodgedAt = normaliseEpcDate(pick(row, "LODGEMENT_DATE", "INSPECTION_DATE")) ?? "";
  return { key: uprn ? `uprn:${uprn}` : addressKey(line1, postcode), line1, postcode, ...(uprn ? { uprn } : {}), lodgedAt, epc };
}
