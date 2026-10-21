import type { ComplianceItem } from "@aircon/domain";
import { db, isUuid, jsonObject, must, nowIso, type Row } from "./base";

/**
 * `compliance_items`: the per-project checklist, one row per template key
 * (unique on project + key). Readiness reads these to decide what blocks a
 * gate.
 */

const TABLE = "compliance_items";

export function fromRow(row: Row): ComplianceItem {
  return { ...jsonObject<ComplianceItem>(row.item), id: String(row.id), projectId: String(row.project_id) };
}

export function toRow(item: ComplianceItem): Row {
  return {
    id: item.id,
    project_id: item.projectId,
    key: item.key,
    status: item.status,
    statutory: item.statutory,
    item,
  };
}

export async function get(id: string): Promise<ComplianceItem | null> {
  if (!isUuid(id)) return null;
  const data = must(await db().from(TABLE).select("*").eq("id", id).maybeSingle(), "compliance get");
  return data ? fromRow(data) : null;
}

export async function getByKey(projectId: string, key: string): Promise<ComplianceItem | null> {
  if (!isUuid(projectId)) return null;
  const data = must(
    await db().from(TABLE).select("*").eq("project_id", projectId).eq("key", key).maybeSingle(),
    "compliance getByKey",
  );
  return data ? fromRow(data) : null;
}

export async function listForProject(projectId: string): Promise<ComplianceItem[]> {
  if (!isUuid(projectId)) return [];
  const data = must(
    await db().from(TABLE).select("*").eq("project_id", projectId).order("created_at", { ascending: true }),
    "compliance listForProject",
  );
  return (data ?? []).map(fromRow);
}

/**
 * Add checklist items, skipping keys the project already has, so
 * instantiating twice (or after a template gains an item) is safe.
 */
export async function insertMany(items: ComplianceItem[]): Promise<number> {
  if (items.length === 0) return 0;
  must(
    await db().from(TABLE).upsert(items.map(toRow), { onConflict: "project_id,key", ignoreDuplicates: true }),
    "compliance insertMany",
  );
  return items.length;
}

export async function update(item: ComplianceItem): Promise<ComplianceItem> {
  const data = must(
    await db()
      .from(TABLE)
      .update({ ...toRow(item), updated_at: nowIso() })
      .eq("id", item.id)
      .select("*")
      .maybeSingle(),
    "compliance update",
  );
  if (!data) throw new Error(`compliance update: ${item.id} not found`);
  return fromRow(data);
}
