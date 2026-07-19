import { NextResponse } from "next/server";
import { z } from "zod";
import { appUrl } from "@/lib/brand";
import { brandedEmail, escapeHtml, sendEmail, sendTeamEmail } from "@/lib/email";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServiceClient } from "@/lib/supabase-server";

const bodySchema = z.object({
  quoteId: z.string().uuid(),
  preferredStart: z.enum(["asap", "2-4-weeks", "1-2-months", "flexible"]),
  notes: z.string().max(2000).optional().default(""),
});

const START_LABEL: Record<string, string> = {
  asap: "as soon as possible",
  "2-4-weeks": "in 2–4 weeks",
  "1-2-months": "in 1–2 months",
  flexible: "flexible on timing",
};

export async function POST(request: Request) {
  const limited = enforceRateLimit(request, "bookings", 10, 600_000);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid booking" }, { status: 400 });
  }

  const supabase = getServiceClient();
  if (!supabase) {
    console.info("[demo mode] booking request:", parsed.data.quoteId);
    return NextResponse.json({ ok: true, demo: true });
  }

  const { quoteId, preferredStart, notes } = parsed.data;
  const { data, error } = await supabase
    .from("quote_requests")
    .update({
      booking: { preferredStart, notes },
      booked_at: new Date().toISOString(),
      status: "booked",
    })
    .eq("id", quoteId)
    .select("id, customer_name, email, postcode, total_gbp")
    .single();

  if (error || !data) {
    console.error("booking update failed:", error?.message);
    return NextResponse.json({ error: "Could not save booking" }, { status: 502 });
  }

  // A booking is the highest-intent action on the site: the customer gets an
  // immediate written confirmation, the team gets pinged. Both best-effort —
  // the booking itself is already saved.
  const total = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(data.total_gbp);
  const link = `${appUrl()}/q/${data.id}`;
  const firstName = (data.customer_name ?? "").split(" ")[0] || "there";

  await Promise.all([
    sendEmail(
      data.email,
      "Booking received — here's what happens next",
      brandedEmail(`<p style="margin:0 0 14px">Hi ${escapeHtml(firstName)},</p>
<p style="margin:0 0 14px">Your installation request is in — thank you. Your fixed price of <strong>${total}</strong> is locked to your quote, and you told us you're ${escapeHtml(START_LABEL[preferredStart] ?? preferredStart)}.</p>
<p style="margin:0 0 14px"><strong>What happens next:</strong> a real person reviews your survey (usually within one working day), then we email you to confirm your installation date and the deposit. No phone calls unless you ask for one.</p>
<p style="margin:0 0 24px">Your quote and booking live here:</p>
<p style="margin:0 0 24px"><a href="${link}" style="display:inline-block;background:#d55a0a;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:999px">View my booking</a></p>`),
    ),
    sendTeamEmail(
      `🎉 BOOKING: ${escapeHtml(data.customer_name ?? data.email)} · ${total} · ${escapeHtml(data.postcode)}`,
      `<p><strong>${escapeHtml(data.customer_name ?? data.email)}</strong> just booked their installation.</p>
<ul>
  <li>Total: ${total}</li>
  <li>Postcode: ${escapeHtml(data.postcode)}</li>
  <li>Timing: ${escapeHtml(START_LABEL[preferredStart] ?? preferredStart)}</li>
  ${notes ? `<li>Notes: ${escapeHtml(notes)}</li>` : ""}
</ul>
<p><a href="${appUrl()}/ops/quotes/${data.id}">Open in ops →</a> — review the survey and confirm their date.</p>`,
    ),
  ]);

  return NextResponse.json({ ok: true, demo: false });
}
