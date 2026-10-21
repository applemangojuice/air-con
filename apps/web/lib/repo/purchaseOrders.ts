import type { PoStatus, PurchaseOrder } from "@aircon/domain";
import { db, isUuid, jsonObject, must, nowIso, type Row } from "./base";

/**
 * `purchase_orders`: kit orders, one per supplier per project. The order,
 * its lines, receipts, inspection and history live in `po` JSONB.
 */

const TABLE = "purchase_orders";

/** Statuses still in flight: what the purchasing board chases. */
export const OPEN_PO_STATUSES: PoStatus[] = ["required", "approved", "ordered", "confirmed", "dispatched"];

export function fromRow(row: Row): PurchaseOrder {
  return { ...jsonObject<PurchaseOrder>(row.po), id: String(row.id), projectId: String(row.project_id) };
}

export function toRow(po: PurchaseOrder): Row {
  return { id: po.id, project_id: po.projectId, supplier: po.supplier, status: po.status, po };
}

export async function get(id: string): Promise<PurchaseOrder | null> {
  if (!isUuid(id)) return null;
  const data = must(await db().from(TABLE).select("*").eq("id", id).maybeSingle(), "purchase_orders get");
  return data ? fromRow(data) : null;
}

/** A project's orders, oldest first (the order they were raised). */
export async function listForProject(projectId: string): Promise<PurchaseOrder[]> {
  if (!isUuid(projectId)) return [];
  const data = must(
    await db().from(TABLE).select("*").eq("project_id", projectId).order("created_at", { ascending: true }),
    "purchase_orders listForProject",
  );
  return (data ?? []).map(fromRow);
}

/** Across projects, e.g. everything not yet delivered. */
export async function list(opts: { statuses?: PoStatus[] } = {}): Promise<PurchaseOrder[]> {
  let q = db().from(TABLE).select("*");
  if (opts.statuses) q = q.in("status", opts.statuses);
  const data = must(await q.order("created_at", { ascending: true }), "purchase_orders list");
  return (data ?? []).map(fromRow);
}

export async function insert(po: PurchaseOrder): Promise<PurchaseOrder> {
  const data = must(await db().from(TABLE).insert(toRow(po)).select("*").single(), "purchase_orders insert");
  return fromRow(data!);
}

export async function insertMany(pos: PurchaseOrder[]): Promise<PurchaseOrder[]> {
  if (pos.length === 0) return [];
  const data = must(await db().from(TABLE).insert(pos.map(toRow)).select("*"), "purchase_orders insertMany");
  return (data ?? []).map((r) => fromRow(r as Row));
}

export async function update(po: PurchaseOrder): Promise<PurchaseOrder> {
  const data = must(
    await db()
      .from(TABLE)
      .update({ ...toRow(po), updated_at: nowIso() })
      .eq("id", po.id)
      .select("*")
      .maybeSingle(),
    "purchase_orders update",
  );
  if (!data) throw new Error(`purchase_orders update: ${po.id} not found`);
  return fromRow(data);
}
