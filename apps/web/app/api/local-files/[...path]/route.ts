import { localBackendOf, type LocalClient } from "@/lib/db/local-client";
import { cleanContentType, inlineSafe, isBucketName, readLimited } from "@/lib/db/local-storage";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Signed file URLs for the local data backend (contract §B): what Supabase
 * Storage's signed URLs are when the app runs on files. The signature is
 * the only credential (like Supabase's token), so this route is public.
 *
 *   GET /api/local-files/<bucket>/<path>?op=get&exp=…&sig=…   serve the file
 *   PUT /api/local-files/<bucket>/<path>?op=put&exp=…&sig=…   store the body
 *
 * 404 whenever the local backend isn't the active one, so a Supabase
 * deployment exposes nothing here.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PREFIX = "/api/local-files/";

type Target = { local: LocalClient; bucket: string; path: string; params: URLSearchParams };

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** Bucket and path straight from the raw URL, so encoding is decoded exactly once. */
function target(request: Request): Target | Response {
  const local = localBackendOf(getServiceClient());
  if (!local) return json(404, { error: "Not found" });

  const url = new URL(request.url);
  const at = url.pathname.indexOf(PREFIX);
  if (at === -1) return json(404, { error: "Not found" });
  let segments: string[];
  try {
    segments = url.pathname.slice(at + PREFIX.length).split("/").map(decodeURIComponent);
  } catch {
    return json(400, { error: "Bad path" });
  }
  const [bucket, ...rest] = segments;
  if (!bucket || !isBucketName(bucket) || rest.length === 0) return json(404, { error: "Not found" });
  return { local, bucket, path: rest.join("/"), params: url.searchParams };
}

function verify(t: Target, ops: string[]): Response | null {
  const op = t.params.get("op") ?? "";
  if (!ops.includes(op)) return json(403, { error: "Invalid signature" });
  const check = t.local.files.verify(op, t.bucket, t.path, t.params.get("exp"), t.params.get("sig"));
  if (check === "expired") return json(403, { error: "Signed URL expired" });
  if (check !== "ok") return json(403, { error: "Invalid signature" });
  return null;
}

export async function GET(request: Request): Promise<Response> {
  const t = target(request);
  if (t instanceof Response) return t;
  const denied = verify(t, ["get"]);
  if (denied) return denied;

  const obj = await t.local.files.read(t.bucket, t.path);
  if (!obj) return json(404, { error: "Object not found" });

  const contentType = cleanContentType(obj.meta.contentType);
  const download = t.params.get("download");
  const name = (download || t.path.split("/").pop() || "file").replace(/["\\\r\n]/g, "_");
  // Uploaded bytes are untrusted: only media and PDFs render inline, and a
  // sandbox CSP keeps anything opened directly from running script here.
  const disposition = download !== null || !inlineSafe(contentType) ? "attachment" : "inline";
  const remaining = Math.max(0, Number(t.params.get("exp")) - Math.floor(Date.now() / 1000));

  return new Response(obj.bytes as Uint8Array<ArrayBuffer>, {
    status: 200,
    headers: {
      "content-type": contentType,
      "content-length": String(obj.bytes.byteLength),
      "content-disposition": `${disposition}; filename="${name}"`,
      "cache-control": `private, max-age=${Math.min(remaining, 3600)}`,
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function PUT(request: Request): Promise<Response> {
  const t = target(request);
  if (t instanceof Response) return t;
  const denied = verify(t, ["put", "upsert"]);
  if (denied) return denied;

  const limit = t.local.files.maxBytes(t.bucket);
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > limit) return json(413, { error: "The object exceeded the maximum allowed size" });
  const body = await readLimited(request.body, limit);
  if (body === "too-large") return json(413, { error: "The object exceeded the maximum allowed size" });

  const contentType = cleanContentType(request.headers.get("content-type"));
  // As Supabase does with the bucket's allowed_mime_types (migration 0011).
  if (!t.local.files.accepts(t.bucket, contentType)) return json(415, { error: `mime type ${contentType.split(";")[0]} is not supported` });
  const status = await t.local.files.write(t.bucket, t.path, body, contentType, t.params.get("op") === "upsert");
  if (status === "exists") return json(409, { error: "The resource already exists" });
  return json(200, { Key: `${t.bucket}/${t.path}` });
}
