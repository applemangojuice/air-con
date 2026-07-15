import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Poll a video survey's pipeline status (used by the iOS app). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const supabase = getServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Not configured" }, { status: 404 });
  }

  const { data } = await supabase
    .from("video_surveys")
    .select("id, status, archetype_id, permutation_id, extracted, draft_survey, quote, error, created_at")
    .eq("id", id)
    .single();
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(data);
}
