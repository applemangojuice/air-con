import type { DocumentKind, DocumentRecord } from "@aircon/domain";
import { db, isUuid, jsonObject, must, optNum, type Row } from "./base";

/**
 * `documents`: printable documents, each an immutable snapshot with a unique
 * `ref`. A change is a new version with a new ref; the old one is marked
 * superseded (the only update a document normally gets).
 */

const TABLE = "documents";

export function fromRow(row: Row): DocumentRecord {
  const record = jsonObject<DocumentRecord>(row.record);
  return {
    ...record,
    id: String(row.id),
    projectId: String(row.project_id),
    version: optNum(row.version) ?? record.version ?? 1,
  };
}

export function toRow(doc: DocumentRecord): Row {
  return {
    id: doc.id,
    project_id: doc.projectId,
    kind: doc.kind,
    version: doc.version,
    ref: doc.ref,
    status: doc.status,
    customer_visible: doc.customerVisible,
    record: doc,
  };
}

export async function get(id: string): Promise<DocumentRecord | null> {
  if (!isUuid(id)) return null;
  const data = must(await db().from(TABLE).select("*").eq("id", id).maybeSingle(), "documents get");
  return data ? fromRow(data) : null;
}

export async function getByRef(ref: string): Promise<DocumentRecord | null> {
  const data = must(await db().from(TABLE).select("*").eq("ref", ref).maybeSingle(), "documents getByRef");
  return data ? fromRow(data) : null;
}

/** A project's documents, newest first. Customer pages pass `customerVisibleOnly`. */
export async function listForProject(
  projectId: string,
  opts: { kind?: DocumentKind; customerVisibleOnly?: boolean; includeSuperseded?: boolean } = {},
): Promise<DocumentRecord[]> {
  if (!isUuid(projectId)) return [];
  let q = db().from(TABLE).select("*").eq("project_id", projectId);
  if (opts.kind) q = q.eq("kind", opts.kind);
  if (opts.customerVisibleOnly) q = q.eq("customer_visible", true);
  if (!opts.includeSuperseded) q = q.neq("status", "superseded");
  const data = must(await q.order("created_at", { ascending: false }), "documents listForProject");
  return (data ?? []).map(fromRow);
}

/** The newest version of one kind (e.g. the current handover pack). */
export async function latestOfKind(projectId: string, kind: DocumentKind): Promise<DocumentRecord | null> {
  if (!isUuid(projectId)) return null;
  const data = must(
    await db()
      .from(TABLE)
      .select("*")
      .eq("project_id", projectId)
      .eq("kind", kind)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "documents latestOfKind",
  );
  return data ? fromRow(data) : null;
}

export async function insert(doc: DocumentRecord): Promise<DocumentRecord> {
  const data = must(await db().from(TABLE).insert(toRow(doc)).select("*").single(), "documents insert");
  return fromRow(data!);
}

/** Status and visibility changes only in practice; the snapshot itself never changes. */
export async function update(doc: DocumentRecord): Promise<DocumentRecord> {
  const data = must(
    await db().from(TABLE).update(toRow(doc)).eq("id", doc.id).select("*").maybeSingle(),
    "documents update",
  );
  if (!data) throw new Error(`documents update: ${doc.id} not found`);
  return fromRow(data);
}
