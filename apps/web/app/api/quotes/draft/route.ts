import { NextResponse } from "next/server";
import { z } from "zod";
import { QUOTE_BODY_MAX_BYTES, readJsonCapped } from "@/lib/http-body";
import { generateQuote, type Survey } from "@aircon/domain";
import { coverageFor } from "@/components/site/claims";
import { brandedEmail, escapeHtml, sendEmail } from "@/lib/email";
import { spendEmailBudget } from "@/lib/email-budget";
import { draftAttribution, funnelFields } from "@/lib/draft-funnel";
import { RESUME_DAYS, RESUME_EMAIL_GAP_MINUTES, funnelState, resumeLines, resumeSubject } from "@/lib/follow-up";
import { getPublicSettings } from "@/lib/public-settings";
import { withUploadedPhotosOnly } from "@/lib/quote-draft";
import { enforceRateLimit } from "@/lib/rate-limit";
import { surveySchema } from "@/lib/schemas";
import { getServiceClient } from "@/lib/supabase-server";

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  survey: surveySchema,
  /** The opt-out under the email (true unless ticked), and the wording version it showed. */
  reminder: z.boolean().optional(),
  reminderNotice: z.string().max(40).optional(),
  ...funnelFields,
  /** They've been told about their unfinished quote and chose to start again here. */
  fresh: z.boolean().optional(),
});

/**
 * Save-early: creates the quote_request the moment we have address + email
 * (the refine gate), status 'draft'. The row is updated as the customer
 * goes (PATCH, with the time of each change, so the reminder knows when
 * they stopped) and finalised by POST /api/quotes with the same id. Only
 * for postcodes we cover: an out-of-area enquiry goes to /api/quotes/waitlist.
 *
 * Coming back: when this email already has an unfinished quote at this
 * postcode, we don't start a second one. We email that quote's link to the
 * address (never show it here: whoever typed the email may not own it) and
 * say so; `fresh` means they'd rather start again.
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

  const settings = await getPublicSettings();
  const coverage = coverageFor(settings.serviceArea, survey.postcode);
  if (!coverage.covered) {
    return NextResponse.json({ error: "out-of-area", outcode: coverage.outcode }, { status: 422 });
  }
  const quote = generateQuote(survey);

  const supabase = getServiceClient();
  if (!supabase) {
    return NextResponse.json({ ok: true, demo: true });
  }

  const now = new Date();
  if (!parsed.data.fresh) {
    const since = new Date(now.getTime() - RESUME_DAYS * 24 * 3600_000).toISOString();
    const compact = survey.postcode.replace(/\s+/g, "").toUpperCase();
    const { data: open } = await supabase
      .from("quote_requests")
      .select("id, postcode, attribution, created_at")
      .eq("email", email)
      .eq("status", "draft")
      .gt("created_at", since)
      .order("created_at", { ascending: false })
      .limit(10);
    const existing = (open ?? []).find((r) => String(r.postcode ?? "").replace(/\s+/g, "").toUpperCase() === compact);
    if (existing) {
      const funnel = funnelState(existing.attribution);
      const recentlySent = funnel.resumeSentAt && Date.parse(funnel.resumeSentAt) > now.getTime() - RESUME_EMAIL_GAP_MINUTES * 60_000;
      if (!recentlySent && (await spendEmailBudget("public"))) {
        const [greeting, opener, link, ignore, signoff] = resumeLines(survey.postcode, String(existing.id));
        const sent = await sendEmail(
          email,
          resumeSubject(survey.postcode),
          brandedEmail(`<p style="margin:0 0 14px">${escapeHtml(greeting!)}</p>
<p style="margin:0 0 14px">${escapeHtml(opener!)}</p>
<p style="margin:0 0 24px"><a href="${escapeHtml(link!)}" style="display:inline-block;background:#a84508;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:999px">Pick up my quote</a></p>
<p style="margin:0 0 14px;font-size:13px"><a href="${escapeHtml(link!)}" style="color:#a84508">${escapeHtml(link!)}</a></p>
<p style="margin:0 0 14px">${escapeHtml(ignore!)}</p>
<p style="margin:0 0 14px">${escapeHtml(signoff!).replace(/\n/g, "<br/>")}</p>`),
          { replyTo: settings.company.email },
        );
        if (sent) {
          const attribution = typeof existing.attribution === "object" && existing.attribution !== null ? existing.attribution : {};
          await supabase
            .from("quote_requests")
            .update({ attribution: { ...attribution, funnel: { ...funnel, resumeSentAt: now.toISOString() } } })
            .eq("id", existing.id)
            .eq("status", "draft");
        }
      }
      // Never the id: the link goes to the inbox, not to whoever typed the address.
      return NextResponse.json({ ok: true, demo: false, resumeSent: true });
    }
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
      // The reminder answer and the funnel's state ride in the attribution
      // JSON (no migration needed): only a draft that saw the notice and
      // didn't opt out is reminded, and only once it's gone quiet.
      attribution: draftAttribution(parsed.data, {}, now.toISOString()),
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("draft insert failed:", error?.message);
    return NextResponse.json({ error: "Could not save draft" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, demo: false, id: data.id });
}
