import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PLANNING_DATA_BASE,
  POSTCODES_BULK_MAX,
  POSTCODES_IO_BASE,
  boundingBox,
  constraintsAtPoint,
  formatPostcode,
  lookupNeeds,
  parsePlanningAreas,
  parsePostcodesBulk,
  planningAreasUrl,
  postcodesBulkRequest,
  propertyRow,
  withConstraints,
  withPoint,
  type PlanningArea,
  type PostcodePoint,
  type PropertyIntel,
} from "@aircon/domain";

/**
 * Bulk enrichment, for after a borough-sized EPC import: every home's
 * postcode centre and planning constraints, fetched per postcode and per
 * district rather than per home.
 *
 *  * postcodes.io takes 100 postcodes a request.
 *  * planning.data.gov.uk is asked once per outcode for every conservation
 *    area, Article 4 direction and listed-building outline touching it
 *    (with their shapes); each postcode is then matched locally.
 *
 * A 20,000-home district is a few hundred requests, not 40,000. Records are
 * saved with their flat columns recomputed, so no separate recompute is
 * needed. Imported only by node scripts and tests: relative imports carry
 * their .ts extension so `node --experimental-strip-types` can load it.
 */

export interface BulkDeps {
  fetcher?: typeof fetch;
  now?: () => Date;
  postcodesBase?: string;
  planningBase?: string;
  log?: (line: string) => void;
}

export interface EnrichOptions {
  /** Only these outcodes; all when empty. */
  outcodes?: string[];
  /** Re-check homes that already have a point and constraints. */
  recheck?: boolean;
}

export interface EnrichReport {
  scanned: number;
  needed: number;
  located: number;
  checked: number;
  saved: number;
  postcodesNotFound: string[];
  outcodesWithoutConstraints: string[];
}

const PAGE = 1000;
const SAVE_CHUNK = 500;

async function json(fetcher: typeof fetch, url: string, init?: RequestInit): Promise<unknown | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetcher(url, { ...init, headers: { Accept: "application/json", ...(init?.headers ?? {}) } });
      if (res.ok) return await res.json();
      if (res.status < 500 && res.status !== 429) return null;
    } catch {
      // network: try again
    }
    await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
  }
  return null;
}

/** Every record in scope, a page at a time (Supabase returns at most 1000 rows per select). */
async function loadBook(db: SupabaseClient, outcodes: string[]): Promise<PropertyIntel[]> {
  const out: PropertyIntel[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db.from("properties").select("id, intel").order("id").range(from, from + PAGE - 1);
    if (outcodes.length) q = q.in("outcode", outcodes);
    const { data, error } = await q;
    if (error) throw new Error(`properties read failed: ${error.message}`);
    for (const row of (data ?? []) as { intel: PropertyIntel }[]) out.push(row.intel);
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export async function locatePostcodes(postcodes: string[], deps: BulkDeps = {}): Promise<Map<string, PostcodePoint>> {
  const fetcher = deps.fetcher ?? fetch;
  const points = new Map<string, PostcodePoint>();
  for (let i = 0; i < postcodes.length; i += POSTCODES_BULK_MAX) {
    const { url, body } = postcodesBulkRequest(postcodes.slice(i, i + POSTCODES_BULK_MAX), deps.postcodesBase ?? POSTCODES_IO_BASE);
    const answer = await json(fetcher, url, { method: "POST", body, headers: { "content-type": "application/json" } });
    for (const [pc, point] of parsePostcodesBulk(answer)) points.set(pc, point);
    deps.log?.(`postcodes located: ${points.size}/${postcodes.length}`);
  }
  return points;
}

/** Every constraint area touching the points' box, all pages. null when the service didn't answer. */
export async function areasAround(points: PostcodePoint[], deps: BulkDeps = {}): Promise<PlanningArea[] | null> {
  const box = boundingBox(points);
  if (!box) return [];
  const fetcher = deps.fetcher ?? fetch;
  const areas = new Map<string, PlanningArea>();
  for (let offset = 0; offset < 20_000; offset += 500) {
    const answer = await json(fetcher, planningAreasUrl(box, offset, deps.planningBase ?? PLANNING_DATA_BASE));
    if (answer === null) return offset === 0 ? null : [...areas.values()];
    const page = parsePlanningAreas(answer);
    for (const a of page) areas.set(a.entity, a);
    const features = (answer as { features?: unknown[] }).features?.length ?? 0;
    if (features < 500) break;
  }
  return [...areas.values()];
}

export async function enrichBook(db: SupabaseClient, opts: EnrichOptions = {}, deps: BulkDeps = {}): Promise<EnrichReport> {
  const nowIso = (deps.now ?? (() => new Date()))().toISOString();
  const outcodes = (opts.outcodes ?? []).map((o) => o.toUpperCase());
  const book = await loadBook(db, outcodes);
  const todo = book.filter((p) => {
    if (opts.recheck) return true;
    const n = lookupNeeds(p);
    return n.geo || n.constraints;
  });
  deps.log?.(`${book.length} homes in scope, ${todo.length} need a location or a planning check`);

  const postcodes = [...new Set(todo.map((p) => formatPostcode(p.address.postcode)))];
  const points = await locatePostcodes(postcodes, deps);

  // One planning query per outcode: a box around its postcodes.
  const byOutcode = new Map<string, PostcodePoint[]>();
  for (const pc of postcodes) {
    const point = points.get(pc);
    if (!point) continue;
    const oc = pc.split(" ")[0]!;
    byOutcode.set(oc, [...(byOutcode.get(oc) ?? []), point]);
  }
  const areasByOutcode = new Map<string, PlanningArea[] | null>();
  for (const [oc, pts] of byOutcode) {
    const areas = await areasAround(pts, deps);
    areasByOutcode.set(oc, areas);
    deps.log?.(`${oc}: ${areas === null ? "planning data didn't answer" : `${areas.length} constraint areas`}`);
  }

  const updated: PropertyIntel[] = [];
  let located = 0;
  let checked = 0;
  for (const home of todo) {
    const pc = formatPostcode(home.address.postcode);
    const point = points.get(pc);
    if (!point) continue;
    let next = withPoint(home, point, nowIso);
    located++;
    const areas = areasByOutcode.get(pc.split(" ")[0]!);
    if (areas) {
      next = withConstraints(next, constraintsAtPoint(areas, point), nowIso);
      checked++;
    }
    updated.push(next);
  }

  let saved = 0;
  for (let i = 0; i < updated.length; i += SAVE_CHUNK) {
    const rows = updated.slice(i, i + SAVE_CHUNK).map((p) => propertyRow(p, nowIso));
    const { error } = await db.from("properties").upsert(rows);
    if (error) throw new Error(`properties save failed: ${error.message}`);
    saved += rows.length;
    deps.log?.(`saved ${saved}/${updated.length}`);
  }

  return {
    scanned: book.length,
    needed: todo.length,
    located,
    checked,
    saved,
    postcodesNotFound: postcodes.filter((pc) => !points.has(pc)),
    outcodesWithoutConstraints: [...areasByOutcode].filter(([, a]) => a === null).map(([oc]) => oc),
  };
}
