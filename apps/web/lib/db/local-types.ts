/**
 * Postgres column types for the local data backend: what a value written to
 * a column becomes (or the error Postgres raises), what a filter literal on
 * it means, and how PostgREST returns it. Measured against PostgREST 12.2.3
 * on Postgres 16 (supabase/tests/compat), so a value that Supabase would
 * refuse is refused here too, and a value comes back in the same shape:
 *
 *   timestamptz  "2026-10-19T13:00:00.12+00:00"  (UTC, trailing zeros dropped)
 *   date         "2026-10-19"                    (a timestamp's date as written)
 *   uuid         lower case
 *   integer      a number; 1.5, true or 3e9 are refused (22P02 / 22003)
 *   numeric      a number ("1.50" is 1.5)
 *   boolean      true/false ("yes", "t", 1 are accepted)
 *   text         a string (a number or object is stored as its JSON text)
 *   text[]       an array of strings
 *   jsonb        any JSON; no "\u0000" anywhere (22P05), nor in text
 */

import { QueryError } from "./local-filters.ts";

export type ColumnType = "uuid" | "text" | "integer" | "numeric" | "boolean" | "jsonb" | "timestamptz" | "date" | "text[]";

const PG_TYPES: Record<string, ColumnType> = {
  uuid: "uuid",
  text: "text",
  integer: "integer",
  numeric: "numeric",
  boolean: "boolean",
  jsonb: "jsonb",
  "timestamp with time zone": "timestamptz",
  date: "date",
  "text[]": "text[]",
};

/** The local type for a Postgres type name (format_type), or an error naming it. */
export function columnType(pgType: string): ColumnType {
  const t = PG_TYPES[pgType];
  if (!t) throw new Error(`local data backend: no mapping for Postgres type "${pgType}" (lib/db/local-types.ts)`);
  return t;
}

/** Postgres' own name for the type, as its error messages say it. */
const TYPE_NAMES: Record<ColumnType, string> = {
  uuid: "uuid",
  text: "text",
  integer: "integer",
  numeric: "numeric",
  boolean: "boolean",
  jsonb: "json",
  timestamptz: "timestamp with time zone",
  date: "date",
  "text[]": "text[]",
};

const invalid = (type: ColumnType, text: string) =>
  new QueryError("22P02", `invalid input syntax for type ${TYPE_NAMES[type]}: "${text}"`);

/** The text Postgres sees for a JSON value cast to a column (what json_to_recordset hands it). */
export function jsonText(v: unknown): string {
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

/** What postgrest-js puts after `eq.` for a JS value: `${value}`. */
export function urlText(v: unknown): string {
  return `${v as string}`;
}

/** Postgres text and jsonb can't hold NUL: PostgREST answers 22P05. */
export function assertNoNul(v: unknown): void {
  const bad = (s: string) => s.includes("\u0000");
  const walk = (x: unknown): boolean => {
    if (typeof x === "string") return bad(x);
    if (Array.isArray(x)) return x.some(walk);
    if (x !== null && typeof x === "object") return Object.entries(x).some(([k, val]) => bad(k) || walk(val));
    return false;
  };
  if (walk(v)) {
    throw new QueryError("22P05", "unsupported Unicode escape sequence", 400, "\\u0000 cannot be converted to text.");
  }
}

/* ------------------------------------------------------------------ */
/* Timestamps and dates                                                */
/* ------------------------------------------------------------------ */

const TS_RE = /^\s*(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?\s*$/i;

/** Epoch ms for a timestamp literal (zoneless means UTC, Supabase's session zone), or null. */
export function parseInstant(text: string): number | null {
  const m = TS_RE.exec(text);
  if (!m) {
    const s = text.trim().toLowerCase();
    if (s === "now") return Date.now();
    if (s === "epoch") return 0;
    return null;
  }
  const [, y, mo, d, h = "00", mi = "00", sec = "00", frac = "", zone = "Z"] = m;
  if (!validDate(Number(y), Number(mo), Number(d)) || Number(h) > 24 || Number(mi) > 59 || Number(sec) > 60) return null;
  const ms = frac ? Math.round(Number(`0${frac}`) * 1000) : 0;
  let offset = 0;
  if (zone.toUpperCase() !== "Z") {
    const zm = /^([+-])(\d{2}):?(\d{2})?$/.exec(zone);
    if (!zm) return null;
    offset = (zm[1] === "-" ? -1 : 1) * (Number(zm[2]) * 60 + Number(zm[3] ?? 0));
  }
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec), ms) - offset * 60_000;
}

function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** PostgREST's rendering of a timestamptz in a UTC session. */
export function formatTimestamptz(ms: number): string {
  const iso = new Date(ms).toISOString(); // yyyy-mm-ddThh:mm:ss.sssZ
  const main = iso.slice(0, 19);
  const frac = iso.slice(20, 23).replace(/0+$/, "");
  return `${main}${frac ? `.${frac}` : ""}+00:00`;
}

function timestamptzIn(v: unknown): string {
  if (typeof v === "number") {
    throw new QueryError("22008", `date/time field value out of range: "${jsonText(v)}"`, 400, null);
  }
  const text = jsonText(v);
  const ms = parseInstant(text);
  if (ms === null || !Number.isFinite(ms)) {
    throw new QueryError("22007", `invalid input syntax for type timestamp with time zone: "${text}"`);
  }
  return formatTimestamptz(ms);
}

function dateIn(v: unknown): string {
  const text = jsonText(v);
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})(?=$|[T ]|\s)/i.exec(text);
  if (m && TS_RE.test(text)) {
    if (!validDate(Number(m[1]), Number(m[2]), Number(m[3]))) {
      throw new QueryError("22008", `date/time field value out of range: "${text}"`);
    }
    return `${m[1]}-${m[2]}-${m[3]}`;
  }
  const special = text.trim().toLowerCase();
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  if (special === "today" || special === "now") return day(0);
  if (special === "tomorrow") return day(1);
  if (special === "yesterday") return day(-1);
  throw new QueryError("22007", `invalid input syntax for type date: "${text}"`);
}

/* ------------------------------------------------------------------ */
/* Scalars                                                             */
/* ------------------------------------------------------------------ */

const UUID_IN = /^\{?([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})\}?$/i;

function uuidIn(v: unknown): string {
  const text = jsonText(v);
  const m = typeof v === "string" ? UUID_IN.exec(v.trim()) : null;
  if (!m) throw invalid("uuid", text);
  return `${m[1]}-${m[2]}-${m[3]}-${m[4]}-${m[5]}`.toLowerCase();
}

const INT_MAX = 2147483647;

function integerIn(v: unknown): number {
  const text = jsonText(v);
  if (typeof v !== "number" && typeof v !== "string") throw invalid("integer", text);
  if (!/^\s*[+-]?\d+\s*$/.test(text)) throw invalid("integer", text);
  const n = Number(text);
  if (n > INT_MAX || n < -INT_MAX - 1) throw new QueryError("22003", `value "${text.trim()}" is out of range for type integer`);
  return n;
}

function numericIn(v: unknown): number {
  const text = jsonText(v);
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\s*[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i.test(v)) return Number(v);
  throw invalid("numeric", text);
}

const TRUE_WORDS = new Set(["t", "true", "y", "yes", "on", "1"]);
const FALSE_WORDS = new Set(["f", "false", "n", "no", "off", "0"]);

function booleanIn(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  const text = jsonText(v);
  const s = text.trim().toLowerCase();
  if (TRUE_WORDS.has(s)) return true;
  if (FALSE_WORDS.has(s)) return false;
  throw invalid("boolean", text);
}

function textIn(v: unknown): string {
  const s = jsonText(v);
  assertNoNul(s);
  return s;
}

/** `{a,"b c"}` → ["a", "b c"] (one dimension, enough for roles). */
function arrayLiteral(text: string): string[] {
  const s = text.trim();
  if (!s.startsWith("{") || !s.endsWith("}")) {
    throw new QueryError("22P02", `malformed array literal: "${text}"`, 400, 'Array value must start with "{" or dimension information.');
  }
  const inner = s.slice(1, -1);
  if (inner.trim() === "") return [];
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!;
    if (c === "\\" && i + 1 < inner.length) cur += inner[++i];
    else if (c === '"') quoted = !quoted;
    else if (c === "," && !quoted) {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

function textArrayIn(v: unknown): (string | null)[] {
  if (Array.isArray(v)) {
    return v.map((x) => {
      if (x === null || x === undefined) return null;
      if (Array.isArray(x)) throw new QueryError("22P02", `malformed array literal: "${JSON.stringify(v)}"`);
      return textIn(x);
    });
  }
  if (typeof v === "string") return arrayLiteral(v);
  throw new QueryError("22P02", `malformed array literal: "${jsonText(v)}"`);
}

/**
 * A JSON value written to a column, as Postgres stores it (canonical form),
 * or the error it raises. null stays null (NOT NULL is checked on the row).
 */
export function columnValue(type: ColumnType, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  switch (type) {
    case "jsonb":
      assertNoNul(v);
      return v;
    case "text":
      return textIn(v);
    case "uuid":
      return uuidIn(v);
    case "integer":
      return integerIn(v);
    case "numeric":
      return numericIn(v);
    case "boolean":
      return booleanIn(v);
    case "timestamptz":
      return timestamptzIn(v);
    case "date":
      return dateIn(v);
    case "text[]":
      return textArrayIn(v);
  }
}

/**
 * A filter literal (the text after `eq.`) on a column of this type, as the
 * value to compare with, or the error Postgres raises casting it. jsonb
 * literals must be JSON ("invalid input syntax for type json").
 */
export function filterLiteral(type: ColumnType, text: string): unknown {
  switch (type) {
    case "jsonb":
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new QueryError("22P02", "invalid input syntax for type json", 400, `Token "${text}" is invalid.`);
      }
    case "text":
      return text;
    case "text[]":
      return arrayLiteral(text);
    default:
      return columnValue(type, text);
  }
}

/** A stored value as PostgREST returns it (legacy rows written before the types were enforced included). */
export function outputValue(type: ColumnType, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  try {
    switch (type) {
      case "timestamptz": {
        if (typeof v !== "string") return v;
        const ms = parseInstant(v);
        return ms === null ? v : formatTimestamptz(ms);
      }
      case "date":
        return typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : v;
      case "uuid":
        return typeof v === "string" ? v.toLowerCase() : v;
      case "integer":
      case "numeric":
        return typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : v;
      case "text":
        return typeof v === "string" ? v : jsonText(v);
      default:
        return v;
    }
  } catch {
    return v;
  }
}

/** Operators Postgres has for this type (`~~` LIKE is text only). */
export function supportsLike(type: ColumnType): boolean {
  return type === "text";
}

export function pgTypeName(type: ColumnType): string {
  return type === "jsonb" ? "jsonb" : TYPE_NAMES[type];
}
