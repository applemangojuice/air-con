/**
 * Object storage for the local data backend: the bucket files behind
 * `storage.from(bucket)`, plus the HMAC-signed URLs served by
 * `/api/local-files/<bucket>/<path>`.
 *
 * A signed URL is `<route>/<bucket>/<path>?op=get|put|upsert&exp=<unix>&sig=<hex>`,
 * where sig = HMAC-SHA256(secret, "op|bucket|path|exp"). `put` refuses to
 * overwrite (like a Supabase signed upload URL); `upsert` is what
 * `createSignedUploadUrl(path, { upsert: true })` mints.
 *
 * Files live at <dataDir>/storage/<bucket>/<path>, with their content type
 * and timestamps in <dataDir>/storage-meta/<bucket>/<path>.json.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, readdir, rmdir, stat, unlink } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { writeAtomic } from "./local-store.ts";

export type SignedOp = "get" | "put" | "upsert";

/** Upload ceiling for signed PUTs and upload(): 25 MB, more for walkthrough videos. */
export const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_UPLOAD_BYTES_BY_BUCKET: Record<string, number> = {
  // Supabase's default per-file limit; phone walkthroughs run long.
  "survey-videos": 50 * 1024 * 1024,
};

export function maxUploadBytes(bucket: string): number {
  return MAX_UPLOAD_BYTES_BY_BUCKET[bucket] ?? DEFAULT_MAX_UPLOAD_BYTES;
}

const TEMP_MARKER = ".~tmp-";
const BUCKET_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;

export function isBucketName(bucket: string): boolean {
  return BUCKET_RE.test(bucket);
}

/**
 * Canonical object path, or null when unsafe. Collapses repeated and
 * leading/trailing slashes (as supabase-js does) and rejects `.` / `..`
 * segments, backslashes, control characters and our temp-file marker.
 */
export function cleanObjectPath(path: unknown): string | null {
  if (typeof path !== "string") return null;
  const p = path.replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
  if (!p || p.length > 1024) return null;
  for (const segment of p.split("/")) {
    if (segment === "." || segment === "..") return null;
    if (/[\u0000-\u001f\u007f\\]/.test(segment)) return null;
    if (segment.includes(TEMP_MARKER)) return null;
  }
  return p;
}

/** Like cleanObjectPath, but "" (the bucket root) is allowed. */
function cleanPrefix(prefix: unknown): string | null {
  if (prefix === undefined || prefix === null || prefix === "" || prefix === "/") return "";
  return cleanObjectPath(prefix);
}

/* ------------------------------------------------------------------ */
/* Signing                                                             */
/* ------------------------------------------------------------------ */

export function storageSignature(secret: string, op: SignedOp, bucket: string, path: string, exp: number): string {
  return createHmac("sha256", secret).update(`${op}|${bucket}|${path}|${exp}`).digest("hex");
}

export function encodeObjectPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function signedFileUrl(
  route: string,
  secret: string,
  op: SignedOp,
  bucket: string,
  path: string,
  exp: number,
): string {
  const sig = storageSignature(secret, op, bucket, path, exp);
  return `${route}/${encodeURIComponent(bucket)}/${encodeObjectPath(path)}?op=${op}&exp=${exp}&sig=${sig}`;
}

export type SignatureCheck = "ok" | "expired" | "invalid";

export function verifyStorageSignature(
  secret: string,
  op: string,
  bucket: string,
  path: string,
  exp: unknown,
  sig: unknown,
  nowSec: number,
): SignatureCheck {
  if (op !== "get" && op !== "put" && op !== "upsert") return "invalid";
  if (typeof sig !== "string" || !/^[0-9a-f]{64}$/.test(sig)) return "invalid";
  const expNum = typeof exp === "number" ? exp : typeof exp === "string" && /^\d{1,12}$/.test(exp) ? Number(exp) : NaN;
  if (!Number.isSafeInteger(expNum)) return "invalid";
  const want = Buffer.from(storageSignature(secret, op, bucket, path, expNum), "hex");
  const got = Buffer.from(sig, "hex");
  if (want.length !== got.length || !timingSafeEqual(want, got)) return "invalid";
  return expNum < nowSec ? "expired" : "ok";
}

/* ------------------------------------------------------------------ */
/* Object stores                                                       */
/* ------------------------------------------------------------------ */

export interface ObjectMeta {
  id: string;
  contentType: string;
  size: number;
  cacheControl: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredObject {
  meta: ObjectMeta;
  bytes: Uint8Array;
}

export interface ObjectListing {
  files: { name: string; meta: ObjectMeta }[];
  folders: string[];
}

export interface ObjectStore {
  /** "exists" when the object is already there and `upsert` is false. */
  put(
    bucket: string,
    path: string,
    bytes: Uint8Array,
    opts: { contentType: string; cacheControl: string; upsert: boolean; now: string },
  ): Promise<{ status: "created" | "updated" | "exists"; meta: ObjectMeta | null }>;
  get(bucket: string, path: string): Promise<StoredObject | null>;
  head(bucket: string, path: string): Promise<ObjectMeta | null>;
  remove(bucket: string, path: string): Promise<ObjectMeta | null>;
  /** Direct children of a folder prefix ("" is the bucket root). */
  list(bucket: string, prefix: string): Promise<ObjectListing>;
}

export function createMemoryObjects(): ObjectStore {
  const objects = new Map<string, StoredObject>();
  const key = (bucket: string, path: string) => `${bucket}/${path}`;
  return {
    async put(bucket, path, bytes, opts) {
      const existing = objects.get(key(bucket, path));
      if (existing && !opts.upsert) return { status: "exists", meta: null };
      const meta: ObjectMeta = {
        id: existing?.meta.id ?? crypto.randomUUID(),
        contentType: opts.contentType,
        size: bytes.byteLength,
        cacheControl: opts.cacheControl,
        createdAt: existing?.meta.createdAt ?? opts.now,
        updatedAt: opts.now,
      };
      objects.set(key(bucket, path), { meta, bytes: bytes.slice() });
      return { status: existing ? "updated" : "created", meta };
    },
    async get(bucket, path) {
      const o = objects.get(key(bucket, path));
      return o ? { meta: { ...o.meta }, bytes: o.bytes.slice() } : null;
    },
    async head(bucket, path) {
      const o = objects.get(key(bucket, path));
      return o ? { ...o.meta } : null;
    },
    async remove(bucket, path) {
      const o = objects.get(key(bucket, path));
      if (!o) return null;
      objects.delete(key(bucket, path));
      return { ...o.meta };
    },
    async list(bucket, prefix) {
      const base = prefix ? `${bucket}/${prefix}/` : `${bucket}/`;
      const files: ObjectListing["files"] = [];
      const folders = new Set<string>();
      for (const [k, o] of objects) {
        if (!k.startsWith(base)) continue;
        const rest = k.slice(base.length);
        const slash = rest.indexOf("/");
        if (slash === -1) files.push({ name: rest, meta: { ...o.meta } });
        else folders.add(rest.slice(0, slash));
      }
      return { files, folders: [...folders] };
    },
  };
}

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  pdf: "application/pdf",
  json: "application/json",
  txt: "text/plain",
};

function guessContentType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPE_BY_EXT[ext] ?? "application/octet-stream";
}

/**
 * Files under <dataDir>/storage, metadata under <dataDir>/storage-meta.
 * Every resolved path is checked to stay inside its root (defence in depth
 * on top of cleanObjectPath).
 */
export function createFileObjects(dataDir: string): ObjectStore {
  const filesRoot = resolve(dataDir, "storage");
  const metaRoot = resolve(dataDir, "storage-meta");

  function inside(root: string, ...parts: string[]): string {
    const full = resolve(root, ...parts);
    if (full !== root && !full.startsWith(root + sep)) throw new Error("path escapes the storage root");
    return full;
  }
  const filePath = (bucket: string, path: string) => inside(filesRoot, bucket, ...path.split("/"));
  const metaPath = (bucket: string, path: string) => `${inside(metaRoot, bucket, ...path.split("/"))}.json`;

  async function readMeta(bucket: string, path: string): Promise<ObjectMeta | null> {
    let info;
    try {
      info = await stat(filePath(bucket, path));
    } catch {
      return null;
    }
    if (!info.isFile()) return null;
    try {
      const meta = JSON.parse(await readFile(metaPath(bucket, path), "utf8")) as ObjectMeta;
      return { ...meta, size: info.size };
    } catch {
      // A file dropped in by hand: describe it from the filesystem.
      return {
        id: `local-${bucket}-${path}`,
        contentType: guessContentType(path),
        size: info.size,
        cacheControl: "max-age=3600",
        createdAt: info.birthtime.toISOString(),
        updatedAt: info.mtime.toISOString(),
      };
    }
  }

  /** Removes now-empty folders up to the bucket root, so list() shows no ghosts. */
  async function pruneEmpty(root: string, bucket: string, path: string): Promise<void> {
    const stop = inside(root, bucket);
    let dir = dirname(inside(root, bucket, ...path.split("/")));
    while (dir.startsWith(stop + sep)) {
      try {
        await rmdir(dir);
      } catch {
        return; // not empty (or already gone)
      }
      dir = dirname(dir);
    }
  }

  return {
    async put(bucket, path, bytes, opts) {
      const existing = await readMeta(bucket, path);
      if (existing && !opts.upsert) return { status: "exists", meta: null };
      const meta: ObjectMeta = {
        id: existing?.id ?? crypto.randomUUID(),
        contentType: opts.contentType,
        size: bytes.byteLength,
        cacheControl: opts.cacheControl,
        createdAt: existing?.createdAt ?? opts.now,
        updatedAt: opts.now,
      };
      const target = filePath(bucket, path);
      const metaTarget = metaPath(bucket, path);
      await mkdir(dirname(target), { recursive: true });
      await mkdir(dirname(metaTarget), { recursive: true });
      await writeAtomic(target, bytes);
      await writeAtomic(metaTarget, JSON.stringify(meta));
      return { status: existing ? "updated" : "created", meta };
    },
    async get(bucket, path) {
      const meta = await readMeta(bucket, path);
      if (!meta) return null;
      try {
        const bytes = new Uint8Array(await readFile(filePath(bucket, path)));
        return { meta: { ...meta, size: bytes.byteLength }, bytes };
      } catch {
        return null;
      }
    },
    head: readMeta,
    async remove(bucket, path) {
      const meta = await readMeta(bucket, path);
      if (!meta) return null;
      await unlink(filePath(bucket, path)).catch(() => undefined);
      await unlink(metaPath(bucket, path)).catch(() => undefined);
      await pruneEmpty(filesRoot, bucket, path);
      await pruneEmpty(metaRoot, bucket, path);
      return meta;
    },
    async list(bucket, prefix) {
      const dir = prefix ? inside(filesRoot, bucket, ...prefix.split("/")) : inside(filesRoot, bucket);
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return { files: [], folders: [] };
      }
      const files: ObjectListing["files"] = [];
      const folders: string[] = [];
      for (const entry of entries) {
        if (entry.name.includes(TEMP_MARKER)) continue;
        if (entry.isDirectory()) {
          folders.push(entry.name);
        } else if (entry.isFile()) {
          const meta = await readMeta(bucket, prefix ? `${prefix}/${entry.name}` : entry.name);
          if (meta) files.push({ name: entry.name, meta });
        }
      }
      return { files, folders };
    },
  };
}

/* ------------------------------------------------------------------ */
/* Bodies                                                              */
/* ------------------------------------------------------------------ */

/** What upload() accepts, normalised to bytes plus the body's own type if any. */
export async function bodyBytes(body: unknown): Promise<{ bytes: Uint8Array; type: string | null }> {
  if (typeof body === "string") return { bytes: new TextEncoder().encode(body), type: null };
  if (body instanceof Uint8Array) return { bytes: body, type: null };
  if (body instanceof ArrayBuffer) return { bytes: new Uint8Array(body), type: null };
  if (ArrayBuffer.isView(body)) {
    return { bytes: new Uint8Array(body.buffer, body.byteOffset, body.byteLength), type: null };
  }
  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return { bytes: new Uint8Array(await body.arrayBuffer()), type: body.type || null };
  }
  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) {
    return { bytes: new Uint8Array(await new Response(body).arrayBuffer()), type: null };
  }
  throw new TypeError("unsupported upload body: use a Blob, ArrayBuffer, typed array, string or ReadableStream");
}

/** Reads a request body, stopping as soon as it passes `limit` bytes. */
export async function readLimited(
  stream: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<Uint8Array | "too-large"> {
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return "too-large";
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Content types we let the browser render inline; anything else downloads. */
export function inlineSafe(contentType: string): boolean {
  return /^(image\/(jpeg|png|webp|gif|heic|heif|avif)|video\/|audio\/|application\/pdf)/i.test(contentType);
}

/** A stored content type, trimmed to something safe to echo in a header. */
export function cleanContentType(value: string | null | undefined): string {
  const v = (value ?? "").replace(/[\r\n]/g, "").trim().slice(0, 200);
  return v || "application/octet-stream";
}
