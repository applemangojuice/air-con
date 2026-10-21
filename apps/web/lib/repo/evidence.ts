import type { EvidenceRecord } from "@aircon/domain";
import { compact, db, isUniqueViolation, isUuid, must, optNum, optStr, uuidOrNull, type Row } from "./base";

/**
 * `install_evidence`: every reading, photo, serial and signature captured on
 * site. Append-only. The id is generated on the phone, so an offline retry
 * of the same capture hits the primary key and is treated as success, never
 * stored twice.
 */

const TABLE = "install_evidence";

export type StoredEvidence = EvidenceRecord & { id: string; projectId: string };

export function fromRow(row: Row): StoredEvidence {
  const gps = row.gps as { lat?: unknown; lng?: unknown } | null | undefined;
  return compact<StoredEvidence>({
    id: String(row.id),
    projectId: String(row.project_id),
    specId: String(row.spec_id),
    value: optNum(row.value),
    ref: optStr(row.ref),
    note: optStr(row.note),
    at: String(row.at),
    gps: gps && typeof gps.lat === "number" && typeof gps.lng === "number" ? { lat: gps.lat, lng: gps.lng } : undefined,
    by: String(row.by_name ?? ""),
    byStaffId: optStr(row.by_staff_id),
    mediaId: optStr(row.media_id),
  });
}

function toRow(projectId: string, record: EvidenceRecord & { id: string }): Row {
  return {
    id: record.id,
    project_id: projectId,
    spec_id: record.specId,
    value: record.value ?? null,
    ref: record.ref ?? null,
    note: record.note ?? null,
    media_id: uuidOrNull(record.mediaId),
    by_staff_id: uuidOrNull(record.byStaffId),
    by_name: record.by,
    at: record.at,
    gps: record.gps ?? null,
  };
}

/**
 * Append one capture. `duplicate: true` means this id was already stored
 * (an offline retry): success, nothing written. A record without a client
 * id gets a fresh one, so it can't dedupe.
 */
export async function appendIdempotent(
  projectId: string,
  record: EvidenceRecord,
): Promise<{ ok: true; id: string; duplicate: boolean }> {
  const id = record.id && record.id.length <= 200 ? record.id : crypto.randomUUID();
  const res = await db().from(TABLE).insert(toRow(projectId, { ...record, id }));
  if (isUniqueViolation(res.error)) return { ok: true, id, duplicate: true };
  must(res, "install_evidence insert");
  return { ok: true, id, duplicate: false };
}

/** The whole log for a project, in capture order (latest record per slot wins). */
export async function listForProject(projectId: string): Promise<StoredEvidence[]> {
  if (!isUuid(projectId)) return [];
  const data = must(
    await db().from(TABLE).select("*").eq("project_id", projectId).order("at", { ascending: true }),
    "install_evidence listForProject",
  );
  return (data ?? []).map(fromRow);
}
