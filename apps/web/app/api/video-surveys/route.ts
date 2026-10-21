import { NextResponse } from "next/server";
import { z } from "zod";
import { getPermutation } from "@aircon/domain";
import { enforceRateLimit } from "@/lib/rate-limit";
import { VIDEO_BUCKET, getServiceClient } from "@/lib/supabase-server";
import { SURVEY_VIDEO_TYPES, baseContentType, storedFileName } from "@/lib/storage-buckets";
import { videoSurveysEnabled } from "@/lib/video-surveys";

const bodySchema = z.object({
  archetypeId: z.string().min(1).max(60),
  permutationId: z.string().min(1).max(60),
  postcode: z.string().max(10).optional(),
  fileName: z.string().min(1).max(200),
  /** What the app will PUT; without it, the file name's extension decides (MP4 or .mov only). */
  contentType: z.string().max(100).optional(),
});

/** The video's type: the one sent, else from the name. Null for anything the bucket won't store. */
function videoType(contentType: string | undefined, fileName: string): (typeof SURVEY_VIDEO_TYPES)[number] | null {
  const byExt: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime" };
  const t = contentType ? baseContentType(contentType) : (byExt[fileName.split(".").pop()?.toLowerCase() ?? ""] ?? "");
  return (SURVEY_VIDEO_TYPES as readonly string[]).includes(t) ? (t as (typeof SURVEY_VIDEO_TYPES)[number]) : null;
}

/**
 * Creates a video survey and mints a signed upload URL for the walkthrough
 * video. The client PUTs the video to the signed URL, then calls
 * /api/video-surveys/{id}/process.
 */
export async function POST(request: Request) {
  // The capture app isn't part of the pilot: off in production unless switched on (lib/video-surveys.ts).
  if (!videoSurveysEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // DB row + signed video-upload URL per call: keep scripted loops out.
  const limited = enforceRateLimit(request, "video-surveys", 10, 600_000);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { archetypeId, permutationId, postcode, fileName } = parsed.data;
  const type = videoType(parsed.data.contentType, fileName);
  if (!type) return NextResponse.json({ error: "Videos only: MP4 or .mov" }, { status: 415 });

  if (!getPermutation(archetypeId, permutationId)) {
    return NextResponse.json({ error: "Unknown archetype/permutation" }, { status: 400 });
  }

  const supabase = getServiceClient();
  if (!supabase) {
    return NextResponse.json({ configured: false });
  }

  const safeName = storedFileName(fileName, type, "walkthrough");
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
    contentType: type,
    signedUrl: signed.signedUrl,
  });
}
