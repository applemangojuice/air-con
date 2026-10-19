import type { SupabaseClient } from "@supabase/supabase-js";
import { requireDb } from "@/lib/supabase-server";

/**
 * Shared plumbing for the repositories (contract §E/§F): one module per
 * table, each mapping rows to the @aircon/domain types in exactly one place.
 *
 * House rules:
 *  * The JSONB column is the truth; typed columns are rewritten from it on
 *    every write so filters and list views can't drift.
 *  * Reads return null (or []) for "not there"; real database errors throw.
 *    These repos are for pilot code, where a silent failure is worse than a
 *    500 (`requireDb()` throws in demo mode for the same reason).
 *  * Optional domain fields are absent, never null, so snapshots stay
 *    JSON-clean and compare equal after a round trip.
 */

export type Row = Record<string, unknown>;

export function db(): SupabaseClient {
  return requireDb();
}

interface DbError {
  message: string;
  code?: string;
}

/** Throws a readable error for a failed query; otherwise hands back the data. */
export function must<T>(res: { data: T | null; error: DbError | null }, what: string): T | null {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

/**
 * Supabase's Max Rows (PostgREST `max-rows`, 1000 by default): a select
 * returns at most this many rows and says nothing about the rest. The local
 * backend enforces the same cap (LOCAL_MAX_ROWS), so tests see it too.
 */
export const MAX_ROWS = 1000;

type PageResult = { data: unknown[] | null; error: DbError | null; count?: number | null };

/**
 * Every row a query matches, read a page at a time, so the Max Rows cap can
 * never silently drop any. `page(from, to, count)` builds the query afresh
 * for each page: it must apply `.range(from, to)` over an order on a unique
 * key (end with `.order("id")`), or pages could overlap or skip a row, and
 * when `count` is true select with `{ count: "exact" }`. The first page asks
 * for the total, so a result under the cap costs one request as before, and
 * paging carries on by what actually came back, whatever the server's cap is
 * set to. Stops once `limit` rows are in.
 */
export async function selectAllPages<T = Row>(
  page: (from: number, to: number, count: boolean) => PromiseLike<PageResult>,
  what: string,
  opts: { limit?: number; pageSize?: number } = {},
): Promise<T[]> {
  const size = Math.max(1, opts.pageSize ?? MAX_ROWS);
  const limit = opts.limit ?? Number.POSITIVE_INFINITY;
  const out: T[] = [];
  let total: number | null = null;
  for (let from = 0; out.length < limit && (total === null || out.length < total); ) {
    const want = Math.min(size, limit - out.length);
    const res = await page(from, from + want - 1, total === null);
    const rows = (must(res, what) ?? []) as T[];
    if (total === null) total = typeof res.count === "number" ? res.count : null;
    out.push(...rows);
    // No count to go by: a short page is the end. With one, only an empty page (rows deleted mid-read) is.
    if (rows.length === 0 || (total === null && rows.length < want)) break;
    from += rows.length;
  }
  return out.slice(0, Number.isFinite(limit) ? limit : undefined);
}

/** Postgres unique violation, from Supabase or the local backend. */
export function isUniqueViolation(error: DbError | null | undefined): boolean {
  return error?.code === "23505";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * uuid columns reject anything else outright in Postgres (an error, not an
 * empty result), so lookups by a junk id short-circuit to "not found".
 */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** null/undefined → undefined; anything else as a string. For optional text fields. */
export function optStr(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

/** Numeric columns can come back as strings (Postgres numeric); null stays absent. */
export function optNum(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** A JSONB object column, or {} when it's missing or not an object. */
export function jsonObject<T>(value: unknown): T {
  return (typeof value === "object" && value !== null && !Array.isArray(value) ? value : {}) as T;
}

export function jsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Drops undefined-valued keys, so optional fields are absent rather than undefined. */
export function compact<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}

/** A JSON-clean deep copy (what a JSONB round trip would give back). */
export function jsonClean<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** A uuid for a uuid column, or null (never a value Postgres would reject). */
export function uuidOrNull(value: string | null | undefined): string | null {
  return isUuid(value) ? value : null;
}
