import { NextResponse } from "next/server";
import { z } from "zod";
import { QUOTE_BODY_MAX_BYTES, readJsonCapped } from "@/lib/http-body";
import { generateQuote, type Survey } from "@aircon/domain";
import { coverageFor } from "@/components/site/claims";
import { getPublicSettings } from "@/lib/public-settings";
import { withUploadedPhotosOnly } from "@/lib/quote-draft";
import { enforceRateLimit } from "@/lib/rate-limit";
import { UUID_RE, surveySchema } from "@/lib/schemas";
import { getServiceClient } from "@/lib/supabase-server";

const bodySchema = z.object({
  survey: surveySchema,
  /** A corrected email must reach the draft, or follow-ups go to the typo. */
  email: z.string().trim().toLowerCase().email().max(200).optional(),
});

/** Update a draft in place as the customer moves through the funnel. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Fires once per funnel step; 60/10min is far above honest usage.
  const limited = enforceRateLimit(request, "draft-sync", 60, 600_000);
  if (limited) return limited;
  // A whole survey is a few kilobytes: a body far bigger is refused before it's read (lib/http-body).
  const body = await readJsonCapped(request, QUOTE_BODY_MAX_BYTES);
  if (body.tooLarge) return NextResponse.json({ error: "Too large" }, { status: 413 });
  const parsed = bodySchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid draft" }, { status: 400 });
  }
  const survey = withUploadedPhotosOnly(parsed.data.survey as Survey);
  // A draft never moves to a postcode we don't cover (the follow-up email
  // would invite them to finish a quote they can't finish).
  const coverage = coverageFor((await getPublicSettings()).serviceArea, survey.postcode);
  if (!coverage.covered) {
    return NextResponse.json({ error: "out-of-area", outcode: coverage.outcode }, { status: 422 });
  }
  const quote = generateQuote(survey);

  const supabase = getServiceClient();
  if (!supabase) return NextResponse.json({ ok: true, demo: true });

  const { error } = await supabase
    .from("quote_requests")
    .update({
      ...(parsed.data.email ? { email: parsed.data.email } : {}),
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
