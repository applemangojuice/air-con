import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Daily cron: one friendly follow-up email to people who started the quote
 * funnel and stopped. The rules are deliberately conservative:
 *
 *  - Only drafts between 24 hours and 7 days old. Younger might still
 *    finish on their own; older is stale (and prevents a mass-mail of
 *    historic drafts the first time this is enabled).
 *  - One email per enquiry, ever (follow_up_sent_at is the flag, set
 *    BEFORE sending so a crash can't cause double-sends).
 *  - Batch capped per run.
 *
 * PECR footing: they gave us this address in the course of asking us to
 * price this exact service (soft opt-in), and the email says there'll be no
 * further chasing — and there isn't.
 *
 * Trigger: Vercel Cron (vercel.json). When CRON_SECRET is set, Vercel sends
 * it as a bearer token; we reject anything else.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceClient();
  if (!supabase) return NextResponse.json({ ok: true, demo: true, sent: 0 });

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    return NextResponse.json({ ok: false, reason: "email not configured", sent: 0 });
  }

  const now = Date.now();
  const dayAgo = new Date(now - 24 * 3600_000).toISOString();
  const weekAgo = new Date(now - 7 * 24 * 3600_000).toISOString();

  const { data, error } = await supabase
    .from("quote_requests")
    .select("id, email, postcode, total_gbp")
    .eq("status", "draft")
    .is("follow_up_sent_at", null)
    .gt("created_at", weekAgo)
    .lt("created_at", dayAgo)
    .order("created_at", { ascending: true })
    .limit(50);

  if (error) {
    console.error("follow-up scan failed:", error.message);
    return NextResponse.json({ ok: false, reason: error.message }, { status: 500 });
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://dang.ac").replace(/\/$/, "");
  let sent = 0;
  const failed: string[] = [];

  for (const draft of data ?? []) {
    // Claim before sending: a crash mid-batch must never double-email.
    const { error: claimErr } = await supabase
      .from("quote_requests")
      .update({ follow_up_sent_at: new Date().toISOString() })
      .eq("id", draft.id)
      .is("follow_up_sent_at", null);
    if (claimErr) continue;

    const ok = await sendFollowUp(apiKey, from, draft.email, draft.postcode, appUrl);
    if (ok) sent++;
    else failed.push(draft.id);
  }

  console.info(`follow-up cron: ${sent} sent, ${failed.length} failed`);
  return NextResponse.json({ ok: true, sent, failed: failed.length });
}

async function sendFollowUp(
  apiKey: string,
  from: string,
  to: string,
  postcode: string,
  appUrl: string,
): Promise<boolean> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `Your air conditioning price for ${postcode} is one tap away`,
        html: `<p>Hi,</p>
<p>You started getting a fixed price for air conditioning at ${escapeHtml(postcode)} and got most of the way there. Your answers are saved on the device you used — picking up where you left off takes about a minute:</p>
<p><a href="${appUrl}/quote">Finish my quote</a></p>
<p>If now isn't the time, no problem: this is the only nudge we'll send. No calls, no follow-up barrage.</p>
<p>Stay cool,<br/>Dang, It's Hot</p>`,
      }),
    });
    if (!res.ok) console.error("follow-up email failed:", res.status, await res.text());
    return res.ok;
  } catch (err) {
    console.error("follow-up email failed:", err);
    return false;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
