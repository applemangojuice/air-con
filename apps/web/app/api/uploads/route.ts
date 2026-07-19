import { NextResponse } from "next/server";
import { z } from "zod";
import { enforceRateLimit } from "@/lib/rate-limit";
import { PHOTO_BUCKET, getServiceClient } from "@/lib/supabase-server";

const bodySchema = z.object({
  fileName: z.string().min(1).max(200),
  kind: z.enum([
    "room",
    "window",
    "external-wall",
    "outdoor-location",
    "fuse-board",
    "side-access",
  ]),
});

/** Mints a short-lived signed upload URL so photos go straight to Storage. */
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

  const safeName = parsed.data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const path = `${crypto.randomUUID()}/${parsed.data.kind}-${safeName}`;

  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) {
    console.error("createSignedUploadUrl failed:", error?.message);
    return NextResponse.json({ error: "Upload unavailable" }, { status: 502 });
  }

  return NextResponse.json({ configured: true, path: data.path, signedUrl: data.signedUrl });
}
