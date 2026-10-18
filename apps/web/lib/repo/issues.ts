import { isOpen, type Issue } from "@aircon/domain";
import { db, isUuid, jsonObject, must, nowIso, optNum, type Row } from "./base";

/**
 * `issues`: defects, snags, shortages, blockers and variations. `number` is
 * the per-project counter people say out loud ("Issue #3").
 */

const TABLE = "issues";

export function fromRow(row: Row): Issue {
  const issue = jsonObject<Issue>(row.issue);
  return { ...issue, id: String(row.id), projectId: String(row.project_id), number: optNum(row.number) ?? issue.number };
}

export function toRow(issue: Issue): Row {
  return {
    id: issue.id,
    project_id: issue.projectId,
    number: issue.number,
    kind: issue.kind,
    status: issue.status,
    severity: issue.severity,
    blocking: issue.blocking,
    issue,
  };
}

export async function get(id: string): Promise<Issue | null> {
  if (!isUuid(id)) return null;
  const data = must(await db().from(TABLE).select("*").eq("id", id).maybeSingle(), "issues get");
  return data ? fromRow(data) : null;
}

/** A project's issues by number. */
export async function listForProject(projectId: string, opts: { openOnly?: boolean } = {}): Promise<Issue[]> {
  if (!isUuid(projectId)) return [];
  const data = must(
    await db().from(TABLE).select("*").eq("project_id", projectId).order("number", { ascending: true }),
    "issues listForProject",
  );
  const issues = (data ?? []).map(fromRow);
  return opts.openOnly ? issues.filter(isOpen) : issues;
}

/** Open issues across every project, newest first (the ops exception list). */
export async function listOpen(): Promise<Issue[]> {
  const data = must(
    await db()
      .from(TABLE)
      .select("*")
      .in("status", ["open", "in-progress", "awaiting-customer"])
      .order("created_at", { ascending: false }),
    "issues listOpen",
  );
  return (data ?? []).map(fromRow);
}

/**
 * The next per-project number. Not unique in the schema: two issues raised
 * in the same instant could share a number, which is cosmetic (ids differ).
 */
export async function nextNumber(projectId: string): Promise<number> {
  if (!isUuid(projectId)) return 1;
  const data = must(
    await db()
      .from(TABLE)
      .select("number")
      .eq("project_id", projectId)
      .order("number", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "issues nextNumber",
  );
  return (optNum((data as Row | null)?.number) ?? 0) + 1;
}

export async function insert(issue: Issue): Promise<Issue> {
  const data = must(await db().from(TABLE).insert(toRow(issue)).select("*").single(), "issues insert");
  return fromRow(data!);
}

export async function update(issue: Issue): Promise<Issue> {
  const data = must(
    await db()
      .from(TABLE)
      .update({ ...toRow(issue), updated_at: nowIso() })
      .eq("id", issue.id)
      .select("*")
      .maybeSingle(),
    "issues update",
  );
  if (!data) throw new Error(`issues update: ${issue.id} not found`);
  return fromRow(data);
}
