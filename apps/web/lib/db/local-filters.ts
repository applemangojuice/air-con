/**
 * PostgREST query semantics for the local data backend, as pure functions:
 * filters (with SQL three-valued logic, so `neq` never matches NULL),
 * `or()` logic trees, select-list projection and ordering.
 *
 * Values in rows are JSON (what supabase-js sends and receives). Filter
 * values arrive either as JS values (`.eq("n", 5)`) or as PostgREST strings
 * (`.or("n.gt.5")`), so comparisons coerce the way Postgres would cast a
 * literal to the column's type: numbers numerically, booleans as booleans,
 * ISO dates and timestamps as instants, uuids case-insensitively.
 */

import { canonicalJson, type Row } from "./local-schema.ts";

export type FilterOp =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "like"
  | "ilike"
  | "match"
  | "imatch"
  | "is"
  | "in"
  | "cs"
  | "cd"
  | "ov";

export interface CondFilter {
  kind: "cond";
  column: string;
  op: FilterOp;
  value: unknown;
  negate: boolean;
}

export type Filter = CondFilter | { kind: "and" | "or"; items: Filter[]; negate: boolean };

/** A PostgREST-style error, the shape supabase-js puts in `error`. */
export class QueryError extends Error {
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null;
  readonly status: number;

  constructor(code: string, message: string, status = 400, details: string | null = null) {
    super(message);
    this.code = code;
    this.details = details;
    this.hint = null;
    this.status = status;
  }

  toJSON(): { code: string; message: string; details: string | null; hint: string | null } {
    return { code: this.code, message: this.message, details: this.details, hint: this.hint };
  }
}

const OPS = new Set<string>(["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "match", "imatch", "is", "in", "cs", "cd", "ov"]);

/* ------------------------------------------------------------------ */
/* Column paths                                                        */
/* ------------------------------------------------------------------ */

export interface ColumnPath {
  column: string;
  /** JSON path steps after the column; `text` marks a final `->>`. */
  steps: string[];
  text: boolean;
}

export function parseColumnPath(expr: string): ColumnPath {
  const parts = expr.split(/(->>|->)/);
  const column = parts[0].trim();
  const steps: string[] = [];
  let text = false;
  for (let i = 1; i < parts.length; i += 2) {
    steps.push(parts[i + 1].trim().replace(/^'(.*)'$/, "$1"));
    text = parts[i] === "->>";
  }
  return { column, steps, text };
}

/** The value at `col`, `col->a->b` or `col->a->>b` (text), null when absent. */
export function resolveColumn(row: Row, expr: string): unknown {
  const { column, steps, text } = parseColumnPath(expr);
  let value: unknown = row[column];
  for (const step of steps) {
    if (value === null || value === undefined || typeof value !== "object") return null;
    value = Array.isArray(value) ? value[Number(step)] : (value as Row)[step];
  }
  if (value === undefined) return null;
  if (text && value !== null && typeof value !== "string") return JSON.stringify(value);
  return value;
}

/* ------------------------------------------------------------------ */
/* Comparison                                                          */
/* ------------------------------------------------------------------ */

const ISO_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?)?$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Epoch ms for an ISO date or timestamp; zoneless times are UTC, like Supabase sessions. */
function isoInstant(s: string): number {
  const t = s.replace(" ", "T");
  if (!t.includes("T")) return Date.parse(t); // date-only: UTC midnight
  const [date, time] = t.split("T");
  const zoned = /(Z|[+-]\d{2}(:?\d{2})?)$/i.test(time)
    ? time.replace(/([+-]\d{2})$/, "$1:00").replace(/([+-]\d{2})(\d{2})$/, "$1:$2")
    : `${time}Z`;
  return Date.parse(`${date}T${zoned}`);
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function toBoolean(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.toLowerCase();
    if (s === "true" || s === "t") return true;
    if (s === "false" || s === "f") return false;
  }
  return null;
}

function sign(a: number | string, b: number | string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Compares a row value with a filter value (or another row value). null
 * means "not comparable", which a filter treats as unknown.
 */
export function compareValues(a: unknown, b: unknown): number | null {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  if (typeof a === "number") {
    const n = toNumber(b);
    return n === null ? null : sign(a, n);
  }
  if (typeof a === "boolean") {
    const bb = toBoolean(b);
    return bb === null ? null : sign(Number(a), Number(bb));
  }
  if (typeof a === "string") {
    if (typeof b === "number") {
      const n = toNumber(a);
      return n === null ? sign(a, String(b)) : sign(n, b);
    }
    const bs = typeof b === "string" ? b : typeof b === "boolean" ? String(b) : canonicalJson(b);
    if (ISO_RE.test(a) && ISO_RE.test(bs)) {
      const ta = isoInstant(a);
      const tb = isoInstant(bs);
      if (Number.isFinite(ta) && Number.isFinite(tb)) return sign(ta, tb);
    }
    if (UUID_RE.test(a) && UUID_RE.test(bs)) return sign(a.toLowerCase(), bs.toLowerCase());
    return sign(a, bs);
  }
  // jsonb / arrays: equality (and a stable order) through canonical JSON.
  let other = b;
  if (typeof b === "string") {
    try {
      other = JSON.parse(b);
    } catch {
      return null;
    }
  }
  return sign(canonicalJson(a), canonicalJson(other));
}

function likeRegex(pattern: string, insensitive: boolean): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\" && i + 1 < pattern.length) {
      re += escapeRegex(pattern[++i]);
    } else if (c === "%" || c === "*") {
      re += "[\\s\\S]*"; // PostgREST accepts * as an alias for %
    } else if (c === "_") {
      re += "[\\s\\S]";
    } else {
      re += escapeRegex(c);
    }
  }
  return new RegExp(`^${re}$`, insensitive ? "i" : "");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
}

function deepContains(container: unknown, contained: unknown): boolean {
  if (Array.isArray(contained)) {
    if (!Array.isArray(container)) return false;
    return contained.every((c) => container.some((x) => deepContains(x, c)));
  }
  if (contained !== null && typeof contained === "object") {
    if (container === null || typeof container !== "object" || Array.isArray(container)) return false;
    return Object.entries(contained as Row).every(([k, v]) => deepContains((container as Row)[k], v));
  }
  return compareValues(container, contained) === 0;
}

/** `{a,b}` array literals, JSON, or a JS value, for cs / cd / ov. */
function parseCollection(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const s = value.trim();
  if (s.startsWith("{") && !s.startsWith('{"') && s.endsWith("}") && !s.includes(":")) {
    const inner = s.slice(1, -1);
    return inner === "" ? [] : splitTopLevel(inner).map(unquote);
  }
  try {
    return JSON.parse(s);
  } catch {
    return [s];
  }
}

type Tri = boolean | null;

function applyOp(op: FilterOp, actual: unknown, expected: unknown): Tri {
  if (op === "is") {
    const want = expected === "null" || expected === "unknown" ? null : (toBoolean(expected) ?? expected);
    if (want === null || want === undefined) return actual === null || actual === undefined;
    return actual === want;
  }
  if (actual === null || actual === undefined) return null;
  switch (op) {
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const c = compareValues(actual, expected);
      if (c === null) return null;
      if (op === "eq") return c === 0;
      if (op === "neq") return c !== 0;
      if (op === "gt") return c > 0;
      if (op === "gte") return c >= 0;
      if (op === "lt") return c < 0;
      return c <= 0;
    }
    case "in": {
      const list = Array.isArray(expected) ? expected : parseInList(String(expected));
      let unknown = false;
      for (const item of list) {
        const c = compareValues(actual, item);
        if (c === 0) return true;
        if (c === null) unknown = true;
      }
      return unknown && list.length > 0 ? null : false;
    }
    case "like":
    case "ilike":
      if (expected === null || expected === undefined) return null;
      return likeRegex(String(expected), op === "ilike").test(scalarText(actual));
    case "match":
    case "imatch":
      if (expected === null || expected === undefined) return null;
      return new RegExp(String(expected), op === "imatch" ? "i" : "").test(scalarText(actual));
    case "cs":
      return deepContains(actual, parseCollection(expected));
    case "cd":
      return deepContains(parseCollection(expected), actual);
    case "ov": {
      const want = parseCollection(expected);
      if (!Array.isArray(actual) || !Array.isArray(want)) return null;
      return actual.some((a) => want.some((w) => compareValues(a, w) === 0));
    }
  }
}

function scalarText(v: unknown): string {
  return typeof v === "string" ? v : canonicalJson(v);
}

function not3(v: Tri): Tri {
  return v === null ? null : !v;
}

export function evaluate(filter: Filter, row: Row): Tri {
  let result: Tri;
  if (filter.kind === "cond") {
    result = applyOp(filter.op, resolveColumn(row, filter.column), filter.value);
  } else if (filter.kind === "and") {
    result = true;
    for (const f of filter.items) {
      const r = evaluate(f, row);
      if (r === false) {
        result = false;
        break;
      }
      if (r === null) result = null;
    }
  } else {
    result = false;
    for (const f of filter.items) {
      const r = evaluate(f, row);
      if (r === true) {
        result = true;
        break;
      }
      if (r === null) result = null;
    }
  }
  return filter.negate ? not3(result) : result;
}

/** WHERE semantics: every filter must be true (unknown excludes the row). */
export function matchesAll(filters: Filter[], row: Row): boolean {
  return filters.every((f) => evaluate(f, row) === true);
}

/* ------------------------------------------------------------------ */
/* PostgREST string syntax: or(), not(), filter()                       */
/* ------------------------------------------------------------------ */

/** Splits on commas outside parentheses and double quotes. */
export function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && quoted) {
      i++;
    } else if (c === '"') {
      quoted = !quoted;
    } else if (!quoted && c === "(") {
      depth++;
    } else if (!quoted && c === ")") {
      depth--;
    } else if (!quoted && depth === 0 && c === ",") {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.map((p) => p.trim()).filter((p) => p !== "");
}

function unquote(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  return t;
}

function parseInList(s: string): string[] {
  const t = s.trim();
  const inner = t.startsWith("(") && t.endsWith(")") ? t.slice(1, -1) : t;
  return inner.trim() === "" ? [] : splitTopLevel(inner).map(unquote);
}

/** Turns the text after `op.` into the value applyOp expects. */
function parseOperand(op: FilterOp, raw: string): unknown {
  if (op === "in") return parseInList(raw);
  if (op === "is") return raw.toLowerCase();
  if (op === "cs" || op === "cd" || op === "ov") return raw;
  return unquote(raw);
}

/** `op.value` or `not.op.value` for one column. */
export function parseCondition(column: string, spec: string): CondFilter {
  let rest = spec;
  let negate = false;
  if (rest.startsWith("not.")) {
    negate = true;
    rest = rest.slice(4);
  }
  const dot = rest.indexOf(".");
  const op = dot === -1 ? rest : rest.slice(0, dot);
  if (!OPS.has(op)) {
    throw new QueryError("PGRST100", `"${op}" is not a filter operator the local data backend supports`);
  }
  const raw = dot === -1 ? "" : rest.slice(dot + 1);
  return { kind: "cond", column, op: op as FilterOp, value: parseOperand(op as FilterOp, raw), negate };
}

/** One item of a logic tree: `col.op.value`, `and(...)`, `not.or(...)`, ... */
function parseLogicItem(item: string): Filter {
  const tree = /^(not\.)?(and|or)\((.*)\)$/s.exec(item);
  if (tree) {
    return {
      kind: tree[2] as "and" | "or",
      items: splitTopLevel(tree[3]).map(parseLogicItem),
      negate: Boolean(tree[1]),
    };
  }
  const dot = item.indexOf(".");
  if (dot <= 0) throw new QueryError("PGRST100", `failed to parse logic tree item "${item}"`);
  return parseCondition(item.slice(0, dot), item.slice(dot + 1));
}

/** `.or("a.eq.1,b.is.null,and(c.gt.2,d.lt.5)")` → one OR filter. */
export function parseOr(expression: string): Filter {
  return { kind: "or", items: splitTopLevel(expression).map(parseLogicItem), negate: false };
}

/* ------------------------------------------------------------------ */
/* Projection                                                          */
/* ------------------------------------------------------------------ */

export type SelectItem =
  | { kind: "all" }
  | { kind: "column"; key: string; expr: string; cast: string | null };

/** Supabase strips whitespace outside double quotes before sending. */
function stripWhitespace(s: string): string {
  let quoted = false;
  let out = "";
  for (const c of s) {
    if (c === '"') quoted = !quoted;
    if (!quoted && /\s/.test(c)) continue;
    out += c;
  }
  return out;
}

export function parseSelect(columns: string | undefined): SelectItem[] {
  const cleaned = stripWhitespace(columns ?? "*") || "*";
  return splitTopLevel(cleaned).map((item): SelectItem => {
    if (item === "*") return { kind: "all" };
    if (item.includes("(") || item.startsWith("...")) {
      throw new QueryError(
        "PGRST200",
        `embedded resources and aggregates aren't supported by the local data backend ("${item}"); query each table separately`,
      );
    }
    let body = item;
    let alias: string | null = null;
    const aliased = /^([A-Za-z_][\w]*):(?!:)(.+)$/.exec(body);
    if (aliased) {
      alias = aliased[1];
      body = aliased[2];
    }
    let cast: string | null = null;
    const castAt = body.indexOf("::");
    if (castAt !== -1) {
      cast = body.slice(castAt + 2).toLowerCase();
      body = body.slice(0, castAt);
    }
    const path = parseColumnPath(body);
    const key = alias ?? (path.steps.length ? path.steps[path.steps.length - 1] : path.column);
    return { kind: "column", key: unquote(key), expr: body, cast };
  });
}

function applyCast(value: unknown, cast: string | null): unknown {
  if (cast === null || value === null || value === undefined) return value;
  if (cast === "text" || cast === "varchar") return typeof value === "string" ? value : canonicalJson(value);
  if (/^(int|int2|int4|int8|integer|bigint|smallint)$/.test(cast)) {
    const n = toNumber(value);
    return n === null ? value : Math.trunc(n);
  }
  if (/^(numeric|float4|float8|real|double precision|decimal)$/.test(cast)) return toNumber(value) ?? value;
  if (cast === "bool" || cast === "boolean") return toBoolean(value) ?? value;
  return value;
}

export function projectRow(row: Row, items: SelectItem[]): Row {
  const out: Row = {};
  for (const item of items) {
    if (item.kind === "all") {
      Object.assign(out, row);
    } else {
      out[item.key] = applyCast(resolveColumn(row, item.expr), item.cast);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Ordering                                                            */
/* ------------------------------------------------------------------ */

export interface OrderSpec {
  column: string;
  ascending: boolean;
  /** Postgres default: NULLS LAST ascending, NULLS FIRST descending. */
  nullsFirst: boolean;
}

function compareForSort(a: unknown, b: unknown): number {
  const c = compareValues(a, b);
  if (c !== null) return c;
  return sign(canonicalJson(a), canonicalJson(b));
}

/** Stable multi-key sort; returns a new array. */
export function sortRows(rows: Row[], orders: OrderSpec[]): Row[] {
  if (orders.length === 0) return rows.slice();
  return rows.slice().sort((x, y) => {
    for (const o of orders) {
      const a = resolveColumn(x, o.column);
      const b = resolveColumn(y, o.column);
      const aNull = a === null || a === undefined;
      const bNull = b === null || b === undefined;
      if (aNull && bNull) continue;
      if (aNull || bNull) return aNull === o.nullsFirst ? -1 : 1;
      const c = compareForSort(a, b);
      if (c !== 0) return o.ascending ? c : -c;
    }
    return 0;
  });
}
