import { NextResponse } from "next/server";
import { z } from "zod";
import { generateQuote, type Survey } from "@aircon/domain";
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
      await alertLeadLost(contact, quote.totalGbp, survey.postcode, saveError);
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

/** Where lead alerts go. Falls back to the address EMAIL_FROM sends as. */
function leadsInbox(): string | null {
  if (process.env.LEADS_NOTIFY_EMAIL) return process.env.LEADS_NOTIFY_EMAIL;
  const from = process.env.EMAIL_FROM;
  if (!from) return null;
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from;
}

/** Best-effort plain email via Resend. No-ops when Resend isn't configured. */
async function sendTeamEmail(subject: string, html: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  const to = leadsInbox();
  if (!apiKey || !from || !to) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
  } catch (err) {
    console.error("team email failed:", err);
  }
}

async function notifyNewLead(
  contact: Contact,
  totalGbp: number,
  postcode: string,
  id: string,
  attribution: Attribution,
): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
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
${appUrl ? `<p><a href="${appUrl}/ops/quotes/${id}">Open in ops →</a></p>` : ""}`,
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
<p>Check <a href="${(process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")}/ops/status">/ops/status</a> — the schema is probably not fully migrated.</p>`,
  );
}

function gbpText(totalGbp: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(totalGbp);
}

/** Best-effort quote email via Resend. Returns false when not configured or failed. */
async function sendQuoteEmail(
  name: string,
  email: string,
  quoteId: string,
  totalGbp: number,
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!apiKey || !from || !appUrl) return false;

  const link = `${appUrl.replace(/\/$/, "")}/q/${quoteId}`;
  const total = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(totalGbp);

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from,
        to: [email],
        subject: `Your fixed price: ${total} installed`,
        html: `<p>Hi ${escapeHtml(name)},</p>
<p>Your fixed installation price is <strong>${total}</strong> (VAT included).</p>
<p>Your full quote (system design, price breakdown and finance options) is saved here:</p>
<p><a href="${link}">${link}</a></p>
<p>You can book your installation from that page whenever you're ready. The link doesn't expire.</p>`,
      }),
    });
    if (!res.ok) console.error("quote email failed:", res.status, await res.text());
    return res.ok;
  } catch (err) {
    console.error("quote email failed:", err);
    return false;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
