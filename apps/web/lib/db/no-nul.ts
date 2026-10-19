/**
 * Postgres can't store the NUL character (U+0000) in text or jsonb: PostgREST
 * answers 22P05 "unsupported Unicode escape sequence" and the whole write
 * fails, so a stray NUL pasted into an address or a note lost the customer's
 * quote ("Could not save quote", 502) on Supabase. Nothing we store needs it,
 * so every value written goes through `withoutNul` first (getServiceClient
 * wraps the client), for Supabase and the local backend alike; the local
 * backend itself refuses a NUL exactly as Postgres does, so a write that
 * skips this wrapper fails in the tests too.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** The value with every U+0000 removed from its strings and object keys. Other values are returned as they are. */
export function withoutNul<T>(value: T): T {
  if (typeof value === "string") return (value.includes("\u0000") ? value.replace(/\u0000/g, "") : value) as T;
  if (Array.isArray(value)) return value.map((v) => withoutNul(v)) as T;
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[withoutNul(k)] = withoutNul(v);
    return out as T;
  }
  return value;
}

const WRITES = new Set<PropertyKey>(["insert", "update", "upsert"]);

/** The client, with insert / update / upsert payloads cleaned of NULs. Everything else passes straight through. */
export function nulSafe(client: SupabaseClient): SupabaseClient {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (prop !== "from" || typeof value !== "function") return value;
      return (table: string) => {
        const builder = (value as (t: string) => object).call(target, table);
        return new Proxy(builder, {
          get(b, p, r) {
            const member = Reflect.get(b, p, r) as unknown;
            if (typeof member !== "function") return member;
            if (WRITES.has(p)) return (values: unknown, opts?: unknown) => (member as (v: unknown, o?: unknown) => unknown).call(b, withoutNul(values), opts);
            return (member as (...args: unknown[]) => unknown).bind(b);
          },
        });
      };
    },
  });
}
