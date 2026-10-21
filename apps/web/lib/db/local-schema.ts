/**
 * What the local data backend knows about each table, so it refuses what
 * Supabase refuses:
 *
 *   - from db-schema.generated.ts (generated from the migrated database, and
 *     checked against it by supabase/tests/run-migrations.sh): every column
 *     with its type, NOT NULL and default, the primary key, unique
 *     constraints, foreign keys and the names of checks and partial or
 *     expression unique indexes;
 *   - by hand, here: what those named indexes index and what the checks
 *     check, and the trigger-level guards that matter for honesty
 *     (`acceptedProposalGuard`, migration 0010). A unit test
 *     (tests/local-schema.test.ts) fails when a migration adds an index or a
 *     check this file doesn't mirror.
 *
 * A table that isn't in the migrations doesn't exist (42P01), and a column
 * that isn't in its table doesn't either (42703 / PGRST204).
 */

import { DB_SCHEMA, type DbTable } from "./db-schema.generated.ts";
import { columnType, type ColumnType } from "./local-types.ts";

export type Row = Record<string, unknown>;

export type ColumnDefault = { kind: "value"; value: unknown } | { kind: "now" } | { kind: "uuid" };

export interface ColumnSchema {
  name: string;
  type: ColumnType;
  notNull: boolean;
  default: ColumnDefault | null;
}

export interface ForeignKey {
  name: string;
  column: string;
  references: string;
  refColumn: string;
  onDelete: "cascade" | "set null" | "set default" | "restrict" | "no action";
}

export interface TableSchema {
  name: string;
  columns: ReadonlyMap<string, ColumnSchema>;
  /** Primary key columns (never null, unique). */
  primaryKey: string[];
  /** Unique constraints: the only column sets ON CONFLICT can name. NULLs never collide (SQL semantics). */
  unique: { name: string; columns: string[] }[];
  /**
   * Unique indexes on expressions, or partial ones (`… where …`), by their
   * migration name: `key` gives the indexed values, or null for a row the
   * index leaves out (its `where` is false, or a value is NULL).
   */
  uniqueIndexes: { name: string; key: (row: Row) => unknown[] | null }[];
  /** Foreign keys from this table, and those pointing at it (for deletes). */
  foreignKeys: ForeignKey[];
  referencedBy: (ForeignKey & { table: string })[];
  /** Check constraints: `ok` is false for a row the check refuses (NULL passes, as in SQL). */
  checks: { name: string; ok: (row: Row) => boolean }[];
  /**
   * Row-level trigger run on every update (including upsert merges).
   * Returns an error message to reject the change, null to allow it.
   */
  beforeUpdate?: (before: Row, after: Row) => string | null;
}

/** A jsonb column's text field, as `col->>'field'` reads it (absent: null). */
const jsonText = (row: Row, col: string, field: string): string | null => {
  const obj = row[col];
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return null;
  const v = (obj as Row)[field];
  if (v === undefined || v === null) return null;
  return typeof v === "string" ? v : canonicalJson(v);
};
/** `col ? 'field'`: the jsonb object has the key (even with a JSON null). */
const jsonHas = (row: Row, col: string, field: string): boolean => {
  const obj = row[col];
  return typeof obj === "object" && obj !== null && !Array.isArray(obj) && field in (obj as Row);
};

const recordOf = (row: Row): Row => {
  const r = row.record;
  return typeof r === "object" && r !== null && !Array.isArray(r) ? (r as Row) : {};
};

/** `timestamptz is distinct from`: the same instant however it's written, else the same value. */
function sameInstant(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  const ta = Date.parse(String(a));
  const tb = Date.parse(String(b));
  return Number.isFinite(ta) && Number.isFinite(tb) ? ta === tb : String(a) === String(b);
}

/**
 * Proposals are immutable once accepted: the same rule as migration 0010's
 * `proposals_guard_accepted` trigger, kept in step by hand. A row is frozen
 * when it's accepted, or superseded with an acceptance record (accepted, then
 * replaced: otherwise accepted → superseded → edit would get round the rule).
 * The one permitted change to a frozen row is (re)stating it superseded,
 * leaving the options, the acceptance record, the project, the version and
 * `accepted_at` exactly as they were.
 */
function acceptedProposalGuard(before: Row, after: Row): string | null {
  const acceptance = recordOf(before).acceptance;
  const wasAccepted = typeof acceptance === "object" && acceptance !== null && !Array.isArray(acceptance);
  const frozen = before.status === "accepted" || (before.status === "superseded" && wasAccepted);
  if (!frozen) return null;
  const unchanged =
    after.status === "superseded" &&
    canonicalJson(recordOf(before).options) === canonicalJson(recordOf(after).options) &&
    canonicalJson(recordOf(before).acceptance) === canonicalJson(recordOf(after).acceptance) &&
    (before.project_id ?? null) === (after.project_id ?? null) &&
    canonicalJson(before.version) === canonicalJson(after.version) &&
    sameInstant(before.accepted_at, after.accepted_at);
  return unchanged ? null : `proposal ${String(before.id)} is accepted and can't be changed (only superseded)`;
}

/** What each partial or expression unique index (by migration name) indexes. */
export const UNIQUE_INDEX_KEYS: Record<string, (row: Row) => unknown[] | null> = {
  // 0013: pilot numbers are unique, where not null.
  projects_pilot_number_key: (r) => (r.pilot_number === null || r.pilot_number === undefined ? null : [r.pilot_number]),
  // 0013: one invoice per request (`invoice->>'requestId'`, where the key is there).
  invoices_request_id_key: (r) => (jsonHas(r, "invoice", "requestId") ? [jsonText(r, "invoice", "requestId")] : null),
  // 0013: one invoice per project per invoice count (`project_id, invoice->>'issueKey'`).
  invoices_issue_key: (r) => (jsonHas(r, "invoice", "issueKey") ? [r.project_id, jsonText(r, "invoice", "issueKey")] : null),
};

const atLeast = (col: string, min: number) => (r: Row) => r[col] === null || r[col] === undefined || Number(r[col]) >= min;
const oneOf = (col: string, values: string[]) => (r: Row) => r[col] === null || r[col] === undefined || values.includes(String(r[col]));

/** What each check constraint (by migration name) checks. */
export const CHECKS: Record<string, (row: Row) => boolean> = {
  login_tokens_subject_kind_check: oneOf("subject_kind", ["staff", "customer"]),
  surveys_minutes_check: atLeast("minutes", 0),
  surveys_version_check: atLeast("version", 1),
  designs_version_check: atLeast("version", 1),
  proposals_version_check: atLeast("version", 1),
  proposals_status_check: oneOf("status", ["draft", "issued", "accepted", "declined", "superseded", "expired"]),
  issues_number_check: atLeast("number", 1),
  time_entries_minutes_check: atLeast("minutes", 0),
  documents_version_check: atLeast("version", 1),
};

const GUARDS: Record<string, (before: Row, after: Row) => string | null> = {
  proposals: acceptedProposalGuard,
};

/** A column default from its SQL (the handful of forms the migrations use). */
export function parseDefault(sql: string | null, where: string): ColumnDefault | null {
  if (sql === null) return null;
  if (sql === "now()") return { kind: "now" };
  if (sql === "gen_random_uuid()") return { kind: "uuid" };
  if (/^-?\d+(\.\d+)?$/.test(sql)) return { kind: "value", value: Number(sql) };
  if (sql === "true" || sql === "false") return { kind: "value", value: sql === "true" };
  const lit = /^'((?:[^']|'')*)'::(text|jsonb|text\[\])$/.exec(sql);
  if (lit) {
    const text = lit[1]!.replace(/''/g, "'");
    if (lit[2] === "text") return { kind: "value", value: text };
    if (lit[2] === "jsonb") return { kind: "value", value: JSON.parse(text) as unknown };
    if (text === "{}") return { kind: "value", value: [] };
  }
  throw new Error(`local data backend: can't mirror the default ${sql} of ${where} (lib/db/local-schema.ts parseDefault)`);
}

function build(name: string, t: DbTable): TableSchema {
  const columns = new Map<string, ColumnSchema>();
  for (const [col, pgType, notNull, def] of t.columns) {
    columns.set(col, { name: col, type: columnType(pgType), notNull, default: parseDefault(def, `${name}.${col}`) });
  }
  const uniqueIndexes = t.uniqueIndexes.map((index) => {
    const key = UNIQUE_INDEX_KEYS[index];
    if (!key) throw new Error(`local data backend: unique index ${index} (on ${name}) isn't mirrored in UNIQUE_INDEX_KEYS (lib/db/local-schema.ts)`);
    return { name: index, key };
  });
  const checks = t.checks.map((check) => {
    const ok = CHECKS[check];
    if (!ok) throw new Error(`local data backend: check constraint ${check} (on ${name}) isn't mirrored in CHECKS (lib/db/local-schema.ts)`);
    return { name: check, ok };
  });
  const referencedBy = Object.entries(DB_SCHEMA).flatMap(([table, other]) =>
    other.foreignKeys.filter((f) => f.references === name).map((f) => ({ ...f, table })),
  );
  return {
    name,
    columns,
    primaryKey: [...t.primaryKey],
    unique: t.unique.map((u) => ({ name: u.name, columns: [...u.columns] })),
    uniqueIndexes,
    foreignKeys: t.foreignKeys.map((f) => ({ ...f })),
    referencedBy,
    checks,
    beforeUpdate: GUARDS[name],
  };
}

const CACHE = new Map<string, TableSchema>();

/** The table as the migrations make it, or null when there's no such table. */
export function tableSchema(table: string): TableSchema | null {
  const cached = CACHE.get(table);
  if (cached) return cached;
  const t = Object.prototype.hasOwnProperty.call(DB_SCHEMA, table) ? DB_SCHEMA[table] : undefined;
  if (!t) return null;
  const schema = build(table, t);
  CACHE.set(table, schema);
  return schema;
}

/** Every table the migrations make. */
export function tableNames(): string[] {
  return Object.keys(DB_SCHEMA).sort();
}

/** JSON with sorted object keys, so equal values serialise identically. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Row;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}
