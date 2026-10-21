import { NextResponse } from "next/server";
import { z } from "zod";
import { generateQuote, type Survey } from "@aircon/domain";
import { AREA_LAUNCH_VERSION, areaLaunchConsentText, coverageFor } from "@/components/site/claims";
import { escapeHtml, sendTeamEmail } from "@/lib/email";
import { isValidUkPostcode, normalisePostcode } from "@/lib/format";
import { getPublicSettings } from "@/lib/public-settings";
import { newDraft } from "@/lib/quote-draft";
import { enforceRateLimit } from "@/lib/rate-limit";
import { UUID_RE } from "@/lib/schemas";
import { getServiceClient } from "@/lib/supabase-server";

const bodySchema = z.object({
  email: z.string().trim().email().max(200),
  postcode: z.string().trim().max(10).refine(isValidUkPostcode, "Invalid postcode"),
  addressLine: z.string().trim().max(200).optional(),
  district: z.string().trim().max(100).optional(),
  /** A draft saved earlier in this funnel visit: it becomes this lead. */
  draftId: z.string().regex(UUID_RE).optional(),
});

const REASON = "out of area";

/**
 * "Tell me when you're here" for a postcode outside the service area. Stores
 * the lead as a declined quote request (reason: out of area) with the exact
 * words the person agreed to, so the one email we owe them can be sent when
 * we reach their outcode, and nothing else is. Idempotent per email and
 * postcode, rate-limited, never a coverage claim.
 */
export async function POST(request: Request) {
  const limited = enforceRateLimit(request, "waitlist", 6, 600_000);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { email, district, draftId } = parsed.data;
  const postcode = normalisePostcode(parsed.data.postcode);
  const addressLine = parsed.data.addressLine ?? "";

  const coverage = coverageFor((await getPublicSettings()).serviceArea, postcode);
  if (coverage.covered) {
    // We do cover it: the funnel is the right place, not a waiting list.
    return NextResponse.json({ error: "covered", outcode: coverage.outcode }, { status: 409 });
  }

  const supabase = getServiceClient();
  if (!supabase) return NextResponse.json({ ok: true, demo: true });

  const now = new Date().toISOString();
  const outcode = coverage.outcode;
  const attribution = {
    outOfArea: { outcode, district: district ?? null, at: now },
    consents: {
      areaLaunch: {
        given: true,
        at: now,
        version: AREA_LAUNCH_VERSION,
        text: areaLaunchConsentText(outcode),
        channels: ["email"],
        source: "quote-funnel",
      },
    },
  };

  // Already on the list for this postcode: nothing to add.
  const { data: existing } = await supabase
    .from("quote_requests")
    .select("id")
    .eq("email", email.toLowerCase())
    .eq("postcode", postcode)
    .eq("status", "declined")
    .limit(1);
  if (existing && existing.length > 0) return NextResponse.json({ ok: true, demo: false });

  const survey: Survey = { ...newDraft(postcode).survey, addressLine };
  const quote = generateQuote(survey);
  const row = {
    email: email.toLowerCase(),
    postcode,
    address_line: addressLine,
    engine_version: quote.engineVersion,
    survey,
    quote,
    total_gbp: 0,
    room_count: 0,
    confidence_score: 0,
    confidence_band: "low",
    status: "declined",
    source: "web",
    attribution,
  };

  let id: string | null = null;
  if (draftId) {
    // The draft they started becomes this lead (still unpriced: no rooms).
    const { data } = await supabase
      .from("quote_requests")
      .update(row)
      .eq("id", draftId)
      .eq("status", "draft")
      .select("id")
      .maybeSingle();
    id = (data?.id as string | undefined) ?? null;
  }
  if (!id) {
    const { data, error } = await supabase.from("quote_requests").insert(row).select("id").single();
    if (error || !data) {
      console.error("waitlist insert failed:", error?.message);
      return NextResponse.json({ error: "Could not save" }, { status: 502 });
    }
    id = data.id as string;
  }

  // The lost-reason note, in the same shape ops uses when it declines a lead.
  const { error: noteError } = await supabase
    .from("ops_notes")
    .insert({ quote_id: id, author: "website", note: `Declined — ${REASON} (${outcode}): asked to hear once when we start installing there.` });
  if (noteError) console.error("waitlist note failed:", noteError.message);

  await sendTeamEmail(
    `Out-of-area interest: ${escapeHtml(outcode)}`,
    `<p>Someone in <strong>${escapeHtml(outcode)}</strong>${district ? ` (${escapeHtml(district)})` : ""} asked to hear when we start installing there.</p>
<p>They agreed to one email when we launch in ${escapeHtml(outcode)}, nothing else. Stored as a declined lead (reason: ${REASON}).</p>`,
  );
  return NextResponse.json({ ok: true, demo: false });
}
