import type { Annotation, MediaItem, PhotoTag } from "@aircon/domain";
import { MEDIA_BUCKET } from "@/lib/supabase-server";
import { compact, db, isUuid, jsonArray, must, nowIso, optNum, optStr, type Row } from "./base";

/**
 * `media`: every photo, signature and document image, typed columns only
 * (annotations are the one JSON column). `annotationsVersion` increments on
 * each annotation save; `locked` freezes media a signed record depends on.
 */

const TABLE = "media";

const takenByOf = (v: unknown): MediaItem["takenBy"] =>
  typeof v === "object" && v !== null && ((v as { kind?: unknown }).kind === "staff" || (v as { kind?: unknown }).kind === "customer")
    ? (v as MediaItem["takenBy"])
    : undefined;

export function fromRow(row: Row): MediaItem {
  return compact<MediaItem>({
    id: String(row.id),
    projectId: row.project_id === null || row.project_id === undefined ? "" : String(row.project_id),
    bucket: String(row.bucket ?? MEDIA_BUCKET),
    storagePath: String(row.storage_path ?? ""),
    contentType: String(row.content_type ?? "application/octet-stream"),
    tag: String(row.tag ?? "other") as PhotoTag,
    roomId: optStr(row.room_id),
    caption: optStr(row.caption),
    source: String(row.source ?? "ops") as MediaItem["source"],
    takenBy: takenByOf(row.taken_by),
    takenAt: String(row.taken_at ?? row.created_at ?? ""),
    customerVisible: row.customer_visible === true,
    width: optNum(row.width),
    height: optNum(row.height),
    annotations: jsonArray<Annotation>(row.annotations),
    annotationsVersion: optNum(row.annotations_version) ?? 0,
    locked: row.locked === true,
  });
}

export function toRow(m: MediaItem): Row {
  return {
    id: m.id,
    // Staff media (profile photos, certificates) belongs to no project.
    project_id: isUuid(m.projectId) ? m.projectId : null,
    bucket: m.bucket,
    storage_path: m.storagePath,
    content_type: m.contentType,
    tag: m.tag,
    room_id: m.roomId ?? null,
    caption: m.caption ?? null,
    source: m.source,
    taken_by: m.takenBy ?? null,
    taken_at: m.takenAt,
    customer_visible: m.customerVisible,
    width: m.width ?? null,
    height: m.height ?? null,
    annotations: m.annotations,
    annotations_version: m.annotationsVersion,
    locked: m.locked,
  };
}

export async function get(id: string): Promise<MediaItem | null> {
  if (!isUuid(id)) return null;
  const data = must(await db().from(TABLE).select("*").eq("id", id).maybeSingle(), "media get");
  return data ? fromRow(data) : null;
}

export async function listByIds(ids: string[]): Promise<MediaItem[]> {
  const wanted = [...new Set(ids.filter(isUuid))];
  if (wanted.length === 0) return [];
  const data = must(await db().from(TABLE).select("*").in("id", wanted), "media listByIds");
  return (data ?? []).map(fromRow);
}

/** A project's media, newest first, optionally narrowed. */
export async function listForProject(
  projectId: string,
  opts: { tag?: PhotoTag; roomId?: string; source?: MediaItem["source"]; customerVisibleOnly?: boolean } = {},
): Promise<MediaItem[]> {
  if (!isUuid(projectId)) return [];
  let q = db().from(TABLE).select("*").eq("project_id", projectId);
  if (opts.tag) q = q.eq("tag", opts.tag);
  if (opts.roomId) q = q.eq("room_id", opts.roomId);
  if (opts.source) q = q.eq("source", opts.source);
  if (opts.customerVisibleOnly) q = q.eq("customer_visible", true);
  const data = must(await q.order("created_at", { ascending: false }), "media listForProject");
  return (data ?? []).map(fromRow);
}

export async function insert(item: MediaItem): Promise<MediaItem> {
  const data = must(await db().from(TABLE).insert(toRow(item)).select("*").single(), "media insert");
  return fromRow(data!);
}

export async function update(item: MediaItem): Promise<MediaItem> {
  const data = must(
    await db()
      .from(TABLE)
      .update({ ...toRow(item), updated_at: nowIso() })
      .eq("id", item.id)
      .select("*")
      .maybeSingle(),
    "media update",
  );
  if (!data) throw new Error(`media update: ${item.id} not found`);
  return fromRow(data);
}

/**
 * Save annotations only if nobody else saved since `expectedVersion` was
 * read, and never on locked media. Returns the new item, or null on a stale
 * write (reload and retry) or a locked item.
 */
export async function saveAnnotations(
  id: string,
  annotations: Annotation[],
  expectedVersion: number,
): Promise<MediaItem | null> {
  if (!isUuid(id)) return null;
  const data = must(
    await db()
      .from(TABLE)
      .update({ annotations, annotations_version: expectedVersion + 1, updated_at: nowIso() })
      .eq("id", id)
      .eq("annotations_version", expectedVersion)
      .eq("locked", false)
      .select("*"),
    "media saveAnnotations",
  );
  const row = (data ?? [])[0];
  return row ? fromRow(row as Row) : null;
}
