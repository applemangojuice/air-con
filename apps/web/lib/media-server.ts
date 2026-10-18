import {
  MEDIA_MAX_BYTES,
  MEDIA_UPLOAD_CONTENT_TYPES,
  PHOTO_TAGS,
  can,
  validateAnnotations,
  type Annotation,
  type MediaItem,
  type Permission,
  type PhotoTag,
  type Point,
  type StaffMember,
} from "@aircon/domain";
import { base64urlDecode, base64urlEncode, constantTimeEqual, hmacSha256Hex, sessionSecret } from "./auth/session.ts";
import { cleanObjectPath } from "./db/local-storage.ts";
import { db, isUniqueViolation, isUuid, must } from "./repo/base";
import * as mediaRepo from "./repo/media";
import { MEDIA_BUCKET } from "./supabase-server.ts";

/**
 * Project media on the server: upload URLs, registration, signed read URLs
 * and edits, for every feature that takes a photo (survey, install,
 * handover, ops). Works the same on Supabase Storage and the local backend.
 *
 * Upload flow (the row exists only once the file does):
 *   1. `createMediaUpload` mints the media id, the object path
 *      `<projectId>/<mediaId>-<safeName>`, a signed upload URL, and an upload
 *      ticket: the row-to-be (project, path, type, tag, who took it), signed
 *      with SESSION_SECRET and valid as long as the upload URL (2 hours).
 *   2. The browser PUTs the bytes to the signed URL (lib/media-client.ts).
 *   3. `registerMedia(ticket)` checks the signature, that the object arrived,
 *      its size and its content type, then inserts the media row under the
 *      minted id. Idempotent: confirming twice returns the same row.
 * So there are no half-made "pending" rows, and nothing the browser sends at
 * confirm time (path, tag, uploader) is trusted: it all comes from the ticket.
 * An upload that's never confirmed leaves an orphan object, not a row.
 *
 * Size is enforced by storage itself (the local route's 25 MB ceiling;
 * the bucket limit on Supabase) and checked again at registration.
 * SVG is only ever stored by the system (`storeSystemMedia`: demo photos,
 * generated drawings), never accepted from an upload.
 *
 * Permissions are the caller's job: routes check the staff member's
 * permission for the media's source (`canWriteMedia`) and their access to
 * the project (`requireProjectAccess`) before calling anything here.
 */

/* ------------------------------------------------------------------ */
/* Rules (pure)                                                        */
/* ------------------------------------------------------------------ */

export class MediaError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "MediaError";
    this.status = status;
  }
}

/** What a phone or laptop may upload: the domain's shared rule (iPhone .mov included). */
export const MEDIA_CONTENT_TYPES = MEDIA_UPLOAD_CONTENT_TYPES;
/** Plus what only the system stores (generated drawings, demo photos). */
export const SYSTEM_MEDIA_CONTENT_TYPES = [...MEDIA_CONTENT_TYPES, "image/svg+xml"] as const;

/** The same ceiling as the local storage route (the domain's shared rule). */
export { MEDIA_MAX_BYTES };

/** The signed upload URL's lifetime on both backends; tickets last as long. */
export const UPLOAD_TICKET_TTL_SECONDS = 2 * 60 * 60;

export const MEDIA_SOURCES: MediaItem["source"][] = ["customer", "survey", "install", "handover", "ops"];

/** Who may add (or confirm) media from each source: any one of these permissions. */
export const MEDIA_WRITE_PERMISSIONS: Record<MediaItem["source"], Permission[]> = {
  survey: ["survey.conduct", "projects.edit"],
  install: ["install.work", "projects.edit"],
  handover: ["install.work", "projects.edit"],
  ops: ["projects.edit"],
  // A customer's photo added on their behalf by the office.
  customer: ["projects.edit"],
};

/** Who may edit media (tags, captions, drawings) once it exists. */
export const MEDIA_EDIT_PERMISSIONS: Permission[] = ["survey.conduct", "install.work", "projects.edit"];

export function canWriteMedia(staff: StaffMember, source: MediaItem["source"]): boolean {
  return (MEDIA_WRITE_PERMISSIONS[source] ?? []).some((p) => can(staff, p));
}

export function canEditMedia(staff: StaffMember): boolean {
  return MEDIA_EDIT_PERMISSIONS.some((p) => can(staff, p));
}

/** "Image/JPG; charset=x" → "image/jpeg". */
export function normaliseContentType(contentType: string | null | undefined): string {
  const base = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  return base === "image/jpg" ? "image/jpeg" : base;
}

export function mediaContentTypeAllowed(contentType: string, opts: { system?: boolean } = {}): boolean {
  const ct = normaliseContentType(contentType);
  const allowed: readonly string[] = opts.system ? SYSTEM_MEDIA_CONTENT_TYPES : MEDIA_CONTENT_TYPES;
  return allowed.includes(ct);
}

const EXTENSION: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/svg+xml": ".svg",
  "application/pdf": ".pdf",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
};

/**
 * A file name safe inside an object path: no directories, only letters,
 * digits, dot, dash and underscore, no leading dots, at most 80 characters
 * (the extension kept), and an extension matching the content type when
 * the name had none. "../../etc/passwd" → "passwd"; "Living room 1.JPG"
 * → "Living_room_1.JPG"; ".jpg" → "file.jpg".
 */
export function safeMediaName(fileName: string, contentType?: string): string {
  const base = String(fileName ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // accents off: "Café" → "Cafe"
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/_{2,}/g, "_")
    .replace(/\.+$/, "");
  const ext = /\.[a-zA-Z0-9]{1,8}$/.exec(cleaned)?.[0] ?? "";
  let stem = cleaned.slice(0, cleaned.length - ext.length).replace(/^[._-]+/, "").replace(/[._-]+$/, "");
  if (!/[a-zA-Z0-9]/.test(stem)) stem = "file";
  if (stem.length + ext.length > 80) stem = stem.slice(0, 80 - ext.length).replace(/[._-]+$/, "");
  const wanted = contentType ? EXTENSION[normaliseContentType(contentType)] : undefined;
  return `${stem}${ext || wanted || ""}`;
}

/** `<projectId>/<mediaId>-<safeName>`, lower-case ids. Throws on ids that aren't uuids. */
export function mediaObjectPath(projectId: string, mediaId: string, fileName: string, contentType?: string): string {
  if (!isUuid(projectId)) throw new MediaError("Unknown project.", 404);
  if (!isUuid(mediaId)) throw new MediaError("Bad media id.");
  const path = `${projectId.toLowerCase()}/${mediaId.toLowerCase()}-${safeMediaName(fileName, contentType)}`;
  if (cleanObjectPath(path) !== path) throw new MediaError("That file name can't be stored.");
  return path;
}

/** Is this exactly one of this project's media paths, for this media id? */
export function isProjectMediaPath(projectId: string, mediaId: string, path: string): boolean {
  if (!isUuid(projectId) || !isUuid(mediaId) || cleanObjectPath(path) !== path) return false;
  const parts = path.split("/");
  return (
    parts.length === 2 &&
    parts[0] === projectId.toLowerCase() &&
    parts[1]!.startsWith(`${mediaId.toLowerCase()}-`) &&
    parts[1]!.length > mediaId.length + 1
  );
}

/* ------------------------------------------------------------------ */
/* Annotations                                                         */
/* ------------------------------------------------------------------ */

export const MAX_ANNOTATIONS = 100;
const MAX_ROUTE_POINTS = 64;

const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");
const rec = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

function pointOf(v: unknown): Point | null {
  const r = rec(v);
  const x = finite(r?.x);
  const y = finite(r?.y);
  return x === null || y === null ? null : { x: clamp01(x), y: clamp01(y) };
}

/**
 * A lenient cleaner with the validator's contract: normalised 0..1
 * coordinates (clamped), known shapes only, junk dropped, short labels,
 * unique ids. Never throws. Saves go through F2's strict
 * `validateAnnotations` (validateAnnotationsSafe below); this is for reading
 * drawings of unknown provenance without refusing them.
 */
export function cleanAnnotations(input: unknown): Annotation[] {
  if (!Array.isArray(input)) return [];
  const out: Annotation[] = [];
  const ids = new Set<string>();
  const idFor = (raw: unknown, i: number) => {
    let id = typeof raw === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : `a${i + 1}`;
    while (ids.has(id)) id = `${id}-${i + 1}`;
    ids.add(id);
    return id;
  };
  for (const [i, raw] of input.slice(0, MAX_ANNOTATIONS * 2).entries()) {
    if (out.length >= MAX_ANNOTATIONS) break;
    const a = rec(raw);
    if (!a) continue;
    const label = text(a.label, 80);
    const withLabel = label ? { label } : {};
    switch (a.type) {
      case "indoor-unit":
      case "outdoor-unit": {
        const x = finite(a.x);
        const y = finite(a.y);
        const w = finite(a.w);
        const h = finite(a.h);
        if (x === null || y === null || w === null || h === null) continue;
        const cx = clamp01(x);
        const cy = clamp01(y);
        const cw = Math.min(clamp01(w), 1 - cx);
        const ch = Math.min(clamp01(h), 1 - cy);
        if (cw <= 0 || ch <= 0) continue;
        out.push({ id: idFor(a.id, i), type: a.type, x: cx, y: cy, w: cw, h: ch, ...withLabel });
        break;
      }
      case "core-hole": {
        const p = pointOf(a);
        if (p) out.push({ id: idFor(a.id, i), type: "core-hole", ...p, ...withLabel });
        break;
      }
      case "route": {
        if (a.kind !== "pipe" && a.kind !== "condensate" && a.kind !== "cable") continue;
        const points = (Array.isArray(a.points) ? a.points : []).slice(0, MAX_ROUTE_POINTS).map(pointOf).filter((p): p is Point => p !== null);
        if (points.length < 2) continue;
        out.push({ id: idFor(a.id, i), type: "route", kind: a.kind, points, ...withLabel });
        break;
      }
      case "obstacle": {
        const p = pointOf(a);
        if (p) out.push({ id: idFor(a.id, i), type: "obstacle", ...p, label: label || "Obstacle" });
        break;
      }
      case "measure": {
        const from = pointOf(a.from);
        const to = pointOf(a.to);
        if (from && to && label) out.push({ id: idFor(a.id, i), type: "measure", from, to, label });
        break;
      }
      case "note": {
        const p = pointOf(a);
        const note = text(a.text, 280);
        if (p && note) out.push({ id: idFor(a.id, i), type: "note", ...p, text: note });
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/**
 * F2's validator (the domain's validateAnnotations), as a result: a
 * validation failure is an error for the caller to show.
 */
export function validateAnnotationsSafe(input: unknown): { ok: true; annotations: Annotation[] } | { ok: false; error: string } {
  try {
    return { ok: true, annotations: validateAnnotations(input) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message || "Those drawings couldn't be read." };
  }
}

/* ------------------------------------------------------------------ */
/* Upload tickets                                                      */
/* ------------------------------------------------------------------ */

export interface UploadClaims {
  v: 1;
  mediaId: string;
  projectId: string;
  bucket: string;
  path: string;
  contentType: string;
  tag: PhotoTag;
  roomId?: string;
  caption?: string;
  source: MediaItem["source"];
  takenBy?: MediaItem["takenBy"];
  customerVisible: boolean;
  width?: number;
  height?: number;
  /** Unix seconds. */
  exp: number;
}

const TICKET_DOMAIN = "media-upload.";
const decoder = new TextDecoder();

export async function signUploadTicket(claims: UploadClaims, secret: string | null = sessionSecret()): Promise<string> {
  if (!secret) throw new MediaError("Uploads are switched off: SESSION_SECRET isn't set.", 503);
  const payload = base64urlEncode(JSON.stringify(claims));
  return `${payload}.${await hmacSha256Hex(secret, TICKET_DOMAIN + payload)}`;
}

/** The claims, or null when the ticket is forged, malformed or expired. */
export async function verifyUploadTicket(
  ticket: unknown,
  opts: { secret?: string | null; nowSec?: number } = {},
): Promise<UploadClaims | null> {
  const secret = opts.secret === undefined ? sessionSecret() : opts.secret;
  if (!secret || typeof ticket !== "string" || ticket.length > 8192) return null;
  const dot = ticket.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = ticket.slice(0, dot);
  const sig = ticket.slice(dot + 1);
  if (!constantTimeEqual(sig, await hmacSha256Hex(secret, TICKET_DOMAIN + payload))) return null;
  let claims: UploadClaims;
  try {
    claims = JSON.parse(decoder.decode(base64urlDecode(payload))) as UploadClaims;
  } catch {
    return null;
  }
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  if (claims?.v !== 1 || typeof claims.exp !== "number" || claims.exp < now) return null;
  if (!isProjectMediaPath(claims.projectId, claims.mediaId, claims.path)) return null;
  return claims;
}

/* ------------------------------------------------------------------ */
/* Upload + register                                                   */
/* ------------------------------------------------------------------ */

export interface MediaUploadInput {
  projectId: string;
  fileName: string;
  contentType: string;
  tag: PhotoTag;
  roomId?: string;
  caption?: string;
  source: MediaItem["source"];
  takenBy?: MediaItem["takenBy"];
  customerVisible?: boolean;
  width?: number;
  height?: number;
}

export interface MediaUpload {
  mediaId: string;
  path: string;
  /** PUT the bytes here (Supabase signed upload URL, or the local files route). */
  signedUrl: string;
  /** Hand back to `registerMedia` (POST /api/media/[id]) once the PUT succeeds. */
  ticket: string;
  expiresAt: string;
}

const isTag = (v: unknown): v is PhotoTag => typeof v === "string" && (PHOTO_TAGS as readonly string[]).includes(v);
const isSource = (v: unknown): v is MediaItem["source"] => typeof v === "string" && (MEDIA_SOURCES as string[]).includes(v);
const optText = (v: unknown, max: number): string | undefined => text(v, max) || undefined;
const optDimension = (v: unknown): number | undefined => {
  const n = finite(v);
  return n !== null && Number.isInteger(n) && n > 0 && n <= 20_000 ? n : undefined;
};

/** Step 1: an id, a path, a signed upload URL and the ticket. Nothing is written yet. */
export async function createMediaUpload(input: MediaUploadInput, opts: { now?: Date } = {}): Promise<MediaUpload> {
  if (!isUuid(input.projectId)) throw new MediaError("Unknown project.", 404);
  const contentType = normaliseContentType(input.contentType);
  if (!mediaContentTypeAllowed(contentType)) {
    throw new MediaError("That kind of file can't be uploaded. Photos (JPEG, PNG, WebP, HEIC), PDFs and videos (MP4, .mov) only.", 415);
  }
  if (!isTag(input.tag)) throw new MediaError("Unknown photo tag.");
  if (!isSource(input.source)) throw new MediaError("Unknown media source.");

  const mediaId = crypto.randomUUID();
  const path = mediaObjectPath(input.projectId, mediaId, input.fileName, contentType);
  const { data, error } = await db().storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new MediaError(`Upload unavailable: ${error?.message ?? "no URL"}`, 502);

  const nowSec = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  const exp = nowSec + UPLOAD_TICKET_TTL_SECONDS;
  const roomId = optText(input.roomId, 64);
  const caption = optText(input.caption, 280);
  const width = optDimension(input.width);
  const height = optDimension(input.height);
  const claims: UploadClaims = {
    v: 1,
    mediaId,
    projectId: input.projectId.toLowerCase(),
    bucket: MEDIA_BUCKET,
    path,
    contentType,
    tag: input.tag,
    ...(roomId ? { roomId } : {}),
    ...(caption ? { caption } : {}),
    source: input.source,
    ...(input.takenBy ? { takenBy: input.takenBy } : {}),
    customerVisible: input.customerVisible === true,
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    exp,
  };
  return {
    mediaId,
    path,
    signedUrl: data.signedUrl,
    ticket: await signUploadTicket(claims),
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export type MediaResult = { ok: true; item: MediaItem; created?: boolean } | { ok: false; error: string; status: number };

const fail = (error: string, status: number): MediaResult => ({ ok: false, error, status });

async function insertItem(item: MediaItem): Promise<{ item: MediaItem; created: boolean }> {
  const res = await db()
    .from("media")
    .insert({ ...mediaRepo.toRow(item), created_at: item.takenAt })
    .select("*")
    .single();
  if (isUniqueViolation(res.error)) {
    const existing = await mediaRepo.get(item.id);
    if (existing) return { item: existing, created: false };
  }
  return { item: mediaRepo.fromRow(must(res, "media insert")!), created: true };
}

/**
 * Step 3: the file is in storage, so record it. Everything comes from the
 * signed ticket. Idempotent: a second confirm returns the same row.
 */
export async function registerMedia(ticket: unknown, opts: { now?: Date } = {}): Promise<MediaResult> {
  const now = opts.now ?? new Date();
  const claims = await verifyUploadTicket(ticket, { nowSec: Math.floor(now.getTime() / 1000) });
  if (!claims) return fail("That upload has expired or isn't valid. Start the upload again.", 400);

  const existing = await mediaRepo.get(claims.mediaId);
  if (existing) return { ok: true, item: existing, created: false };

  const bucket = db().storage.from(claims.bucket);
  const { data: info, error } = await bucket.info(claims.path);
  if (error || !info) return fail("The file hasn't arrived yet. Try the upload again.", 409);
  const size = typeof info.size === "number" ? info.size : 0;
  if (size > MEDIA_MAX_BYTES) {
    await bucket.remove([claims.path]);
    return fail("That file is too big (25 MB at most).", 413);
  }
  const stored = normaliseContentType(info.contentType);
  if (stored && stored !== "application/octet-stream" && stored !== claims.contentType) {
    // What arrived isn't what was declared: never keep it.
    await bucket.remove([claims.path]);
    return fail("The uploaded file wasn't the type that was declared.", 415);
  }

  const item: MediaItem = {
    id: claims.mediaId,
    projectId: claims.projectId,
    bucket: claims.bucket,
    storagePath: claims.path,
    contentType: claims.contentType,
    tag: claims.tag,
    ...(claims.roomId ? { roomId: claims.roomId } : {}),
    ...(claims.caption ? { caption: claims.caption } : {}),
    source: claims.source,
    ...(claims.takenBy ? { takenBy: claims.takenBy } : {}),
    takenAt: now.toISOString(),
    customerVisible: claims.customerVisible,
    ...(claims.width ? { width: claims.width } : {}),
    ...(claims.height ? { height: claims.height } : {}),
    annotations: [],
    annotationsVersion: 0,
    locked: false,
  };
  const saved = await insertItem(item);
  return { ok: true, item: saved.item, created: saved.created };
}

/**
 * Store a file the system made (demo photos, generated drawings) and record
 * it in one go. The only path that accepts SVG. Replaces an object already
 * at the same path.
 */
export async function storeSystemMedia(input: {
  projectId: string;
  mediaId?: string;
  fileName: string;
  contentType: string;
  body: string | Uint8Array;
  tag: PhotoTag;
  roomId?: string;
  caption?: string;
  source: MediaItem["source"];
  takenBy?: MediaItem["takenBy"];
  takenAt?: string;
  customerVisible?: boolean;
  width?: number;
  height?: number;
  annotations?: Annotation[];
  locked?: boolean;
}): Promise<MediaItem> {
  const contentType = normaliseContentType(input.contentType);
  if (!mediaContentTypeAllowed(contentType, { system: true })) throw new MediaError(`Unsupported content type ${contentType}.`, 415);
  if (!isTag(input.tag) || !isSource(input.source)) throw new MediaError("Unknown tag or source.");
  const mediaId = input.mediaId && isUuid(input.mediaId) ? input.mediaId.toLowerCase() : crypto.randomUUID();
  const path = mediaObjectPath(input.projectId, mediaId, input.fileName, contentType);
  const bytes = typeof input.body === "string" ? new TextEncoder().encode(input.body) : input.body;
  if (bytes.byteLength > MEDIA_MAX_BYTES) throw new MediaError("That file is too big (25 MB at most).", 413);
  const { error } = await db().storage.from(MEDIA_BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw new MediaError(`Storing ${path} failed: ${error.message}`, 502);

  const checked = validateAnnotationsSafe(input.annotations ?? []);
  const item: MediaItem = {
    id: mediaId,
    projectId: input.projectId.toLowerCase(),
    bucket: MEDIA_BUCKET,
    storagePath: path,
    contentType,
    tag: input.tag,
    ...(input.roomId ? { roomId: input.roomId } : {}),
    ...(input.caption ? { caption: input.caption } : {}),
    source: input.source,
    ...(input.takenBy ? { takenBy: input.takenBy } : {}),
    takenAt: input.takenAt ?? new Date().toISOString(),
    customerVisible: input.customerVisible === true,
    ...(optDimension(input.width) ? { width: input.width } : {}),
    ...(optDimension(input.height) ? { height: input.height } : {}),
    annotations: checked.ok ? checked.annotations : [],
    annotationsVersion: checked.ok && checked.annotations.length ? 1 : 0,
    locked: input.locked === true,
  };
  return (await insertItem(item)).item;
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

/**
 * Short-lived read URLs, media id → URL, on whichever backend is live.
 * Items whose file is missing get no entry (callers show a placeholder).
 */
export async function signedMediaUrls(
  items: Pick<MediaItem, "id" | "bucket" | "storagePath">[],
  expiresSec = 3600,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const byBucket = new Map<string, Pick<MediaItem, "id" | "bucket" | "storagePath">[]>();
  for (const item of items) {
    if (!item.storagePath) continue;
    const bucket = item.bucket || MEDIA_BUCKET;
    byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), item]);
  }
  for (const [bucket, group] of byBucket) {
    const paths = [...new Set(group.map((i) => i.storagePath))];
    const { data, error } = await db().storage.from(bucket).createSignedUrls(paths, Math.max(1, Math.floor(expiresSec)));
    if (error || !data) {
      console.error(`[media] signing ${paths.length} URL(s) in ${bucket} failed:`, error?.message);
      continue;
    }
    const urlByPath = new Map<string, string>();
    data.forEach((entry, i) => {
      const url = entry.signedUrl;
      if (!entry.error && url) urlByPath.set(entry.path ?? paths[i]!, url);
    });
    for (const item of group) {
      const url = urlByPath.get(item.storagePath);
      if (url) out.set(item.id, url);
    }
  }
  return out;
}

export type MediaWithUrl = MediaItem & { url: string | null };

/** A project's media with read URLs, newest first. Customers pass `customerVisibleOnly`. */
export async function listProjectMedia(
  projectId: string,
  opts: { customerVisibleOnly?: boolean; tag?: PhotoTag; roomId?: string; source?: MediaItem["source"]; expiresSec?: number } = {},
): Promise<MediaWithUrl[]> {
  const items = await mediaRepo.listForProject(projectId, {
    ...(opts.tag ? { tag: opts.tag } : {}),
    ...(opts.roomId ? { roomId: opts.roomId } : {}),
    ...(opts.source ? { source: opts.source } : {}),
    ...(opts.customerVisibleOnly ? { customerVisibleOnly: true } : {}),
  });
  const urls = await signedMediaUrls(items, opts.expiresSec);
  return items.map((item) => ({ ...item, url: urls.get(item.id) ?? null }));
}

/* ------------------------------------------------------------------ */
/* Edit                                                                */
/* ------------------------------------------------------------------ */

export interface MediaPatch {
  annotations?: unknown;
  /** The annotationsVersion the editor loaded; a stale save is refused rather than lost. */
  expectedVersion?: number;
  tag?: PhotoTag;
  caption?: string | null;
  customerVisible?: boolean;
  roomId?: string | null;
}

/**
 * Change a media item's drawing, tag, caption, room or visibility. A locked
 * item (part of an approved design or a signed record) refuses drawing, tag
 * and room changes: a change there is a new version, never an edit in place.
 * Caption and customer visibility stay editable.
 */
export async function updateMedia(id: string, patch: MediaPatch): Promise<MediaResult> {
  const item = await mediaRepo.get(id);
  if (!item) return fail("Not found", 404);

  const structural = patch.annotations !== undefined || patch.tag !== undefined || patch.roomId !== undefined;
  if (item.locked && structural) {
    return fail("This photo is part of an approved design, so its drawing, tag and room are locked. Make a new version instead.", 409);
  }
  if (patch.tag !== undefined && !isTag(patch.tag)) return fail("Unknown photo tag.", 400);

  let current = item;
  if (patch.annotations !== undefined) {
    const checked = validateAnnotationsSafe(patch.annotations);
    if (!checked.ok) return fail(checked.error, 400);
    const expected = Number.isInteger(patch.expectedVersion) ? patch.expectedVersion! : item.annotationsVersion;
    const saved = await mediaRepo.saveAnnotations(id, checked.annotations, expected);
    if (!saved) {
      return fail("Someone else saved this drawing since you opened it (or it was locked). Reload to see the latest.", 409);
    }
    current = saved;
  }

  const next: MediaItem = { ...current };
  let changed = false;
  if (patch.tag !== undefined && patch.tag !== current.tag) {
    next.tag = patch.tag;
    changed = true;
  }
  if (patch.caption !== undefined) {
    const caption = patch.caption === null ? "" : text(patch.caption, 280);
    if (caption) next.caption = caption;
    else delete next.caption;
    changed = changed || caption !== (current.caption ?? "");
  }
  if (patch.roomId !== undefined) {
    const roomId = patch.roomId === null ? "" : text(patch.roomId, 64);
    if (roomId) next.roomId = roomId;
    else delete next.roomId;
    changed = changed || roomId !== (current.roomId ?? "");
  }
  if (patch.customerVisible !== undefined && patch.customerVisible !== current.customerVisible) {
    next.customerVisible = patch.customerVisible === true;
    changed = true;
  }
  if (!changed) return { ok: true, item: current };
  return { ok: true, item: await mediaRepo.update(next) };
}
