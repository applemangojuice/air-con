/**
 * The local data backend: the subset of supabase-js this repo uses, run
 * against JSON files (or memory) instead of Postgres + Storage. Contract §B.
 *
 *   const db = createLocalClient({ backend: "file", dataDir });
 *   const { data, error } = await db.from("projects").select("id").eq("quote_id", q).maybeSingle();
 *
 * Results have the supabase-js shape ({ data, error, count, status,
 * statusText, success }) and errors the PostgREST shape ({ code, message,
 * details, hint }): 23505 for unique violations, PGRST116 from .single(),
 * 21000 for an UPDATE or DELETE without filters (Supabase runs
 * pg-safeupdate), P0001 when a table guard (trigger) rejects a change.
 *
 * The schema is the migrations' (db-schema.generated.ts + local-schema.ts),
 * enforced the way Postgres and PostgREST enforce it: unknown tables 42P01,
 * unknown columns 42703 / PGRST204, values cast to their column types
 * (22P02, 22003, 22007, 22P05 for NUL), NOT NULL 23502, checks 23514,
 * foreign keys 23503 with their ON DELETE actions, ON CONFLICT only on a
 * unique constraint (42P10), and rows returned in PostgREST's shapes
 * (timestamptz "…+00:00", dates "yyyy-mm-dd", uuids lower case).
 * supabase/tests/compat runs the app on the real thing to keep this honest.
 *
 * Deliberately not here: embedded selects (`rel(...)`), rpc, auth,
 * realtime, full-text search. Those fail loudly with an error rather than
 * pretending.
 *
 * Node-only (fs, crypto) and self-contained: relative imports, no Next.js,
 * so `node --test` can load it directly.
 */

import { jsonbKeyOrder } from "@aircon/domain";
import type { SupabaseClient } from "@supabase/supabase-js";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  QueryError,
  matchesAll,
  parseColumnPath,
  parseCondition,
  parseOr,
  parseSelect,
  projectRow,
  sortRows,
  type CondFilter,
  type Filter,
  type FilterOp,
  type OrderSpec,
  type SelectItem,
} from "./local-filters.ts";
import { canonicalJson, tableSchema, type ColumnSchema, type Row, type TableSchema } from "./local-schema.ts";
import { columnValue, filterLiteral, formatTimestamptz, outputValue, pgTypeName, supportsLike, urlText } from "./local-types.ts";
import {
  bodyBytes,
  cleanContentType,
  cleanObjectPath,
  createFileObjects,
  createMemoryObjects,
  allowedContentTypes,
  bucketTakesType,
  maxUploadBytes,
  signedFileUrl,
  verifyStorageSignature,
  type ObjectMeta,
  type ObjectStore,
  type SignatureCheck,
  type SignedOp,
  type StoredObject,
} from "./local-storage.ts";
import { createFileStore, createMemoryStore, type TableStore } from "./local-store.ts";

export type LocalBackendKind = "file" | "memory";

export interface LocalClientOptions {
  backend: LocalBackendKind;
  /** File backend: where tables and storage live. Default: see defaultDataDir(). */
  dataDir?: string;
  /**
   * HMAC secret for signed storage URLs (SESSION_SECRET). Without one, a
   * fixed dev secret is used outside production; in production signing is
   * refused, because anyone could forge the dev secret.
   */
  secret?: string;
  /** Buckets that exist. Others answer "Bucket not found", like Supabase. */
  buckets?: readonly string[];
  /** Route that serves signed URLs. */
  filesRoute?: string;
  /** Clock, for tests. */
  now?: () => Date;
  /**
   * The most rows one select returns, like Supabase's Max Rows (PostgREST
   * `max-rows`, 1000 by default): more are silently cut off, so code that
   * reads big tables has to page (repo/base selectAllPages) here exactly as
   * it must against the real thing. Default: LOCAL_MAX_ROWS, else 1000.
   */
  maxRows?: number;
}

/** LOCAL_MAX_ROWS, else Supabase's default 1000. */
export function defaultMaxRows(): number {
  const n = Number(process.env.LOCAL_MAX_ROWS);
  return Number.isInteger(n) && n > 0 ? n : 1000;
}

export interface LocalError {
  code: string;
  message: string;
  details: string | null;
  hint: string | null;
}

export interface LocalResponse<T = unknown> {
  success: boolean;
  data: T | null;
  error: LocalError | null;
  count: number | null;
  status: number;
  statusText: string;
}

export const LOCAL_FILES_ROUTE = "/api/local-files";
export const DEFAULT_LOCAL_BUCKETS: readonly string[] = ["survey-photos", "survey-videos", "project-media"];
const DEV_FALLBACK_SECRET = "dih-local-dev-only-secret-not-for-production";
/** Supabase signed upload URLs last two hours. */
const UPLOAD_URL_TTL_SECONDS = 2 * 60 * 60;

/**
 * LOCAL_DATA_DIR, else apps/web/.data (also when the process runs from the
 * monorepo root), else ./.data.
 */
export function defaultDataDir(): string {
  const configured = process.env.LOCAL_DATA_DIR;
  if (configured) return resolve(configured);
  const cwd = process.cwd();
  if (existsSync(join(cwd, "apps", "web", "package.json"))) return join(cwd, "apps", "web", ".data");
  return join(cwd, ".data");
}

const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  201: "Created",
  204: "No Content",
  400: "Bad Request",
  404: "Not Found",
  406: "Not Acceptable",
  409: "Conflict",
  500: "Internal Server Error",
};

function ok<T>(data: T | null, count: number | null, status: number): LocalResponse<T> {
  return { success: true, data, error: null, count, status, statusText: STATUS_TEXT[status] ?? "" };
}

function failure(err: QueryError): LocalResponse<never> {
  return {
    success: false,
    data: null,
    error: err.toJSON(),
    count: null,
    status: err.status,
    statusText: STATUS_TEXT[err.status] ?? "",
  };
}

/** What supabase-js would send: JSON, so Dates become strings and undefined keys vanish. */
function toJson(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch (err) {
    throw new QueryError("22P02", `invalid input: ${(err as Error).message}`);
  }
}

/**
 * Rows as PostgREST returns them: every object or array column comes back
 * the way Postgres `jsonb` stores it, with object keys shortest first, then
 * in byte order (not the order the code wrote them). Mirroring that here
 * means a comparison that depends on key order fails in the tests and the
 * e2e walk, not only on Supabase. Also a deep copy, so callers never hold
 * the store's own objects.
 */
function asReturned(rows: Row[], schema: TableSchema): Row[] {
  return rows.map((row) => {
    const out: Row = {};
    for (const [k, v] of Object.entries(row)) {
      const col = schema.columns.get(k);
      const shaped = col ? outputValue(col.type, v) : v;
      out[k] = shaped !== null && typeof shaped === "object" ? jsonbKeyOrder(structuredClone(shaped)) : shaped;
    }
    return out;
  });
}

/* ------------------------------------------------------------------ */
/* The schema, as Postgres and PostgREST enforce it                    */
/* ------------------------------------------------------------------ */

function noTable(table: string): QueryError {
  return new QueryError("42P01", `relation "public.${table}" does not exist`, 404);
}

function noColumn(table: string, column: string): QueryError {
  return new QueryError("42703", `column ${table}.${column} does not exist`);
}

/** The column a select item, filter or order names (its base column for a json path). */
function columnOf(schema: TableSchema, expr: string): { col: ColumnSchema; path: ReturnType<typeof parseColumnPath> } {
  const path = parseColumnPath(expr);
  const col = schema.columns.get(path.column);
  if (!col) throw noColumn(schema.name, path.column);
  return { col, path };
}

function checkSelect(schema: TableSchema, items: SelectItem[]): void {
  for (const item of items) if (item.kind === "column") columnOf(schema, item.expr);
}

const OPERATOR: Partial<Record<FilterOp, string>> = { like: "~~", ilike: "~~*", match: "~", imatch: "~*", cs: "@>", cd: "<@", ov: "&&" };

/**
 * A filter as Postgres runs it: the column must exist, and its literal is
 * cast to the column's type (a non-uuid against a uuid column is 22P02, not
 * "no rows"). Returns the filter with typed values to compare.
 */
function typedFilter(schema: TableSchema, f: Filter): Filter {
  if (f.kind !== "cond") return { ...f, items: f.items.map((i) => typedFilter(schema, i)) };
  const { col, path } = columnOf(schema, f.column);
  const type = path.steps.length === 0 ? col.type : path.text ? "text" : "jsonb";
  const op = f.op;
  if (op === "is") {
    const v = String(f.value ?? "null").toLowerCase();
    if ((v === "true" || v === "false") && type !== "boolean") {
      throw new QueryError("42804", `argument of IS ${v.toUpperCase()} must be type boolean, not type ${pgTypeName(type)}`);
    }
    return f;
  }
  if (op === "like" || op === "ilike" || op === "match" || op === "imatch") {
    if (!supportsLike(type)) {
      throw new QueryError("42883", `operator does not exist: ${pgTypeName(type)} ${OPERATOR[op]} unknown`, 404, null);
    }
    return f;
  }
  if (op === "cs" || op === "cd" || op === "ov") {
    if (type !== "jsonb" && type !== "text[]") {
      throw new QueryError("42883", `operator does not exist: ${pgTypeName(type)} ${OPERATOR[op]} unknown`, 404, null);
    }
    return f;
  }
  const literal = (v: unknown) => filterLiteral(type, typeof v === "string" ? v : urlText(v));
  if (op === "in") {
    const list = Array.isArray(f.value) ? f.value : [f.value];
    return { ...f, value: list.map(literal) } as CondFilter;
  }
  return { ...f, value: literal(f.value) } as CondFilter;
}

/** A JSON payload value cast to its column, named on failure the way PostgREST names it. */
function castColumn(schema: TableSchema, column: string, value: unknown): unknown {
  const col = schema.columns.get(column);
  if (!col) {
    throw new QueryError("PGRST204", `Could not find the '${column}' column of '${schema.name}' in the schema cache`);
  }
  return columnValue(col.type, value);
}

/** Every key of every row cast to its column (unknown keys are PGRST204). */
function castRow(schema: TableSchema, row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[k] = castColumn(schema, k, v);
  return out;
}

function assertNotNull(schema: TableSchema, rows: Row[]): void {
  for (const row of rows) {
    for (const col of schema.columns.values()) {
      if (col.notNull && (row[col.name] === null || row[col.name] === undefined)) {
        throw new QueryError("23502", `null value in column "${col.name}" of relation "${schema.name}" violates not-null constraint`);
      }
    }
  }
}

function assertChecks(schema: TableSchema, rows: Row[]): void {
  for (const row of rows) {
    for (const check of schema.checks) {
      if (!check.ok(row)) {
        throw new QueryError("23514", `new row for relation "${schema.name}" violates check constraint "${check.name}"`);
      }
    }
  }
}

/** Keys present in the parent tables this table's foreign keys point at (read before the write). */
type ParentKeys = Map<string, Set<string>>;

const fkKey = (v: unknown) => (typeof v === "string" ? v.toLowerCase() : canonicalJson(v));

function assertParents(schema: TableSchema, rows: Row[], parents: ParentKeys, only?: Set<string>): void {
  for (const row of rows) {
    for (const fk of schema.foreignKeys) {
      if (only && !only.has(fk.column)) continue;
      const v = row[fk.column];
      if (v === null || v === undefined) continue;
      if (!parents.get(fk.name)?.has(fkKey(v))) {
        throw new QueryError(
          "23503",
          `insert or update on table "${schema.name}" violates foreign key constraint "${fk.name}"`,
          409,
          `Key (${fk.column})=(${String(v)}) is not present in table "${fk.references}".`,
        );
      }
    }
  }
}

function isRecord(v: unknown): v is Row {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/* ------------------------------------------------------------------ */
/* Write helpers (pure)                                                */
/* ------------------------------------------------------------------ */

/**
 * Normalises insert/upsert payloads. Bulk payloads follow supabase-js's
 * `defaultToNull`: a key present in any row is NULL (not the column
 * default) in rows that omit it.
 */
function prepareInputs(payload: unknown, defaultToNull: boolean): Row[] {
  const json = toJson(payload);
  const list = Array.isArray(json) ? json : [json];
  for (const item of list) {
    if (!isRecord(item)) throw new QueryError("PGRST102", "Empty or invalid json: rows must be objects");
  }
  const rows = list as Row[];
  if (!Array.isArray(json) || !defaultToNull) return rows;
  const keys = new Set(rows.flatMap((r) => Object.keys(r)));
  return rows.map((r) => {
    const out = { ...r };
    for (const k of keys) if (!(k in out)) out[k] = null;
    return out;
  });
}

function withDefaults(schema: TableSchema, row: Row, now: string): Row {
  const out: Row = { ...row };
  for (const col of schema.columns.values()) {
    if (col.name in out || !col.default) continue;
    if (col.default.kind === "now") out[col.name] = now;
    else if (col.default.kind === "uuid") out[col.name] = crypto.randomUUID();
    else out[col.name] = structuredClone(col.default.value);
  }
  return out;
}

function keyOf(row: Row, cols: string[]): string | null {
  const values = cols.map((c) => row[c]);
  if (values.some((v) => v === null || v === undefined)) return null; // NULLs never collide
  return canonicalJson(values);
}

function display(v: unknown): string {
  return typeof v === "string" ? v : canonicalJson(v);
}

/** Every changed row against the unchanged rows and each other. */
function assertUnique(table: string, schema: TableSchema, unchanged: readonly Row[], changed: Row[]): void {
  const constraints = [
    { cols: schema.primaryKey, name: `${table}_pkey` },
    ...schema.unique.map((u) => ({ cols: u.columns, name: u.name })),
  ];
  for (const c of constraints) {
    if (c.cols.length === 0) continue;
    const seen = new Set<string>();
    for (const r of unchanged) {
      const k = keyOf(r, c.cols);
      if (k !== null) seen.add(k);
    }
    for (const r of changed) {
      const k = keyOf(r, c.cols);
      if (k === null) continue;
      if (seen.has(k)) {
        throw new QueryError(
          "23505",
          `duplicate key value violates unique constraint "${c.name}"`,
          409,
          `Key (${c.cols.join(", ")})=(${c.cols.map((col) => display(r[col])).join(", ")}) already exists.`,
        );
      }
      seen.add(k);
    }
  }
  for (const index of schema.uniqueIndexes) {
    const seen = new Set<string>();
    const keyFor = (r: Row) => {
      const values = index.key(r);
      return values && !values.some((v) => v === null || v === undefined) ? canonicalJson(values) : null;
    };
    for (const r of unchanged) {
      const k = keyFor(r);
      if (k !== null) seen.add(k);
    }
    for (const r of changed) {
      const k = keyFor(r);
      if (k === null) continue;
      if (seen.has(k)) {
        throw new QueryError("23505", `duplicate key value violates unique constraint "${index.name}"`, 409, `Key ${k} already exists.`);
      }
      seen.add(k);
    }
  }
}

function runGuard(schema: TableSchema, before: Row, after: Row): void {
  const message = schema.beforeUpdate?.(before, after);
  if (message) throw new QueryError("P0001", message);
}

/* ------------------------------------------------------------------ */
/* Query builder                                                       */
/* ------------------------------------------------------------------ */

type Verb = "select" | "insert" | "update" | "upsert" | "delete";
type CountMode = "exact" | "planned" | "estimated";

interface WriteResult {
  rows: Row[];
  result: Row[];
}

/**
 * One builder for every verb (supabase-js splits it across classes).
 * Mutable and chainable like postgrest-js; runs when awaited, and again on
 * every await, exactly like the real thing.
 */
export class LocalQuery implements PromiseLike<LocalResponse> {
  private readonly db: LocalClient;
  private readonly table: string;
  private readonly verb: Verb;
  private columns: string | undefined = undefined;
  private returning = false;
  private countMode: CountMode | null = null;
  private head = false;
  private filters: Filter[] = [];
  private orders: OrderSpec[] = [];
  private limitN: number | null = null;
  private offsetN = 0;
  private singular: "single" | "maybe" | null = null;
  private shouldThrow = false;
  private deferred: QueryError | null = null;
  payload: unknown = undefined;
  defaultToNull = true;
  onConflict: string | undefined = undefined;
  ignoreDuplicates = false;

  constructor(db: LocalClient, table: string, verb: Verb) {
    this.db = db;
    this.table = table;
    this.verb = verb;
  }

  /* -- projection ---------------------------------------------------- */

  /** On a read: the column list (+ count/head). After a write: return the rows. */
  select(columns?: string, opts?: { count?: CountMode; head?: boolean }): this {
    this.columns = columns;
    if (this.verb === "select") {
      if (opts?.count) this.countMode = opts.count;
      if (opts?.head) this.head = true;
    } else {
      this.returning = true;
    }
    return this;
  }

  /** Internal: count option on insert/update/upsert/delete. */
  withCount(mode: CountMode | undefined): this {
    if (mode) this.countMode = mode;
    return this;
  }

  /* -- filters ------------------------------------------------------- */

  private cond(column: string, op: FilterOp, value: unknown, negate = false): this {
    this.filters.push({ kind: "cond", column, op, value, negate });
    return this;
  }

  eq(column: string, value: unknown): this {
    return this.cond(column, "eq", value);
  }
  neq(column: string, value: unknown): this {
    return this.cond(column, "neq", value);
  }
  gt(column: string, value: unknown): this {
    return this.cond(column, "gt", value);
  }
  gte(column: string, value: unknown): this {
    return this.cond(column, "gte", value);
  }
  lt(column: string, value: unknown): this {
    return this.cond(column, "lt", value);
  }
  lte(column: string, value: unknown): this {
    return this.cond(column, "lte", value);
  }
  like(column: string, pattern: string): this {
    return this.cond(column, "like", pattern);
  }
  ilike(column: string, pattern: string): this {
    return this.cond(column, "ilike", pattern);
  }
  is(column: string, value: boolean | null): this {
    return this.cond(column, "is", value);
  }
  in(column: string, values: readonly unknown[]): this {
    return this.cond(column, "in", [...values]);
  }
  contains(column: string, value: unknown): this {
    return this.cond(column, "cs", value);
  }
  containedBy(column: string, value: unknown): this {
    return this.cond(column, "cd", value);
  }
  overlaps(column: string, value: unknown): this {
    return this.cond(column, "ov", value);
  }
  match(query: Record<string, unknown>): this {
    for (const [column, value] of Object.entries(query)) this.cond(column, "eq", value);
    return this;
  }

  /**
   * A PostgREST-syntax condition. String values are parsed as PostgREST
   * would (`"(a,b)"` for in); JS values (null, numbers, arrays) are used as is.
   */
  private raw(column: string, operator: string, value: unknown, negate: boolean): this {
    return this.guarded(() => {
      const f =
        typeof value === "string"
          ? parseCondition(column, `${operator}.${value}`)
          : { ...parseCondition(column, operator), value };
      this.filters.push(negate ? { ...f, negate: !f.negate } : f);
    });
  }

  /** `.not("col", "is", null)`, `.not("col", "in", "(a,b)")`, ... */
  not(column: string, operator: string, value: unknown): this {
    return this.raw(column, operator, value, true);
  }

  /** Raw PostgREST filter: `.filter("status", "in", "(a,b)")`, `.filter("n", "not.eq", 3)`. */
  filter(column: string, operator: string, value: unknown): this {
    return this.raw(column, operator, value, false);
  }

  /** PostgREST logic tree: `"a.eq.1,b.is.null,and(c.gt.2,d.lt.5)"`. */
  or(expression: string, opts?: { referencedTable?: string; foreignTable?: string }): this {
    return this.guarded(() => {
      if (opts?.referencedTable || opts?.foreignTable) unsupported("or() on a referenced table");
      this.filters.push(parseOr(expression));
    });
  }

  /* -- modifiers ----------------------------------------------------- */

  order(
    column: string,
    opts?: { ascending?: boolean; nullsFirst?: boolean; referencedTable?: string; foreignTable?: string },
  ): this {
    return this.guarded(() => {
      if (opts?.referencedTable || opts?.foreignTable) unsupported("order() on a referenced table");
      const ascending = opts?.ascending ?? true;
      this.orders.push({ column, ascending, nullsFirst: opts?.nullsFirst ?? !ascending });
    });
  }

  limit(count: number, opts?: { referencedTable?: string; foreignTable?: string }): this {
    return this.guarded(() => {
      if (opts?.referencedTable || opts?.foreignTable) unsupported("limit() on a referenced table");
      this.limitN = Math.max(0, Math.floor(count));
    });
  }

  range(from: number, to: number, opts?: { referencedTable?: string; foreignTable?: string }): this {
    return this.guarded(() => {
      if (opts?.referencedTable || opts?.foreignTable) unsupported("range() on a referenced table");
      this.offsetN = Math.max(0, Math.floor(from));
      this.limitN = Math.max(0, Math.floor(to) - Math.floor(from) + 1);
    });
  }

  single(): this {
    this.singular = "single";
    return this;
  }

  maybeSingle(): this {
    this.singular = "maybe";
    return this;
  }

  throwOnError(): this {
    this.shouldThrow = true;
    return this;
  }

  /** Accepted for API parity; local queries finish synchronously enough. */
  abortSignal(_signal: AbortSignal): this {
    return this;
  }
  returns(): this {
    return this;
  }
  overrideTypes(): this {
    return this;
  }
  setHeader(_name: string, _value: string): this {
    return this;
  }

  csv(): this {
    return this.guarded(() => unsupported("csv()"));
  }
  explain(): this {
    return this.guarded(() => unsupported("explain()"));
  }
  textSearch(): this {
    return this.guarded(() => unsupported("textSearch()"));
  }

  /** Internal: fail on execution (rpc and friends). */
  fail(err: QueryError): this {
    this.deferred ??= err;
    return this;
  }

  /** Builder errors surface on await, like PostgREST's 400s, not as throws. */
  private guarded(fn: () => void): this {
    try {
      fn();
    } catch (err) {
      if (!(err instanceof QueryError)) throw err;
      this.deferred ??= err;
    }
    return this;
  }

  /* -- execution ----------------------------------------------------- */

  then<A = LocalResponse, B = never>(
    onfulfilled?: ((value: LocalResponse) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<LocalResponse> {
    try {
      if (this.deferred) throw this.deferred;
      const schema = tableSchema(this.table);
      if (!schema) throw noTable(this.table);
      return this.verb === "select" ? await this.runSelect(schema) : await this.runWrite(schema);
    } catch (err) {
      if (!(err instanceof QueryError)) throw err;
      if (this.shouldThrow) throw err;
      return failure(err);
    }
  }

  /** Columns exist and filter literals are cast, as Postgres plans the statement. */
  private prepare(schema: TableSchema, items: SelectItem[] | null): Filter[] {
    if (items) checkSelect(schema, items);
    for (const o of this.orders) columnOf(schema, o.column);
    return this.filters.map((f) => typedFilter(schema, f));
  }

  private async runSelect(schema: TableSchema): Promise<LocalResponse> {
    const items = parseSelect(this.columns);
    const filters = this.prepare(schema, items);
    const rows = await this.db.store.read(this.table);
    const matched = rows.filter((r) => matchesAll(filters, r));
    const count = this.countMode ? matched.length : null;
    if (this.head) return ok(null, count, 200);
    const sorted = sortRows(matched, this.orders);
    // Max Rows: never more than the cap, whatever the limit or range asked for (and no error about it).
    const take = Math.min(this.limitN ?? Number.POSITIVE_INFINITY, this.db.maxRows);
    const page = sorted.slice(this.offsetN, this.offsetN + take);
    return this.shape(asReturned(page, schema).map((r) => projectRow(r, items)), count, 200);
  }

  private shape(rows: Row[], count: number | null, status: number): LocalResponse {
    if (this.singular === "single") {
      if (rows.length !== 1) throw singleError(rows.length);
      return ok(rows[0], count, status);
    }
    if (this.singular === "maybe") {
      if (rows.length > 1) {
        throw new QueryError(
          "PGRST116",
          "JSON object requested, multiple (or no) rows returned",
          406,
          `Results contain ${rows.length} rows, application/vnd.pgrst.object+json requires 1 row`,
        );
      }
      return ok(rows[0] ?? null, count, status);
    }
    return ok(rows, count, status);
  }

  /** The keys of the rows this table's foreign keys point at, read before the write. */
  private async parentKeys(schema: TableSchema): Promise<ParentKeys> {
    const out: ParentKeys = new Map();
    for (const fk of schema.foreignKeys) {
      const parent = await this.db.store.read(fk.references);
      out.set(fk.name, new Set(parent.map((r) => r[fk.refColumn]).filter((v) => v !== null && v !== undefined).map(fkKey)));
    }
    return out;
  }

  private async runWrite(schema: TableSchema): Promise<LocalResponse> {
    const items = this.returning ? parseSelect(this.columns) : null;
    if ((this.verb === "update" || this.verb === "delete") && this.filters.length === 0) {
      throw new QueryError("21000", `${this.verb.toUpperCase()} requires a WHERE clause`);
    }
    const filters = this.prepare(schema, items);
    const now = formatTimestamptz(this.db.now().getTime());
    const parents: ParentKeys = this.verb === "delete" ? new Map() : await this.parentKeys(schema);
    if (this.verb === "delete") await this.db.restrictDelete(schema, filters);

    const affected = await this.db.store.mutate(this.table, (rows) => {
      const out = this.applyWrite(schema, filters, rows, now, parents);
      // .single() on a write is checked server-side: the write rolls back.
      if (items && this.singular === "single" && out.result.length !== 1) {
        throw singleError(out.result.length);
      }
      return out;
    });
    if (this.verb === "delete") await this.db.afterDelete(schema, affected);

    const count = this.countMode ? affected.length : null;
    const status = this.verb === "insert" || this.verb === "upsert" ? 201 : items ? 200 : 204;
    if (!items) return ok(null, count, status);
    const projected = asReturned(sortRows(affected, this.orders), schema).map((r) => projectRow(r, items));
    return this.shape(projected, count, status);
  }

  /** The ON CONFLICT target: the primary key, or exactly the columns of a unique constraint. */
  private conflictTarget(schema: TableSchema): string[] {
    if (!this.onConflict) return schema.primaryKey;
    const target = this.onConflict
      .split(",")
      .map((c) => c.trim().replace(/^"(.*)"$/, "$1"))
      .filter(Boolean);
    for (const c of target) if (!schema.columns.has(c)) throw noColumn(schema.name, c);
    const same = (cols: string[]) => cols.length === target.length && cols.every((c) => target.includes(c));
    if (!same(schema.primaryKey) && !schema.unique.some((u) => same(u.columns))) {
      throw new QueryError("42P10", "there is no unique or exclusion constraint matching the ON CONFLICT specification");
    }
    return target;
  }

  /** Returns the table's next rows (the same array when nothing changed) and the affected rows. */
  private applyWrite(schema: TableSchema, filters: Filter[], rows: readonly Row[], now: string, parents: ParentKeys): WriteResult {
    const table = this.table;
    const unchangedRef = rows as Row[];
    /** What Postgres checks on every row a statement writes. */
    const checkRows = (written: Row[], fkColumns?: Set<string>) => {
      assertNotNull(schema, written);
      assertChecks(schema, written);
      assertParents(schema, written, parents, fkColumns);
    };

    if (this.verb === "insert") {
      const inserted = prepareInputs(this.payload, this.defaultToNull).map((r) => withDefaults(schema, castRow(schema, r), now));
      if (inserted.length === 0) return { rows: unchangedRef, result: [] };
      checkRows(inserted);
      assertUnique(table, schema, rows, inserted);
      return { rows: [...rows, ...inserted], result: inserted };
    }

    if (this.verb === "update") {
      const raw = toJson(this.payload);
      if (!isRecord(raw)) throw new QueryError("PGRST102", "Empty or invalid json: update needs an object");
      const patch = castRow(schema, raw);
      const next = rows.slice();
      const changed: Row[] = [];
      const unchanged: Row[] = [];
      rows.forEach((row, i) => {
        if (!matchesAll(filters, row)) {
          unchanged.push(row);
          return;
        }
        const after = { ...row, ...structuredClone(patch) };
        runGuard(schema, row, after);
        next[i] = after;
        changed.push(after);
      });
      if (changed.length === 0) return { rows: unchangedRef, result: [] };
      checkRows(changed, new Set(Object.keys(patch)));
      assertUnique(table, schema, unchanged, changed);
      return { rows: next, result: changed };
    }

    if (this.verb === "upsert") {
      const inputs = prepareInputs(this.payload, this.defaultToNull).map((r) => castRow(schema, r));
      const target = this.conflictTarget(schema);
      const next = rows.slice();
      const index = new Map<string, number>();
      next.forEach((r, i) => {
        const k = keyOf(r, target);
        if (k !== null) index.set(k, i);
      });
      const touched = new Set<number>();
      const proposed = new Set<string>();
      const result: Row[] = [];
      for (const input of inputs) {
        const candidate = withDefaults(schema, input, now);
        // INSERT … ON CONFLICT checks the proposed row first: a partial row fails NOT NULL even when it would merge.
        assertNotNull(schema, [candidate]);
        assertChecks(schema, [candidate]);
        const k = keyOf(candidate, target);
        if (k !== null && proposed.has(k) && !this.ignoreDuplicates) {
          throw new QueryError(
            "21000",
            "ON CONFLICT DO UPDATE command cannot affect row a second time",
            400,
            "Ensure that no rows proposed for insertion within the same command have duplicate constrained values.",
          );
        }
        if (k !== null) proposed.add(k);
        const at = k === null ? undefined : index.get(k);
        if (at === undefined) {
          next.push(candidate);
          if (k !== null) index.set(k, next.length - 1);
          touched.add(next.length - 1);
          result.push(candidate);
        } else if (!this.ignoreDuplicates) {
          const before = next[at]!;
          const after = { ...before, ...input };
          runGuard(schema, before, after);
          next[at] = after;
          touched.add(at);
          result.push(after);
        }
      }
      if (touched.size === 0) return { rows: unchangedRef, result };
      const changed = [...touched].map((i) => next[i]!);
      checkRows(changed);
      assertUnique(
        table,
        schema,
        next.filter((_, i) => !touched.has(i)),
        changed,
      );
      return { rows: next, result };
    }

    // delete
    const kept: Row[] = [];
    const removed: Row[] = [];
    for (const row of rows) (matchesAll(filters, row) ? removed : kept).push(row);
    if (removed.length === 0) return { rows: unchangedRef, result: [] };
    return { rows: kept, result: removed };
  }
}

function singleError(n: number): QueryError {
  return new QueryError("PGRST116", "Cannot coerce the result to a single JSON object", 406, `The result contains ${n} rows`);
}

function unsupported(what: string): never {
  throw new QueryError("PGRST000", `${what} isn't supported by the local data backend`);
}

class LocalTable {
  private readonly db: LocalClient;
  private readonly table: string;

  constructor(db: LocalClient, table: string) {
    this.db = db;
    this.table = table;
  }

  select(columns?: string, opts?: { count?: CountMode; head?: boolean }): LocalQuery {
    return new LocalQuery(this.db, this.table, "select").select(columns, opts);
  }

  insert(values: unknown, opts?: { count?: CountMode; defaultToNull?: boolean }): LocalQuery {
    const q = new LocalQuery(this.db, this.table, "insert").withCount(opts?.count);
    q.payload = values;
    q.defaultToNull = opts?.defaultToNull ?? true;
    return q;
  }

  update(values: unknown, opts?: { count?: CountMode }): LocalQuery {
    const q = new LocalQuery(this.db, this.table, "update").withCount(opts?.count);
    q.payload = values;
    return q;
  }

  upsert(
    values: unknown,
    opts?: { onConflict?: string; ignoreDuplicates?: boolean; count?: CountMode; defaultToNull?: boolean },
  ): LocalQuery {
    const q = new LocalQuery(this.db, this.table, "upsert").withCount(opts?.count);
    q.payload = values;
    q.onConflict = opts?.onConflict;
    q.ignoreDuplicates = opts?.ignoreDuplicates ?? false;
    q.defaultToNull = opts?.defaultToNull ?? true;
    return q;
  }

  delete(opts?: { count?: CountMode }): LocalQuery {
    return new LocalQuery(this.db, this.table, "delete").withCount(opts?.count);
  }
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

/** Same shape as supabase-js's StorageApiError (`isStorageError` sees it). */
export class LocalStorageError extends Error {
  readonly __isStorageError = true;
  readonly status: number;
  readonly statusCode: string;

  constructor(message: string, status: number, statusCode: string) {
    super(message);
    this.name = "StorageApiError";
    this.status = status;
    this.statusCode = statusCode;
  }

  toJSON(): { name: string; message: string; status: number; statusCode: string } {
    return { name: this.name, message: this.message, status: this.status, statusCode: this.statusCode };
  }
}

type StorageResult<T> = { data: T; error: null } | { data: null; error: LocalStorageError };

const notFound = () => new LocalStorageError("Object not found", 400, "404");

function fileObject(bucket: string, name: string, meta: ObjectMeta) {
  return {
    name,
    bucket_id: bucket,
    id: meta.id,
    owner: "",
    created_at: meta.createdAt,
    updated_at: meta.updatedAt,
    last_accessed_at: meta.updatedAt,
    metadata: {
      size: meta.size,
      mimetype: meta.contentType,
      cacheControl: meta.cacheControl,
      lastModified: meta.updatedAt,
      contentLength: meta.size,
      httpStatusCode: 200,
    },
  };
}

class LocalBucket {
  private readonly db: LocalClient;
  private readonly bucket: string;

  constructor(db: LocalClient, bucket: string) {
    this.db = db;
    this.bucket = bucket;
  }

  private async run<T>(fn: () => Promise<T>): Promise<StorageResult<T>> {
    try {
      if (!this.db.buckets.includes(this.bucket)) throw new LocalStorageError("Bucket not found", 400, "404");
      return { data: await fn(), error: null };
    } catch (err) {
      if (err instanceof LocalStorageError) return { data: null, error: err };
      throw err;
    }
  }

  private clean(path: unknown): string {
    const p = cleanObjectPath(path);
    if (!p) throw new LocalStorageError("Invalid key", 400, "400");
    return p;
  }

  private secret(): string {
    if (!this.db.secret) {
      throw new LocalStorageError("Local file signing needs SESSION_SECRET in production", 500, "500");
    }
    return this.db.secret;
  }

  private nowSec(): number {
    return Math.floor(this.db.now().getTime() / 1000);
  }

  private async put(path: string, body: unknown, contentType: string | undefined, upsert: boolean, cacheControl?: string) {
    const { bytes, type } = await bodyBytes(body);
    if (bytes.byteLength > maxUploadBytes(this.bucket)) {
      throw new LocalStorageError("The object exceeded the maximum allowed size", 413, "413");
    }
    const storedType = contentType ?? type ?? "text/plain;charset=UTF-8";
    if (!bucketTakesType(this.bucket, storedType)) {
      throw new LocalStorageError(`mime type ${cleanContentType(storedType).split(";")[0]} is not supported`, 415, "415");
    }
    const result = await this.db.store.exclusive(() =>
      this.db.objects.put(this.bucket, path, bytes, {
        contentType: cleanContentType(contentType ?? type ?? "text/plain;charset=UTF-8"),
        cacheControl: `max-age=${cacheControl ?? "3600"}`,
        upsert,
        now: this.db.now().toISOString(),
      }),
    );
    if (result.status === "exists" || !result.meta) throw new LocalStorageError("The resource already exists", 400, "409");
    return result.meta;
  }

  upload(path: string, body: unknown, opts?: { contentType?: string; upsert?: boolean; cacheControl?: string }) {
    return this.run(async () => {
      const p = this.clean(path);
      const meta = await this.put(p, body, opts?.contentType, opts?.upsert ?? false, opts?.cacheControl);
      return { id: meta.id, path: p, fullPath: `${this.bucket}/${p}` };
    });
  }

  update(path: string, body: unknown, opts?: { contentType?: string; cacheControl?: string }) {
    return this.upload(path, body, { ...opts, upsert: true });
  }

  createSignedUploadUrl(path: string, opts?: { upsert?: boolean }) {
    return this.run(async () => {
      const p = this.clean(path);
      const op: SignedOp = opts?.upsert ? "upsert" : "put";
      const exp = this.nowSec() + UPLOAD_URL_TTL_SECONDS;
      const signedUrl = signedFileUrl(this.db.filesRoute, this.secret(), op, this.bucket, p, exp);
      const sig = new URL(signedUrl, "http://local").searchParams.get("sig") ?? "";
      return { signedUrl, token: `${op}.${exp}.${sig}`, path: p };
    });
  }

  uploadToSignedUrl(path: string, token: string, body: unknown, opts?: { contentType?: string; cacheControl?: string }) {
    return this.run(async () => {
      const p = this.clean(path);
      const [op, exp, sig] = String(token).split(".");
      if (op !== "put" && op !== "upsert") throw new LocalStorageError("Invalid signature", 400, "403");
      const check = verifyStorageSignature(this.secret(), op, this.bucket, p, exp, sig, this.nowSec());
      if (check !== "ok") throw new LocalStorageError(check === "expired" ? "Signed URL expired" : "Invalid signature", 400, "403");
      await this.put(p, body, opts?.contentType, op === "upsert", opts?.cacheControl);
      return { path: p, fullPath: `${this.bucket}/${p}` };
    });
  }

  createSignedUrl(path: string, expiresIn: number, opts?: { download?: string | boolean }) {
    return this.run(async () => {
      const p = this.clean(path);
      if (!(await this.db.objects.head(this.bucket, p))) throw notFound();
      return { signedUrl: this.signRead(p, expiresIn, opts?.download) };
    });
  }

  createSignedUrls(paths: string[], expiresIn: number, opts?: { download?: string | boolean }) {
    return this.run(async () => {
      this.secret(); // fail the whole call, not each item, when signing is off
      return Promise.all(
        paths.map(async (path) => {
          const p = cleanObjectPath(path);
          const exists = p ? await this.db.objects.head(this.bucket, p) : null;
          if (!p || !exists) {
            const error = "Either the object does not exist or you do not have access to it";
            return { error, path, signedURL: null, signedUrl: null };
          }
          const signedUrl = this.signRead(p, expiresIn, opts?.download);
          return { error: null, path, signedURL: signedUrl, signedUrl };
        }),
      );
    });
  }

  private signRead(path: string, expiresIn: number, download?: string | boolean): string {
    const exp = this.nowSec() + Math.max(1, Math.floor(expiresIn));
    const url = signedFileUrl(this.db.filesRoute, this.secret(), "get", this.bucket, path, exp);
    if (!download) return url;
    return `${url}&download=${encodeURIComponent(download === true ? "" : download)}`;
  }

  download(path: string) {
    return this.run(async () => {
      const obj = await this.db.objects.get(this.bucket, this.clean(path));
      if (!obj) throw notFound();
      return new Blob([obj.bytes as Uint8Array<ArrayBuffer>], { type: obj.meta.contentType });
    });
  }

  info(path: string) {
    return this.run(async () => {
      const p = this.clean(path);
      const meta = await this.db.objects.head(this.bucket, p);
      if (!meta) throw notFound();
      return {
        id: meta.id,
        name: p,
        bucketId: this.bucket,
        size: meta.size,
        contentType: meta.contentType,
        cacheControl: meta.cacheControl,
        createdAt: meta.createdAt,
        lastModified: meta.updatedAt,
        etag: null,
        metadata: {},
        version: null,
      };
    });
  }

  async exists(path: string): Promise<{ data: boolean; error: LocalStorageError | null }> {
    const res = await this.info(path);
    return res.error ? { data: false, error: res.error } : { data: true, error: null };
  }

  remove(paths: string[]) {
    return this.run(async () => {
      const removed = [];
      for (const path of paths) {
        const p = cleanObjectPath(path);
        if (!p) continue;
        const meta = await this.db.store.exclusive(() => this.db.objects.remove(this.bucket, p));
        if (meta) removed.push(fileObject(this.bucket, p, meta));
      }
      return removed;
    });
  }

  list(
    prefix?: string,
    opts?: { limit?: number; offset?: number; search?: string; sortBy?: { column?: string; order?: string } },
  ) {
    return this.run(async () => {
      const cleaned = prefix ? cleanObjectPath(prefix) : "";
      if (cleaned === null) throw new LocalStorageError("Invalid key", 400, "400");
      const { files, folders } = await this.db.objects.list(this.bucket, cleaned);
      const search = opts?.search?.toLowerCase() ?? "";
      type Entry = ReturnType<typeof fileObject> | {
        name: string;
        id: null;
        updated_at: null;
        created_at: null;
        last_accessed_at: null;
        metadata: null;
      };
      const entries: Entry[] = [
        ...folders.map((name) => ({ name, id: null, updated_at: null, created_at: null, last_accessed_at: null, metadata: null })),
        ...files.map((f) => fileObject(this.bucket, f.name, f.meta)),
      ].filter((e) => e.name.toLowerCase().startsWith(search));
      const column = opts?.sortBy?.column ?? "name";
      const dir = opts?.sortBy?.order === "desc" ? -1 : 1;
      const keyOfEntry = (e: Entry) => String((e as Record<string, unknown>)[column] ?? "");
      entries.sort((a, b) => (keyOfEntry(a) < keyOfEntry(b) ? -dir : keyOfEntry(a) > keyOfEntry(b) ? dir : 0));
      const offset = opts?.offset ?? 0;
      return entries.slice(offset, offset + (opts?.limit ?? 100));
    });
  }

  move(fromPath: string, toPath: string) {
    return this.run(async () => {
      await this.transfer(fromPath, toPath, true);
      return { message: "Successfully moved" };
    });
  }

  copy(fromPath: string, toPath: string) {
    return this.run(async () => {
      const to = await this.transfer(fromPath, toPath, false);
      return { path: to };
    });
  }

  private async transfer(fromPath: string, toPath: string, removeSource: boolean): Promise<string> {
    const from = this.clean(fromPath);
    const to = this.clean(toPath);
    const obj = await this.db.objects.get(this.bucket, from);
    if (!obj) throw notFound();
    await this.put(to, obj.bytes, obj.meta.contentType, false);
    if (removeSource) await this.db.store.exclusive(() => this.db.objects.remove(this.bucket, from));
    return to;
  }

  /** Buckets are private, so like Supabase this URL exists but won't serve. */
  getPublicUrl(path: string): { data: { publicUrl: string } } {
    const p = cleanObjectPath(path) ?? "";
    return { data: { publicUrl: `${this.db.filesRoute}/${encodeURIComponent(this.bucket)}/${p}` } };
  }
}

class LocalStorageApi {
  private readonly db: LocalClient;

  constructor(db: LocalClient) {
    this.db = db;
  }

  from(bucket: string): LocalBucket {
    return new LocalBucket(this.db, bucket);
  }

  private describe(id: string) {
    const epoch = new Date(0).toISOString();
    return {
      id,
      name: id,
      owner: "",
      public: false,
      file_size_limit: maxUploadBytes(id),
      allowed_mime_types: allowedContentTypes(id),
      created_at: epoch,
      updated_at: epoch,
    };
  }

  async getBucket(id: string) {
    if (!this.db.buckets.includes(id)) {
      return { data: null, error: new LocalStorageError("Bucket not found", 400, "404") };
    }
    return { data: this.describe(id), error: null };
  }

  async listBuckets() {
    return { data: this.db.buckets.map((id) => this.describe(id)), error: null };
  }
}

/* ------------------------------------------------------------------ */
/* Client                                                              */
/* ------------------------------------------------------------------ */

/** What /api/local-files needs: verify a signed request, read and write objects. */
export interface LocalFilesHandle {
  readonly route: string;
  verify(op: string, bucket: string, path: string, exp: unknown, sig: unknown): SignatureCheck;
  read(bucket: string, path: string): Promise<StoredObject | null>;
  write(
    bucket: string,
    path: string,
    bytes: Uint8Array,
    contentType: string,
    upsert: boolean,
  ): Promise<"created" | "updated" | "exists">;
  maxBytes(bucket: string): number;
  /** The bucket's allowed content types (Supabase's allowed_mime_types). */
  accepts(bucket: string, contentType: string): boolean;
}

export class LocalClient {
  /** Brand checked by localBackendOf (survives Next.js module duplication, unlike instanceof). */
  readonly isLocalBackend = true;
  readonly kind: LocalBackendKind;
  readonly dataDir: string | null;
  readonly store: TableStore;
  readonly objects: ObjectStore;
  readonly buckets: readonly string[];
  readonly filesRoute: string;
  readonly secret: string | null;
  readonly now: () => Date;
  readonly maxRows: number;
  readonly storage: LocalStorageApi;
  readonly files: LocalFilesHandle;

  constructor(opts: LocalClientOptions) {
    this.kind = opts.backend;
    this.dataDir = opts.backend === "file" ? resolve(opts.dataDir ?? defaultDataDir()) : null;
    this.store = this.dataDir ? createFileStore(this.dataDir) : createMemoryStore();
    this.objects = this.dataDir ? createFileObjects(this.dataDir) : createMemoryObjects();
    this.buckets = opts.buckets ?? DEFAULT_LOCAL_BUCKETS;
    this.filesRoute = opts.filesRoute ?? LOCAL_FILES_ROUTE;
    this.secret = opts.secret || (process.env.NODE_ENV === "production" ? null : DEV_FALLBACK_SECRET);
    this.now = opts.now ?? (() => new Date());
    this.maxRows = opts.maxRows && opts.maxRows > 0 ? Math.floor(opts.maxRows) : defaultMaxRows();
    this.storage = new LocalStorageApi(this);

    const secret = this.secret;
    this.files = {
      route: this.filesRoute,
      verify: (op, bucket, path, exp, sig) => {
        if (!secret || !this.buckets.includes(bucket) || cleanObjectPath(path) !== path) return "invalid";
        return verifyStorageSignature(secret, op, bucket, path, exp, sig, Math.floor(this.now().getTime() / 1000));
      },
      read: (bucket, path) => this.objects.get(bucket, path),
      write: async (bucket, path, bytes, contentType, upsert) => {
        const res = await this.store.exclusive(() =>
          this.objects.put(bucket, path, bytes, {
            contentType: cleanContentType(contentType),
            cacheControl: "max-age=3600",
            upsert,
            now: this.now().toISOString(),
          }),
        );
        return res.status;
      },
      maxBytes: maxUploadBytes,
      accepts: bucketTakesType,
    };
  }

  from(table: string): LocalTable {
    return new LocalTable(this, table);
  }

  /**
   * Foreign keys without ON DELETE (NO ACTION) or RESTRICT: a row another
   * table still points at can't be deleted (23503), checked before the delete.
   */
  async restrictDelete(schema: TableSchema, filters: Filter[]): Promise<void> {
    const blocking = schema.referencedBy.filter((f) => f.onDelete === "restrict" || f.onDelete === "no action");
    if (blocking.length === 0) return;
    const victims = (await this.store.read(schema.name)).filter((r) => matchesAll(filters, r));
    for (const fk of blocking) {
      const keys = new Set(victims.map((r) => r[fk.refColumn]).filter((v) => v !== null && v !== undefined).map(fkKey));
      if (keys.size === 0) continue;
      const hit = (await this.store.read(fk.table)).find((c) => c[fk.column] !== null && c[fk.column] !== undefined && keys.has(fkKey(c[fk.column])));
      if (hit) {
        throw new QueryError(
          "23503",
          `update or delete on table "${schema.name}" violates foreign key constraint "${fk.name}" on table "${fk.table}"`,
          409,
          `Key (${fk.refColumn})=(${String(hit[fk.column])}) is still referenced from table "${fk.table}".`,
        );
      }
    }
  }

  /** ON DELETE CASCADE and SET NULL, once the parent rows have gone (and their children's, in turn). */
  async afterDelete(schema: TableSchema, removed: readonly Row[]): Promise<void> {
    if (removed.length === 0) return;
    for (const fk of schema.referencedBy) {
      if (fk.onDelete !== "cascade" && fk.onDelete !== "set null") continue;
      const keys = new Set(removed.map((r) => r[fk.refColumn]).filter((v) => v !== null && v !== undefined).map(fkKey));
      if (keys.size === 0) continue;
      const refs = (r: Row) => r[fk.column] !== null && r[fk.column] !== undefined && keys.has(fkKey(r[fk.column]));
      if (fk.onDelete === "set null") {
        await this.store.mutate(fk.table, (rows) => ({
          rows: rows.some(refs) ? rows.map((r) => (refs(r) ? { ...r, [fk.column]: null } : r)) : (rows as Row[]),
          result: null,
        }));
        continue;
      }
      const gone = await this.store.mutate(fk.table, (rows) => {
        const kept: Row[] = [];
        const out: Row[] = [];
        for (const r of rows) (refs(r) ? out : kept).push(r);
        return { rows: out.length ? kept : (rows as Row[]), result: out };
      });
      const child = tableSchema(fk.table);
      if (child) await this.afterDelete(child, gone);
    }
  }

  rpc(fn: string): LocalQuery {
    return new LocalQuery(this, "rpc", "select").fail(
      new QueryError("PGRST202", `Could not find the function public.${fn}: the local data backend has no database functions`, 404),
    );
  }
}

/** A local client typed as the SupabaseClient every caller already expects. */
export function createLocalClient(opts: LocalClientOptions): SupabaseClient {
  return new LocalClient(opts) as unknown as SupabaseClient;
}

/** The local client behind a SupabaseClient, or null for a real Supabase client. */
export function localBackendOf(client: unknown): LocalClient | null {
  return client !== null && typeof client === "object" && (client as { isLocalBackend?: unknown }).isLocalBackend === true
    ? (client as LocalClient)
    : null;
}
