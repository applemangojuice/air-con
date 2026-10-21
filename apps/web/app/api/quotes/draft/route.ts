import { NextResponse } from "next/server";
import { z } from "zod";
import { QUOTE_BODY_MAX_BYTES, readJsonCapped } from "@/lib/http-body";
import { generateQuote, type Survey } from "@aircon/domain";
import { coverageFor } from "@/components/site/claims";
import { reminderRecord } from "@/lib/follow-up";
import { getPublicSettings } from "@/lib/public-settings";
import { withUploadedPhotosOnly } from "@/lib/quote-draft";
import { enforceRateLimit } from "@/lib/rate-limit";
import { surveySchema } from "@/lib/schemas";
import { getServiceClient } from "@/lib/supabase-server";

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  survey: surveySchema,
  /** The "Email me one reminder if I don't finish" box next to the email, and the wording version it showed. */
  reminder: z.boolean().optional(),
  reminderNotice: z.string().max(40).optional(),
});

/**
 * Save-early: creates the quote_request the moment we have address + email
 * (step 1 of the funnel), status 'draft'. The row is updated as the customer
 * progresses and finalised by POST /api/quotes with the same id. Only for
 * postcodes we cover: an out-of-area enquiry goes to /api/quotes/waitlist.
 */
export async function POST(request: Request) {
  // One draft insert per funnel entry; stop scripted row-stuffing.
  const limited = enforceRateLimit(request, "draft", 10, 600_000);
  if (limited) return limited;

  // A whole survey is a few kilobytes: a body far bigger is refused before it's read (lib/http-body).
  const body = await readJsonCapped(request, QUOTE_BODY_MAX_BYTES);
  if (body.tooLarge) return NextResponse.json({ error: "Too large" }, { status: 413 });
  const parsed = bodySchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid draft" }, { status: 400 });
  }
  const { email } = parsed.data;
  const survey = withUploadedPhotosOnly(parsed.data.survey as Survey);

  const coverage = coverageFor((await getPublicSettings()).serviceArea, survey.postcode);
  if (!coverage.covered) {
    return NextResponse.json({ error: "out-of-area", outcode: coverage.outcode }, { status: 422 });
  }
  const quote = generateQuote(survey);

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
      // The reminder choice rides in the attribution JSON (no migration
      // needed): only a draft that saw the box and left it ticked is reminded.
      attribution: reminderFor(parsed.data),
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("draft insert failed:", error?.message);
    return NextResponse.json({ error: "Could not save draft" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, demo: false, id: data.id });
}

function reminderFor(input: { reminder?: boolean; reminderNotice?: string }): { reminder: NonNullable<ReturnType<typeof reminderRecord>> } | null {
  const reminder = reminderRecord(input, new Date().toISOString());
  return reminder ? { reminder } : null;
}
