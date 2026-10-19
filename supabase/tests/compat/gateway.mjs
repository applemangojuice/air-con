/**
 * The front door of the Supabase-shaped test stack: what a Supabase
 * project's API gateway (Kong) and Storage API do for the calls supabase-js
 * makes in this app. node:http only, no dependencies. Test harness only:
 * it holds a throwaway database's files and listens on localhost.
 *
 *   /rest/v1/*     → PostgREST (prefix stripped), after Kong's key check
 *                    (`apikey` must be the anon or service_role key) and
 *                    Supabase's pg-safeupdate rule (an UPDATE or DELETE with
 *                    no filter is refused, 21000).
 *   /storage/v1/*  → an implementation of the Storage API endpoints that
 *                    @supabase/storage-js v2 calls (see the routes below),
 *                    enforcing each bucket's `file_size_limit` and
 *                    `allowed_mime_types` from `storage.buckets` (0011),
 *                    with signed URLs that are JWTs over "<bucket>/<path>",
 *                    as Supabase signs them. Objects live on disk under
 *                    STORAGE_DIR.
 *   /auth/v1/*     → 404: the app doesn't use Supabase Auth.
 *
 * Env: GATEWAY_PORT (54321), POSTGREST_URL (http://127.0.0.1:3001),
 * JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY, STORAGE_DIR, PSQL (path to psql)
 * plus PGHOST / PGPORT / PGUSER / PGDATABASE for reading storage.buckets,
 * GATEWAY_LOG=1 to log every request.
 */
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import http from "node:http";
import { dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { signJwt, verifyJwt } from "./jwt.mjs";

const run = promisify(execFile);

const PORT = Number(process.env.GATEWAY_PORT ?? 54321);
const POSTGREST = new URL(process.env.POSTGREST_URL ?? "http://127.0.0.1:3001");
const JWT_SECRET = process.env.JWT_SECRET ?? "";
const API_KEYS = new Set([process.env.ANON_KEY, process.env.SERVICE_ROLE_KEY].filter(Boolean));
const STORAGE_DIR = resolve(process.env.STORAGE_DIR ?? "./storage");
const OBJECTS = join(STORAGE_DIR, "objects");
const META = join(STORAGE_DIR, "meta");
const LOG = process.env.GATEWAY_LOG === "1";
/** Supabase's project-wide upload ceiling (Free plan default: 50 MB). */
const GLOBAL_MAX_BYTES = 50 * 1024 * 1024;
/** Signed upload URLs last two hours, as on Supabase. */
const UPLOAD_URL_TTL = 2 * 60 * 60;

if (JWT_SECRET.length < 32) {
  console.error("gateway: JWT_SECRET (at least 32 characters) is required");
  process.exit(2);
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type, content-profile, accept-profile, prefer, range, x-upsert, cache-control, x-metadata, x-supabase-api-version",
  "access-control-expose-headers": "content-range, content-length, content-type, etag, x-total-count",
  "access-control-max-age": "3600",
};

function send(res, status, body, headers = {}) {
  const isBuffer = Buffer.isBuffer(body);
  const payload = body === undefined || body === null ? "" : isBuffer || typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    ...CORS,
    ...(isBuffer || typeof body === "string" ? {} : { "content-type": "application/json; charset=utf-8" }),
    ...headers,
  });
  res.end(payload);
}

/** A Storage API error as the real service renders it: `{ statusCode, error, message }`, HTTP 400 unless said. */
class StorageHttpError extends Error {
  constructor(statusCode, error, message, httpStatus = 400) {
    super(message);
    this.statusCode = String(statusCode);
    this.error = error;
    this.httpStatus = httpStatus;
  }
}
const notFoundObject = () => new StorageHttpError("404", "not_found", "Object not found");
const notFoundBucket = () => new StorageHttpError("404", "Bucket not found", "Bucket not found");
const duplicate = () => new StorageHttpError("409", "Duplicate", "The resource already exists");
const invalidKey = (key) => new StorageHttpError("400", "InvalidKey", `Invalid key: ${key}`);

async function readBody(req, limit = GLOBAL_MAX_BYTES + 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw new StorageHttpError("413", "Payload too large", "The object exceeded the maximum allowed size", 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const body = await readBody(req, 5 * 1024 * 1024);
  if (body.length === 0) return {};
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new StorageHttpError("400", "Invalid JSON", "Body is not valid JSON");
  }
}

/* ------------------------------------------------------------------ */
/* Auth: Kong's key check and the Storage API's JWT                    */
/* ------------------------------------------------------------------ */

function bearer(req) {
  const h = req.headers.authorization ?? "";
  return /^bearer\s+/i.test(h) ? h.replace(/^bearer\s+/i, "").trim() : null;
}

/** The caller's role from its JWT (Authorization, else the apikey), or a Storage error. */
function storageRole(req) {
  const token = bearer(req) ?? req.headers.apikey;
  if (!token) throw new StorageHttpError("403", "Unauthorized", "headers must have required property 'authorization'");
  const { payload, error } = verifyJwt(token, JWT_SECRET);
  if (error) throw new StorageHttpError("403", "Unauthorized", error);
  return payload.role ?? "anon";
}

/**
 * Every bucket is private and storage.objects has no policies, so only the
 * service role (which bypasses RLS) can read or write; anyone else sees what
 * RLS shows them: nothing.
 */
function requireServiceRole(req, op) {
  const role = storageRole(req);
  if (role === "service_role") return;
  if (op === "read") throw notFoundObject();
  throw new StorageHttpError("403", "Unauthorized", "new row violates row-level security policy", 403);
}

/* ------------------------------------------------------------------ */
/* Buckets (from Postgres) and objects (on disk)                       */
/* ------------------------------------------------------------------ */

let bucketCache = { at: 0, rows: [] };
async function buckets() {
  if (Date.now() - bucketCache.at < 2000) return bucketCache.rows;
  const { stdout } = await run(process.env.PSQL ?? "psql", [
    "-X",
    "-A",
    "-t",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    "select coalesce(json_agg(row_to_json(b) order by b.id), '[]'::json) from storage.buckets b",
  ]);
  bucketCache = { at: Date.now(), rows: JSON.parse(stdout.trim() || "[]") };
  return bucketCache.rows;
}

async function bucket(id) {
  const b = (await buckets()).find((row) => row.id === id);
  if (!b) throw notFoundBucket();
  return b;
}

function bucketJson(b) {
  return {
    id: b.id,
    name: b.name,
    owner: b.owner ?? "",
    public: Boolean(b.public),
    file_size_limit: b.file_size_limit ?? null,
    allowed_mime_types: b.allowed_mime_types ?? null,
    created_at: b.created_at ?? null,
    updated_at: b.updated_at ?? b.created_at ?? null,
  };
}

/** storage-api's isValidKey: only these characters (ASCII \w, "/", space and !-.*'()&$@=;:+,?). */
const VALID_KEY = /^(\w|\/|!|-|\.|\*|'|\(|\)| |&|\$|@|=|;|:|\+|,|\?)*$/;

/** Storage's key rules: its character set, no empty segments after cleaning, no "." / "..", nothing unprintable. */
function cleanKey(raw) {
  const key = String(raw ?? "");
  if (!key || key.length > 1024 || !VALID_KEY.test(key)) throw invalidKey(key);
  for (const seg of key.split("/")) {
    if (seg === "" || seg === "." || seg === "..") throw invalidKey(key);
    if (/[\u0000-\u001f\u007f]/.test(seg)) throw invalidKey(key);
  }
  return key;
}

function inside(root, ...parts) {
  const full = resolve(root, ...parts);
  if (full !== root && !full.startsWith(root + sep)) throw invalidKey(parts.join("/"));
  return full;
}
const objectFile = (b, key) => inside(OBJECTS, b, ...key.split("/"));
const metaFile = (b, key) => `${inside(META, b, ...key.split("/"))}.json`;

async function writeAtomic(file, data) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.~tmp-${randomUUID()}`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

async function headObject(b, key) {
  try {
    const meta = JSON.parse(await readFile(metaFile(b, key), "utf8"));
    const info = await stat(objectFile(b, key));
    return info.isFile() ? meta : null;
  } catch {
    return null;
  }
}

/** One write at a time per object, so "upsert: false" can't race itself. */
const locks = new Map();
async function exclusive(lockKey, fn) {
  const prev = locks.get(lockKey) ?? Promise.resolve();
  let release;
  const next = new Promise((r) => (release = r));
  locks.set(lockKey, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(lockKey) === next) locks.delete(lockKey);
  }
}

/** Storage's mime check: the media type (no parameters) is listed, or `type/*` is. */
function mimeAllowed(b, contentType) {
  const allowed = b.allowed_mime_types;
  if (!allowed || allowed.length === 0) return true;
  const mime = String(contentType ?? "").split(";")[0].trim().toLowerCase();
  const [type, sub] = mime.split("/");
  if (!type || !sub) return false;
  return allowed.some((a) => {
    const [at, as] = String(a).toLowerCase().split("/");
    return at === type && (as === "*" || as === sub);
  });
}

async function putObject(b, key, bytes, contentType, cacheControl, upsert) {
  const limit = Math.min(Number(b.file_size_limit ?? GLOBAL_MAX_BYTES) || GLOBAL_MAX_BYTES, GLOBAL_MAX_BYTES);
  if (bytes.length > limit) {
    throw new StorageHttpError("413", "Payload too large", "The object exceeded the maximum allowed size", 413);
  }
  if (!mimeAllowed(b, contentType)) {
    throw new StorageHttpError("415", "invalid_mime_type", `mime type ${String(contentType).split(";")[0]} is not supported`, 415);
  }
  return exclusive(`${b.id}/${key}`, async () => {
    const existing = await headObject(b.id, key);
    if (existing && !upsert) throw duplicate();
    const now = new Date().toISOString();
    const meta = {
      id: existing?.id ?? randomUUID(),
      bucket_id: b.id,
      name: key,
      owner: "",
      created_at: existing?.created_at ?? now,
      updated_at: now,
      last_accessed_at: now,
      metadata: {
        eTag: `"${createHash("md5").update(bytes).digest("hex")}"`,
        size: bytes.length,
        mimetype: String(contentType),
        cacheControl: cacheControl || "max-age=3600",
        lastModified: now,
        contentLength: bytes.length,
        httpStatusCode: 200,
      },
    };
    await writeAtomic(objectFile(b.id, key), bytes);
    await writeAtomic(metaFile(b.id, key), JSON.stringify(meta));
    return meta;
  });
}

async function pruneEmpty(root, b, key) {
  const stop = inside(root, b);
  let dir = dirname(inside(root, b, ...key.split("/")));
  while (dir.startsWith(stop + sep)) {
    try {
      await rmdir(dir);
    } catch {
      return;
    }
    dir = dirname(dir);
  }
}

async function removeObject(b, key) {
  return exclusive(`${b}/${key}`, async () => {
    const meta = await headObject(b, key);
    if (!meta) return null;
    await unlink(objectFile(b, key)).catch(() => {});
    await unlink(metaFile(b, key)).catch(() => {});
    await pruneEmpty(OBJECTS, b, key);
    await pruneEmpty(META, b, key);
    return meta;
  });
}

/* ------------------------------------------------------------------ */
/* Upload bodies: raw bytes, or the multipart form supabase-js sends   */
/* for a Blob                                                          */
/* ------------------------------------------------------------------ */

function parseMultipart(body, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!m) throw new StorageHttpError("400", "InvalidRequest", "multipart body without a boundary");
  const boundary = Buffer.from(`--${m[1] ?? m[2]}`);
  const fields = {};
  let file = null;
  let pos = body.indexOf(boundary);
  while (pos !== -1) {
    const start = pos + boundary.length;
    if (body.slice(start, start + 2).toString() === "--") break;
    const headerEnd = body.indexOf("\r\n\r\n", start);
    if (headerEnd === -1) break;
    const headers = body.slice(start + 2, headerEnd).toString("utf8");
    const next = body.indexOf(boundary, headerEnd + 4);
    if (next === -1) break;
    const content = body.slice(headerEnd + 4, next - 2); // drop the CRLF before the boundary
    const name = /name="([^"]*)"/i.exec(headers)?.[1] ?? "";
    const isFile = /filename="/i.test(headers) || name === "";
    if (isFile && !file) {
      const type = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() ?? "application/octet-stream";
      file = { bytes: content, contentType: type };
    } else {
      fields[name] = content.toString("utf8");
    }
    pos = next;
  }
  if (!file) throw new StorageHttpError("400", "InvalidRequest", "No file in the form");
  return { ...file, cacheControl: fields.cacheControl };
}

async function uploadBody(req) {
  const body = await readBody(req);
  const type = req.headers["content-type"] ?? "";
  if (/^multipart\/form-data/i.test(type)) {
    const part = parseMultipart(body, type);
    return { bytes: part.bytes, contentType: part.contentType, cacheControl: part.cacheControl ? `max-age=${part.cacheControl}` : undefined };
  }
  return {
    bytes: body,
    contentType: type || "application/octet-stream",
    cacheControl: req.headers["cache-control"],
  };
}

/* ------------------------------------------------------------------ */
/* Serving an object                                                   */
/* ------------------------------------------------------------------ */

async function serveObject(req, res, b, key, download) {
  const meta = await headObject(b, key);
  if (!meta) throw notFoundObject();
  const bytes = await readFile(objectFile(b, key));
  const headers = {
    "content-type": meta.metadata.mimetype,
    "cache-control": meta.metadata.cacheControl,
    etag: meta.metadata.eTag,
    "last-modified": new Date(meta.updated_at).toUTCString(),
    "accept-ranges": "bytes",
  };
  if (download !== null && download !== undefined) {
    const name = download || key.split("/").pop();
    headers["content-disposition"] = `attachment; filename=${encodeURIComponent(name)}`;
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : bytes.length - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : bytes.length - 1;
    start = Math.max(0, start);
    end = Math.min(end, bytes.length - 1);
    if (start > end) return send(res, 416, "", { ...headers, "content-range": `bytes */${bytes.length}` });
    const part = bytes.subarray(start, end + 1);
    return send(res, 206, req.method === "HEAD" ? "" : part, {
      ...headers,
      "content-range": `bytes ${start}-${end}/${bytes.length}`,
      "content-length": String(part.length),
    });
  }
  send(res, 200, req.method === "HEAD" ? "" : bytes, { ...headers, "content-length": String(bytes.length) });
}

/* ------------------------------------------------------------------ */
/* Storage routes                                                      */
/* ------------------------------------------------------------------ */

const decodeSegments = (segments) => segments.map((s) => decodeURIComponent(s));

function signToken(url, expiresIn, extra = {}) {
  const iat = Math.floor(Date.now() / 1000);
  return signJwt({ url, iat, exp: iat + Math.max(1, Math.floor(Number(expiresIn) || 0)), ...extra }, JWT_SECRET);
}

function checkSignedToken(token, url) {
  if (!token) throw new StorageHttpError("400", "InvalidJWT", "querystring must have required property 'token'");
  const { payload, error } = verifyJwt(token, JWT_SECRET);
  if (error) throw new StorageHttpError("400", "InvalidJWT", error);
  if (payload.url !== url) throw new StorageHttpError("400", "InvalidSignature", "The url do not match the signature");
  return payload;
}

async function storage(req, res, path, query) {
  const segs = path.split("/").filter((s, i) => i > 0 || s !== "");
  const [area, ...rest] = segs;
  const method = req.method;

  if (area === "bucket") {
    requireServiceRole(req, "read");
    if (method === "GET" && rest.length === 0) return send(res, 200, (await buckets()).map(bucketJson));
    if (method === "GET" && rest.length === 1) return send(res, 200, bucketJson(await bucket(decodeURIComponent(rest[0]))));
    throw new StorageHttpError("405", "Method not allowed", `${method} /bucket is not implemented by the compat gateway`, 405);
  }
  if (area !== "object") throw new StorageHttpError("404", "Not Found", `Route ${method}:${path} not found`, 404);

  const [kind, ...tail] = rest;

  // Signed upload URLs.
  if (kind === "upload" && tail[0] === "sign" && tail.length >= 3) {
    const [bucketId, ...keySegs] = decodeSegments(tail.slice(1));
    const key = cleanKey(keySegs.join("/"));
    const b = await bucket(bucketId);
    if (method === "POST") {
      requireServiceRole(req, "write");
      const upsert = req.headers["x-upsert"] === "true";
      if (!upsert && (await headObject(b.id, key))) throw duplicate();
      const token = signToken(`${b.id}/${key}`, UPLOAD_URL_TTL, { upsert, owner: undefined });
      return send(res, 200, { url: `/object/upload/sign/${b.id}/${key}?token=${token}`, token });
    }
    if (method === "PUT") {
      const claims = checkSignedToken(query.get("token"), `${b.id}/${key}`);
      const { bytes, contentType, cacheControl } = await uploadBody(req);
      const meta = await putObject(b, key, bytes, contentType, cacheControl, Boolean(claims.upsert));
      return send(res, 200, { Id: meta.id, Key: `${b.id}/${key}` });
    }
  }

  // Signed read URLs.
  if (kind === "sign") {
    if (method === "POST" && tail.length === 1) {
      requireServiceRole(req, "read");
      const b = await bucket(decodeURIComponent(tail[0]));
      const { expiresIn, paths } = await readJson(req);
      if (!Array.isArray(paths)) throw new StorageHttpError("400", "InvalidRequest", "body must have required property 'paths'");
      const out = [];
      for (const p of paths) {
        const meta = typeof p === "string" && p ? await headObject(b.id, p).catch(() => null) : null;
        if (!meta) {
          out.push({ error: "Either the object does not exist or you do not have access to it", path: p, signedURL: null });
        } else {
          out.push({ error: null, path: p, signedURL: `/object/sign/${b.id}/${p}?token=${signToken(`${b.id}/${p}`, expiresIn)}` });
        }
      }
      return send(res, 200, out);
    }
    if (tail.length >= 2) {
      const [bucketId, ...keySegs] = decodeSegments(tail);
      const key = cleanKey(keySegs.join("/"));
      const b = await bucket(bucketId);
      if (method === "POST") {
        requireServiceRole(req, "read");
        const { expiresIn } = await readJson(req);
        if (!(await headObject(b.id, key))) throw notFoundObject();
        return send(res, 200, { signedURL: `/object/sign/${b.id}/${key}?token=${signToken(`${b.id}/${key}`, expiresIn)}` });
      }
      if (method === "GET" || method === "HEAD") {
        checkSignedToken(query.get("token"), `${b.id}/${key}`);
        return serveObject(req, res, b.id, key, query.has("download") ? query.get("download") : null);
      }
    }
  }

  if (kind === "list" && method === "POST" && tail.length === 1) {
    requireServiceRole(req, "read");
    const b = await bucket(decodeURIComponent(tail[0]));
    const body = await readJson(req);
    const prefix = String(body.prefix ?? "").replace(/^\/+|\/+$/g, "");
    const dir = prefix ? inside(META, b.id, ...prefix.split("/")) : inside(META, b.id);
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      entries = [];
    }
    const items = [];
    for (const e of entries) {
      if (e.name.includes(".~tmp-")) continue;
      if (e.isDirectory()) {
        items.push({ name: e.name, id: null, updated_at: null, created_at: null, last_accessed_at: null, metadata: null });
      } else if (e.name.endsWith(".json")) {
        const name = e.name.slice(0, -5);
        const meta = await headObject(b.id, prefix ? `${prefix}/${name}` : name);
        if (meta) {
          items.push({ name, id: meta.id, updated_at: meta.updated_at, created_at: meta.created_at, last_accessed_at: meta.last_accessed_at, metadata: meta.metadata });
        }
      }
    }
    const search = String(body.search ?? "").toLowerCase();
    const column = body.sortBy?.column ?? "name";
    const dirSign = String(body.sortBy?.order ?? "asc").toLowerCase() === "desc" ? -1 : 1;
    const sorted = items
      .filter((i) => i.name.toLowerCase().startsWith(search))
      .sort((a, c) => {
        const x = String(a[column] ?? "");
        const y = String(c[column] ?? "");
        return x < y ? -dirSign : x > y ? dirSign : 0;
      });
    const offset = Number(body.offset ?? 0) || 0;
    const limit = Number(body.limit ?? 100) || 100;
    return send(res, 200, sorted.slice(offset, offset + limit));
  }

  if (kind === "info" && method === "GET") {
    const parts = tail[0] === "authenticated" || tail[0] === "public" ? tail.slice(1) : tail;
    requireServiceRole(req, "read");
    const [bucketId, ...keySegs] = decodeSegments(parts);
    const b = await bucket(bucketId);
    const key = cleanKey(keySegs.join("/"));
    const meta = await headObject(b.id, key);
    if (!meta) throw notFoundObject();
    return send(res, 200, {
      id: meta.id,
      name: key,
      bucket_id: b.id,
      version: null,
      size: meta.metadata.size,
      content_type: meta.metadata.mimetype,
      cache_control: meta.metadata.cacheControl,
      etag: meta.metadata.eTag,
      metadata: {},
      last_modified: meta.updated_at,
      created_at: meta.created_at,
    });
  }

  if ((kind === "move" || kind === "copy") && method === "POST") {
    requireServiceRole(req, "write");
    const body = await readJson(req);
    const from = await bucket(String(body.bucketId));
    const to = await bucket(String(body.destinationBucket ?? body.bucketId));
    const sourceKey = cleanKey(body.sourceKey);
    const destKey = cleanKey(body.destinationKey);
    const meta = await headObject(from.id, sourceKey);
    if (!meta) throw notFoundObject();
    const bytes = await readFile(objectFile(from.id, sourceKey));
    const copied = await putObject(to, destKey, bytes, meta.metadata.mimetype, meta.metadata.cacheControl, false);
    if (kind === "move") {
      await removeObject(from.id, sourceKey);
      return send(res, 200, { message: "Successfully moved" });
    }
    return send(res, 200, { Id: copied.id, Key: `${to.id}/${destKey}` });
  }

  // Delete several: DELETE /object/:bucket { prefixes }.
  if (method === "DELETE" && rest.length === 1) {
    requireServiceRole(req, "write");
    const b = await bucket(decodeURIComponent(rest[0]));
    const { prefixes } = await readJson(req);
    if (!Array.isArray(prefixes)) throw new StorageHttpError("400", "InvalidRequest", "body must have required property 'prefixes'");
    const removed = [];
    for (const p of prefixes) {
      let key;
      try {
        key = cleanKey(p);
      } catch {
        continue;
      }
      const meta = await removeObject(b.id, key);
      if (meta) removed.push({ ...meta, bucket_id: b.id, name: key, owner_id: "", version: null, user_metadata: null });
    }
    return send(res, 200, removed);
  }

  // Plain object routes: /object/(authenticated/|public/)?:bucket/*key.
  const scoped = rest[0] === "authenticated" || rest[0] === "public" ? rest.slice(1) : rest;
  if (scoped.length >= 2) {
    const [bucketId, ...keySegs] = decodeSegments(scoped);
    const key = cleanKey(keySegs.join("/"));
    const b = await bucket(bucketId);
    if (method === "GET" || method === "HEAD") {
      if (rest[0] === "public") {
        if (!b.public) throw notFoundObject();
      } else {
        requireServiceRole(req, "read");
      }
      return serveObject(req, res, b.id, key, query.has("download") ? query.get("download") : null);
    }
    if (method === "POST" || method === "PUT") {
      requireServiceRole(req, "write");
      const upsert = method === "PUT" || req.headers["x-upsert"] === "true";
      const { bytes, contentType, cacheControl } = await uploadBody(req);
      const meta = await putObject(b, key, bytes, contentType, cacheControl, upsert);
      return send(res, 200, { Id: meta.id, Key: `${b.id}/${key}` });
    }
    if (method === "DELETE") {
      requireServiceRole(req, "write");
      const meta = await removeObject(b.id, key);
      if (!meta) throw notFoundObject();
      return send(res, 200, { message: "Successfully deleted" });
    }
  }

  throw new StorageHttpError("404", "Not Found", `Route ${method}:/storage/v1${path} not found`, 404);
}

/* ------------------------------------------------------------------ */
/* REST: Kong's key check, pg-safeupdate, then PostgREST               */
/* ------------------------------------------------------------------ */

/** Query parameters that aren't row filters (PostgREST's reserved names). */
const NOT_FILTERS = new Set(["select", "columns", "order", "limit", "offset", "on_conflict"]);

function rest(req, res, path, search) {
  const key = req.headers.apikey ?? new URLSearchParams(search).get("apikey");
  if (!key) return send(res, 401, { message: "No API key found in request", hint: "No `apikey` request header or url param was found." });
  if (!API_KEYS.has(key)) return send(res, 401, { message: "Invalid API key", hint: "Double check your Supabase `anon` or `service_role` API key." });

  // Supabase loads pg-safeupdate for API requests: no UPDATE or DELETE without a WHERE.
  if (req.method === "PATCH" || req.method === "DELETE") {
    const params = [...new URLSearchParams(search).keys()];
    const table = !path.startsWith("/rpc/");
    if (table && !params.some((k) => !NOT_FILTERS.has(k) && k !== "apikey")) {
      return send(res, 400, { code: "21000", details: null, hint: null, message: `${req.method === "PATCH" ? "UPDATE" : "DELETE"} requires a WHERE clause` });
    }
  }

  const headers = { ...req.headers, host: POSTGREST.host };
  delete headers.connection;
  delete headers.apikey;
  // Kong turns a request with only an apikey into a bearer token, as Supabase's does.
  if (!headers.authorization) headers.authorization = `Bearer ${key}`;
  const upstream = http.request(
    { hostname: POSTGREST.hostname, port: POSTGREST.port, method: req.method, path: `${path}${search}`, headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, { ...up.headers, ...CORS });
      up.pipe(res);
    },
  );
  upstream.on("error", (err) => send(res, 502, { message: `PostgREST unreachable: ${err.message}` }));
  req.pipe(upstream);
}

/* ------------------------------------------------------------------ */
/* Server                                                              */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url ?? "/", "http://gateway");
  if (LOG) res.on("finish", () => console.log(`${req.method} ${url.pathname}${url.search.slice(0, 200)} → ${res.statusCode} ${Date.now() - started}ms`));
  if (req.method === "OPTIONS") return send(res, 204, "");
  try {
    if (url.pathname === "/rest/v1" || url.pathname.startsWith("/rest/v1/")) {
      return rest(req, res, url.pathname.slice("/rest/v1".length) || "/", url.search);
    }
    if (url.pathname.startsWith("/storage/v1/")) {
      return await storage(req, res, url.pathname.slice("/storage/v1".length), url.searchParams);
    }
    if (url.pathname === "/health") return send(res, 200, { ok: true });
    send(res, 404, { message: "no Route matched with those values" });
  } catch (err) {
    if (err instanceof StorageHttpError) {
      return send(res, err.httpStatus, { statusCode: err.statusCode, error: err.error, message: err.message });
    }
    console.error("gateway error", req.method, url.pathname, err);
    send(res, 500, { statusCode: "500", error: "internal", message: String(err?.message ?? err) });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`gateway listening on http://localhost:${PORT}`));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.close(() => process.exit(0)));
