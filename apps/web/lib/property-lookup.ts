import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EPC_API_BASE,
  epcCertificateUrl,
  epcFromCertificate,
  epcSearchUrl,
  formatPostcode,
  intelFromSearchHit,
  latestHitPerAddress,
  lookupNeeds,
  mergeLookedUp,
  normaliseAddress,
  parseEpcSearch,
  parsePlanningConstraints,
  parsePostcodeLookup,
  planningConstraintsUrl,
  postcodeLookupUrl,
  withCertificate,
  withConstraints,
  withPoint,
  type EpcSearchHit,
  type PostcodePoint,
  type PropertyIntel,
} from "@aircon/domain";
import { realEnv } from "./env-placeholders";
import { denormaliseIntel } from "./intel-server";

/**
 * Live property lookups for the quote funnel and the office's price check.
 *
 * When someone types a postcode the property book hasn't seen, the EPC
 * register is asked which homes are there (one call). When they pick their
 * home, its certificate (type, age, size, rooms), its postcode's centre and
 * the planning constraints at that point are fetched and saved on the
 * record. Every answer is stored, so each home is looked up once and the
 * book grows with every postcode anyone types.
 *
 * Everything here degrades to "nothing found": a slow or missing service
 * never blocks a quote, the customer just answers the questions themselves.
 */

/** The EPC data service's API token (get-energy-performance-data.communities.gov.uk → your account). */
export function epcBearerToken(env: Record<string, string | undefined> = process.env): string | undefined {
  return realEnv(env, "EPC_BEARER_TOKEN");
}

export function epcApiBase(env: Record<string, string | undefined> = process.env): string {
  return realEnv(env, "EPC_API_BASE") ?? EPC_API_BASE;
}

export interface LookupDeps {
  fetcher?: typeof fetch;
  token?: string;
  base?: string;
  now?: () => Date;
  /** Per request, in ms. A postcode answer has to feel instant. */
  timeoutMs?: number;
}

function resolve(deps: LookupDeps) {
  return {
    fetcher: deps.fetcher ?? fetch,
    token: "token" in deps ? deps.token : epcBearerToken(),
    base: deps.base ?? epcApiBase(),
    nowIso: (deps.now ?? (() => new Date()))().toISOString(),
    timeoutMs: deps.timeoutMs ?? 6000,
  };
}

async function getJson(
  fetcher: typeof fetch,
  url: string,
  timeoutMs: number,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: unknown } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetcher(url, { headers: { Accept: "application/json", ...headers }, signal: controller.signal, cache: "no-store" });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  } catch (err) {
    console.warn(`property lookup: ${new URL(url).host} unreachable: ${(err as Error).message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Every home with an EPC at a postcode, newest certificate each. null when the service can't be asked. */
export async function searchEpcByPostcode(postcode: string, deps: LookupDeps = {}): Promise<EpcSearchHit[] | null> {
  const { fetcher, token, base, timeoutMs } = resolve(deps);
  if (!token) return null;
  const res = await getJson(fetcher, epcSearchUrl(postcode, base), timeoutMs, { Authorization: `Bearer ${token}` });
  if (!res) return null;
  if (res.status === 401 || res.status === 403) {
    console.error("property lookup: the EPC service refused the token (EPC_BEARER_TOKEN)");
    return null;
  }
  if (res.status === 404 || res.status === 400) return [];
  if (res.status !== 200) return null;
  return latestHitPerAddress(parseEpcSearch(res.json));
}

export async function fetchEpcCertificate(certificateNumber: string, deps: LookupDeps = {}) {
  const { fetcher, token, base, timeoutMs } = resolve(deps);
  if (!token) return undefined;
  const res = await getJson(fetcher, epcCertificateUrl(certificateNumber, base), timeoutMs, { Authorization: `Bearer ${token}` });
  return res?.status === 200 ? epcFromCertificate(res.json) : undefined;
}

export async function fetchPostcodePoint(postcode: string, deps: LookupDeps = {}): Promise<PostcodePoint | undefined> {
  const { fetcher, timeoutMs } = resolve(deps);
  const res = await getJson(fetcher, postcodeLookupUrl(postcode), timeoutMs);
  return res?.status === 200 ? parsePostcodeLookup(res.json) : undefined;
}

export async function fetchConstraints(point: PostcodePoint, deps: LookupDeps = {}) {
  const { fetcher, timeoutMs } = resolve(deps);
  const res = await getJson(fetcher, planningConstraintsUrl(point), timeoutMs);
  return res?.status === 200 ? parsePlanningConstraints(res.json) : undefined;
}

/**
 * Fill in what a record still lacks (certificate detail, postcode centre,
 * constraints), each from its own service, in parallel where they don't
 * depend on each other. `changed` is false when nothing new was learned.
 */
export async function enrichIntel(intel: PropertyIntel, deps: LookupDeps = {}): Promise<{ intel: PropertyIntel; changed: boolean }> {
  const needs = lookupNeeds(intel);
  if (!needs.any) return { intel, changed: false };
  const { nowIso } = resolve(deps);
  const cert = intel.epc?.certificateNumber;

  const [epc, point] = await Promise.all([
    needs.epcDetail && cert ? fetchEpcCertificate(cert, deps) : Promise.resolve(undefined),
    needs.geo ? fetchPostcodePoint(intel.address.postcode, deps) : Promise.resolve(intel.sources?.geo),
  ]);

  let next = intel;
  if (epc) next = withCertificate(next, epc, nowIso);
  if (point && needs.geo) next = withPoint(next, point, nowIso);
  if (point && needs.constraints) {
    const found = await fetchConstraints(point, deps);
    if (found) next = withConstraints(next, found, nowIso);
  }
  return { intel: next, changed: next !== intel };
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

const addressKeyOf = (intel: PropertyIntel) => `${normaliseAddress(intel.address.line1)} ${intel.address.postcode.replace(/\s+/g, "")}`;

/** Save records and log each in the append-only assessment history. */
export async function storeLookups(db: SupabaseClient, records: PropertyIntel[], source = "live-lookup"): Promise<boolean> {
  if (records.length === 0) return true;
  const rows = records.map((intel) => ({ id: intel.id, ...denormaliseIntel(intel) }));
  const { error } = await db.from("properties").upsert(rows);
  if (error) {
    console.error("property lookup save failed:", error.message);
    return false;
  }
  const { error: logError } = await db
    .from("property_assessments")
    .insert(records.map((intel) => ({ property_id: intel.id, source, assessment: intel })));
  if (logError) console.warn("property lookup log failed:", logError.message);
  return true;
}

/**
 * A postcode the book doesn't know: ask the EPC register who lives there,
 * merge with any records already held (an import, an earlier lookup), save,
 * and return the homes for the address picker. [] when nothing is found or
 * the service isn't set up.
 */
export async function lookupPostcode(db: SupabaseClient, postcode: string, deps: LookupDeps = {}): Promise<PropertyIntel[]> {
  const hits = await searchEpcByPostcode(postcode, deps);
  if (!hits || hits.length === 0) return [];
  const { nowIso } = resolve(deps);

  const clean = postcode.toUpperCase().replace(/\s+/g, "");
  const { data } = await db.from("properties").select("id, address_key, intel").in("postcode", [clean, formatPostcode(clean)]);
  const byId = new Map<string, PropertyIntel>();
  const byKey = new Map<string, PropertyIntel>();
  for (const row of (data ?? []) as { id: string; address_key: string; intel: PropertyIntel }[]) {
    byId.set(row.id, row.intel);
    byKey.set(row.address_key, row.intel);
  }

  const records = hits.map((hit) => {
    const fresh = intelFromSearchHit(hit, nowIso);
    return mergeLookedUp(byId.get(fresh.id) ?? byKey.get(addressKeyOf(fresh)), fresh);
  });
  // Two certificates can name one home under two spellings that share a UPRN-less key: keep one.
  const unique = [...new Map(records.map((r) => [r.id, r])).values()];
  await storeLookups(db, unique);
  return unique;
}

/** Load, enrich if anything's missing, save. The record as it now stands (or as it was, if every service was down). */
export async function enrichAndStore(db: SupabaseClient, intel: PropertyIntel, deps: LookupDeps = {}): Promise<PropertyIntel> {
  const { intel: next, changed } = await enrichIntel(intel, deps);
  if (changed) await storeLookups(db, [next]);
  return next;
}
