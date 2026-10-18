/**
 * What the local data backend knows about each table: keys, unique
 * constraints, SQL column defaults and the trigger-level guards that matter
 * for honesty. Mirrors supabase/migrations by hand, so keep it in step when
 * a migration adds a unique constraint or a default the app relies on.
 *
 * The local backend is otherwise schemaless: unknown columns read as null
 * and writes accept any keys. Tables not listed get the house defaults
 * (uuid `id` primary key, `created_at` / `updated_at` stamped on insert).
 */

export type Row = Record<string, unknown>;

export interface TableSchema {
  /** Primary key columns (never null, unique). */
  primaryKey: string[];
  /** Further unique constraints, each a column list. NULLs never collide (SQL semantics). */
  unique: string[][];
  /** SQL `default` values applied on insert when the column is absent. */
  defaults: Record<string, unknown>;
  /** Timestamp columns stamped with now on insert when absent. */
  stamps: string[];
  /** `id` defaults to `crypto.randomUUID()` when absent. */
  autoId: boolean;
  /**
   * Row-level trigger run on every update (including upsert merges).
   * Returns an error message to reject the change, null to allow it.
   */
  beforeUpdate?: (before: Row, after: Row) => string | null;
}

const BOTH_STAMPS = ["created_at", "updated_at"];
const CREATED_ONLY = ["created_at"];

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

type SchemaPatch = Partial<TableSchema>;

const TABLES: Record<string, SchemaPatch> = {
  // Existing tables (migrations 0001–0009).
  quote_requests: { stamps: CREATED_ONLY, defaults: { status: "new", source: "web" } },
  video_surveys: { stamps: CREATED_ONLY, defaults: { status: "uploaded" } },
  projects: {
    unique: [["quote_id"]],
    defaults: { completed: false, schema_version: 1, blocked: false },
  },
  properties: {
    defaults: {
      archetype_confidence: 0,
      planning_risk: "none",
      has_loft_conversion: false,
      audited: false,
      priority_score: 0,
      priority_band: "low",
      lead_status: "untouched",
    },
  },
  property_assessments: { stamps: CREATED_ONLY },
  analytics_events: { stamps: CREATED_ONLY },
  ops_notes: { stamps: CREATED_ONLY, defaults: { author: "ops" } },

  // Pilot platform (migration 0010, contract §E).
  staff: { unique: [["email"]] },
  customers: { unique: [["email"]] },
  login_tokens: { unique: [["token_hash"]], stamps: CREATED_ONLY },
  media: { defaults: { annotations: [] } },
  surveys: { unique: [["project_id", "version"]] },
  designs: { unique: [["project_id", "version"]] },
  proposals: { unique: [["project_id", "version"]], beforeUpdate: acceptedProposalGuard },
  compliance_items: { unique: [["project_id", "key"]] },
  install_jobs: { unique: [["project_id"]] },
  install_evidence: { stamps: CREATED_ONLY },
  time_entries: { stamps: CREATED_ONLY },
  invoices: { unique: [["number"]] },
  payments: { unique: [["provider_ref"]], stamps: CREATED_ONLY },
  messages: { unique: [["idempotency_key"]] },
  documents: { unique: [["ref"]], stamps: CREATED_ONLY },
  settings: { primaryKey: ["key"], autoId: false, stamps: ["updated_at"] },
  audit_log: { stamps: ["at"] },
};

export function tableSchema(table: string): TableSchema {
  const patch = TABLES[table] ?? {};
  return {
    primaryKey: patch.primaryKey ?? ["id"],
    unique: patch.unique ?? [],
    defaults: patch.defaults ?? {},
    stamps: patch.stamps ?? BOTH_STAMPS,
    autoId: patch.autoId ?? true,
    beforeUpdate: patch.beforeUpdate,
  };
}

/** Postgres names constraints `<table>_pkey` and `<table>_<cols>_key`. */
export function constraintName(table: string, columns: string[], primary: boolean): string {
  return primary ? `${table}_pkey` : `${table}_${columns.join("_")}_key`;
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
