import { NextResponse } from "next/server";
import { z } from "zod";
import { enforceRateLimit } from "@/lib/rate-limit";
import { SURVEY_PHOTO_TYPES, baseContentType, storedFileName } from "@/lib/storage-buckets";
import { PHOTO_BUCKET, getServiceClient } from "@/lib/supabase-server";

const bodySchema = z.object({
  fileName: z.string().min(1).max(200),
  /** What the browser will PUT. The bucket refuses anything else (migration 0011), and so does this. */
  contentType: z.string().max(100).transform(baseContentType).pipe(z.enum(SURVEY_PHOTO_TYPES)),
  kind: z.enum([
    "room",
    "window",
    "external-wall",
    "outdoor-location",
    "fuse-board",
    "side-access",
  ]),
});

/**
 * Mints a short-lived signed upload URL so photos go straight to Storage.
 * Photos only: the content type is required and must be one the bucket
 * stores, and the object's extension comes from it, never from the name the
 * browser sent. Size is the bucket's limit (25 MB).
 */
export async function POST(request: Request) {
  // Stop signed-URL farming while leaving room for several photo-heavy
  // surveys and retries behind one shared IP — a tripped limit here means
  // silently missing photos, so err generous.
  const limited = enforceRateLimit(request, "uploads", 240, 600_000);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const supabase = getServiceClient();
  if (!supabase) {
    return NextResponse.json({ configured: false });
  }

  const path = `${crypto.randomUUID()}/${parsed.data.kind}-${storedFileName(parsed.data.fileName, parsed.data.contentType, "photo")}`;

  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) {
    console.error("createSignedUploadUrl failed:", error?.message);
    return NextResponse.json({ error: "Upload unavailable" }, { status: 502 });
  }

  return NextResponse.json({ configured: true, path: data.path, signedUrl: data.signedUrl });
}
