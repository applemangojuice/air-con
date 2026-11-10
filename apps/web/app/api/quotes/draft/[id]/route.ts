import { NextResponse } from "next/server";
import { z } from "zod";
import { QUOTE_BODY_MAX_BYTES, readJsonCapped } from "@/lib/http-body";
import { generateQuote, type Survey } from "@aircon/domain";
import { coverageFor } from "@/components/site/claims";
import { draftAttribution, funnelFields } from "@/lib/draft-funnel";
import { funnelState, reminderState } from "@/lib/follow-up";
import { getPublicSettings } from "@/lib/public-settings";
import { withUploadedPhotosOnly } from "@/lib/quote-draft";
import { enforceRateLimit } from "@/lib/rate-limit";
import { UUID_RE, surveySchema } from "@/lib/schemas";
import { getServiceClient } from "@/lib/supabase-server";

const bodySchema = z.object({
  survey: surveySchema,
  /** A corrected email must reach the draft, or follow-ups go to the typo. */
  email: z.string().trim().toLowerCase().email().max(200).optional(),
  /** The opt-out at the gate (and its wording version): ticking it later still counts. */
  reminder: z.boolean().optional(),
  reminderNotice: z.string().max(40).optional(),
  ...funnelFields,
});

/**
 * The resume link (/quote?resume=<id>, from the reminder and the
 * "pick up where you left off" emails): an unfinished quote's answers, so
 * any device carries on where they stopped. The id is the key, as with a
 * saved quote's /q/[id] page: unguessable, sent only to the inbox that
 * started it. Finished quotes are not served here (they have their page).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const limited = enforceRateLimit(request, "draft-resume", 30, 600_000);
  if (limited) return limited;

  const supabase = getServiceClient();
  if (!supabase) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data } = await supabase
    .from("quote_requests")
    .select("id, email, survey, attribution, status")
    .eq("id", id)
    .maybeSingle();
  if (!data || data.status !== "draft") return NextResponse.json({ error: "Not found" }, { status: 404 });

  const funnel = funnelState(data.attribution);
  const answer = reminderState(data.attribution);
  return NextResponse.json({
    id: data.id,
    email: data.email,
    survey: data.survey,
    layout: funnel.layout,
    prefillSource: funnel.prefillSource,
    reminder: answer === "unknown" ? undefined : answer === "allowed",
  });
}

/** Update a draft in place as the customer moves through the funnel. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Saves as they go (a few seconds after each change); 120/10min is far above honest usage.
  const limited = enforceRateLimit(request, "draft-sync", 120, 600_000);
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

  // The answer on record stands unless this save carries a new one; the funnel state is stamped with now.
  const { data: current } = await supabase.from("quote_requests").select("attribution, status").eq("id", id).maybeSingle();
  if (!current || current.status !== "draft") return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { error } = await supabase
    .from("quote_requests")
    .update({
      ...(parsed.data.email ? { email: parsed.data.email } : {}),
      attribution: draftAttribution(parsed.data, current.attribution, new Date().toISOString()),
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
