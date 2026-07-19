import { NextResponse } from "next/server";
import { z } from "zod";
import { getPermutation } from "@aircon/domain";
import { enforceRateLimit } from "@/lib/rate-limit";
import { VIDEO_BUCKET, getServiceClient } from "@/lib/supabase-server";

const bodySchema = z.object({
  archetypeId: z.string().min(1).max(60),
  permutationId: z.string().min(1).max(60),
  postcode: z.string().max(10).optional(),
  fileName: z.string().min(1).max(200),
});

/**
 * Creates a video survey and mints a signed upload URL for the walkthrough
 * video. The client PUTs the video to the signed URL, then calls
 * /api/video-surveys/{id}/process.
 */
export async function POST(request: Request) {
  // DB row + signed video-upload URL per call: keep scripted loops out.
  const limited = enforceRateLimit(request, "video-surveys", 10, 600_000);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { archetypeId, permutationId, postcode, fileName } = parsed.data;

  if (!getPermutation(archetypeId, permutationId)) {
    return NextResponse.json({ error: "Unknown archetype/permutation" }, { status: 400 });
  }

  const supabase = getServiceClient();
  if (!supabase) {
    return NextResponse.json({ configured: false });
  }

  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const { data: row, error: insertError } = await supabase
    .from("video_surveys")
    .insert({
      archetype_id: archetypeId,
      permutation_id: permutationId,
      postcode: postcode ?? null,
      status: "uploaded",
    })
    .select("id")
    .single();

  if (insertError || !row) {
    console.error("video survey insert failed:", insertError?.message);
    return NextResponse.json({ error: "Could not create video survey" }, { status: 502 });
  }

  const path = `${row.id}/${safeName}`;
  const { data: signed, error: signError } = await supabase.storage
    .from(VIDEO_BUCKET)
    .createSignedUploadUrl(path);

  if (signError || !signed) {
    console.error("video signed url failed:", signError?.message);
    return NextResponse.json({ error: "Upload unavailable" }, { status: 502 });
  }

  await supabase.from("video_surveys").update({ video_path: path }).eq("id", row.id);

  return NextResponse.json({
    configured: true,
    id: row.id,
    path,
    signedUrl: signed.signedUrl,
  });
}
