/**
 * JSON with object keys sorted at every level (undefined and functions
 * dropped from objects and written as null in arrays, as JSON.stringify
 * does), so equal content serialises identically whatever order its keys
 * were written in.
 *
 * Use it whenever a value read back from the database is compared with one
 * built in code: Postgres `jsonb` doesn't keep key order (it returns keys
 * shortest first, then in byte order), so a plain JSON.stringify of the same
 * content read from Supabase and built in memory differs.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const s = JSON.stringify(value);
    return s === undefined ? "null" : s;
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined || typeof v === "function" ? "null" : canonicalJson(v))).join(",")}]`;
  }
  if (typeof (value as { toJSON?: unknown }).toJSON === "function") {
    return canonicalJson((value as { toJSON(): unknown }).toJSON());
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && typeof v !== "function")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** Same content, ignoring object key order (see canonicalJson). */
export function sameJson(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

const utf8 = new TextEncoder();

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return (a[i] ?? 0) - (b[i] ?? 0);
  return a.length - b.length;
}

/**
 * The value as Postgres `jsonb` hands it back: every object's keys shortest
 * first (by UTF-8 bytes), then in byte order. The local data backend returns
 * jsonb-shaped values through this, so tests and the e2e walk see the key
 * order Supabase returns instead of the order the code wrote.
 */
export function jsonbKeyOrder<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => jsonbKeyOrder(v)) as T;
  const keys = Object.keys(value as Record<string, unknown>)
    .map((k) => ({ k, b: utf8.encode(k) }))
    .sort((x, y) => x.b.length - y.b.length || compareBytes(x.b, y.b));
  const out: Record<string, unknown> = {};
  for (const { k } of keys) out[k] = jsonbKeyOrder((value as Record<string, unknown>)[k]);
  return out as T;
}
