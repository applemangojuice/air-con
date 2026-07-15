import { NextResponse } from "next/server";
import { z } from "zod";
import { generateQuote, type Survey } from "@aircon/domain";
import { UUID_RE, surveySchema } from "@/lib/schemas";
import { getServiceClient } from "@/lib/supabase-server";

const bodySchema = z.object({
  survey: surveySchema,
  source: z.enum(["web", "ios"]).optional().default("web"),
  /** When present, finalises the draft row created at the address step. */
  draftId: z.string().regex(UUID_RE).optional(),
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

  const { survey, contact, source, draftId } = parsed.data;
  if (survey.rooms.length === 0) {
    return NextResponse.json({ error: "No rooms selected" }, { status: 400 });
  }
  // The server recomputes the quote — the stored price never comes from the client.
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
  };

  // Finalise the existing draft when we have one; insert otherwise.
  let id: string | null = null;
  if (draftId) {
    const { data } = await supabase
      .from("quote_requests")
      .update({ ...record, status: "new" })
      .eq("id", draftId)
      .eq("status", "draft")
      .select("id")
      .single();
    id = data?.id ?? null;
  }
  if (!id) {
    const { data, error } = await supabase
      .from("quote_requests")
      .insert(record)
      .select("id")
      .single();
    if (error || !data) {
      console.error("quote insert failed:", error?.message);
      return NextResponse.json({ error: "Could not save quote" }, { status: 502 });
    }
    id = data.id;
  }

  const emailed = await sendQuoteEmail(contact.name, contact.email, id!, quote.totalGbp);
  return NextResponse.json({ ok: true, demo: false, id, emailed });
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
<p>Your full quote — system design, price breakdown and finance options — is saved here:</p>
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
