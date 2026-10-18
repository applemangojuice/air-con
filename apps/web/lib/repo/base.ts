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
