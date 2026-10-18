import type { Learning } from "@aircon/domain";
import { db, isUuid, jsonObject, must, nowIso, type Row } from "./base";

/** `learnings`: answers to the end-of-day prompts, and whether we acted on them. */

const TABLE = "learnings";

export function fromRow(row: Row): Learning {
  return { ...jsonObject<Learning>(row.learning), id: String(row.id), projectId: String(row.project_id) };
}

export function toRow(learning: Learning): Row {
  return { id: learning.id, project_id: learning.projectId, status: learning.status, learning };
}

export async function get(id: string): Promise<Learning | null> {
  if (!isUuid(id)) return null;
  const data = must(await db().from(TABLE).select("*").eq("id", id).maybeSingle(), "learnings get");
  return data ? fromRow(data) : null;
}

export async function listForProject(projectId: string): Promise<Learning[]> {
  if (!isUuid(projectId)) return [];
  const data = must(
    await db().from(TABLE).select("*").eq("project_id", projectId).order("created_at", { ascending: false }),
    "learnings listForProject",
  );
  return (data ?? []).map(fromRow);
}

/** Across every pilot, newest first, e.g. the open ones to act on. */
export async function list(opts: { status?: Learning["status"] } = {}): Promise<Learning[]> {
  let q = db().from(TABLE).select("*");
  if (opts.status) q = q.eq("status", opts.status);
  const data = must(await q.order("created_at", { ascending: false }), "learnings list");
  return (data ?? []).map(fromRow);
}

export async function insert(learning: Learning): Promise<Learning> {
  const data = must(await db().from(TABLE).insert(toRow(learning)).select("*").single(), "learnings insert");
  return fromRow(data!);
}

export async function update(learning: Learning): Promise<Learning> {
  const data = must(
    await db()
      .from(TABLE)
      .update({ ...toRow(learning), updated_at: nowIso() })
      .eq("id", learning.id)
      .select("*")
      .maybeSingle(),
    "learnings update",
  );
  if (!data) throw new Error(`learnings update: ${learning.id} not found`);
  return fromRow(data);
}
