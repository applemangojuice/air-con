import { NextResponse } from "next/server";
import { getArchetype, getPermutation } from "@aircon/domain";
import { VIDEO_BUCKET, getServiceClient } from "@/lib/supabase-server";
import { assembleSurvey } from "@/lib/pipeline/assemble";
import { extractFromTranscript, isExtractionConfigured } from "@/lib/pipeline/extract";
import { isTranscriptionConfigured, transcribeVideo } from "@/lib/pipeline/transcribe";

// Transcription + extraction of a walkthrough can take a couple of minutes.
export const maxDuration = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs the pipeline for an uploaded walkthrough video:
 *   video → transcript (Whisper) → structured extraction (Claude)
 *   → assembled Survey (archetype defaults) → fixed-price quote.
 * Any unavailable stage parks the record at 'needs_review' instead of failing.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const supabase = getServiceClient();
  if (!supabase) {
    return NextResponse.json({ ok: true, demo: true, status: "needs_review" });
  }

  const { data: row } = await supabase.from("video_surveys").select("*").eq("id", id).single();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!row.video_path) {
    return NextResponse.json({ error: "No video uploaded" }, { status: 409 });
  }

  const archetype = getArchetype(row.archetype_id);
  const permutation = archetype && getPermutation(row.archetype_id, row.permutation_id);
  if (!archetype || !permutation) {
    return NextResponse.json({ error: "Unknown archetype" }, { status: 409 });
  }

  async function park(reason: string) {
    await supabase!
      .from("video_surveys")
      .update({ status: "needs_review", error: reason })
      .eq("id", id);
    return NextResponse.json({ ok: true, status: "needs_review", reason });
  }

  try {
    // 1. Transcribe
    let transcript: string | null = row.transcript;
    if (!transcript) {
      if (!isTranscriptionConfigured()) {
        return park("Transcription not configured (OPENAI_API_KEY) — video saved for manual review.");
      }
      const { data: video, error: dlError } = await supabase.storage
        .from(VIDEO_BUCKET)
        .download(row.video_path);
      if (dlError || !video) return park(`Could not read video: ${dlError?.message}`);
      transcript = await transcribeVideo(video, row.video_path.split("/").pop() ?? "video.mp4");
      if (transcript === null) return park("Transcription not configured.");
      await supabase
        .from("video_surveys")
        .update({ transcript, status: "transcribed" })
        .eq("id", id);
    }

    // 2. Extract structured rooms/wishes with Claude
    if (!isExtractionConfigured()) {
      return park("Extraction not configured (ANTHROPIC_API_KEY) — transcript saved for manual review.");
    }
    const extraction = await extractFromTranscript(transcript, archetype, permutation);
    if (!extraction) return park("Extraction returned no result.");
    await supabase
      .from("video_surveys")
      .update({ extracted: extraction, status: "extracted" })
      .eq("id", id);

    if (extraction.rooms.filter((r) => r.wantsCooling).length === 0) {
      return park("No rooms requesting cooling were identified in the narration.");
    }

    // 3. Assemble survey + price it
    const { survey, quote } = assembleSurvey(
      extraction,
      archetype,
      permutation,
      row.postcode ?? "",
    );
    await supabase
      .from("video_surveys")
      .update({
        draft_survey: survey,
        quote,
        engine_version: quote.engineVersion,
        status: "quoted",
        error: null,
      })
      .eq("id", id);

    return NextResponse.json({ ok: true, status: "quoted", survey, quote });
  } catch (err) {
    console.error("video pipeline failed:", err);
    return park(err instanceof Error ? err.message : "Pipeline failed");
  }
}
