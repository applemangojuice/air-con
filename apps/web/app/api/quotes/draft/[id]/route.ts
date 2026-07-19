import { NextResponse } from "next/server";
import { z } from "zod";
import { generateQuote, type Survey } from "@aircon/domain";
import { enforceRateLimit } from "@/lib/rate-limit";
import { UUID_RE, surveySchema } from "@/lib/schemas";
import { getServiceClient } from "@/lib/supabase-server";

const bodySchema = z.object({ survey: surveySchema });

/** Update a draft in place as the customer moves through the funnel. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Fires once per funnel step; 60/10min is far above honest usage.
  const limited = enforceRateLimit(request, "draft-sync", 60, 600_000);
  if (limited) return limited;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid draft" }, { status: 400 });
  }
  const survey = parsed.data.survey as Survey;
  const quote = generateQuote(survey);

  const supabase = getServiceClient();
  if (!supabase) return NextResponse.json({ ok: true, demo: true });

  const { error } = await supabase
    .from("quote_requests")
    .update({
      postcode: survey.postcode,
      address_line: survey.addressLine,
      engine_version: quote.engineVersion,
      survey,
      quote,
      total_gbp: quote.totalGbp,
      room_count: survey.rooms.length,
      confidence_score: quote.confidence.score,
      confidence_band: quote.confidence.band,
    })
    .eq("id", id)
    .eq("status", "draft"); // finalised quotes are immutable via this route

  if (error) {
    console.error("draft update failed:", error.message);
    return NextResponse.json({ error: "Could not update draft" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, demo: false });
}
