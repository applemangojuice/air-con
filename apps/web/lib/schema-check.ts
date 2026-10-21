import type { SupabaseClient } from "@supabase/supabase-js";
import { dataBackend, getServiceClient } from "./supabase-server";

/**
 * Is the database's schema what the app writes to? One implementation for
 * /api/health and /ops/status (lib/health.ts), /ops/launch (goLiveChecks),
 * the boot log (instrumentation.ts), the /login banner and the break-glass
 * fallback, so they can never disagree.
 *
 * Every probe is a GET (`select(cols).limit(0)`), never a HEAD: PostgREST
 * answers a missing table with a 404 (PGRST205), and on a HEAD request the
 * body is empty, which postgrest-js turns into a 204 with no error, so a
 * missing table would look present and empty.
 */

/** Every table the pilot platform writes (migration 0010_pilot_platform.sql). */
export const PILOT_TABLES = [
  "staff",
  "login_tokens",
  "customers",
  "media",
  "surveys",
  "designs",
  "proposals",
  "catalogue_items",
  "catalogue_compatibility",
  "purchase_orders",
  "compliance_items",
  "install_jobs",
  "install_evidence",
  "issues",
  "time_entries",
  "invoices",
  "payments",
  "messages",
  "documents",
  "learnings",
  "settings",
  "audit_log",
] as const;

/** Columns 0010 adds to tables earlier migrations made: the table is there, the pilot can't use it without them. */
export const PILOT_COLUMNS: { table: string; columns: string[] }[] = [
  { table: "projects", columns: ["schema_version", "customer_id", "pilot_number", "owner_staff_id", "next_action", "next_action_at", "value_pence", "blocked"] },
  { table: "media", columns: ["annotations_version", "locked"] },
];

/** The migration that creates them, for every message that says how to fix it. */
export const PILOT_MIGRATION = "supabase/migrations/0010_pilot_platform.sql";

/** The one-paste upgrade (0010 onwards, in one transaction) the founders' guide uses. */
export const PILOT_UPGRADE = "supabase/pilot-upgrade.sql";

/**
 * How to bring a Supabase database up to date, in the same words as
 * START-HERE-TOMORROW.md step 3, for every screen and log that says so.
 */
export const UPGRADE_HOW = `In Supabase → SQL Editor, paste and run ${PILOT_UPGRADE} (safe to run again; a brand-new, empty project first needs 0001 to 0009 from supabase/migrations, both 0006 files), then run supabase/check-schema.sql: it should say "All present".`;

type ErrorLike = { code?: string | null; message?: string | null } | null | undefined;

/**
 * PostgREST or Postgres saying a table or column isn't there: PGRST205 (not
 * in the schema cache), PGRST204 (no such column), 42P01 (undefined table),
 * 42703 (undefined column). Network or permission errors are not this.
 */
export function isMissingSchemaError(error: ErrorLike): boolean {
  if (!error) return false;
  if (["PGRST205", "PGRST204", "42P01", "42703"].includes(String(error.code ?? ""))) return true;
  return /could not find the (table|'[^']+' column)|relation .* does not exist|column .* does not exist/i.test(String(error.message ?? ""));
}

/**
 * Postgres refusing the server's own key: 42501, "permission denied for
 * table x". Supabase no longer grants new tables in `public` to its API roles
 * by default (projects created since 30 May 2026; existing projects for
 * tables made after 30 October 2026), and the service role bypasses RLS but
 * still needs the grant. A table made without migration 0014's grants is
 * there but unusable, and the fix is the same upgrade. Only for read probes:
 * an insert refused by RLS is 42501 too, and that isn't this.
 */
export function isPermissionDeniedError(error: ErrorLike): boolean {
  if (!error) return false;
  if (String(error.code ?? "") === "42501") return true;
  return /permission denied for (table|relation|schema|sequence)/i.test(String(error.message ?? ""));
}

export interface TableProbe {
  ok: boolean;
  /** Rows in the table (when the probe asked and it answered). */
  count: number | null;
  error: string | null;
  /**
   * The upgrade is what fixes it: the table (or a probed column) definitely
   * isn't there, or it is but the server's key isn't granted it (`denied`),
   * as opposed to an unreachable database.
   */
  missing: boolean;
  /** There, but the server's key isn't allowed to use it (42501: the grants in 0014 haven't run). */
  denied: boolean;
}

/** One table, by GET. With `columns`, checks those columns exist too. */
export async function probeTable(client: SupabaseClient, table: string, opts: { columns?: string[]; count?: boolean } = {}): Promise<TableProbe> {
  try {
    const columns = opts.columns?.length ? opts.columns.join(",") : "*";
    const query = opts.count ? client.from(table).select(columns, { count: "exact" }) : client.from(table).select(columns);
    const { error, count, status, data } = await query.limit(0);
    if (error) {
      if (isPermissionDeniedError(error)) {
        return {
          ok: false,
          count: null,
          error: `The server's key isn't allowed to use "${table}" (${error.message}). The upgrade grants it (migration 0014).`,
          missing: true,
          denied: true,
        };
      }
      return { ok: false, count: null, error: error.message, missing: isMissingSchemaError(error), denied: false };
    }
    // A real table answers a GET with an array (empty here). No body at all
    // (postgrest-js turns an empty 404 into "204, no error") is no answer:
    // unknown, never "present".
    if (!Array.isArray(data)) return { ok: false, count: null, error: `No answer for "${table}" (HTTP ${status})`, missing: false, denied: false };
    return { ok: true, count: opts.count ? (count ?? 0) : null, error: null, missing: false, denied: false };
  } catch (err) {
    return { ok: false, count: null, error: err instanceof Error ? err.message : String(err), missing: false, denied: false };
  }
}

export interface SchemaStatus {
  /** False when there's no Supabase database to check (demo mode or the local backend). */
  checked: boolean;
  missingTables: string[];
  /** "projects.schema_version" and the like. */
  missingColumns: string[];
  /** Tables that are there but the server's key isn't granted (42501): the upgrade's 0014 grants them. */
  deniedTables: string[];
  /** Probes that failed for another reason (unreachable, a bad key): unknown, never "missing". */
  errors: string[];
}

/** Everything the upgrade would fix, in words for a screen or a log ("staff", "projects.blocked", "media (not granted to the server's key)"). */
export function schemaProblems(s: Pick<SchemaStatus, "missingTables" | "missingColumns" | "deniedTables">): string[] {
  return [...s.missingTables, ...s.missingColumns, ...s.deniedTables.map((t) => `${t} (there, but not granted to the server's key)`)];
}

/** Does this database need the pilot upgrade (a table or column missing, or a table the server's key can't use)? */
export function needsUpgrade(s: Pick<SchemaStatus, "checked" | "missingTables" | "missingColumns" | "deniedTables"> | null | undefined): boolean {
  return Boolean(s?.checked && schemaProblems(s).length > 0);
}

/** Every pilot table and column, now. */
export async function checkPilotSchema(client: SupabaseClient | null = getServiceClient()): Promise<SchemaStatus> {
  if (!client || dataBackend() !== "supabase") return { checked: false, missingTables: [], missingColumns: [], deniedTables: [], errors: [] };
  const [tables, columns] = await Promise.all([
    Promise.all(PILOT_TABLES.map(async (t) => ({ t, r: await probeTable(client, t) }))),
    Promise.all(PILOT_COLUMNS.map(async (c) => ({ c, r: await probeTable(client, c.table, { columns: c.columns }) }))),
  ]);
  const missingTables: string[] = tables.filter((x) => x.r.missing && !x.r.denied).map((x) => x.t);
  const deniedTables: string[] = tables.filter((x) => x.r.denied).map((x) => x.t);
  const missingColumns: string[] = [];
  // The older tables 0010 adds columns to are checked for the grant too (a brand-new project's 0001 to 0009).
  for (const { c, r } of columns) if (r.denied && !deniedTables.includes(c.table)) deniedTables.push(c.table);
  for (const { c, r } of columns) {
    if (!r.missing || r.denied || missingTables.includes(c.table) || deniedTables.includes(c.table)) continue;
    // Name the columns that are missing (one probe each only when the group failed).
    const each = await Promise.all(c.columns.map(async (col) => ({ col, r: await probeTable(client, c.table, { columns: [col] }) })));
    const gone = each.filter((x) => x.r.missing && !x.r.denied).map((x) => `${c.table}.${x.col}`);
    missingColumns.push(...(gone.length ? gone : [`${c.table} (${c.columns.join(", ")})`]));
  }
  const errors = [...tables, ...columns].filter((x) => !x.r.ok && !x.r.missing).map((x) => x.r.error ?? "unreachable");
  return { checked: true, missingTables, missingColumns, deniedTables, errors };
}

const CACHE_MS = 60_000;
let cached: { at: number; status: SchemaStatus } | null = null;

/**
 * checkPilotSchema, remembered for a minute: for pages that ask on every
 * request (/login) and the break-glass fallback. A fixed schema shows up
 * within a minute; a failure to check is never cached.
 */
export async function pilotSchemaStatus(): Promise<SchemaStatus> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.status;
  const status = await checkPilotSchema();
  if (status.checked && status.errors.length === 0) cached = { at: Date.now(), status };
  return status;
}

/**
 * True only when the database definitely can't give the app its staff table
 * (sign-in can't work at all): it isn't there, or it is but the server's key
 * isn't granted it. Break-glass then falls back to the synthetic admin, so
 * /ops/status and /ops/launch can open and say what's wrong.
 */
export async function staffTableMissing(): Promise<boolean> {
  const s = await pilotSchemaStatus();
  return s.checked && (s.missingTables.includes("staff") || s.deniedTables.includes("staff"));
}

/** For tests: forget the remembered status. */
export function resetSchemaStatusCache(): void {
  cached = null;
}
