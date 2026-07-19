import { NextResponse } from "next/server";
import { z } from "zod";
import { generateQuote, type Survey } from "@aircon/domain";
import { enforceRateLimit } from "@/lib/rate-limit";
import { surveySchema } from "@/lib/schemas";
import { getServiceClient } from "@/lib/supabase-server";

const bodySchema = z.object({
  email: z.string().email().max(200),
  survey: surveySchema,
});

/**
 * Save-early: creates the quote_request the moment we have address + email
 * (step 1 of the funnel), status 'draft'. The row is updated as the customer
 * progresses and finalised by POST /api/quotes with the same id.
 */
export async function POST(request: Request) {
  // One draft insert per funnel entry; stop scripted row-stuffing.
  const limited = enforceRateLimit(request, "draft", 10, 600_000);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid draft" }, { status: 400 });
  }
  const { email, survey } = parsed.data;
  const quote = generateQuote(survey as Survey);

  const supabase = getServiceClient();
  if (!supabase) {
    return NextResponse.json({ ok: true, demo: true });
  }

  const { data, error } = await supabase
    .from("quote_requests")
    .insert({
      customer_name: null,
      email,
      postcode: survey.postcode,
      address_line: survey.addressLine,
      engine_version: quote.engineVersion,
      survey,
      quote,
      total_gbp: quote.totalGbp,
      room_count: survey.rooms.length,
      confidence_score: quote.confidence.score,
      confidence_band: quote.confidence.band,
      status: "draft",
      source: "web",
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("draft insert failed:", error?.message);
    return NextResponse.json({ error: "Could not save draft" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, demo: false, id: data.id });
}
