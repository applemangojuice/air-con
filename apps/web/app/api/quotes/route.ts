import { NextResponse } from "next/server";
import { z } from "zod";
import { generateQuote, type Survey } from "@aircon/domain";
import { logServerEvent } from "@/lib/analytics-server";
import { appUrl } from "@/lib/brand";
import { brandedEmail, escapeHtml, sendEmail, sendTeamEmail } from "@/lib/email";
import { enforceRateLimit } from "@/lib/rate-limit";
import { UUID_RE, surveySchema } from "@/lib/schemas";
import { getServiceClient } from "@/lib/supabase-server";

const attributionSchema = z
  .object({
    referrer: z.string().max(600).optional(),
    utmSource: z.string().max(200).optional(),
    utmMedium: z.string().max(200).optional(),
    utmCampaign: z.string().max(200).optional(),
    utmTerm: z.string().max(200).optional(),
    utmContent: z.string().max(200).optional(),
    landingPath: z.string().max(300).optional(),
    firstSeenAt: z.string().max(40).optional(),
  })
  .optional();

const bodySchema = z.object({
  survey: surveySchema,
  source: z.enum(["web", "ios"]).optional().default("web"),
  /** When present, finalises the draft row created at the address step. */
  draftId: z.string().regex(UUID_RE).optional(),
  /** First-touch acquisition, so a booking traces back to its campaign. */
  attribution: attributionSchema,
  contact: z.object({
    name: z.string().min(2).max(120),
    email: z.string().email().max(200),
    phone: z.string().max(30).optional().default(""),
    timeframe: z.enum(["asap", "1-3-months", "researching"]),
  }),
});

export async function POST(request: Request) {
  // A brake on scripted spam, sized for shared IPs (CGNAT, office wifi): a
  // whole household or demo room fits, a bot loop doesn't. The save-early
  // draft row is the backstop if a legitimate burst ever trips this.
  const limited = enforceRateLimit(request, "quotes", 30, 600_000);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid survey" }, { status: 400 });
  }

  const { survey, contact, source, draftId, attribution } = parsed.data;
  if (survey.rooms.length === 0) {
    return NextResponse.json({ error: "No rooms selected" }, { status: 400 });
  }
  // The server recomputes the quote; the stored price never comes from the client.
  const quote = generateQuote(survey as Survey);

  const supabase = getServiceClient();
  if (!supabase) {
    console.info("[demo mode] quote request:", contact.email, quote.totalGbp);
    return NextResponse.json({ ok: true, demo: true });
  }

  const record = {
    customer_name: contact.name,
    email: contact.email,
    phone: contact.phone || null,
    timeframe: contact.timeframe,
    postcode: survey.postcode,
    address_line: survey.addressLine,
    engine_version: quote.engineVersion,
    survey,
    quote,
    total_gbp: quote.totalGbp,
    room_count: survey.rooms.length,
    confidence_score: quote.confidence.score,
    confidence_band: quote.confidence.band,
    source,
    attribution: attribution ?? null,
    referrer: attribution?.referrer ?? null,
    utm_source: attribution?.utmSource ?? null,
  };

  // Finalise the existing draft when we have one; insert otherwise.
  let id: string | null = null;
  let saveError: string | null = null;
  if (draftId) {
    const { data, error } = await supabase
      .from("quote_requests")
      .update({ ...record, status: "new" })
      .eq("id", draftId)
      .eq("status", "draft")
      .select("id")
      .single();
    if (error) saveError = error.message;
    id = data?.id ?? null;

    // Already finalised (double-submit, browser Back): idempotent success —
    // return the existing quote instead of inserting a duplicate row and
    // emailing the customer twice.
    if (!id) {
      const { data: existing } = await supabase
        .from("quote_requests")
        .select("id, status")
        .eq("id", draftId)
        .maybeSingle();
      if (existing && existing.status !== "draft") {
        return NextResponse.json({ ok: true, demo: false, id: existing.id, emailed: false });
      }
    }
  }
  if (!id) {
    const { data, error } = await supabase
      .from("quote_requests")
      .insert(record)
      .select("id")
      .single();
    if (error || !data) {
      saveError = error?.message ?? "no row returned";
      console.error("quote insert failed:", saveError);
      // Safety net: never lose a lead to a database hiccup. Email the details
      // to the team so it can be recovered by hand, then tell the client the
      // quote is still valid.
      await Promise.all([
        alertLeadLost(contact, quote.totalGbp, survey.postcode, saveError),
        logServerEvent("server_error", { where: "quote_insert", error: saveError }),
      ]);
      return NextResponse.json({ error: "Could not save quote", saved: false }, { status: 502 });
    }
    id = data.id;
  }

  const emailed = await sendQuoteEmail(contact.name, contact.email, id!, quote.totalGbp);
  // Ping the team so a real submission (an investor, a friend) is never missed.
  await notifyNewLead(contact, quote.totalGbp, survey.postcode, id!, attribution);
  return NextResponse.json({ ok: true, demo: false, id, emailed });
}

type Contact = { name: string; email: string; phone: string; timeframe: string };
type Attribution = { referrer?: string; utmSource?: string; utmCampaign?: string } | undefined;

async function notifyNewLead(
  contact: Contact,
  totalGbp: number,
  postcode: string,
  id: string,
  attribution: Attribution,
): Promise<void> {
  const base = appUrl();
  const source = attribution?.utmCampaign || attribution?.utmSource || attribution?.referrer || "direct";
  await sendTeamEmail(
    `New quote: ${escapeHtml(contact.name)} · ${gbpText(totalGbp)}`,
    `<p><strong>${escapeHtml(contact.name)}</strong> just got a fixed price.</p>
<ul>
  <li>Email: ${escapeHtml(contact.email)}</li>
  <li>Phone: ${escapeHtml(contact.phone || "—")}</li>
  <li>Postcode: ${escapeHtml(postcode)}</li>
  <li>Timeframe: ${escapeHtml(contact.timeframe)}</li>
  <li>Total: ${gbpText(totalGbp)}</li>
  <li>Came from: ${escapeHtml(source)}</li>
</ul>
<p><a href="${base}/ops/quotes/${id}">Open in ops →</a></p>`,
  );
}

async function alertLeadLost(
  contact: Contact,
  totalGbp: number,
  postcode: string,
  reason: string,
): Promise<void> {
  await sendTeamEmail(
    `⚠️ Quote FAILED TO SAVE: ${escapeHtml(contact.name)} — recover by hand`,
    `<p>A customer completed the funnel but the database write failed, so this
lead is <strong>not</strong> in the system. Reach out to them directly.</p>
<ul>
  <li>Name: ${escapeHtml(contact.name)}</li>
  <li>Email: ${escapeHtml(contact.email)}</li>
  <li>Phone: ${escapeHtml(contact.phone || "—")}</li>
  <li>Postcode: ${escapeHtml(postcode)}</li>
  <li>Timeframe: ${escapeHtml(contact.timeframe)}</li>
  <li>Indicative total: ${gbpText(totalGbp)}</li>
</ul>
<p>Database error: <code>${escapeHtml(reason)}</code></p>
<p>Check <a href="${appUrl()}/ops/status">/ops/status</a> — the schema is probably not fully migrated.</p>`,
  );
}

function gbpText(totalGbp: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(totalGbp);
}

/** Best-effort quote email. Returns false when not configured or failed. */
async function sendQuoteEmail(
  name: string,
  email: string,
  quoteId: string,
  totalGbp: number,
): Promise<boolean> {
  const link = `${appUrl()}/q/${quoteId}`;
  const total = gbpText(totalGbp);
  return sendEmail(
    email,
    `Your fixed price: ${total} installed`,
    brandedEmail(`<p style="margin:0 0 14px">Hi ${escapeHtml(name)},</p>
    <p style="margin:0 0 6px;color:#6e7482;font-size:14px">Your fixed installation price, VAT included:</p>
    <p style="margin:0 0 16px;font-size:36px;font-weight:700">${total}</p>
    <p style="margin:0 0 20px;color:#454b58">That's the actual price, not an estimate — your full quote with the system design, price breakdown and finance options is saved at the link below, and it doesn't expire.</p>
    <p style="margin:0 0 24px">
      <a href="${link}" style="display:inline-block;background:#d55a0a;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:999px">View my quote</a>
    </p>
    <p style="margin:0 0 6px;font-size:13px;color:#6e7482">Or copy this link:</p>
    <p style="margin:0 0 24px;font-size:13px"><a href="${link}" style="color:#a84508">${link}</a></p>
    <p style="margin:0 0 28px;color:#454b58">You can book your installation from that page whenever you're ready. No calls, no chasing.</p>`),
  );
}


