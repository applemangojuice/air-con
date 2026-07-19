import { NextResponse } from "next/server";
import { appUrl } from "@/lib/brand";
import { brandedEmail, emailConfigured, sendEmail } from "@/lib/email";
import { followUpLines, followUpSubject } from "@/lib/follow-up";
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

  if (!emailConfigured()) {
    return NextResponse.json({ ok: false, reason: "email not configured", sent: 0 });
  }

  const now = Date.now();
  const dayAgo = new Date(now - 24 * 3600_000).toISOString();
  const weekAgo = new Date(now - 7 * 24 * 3600_000).toISOString();

  const { data, error } = await supabase
    .from("quote_requests")
    .select("id, email, postcode, created_at")
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

  // One nudge per PERSON, and never to someone who already finished: drop
  // drafts whose email has any non-draft quote (they completed on another
  // device/row), and collapse multiple drafts per email to the newest.
  let candidates = data ?? [];
  if (candidates.length > 0) {
    const emails = [...new Set(candidates.map((d) => d.email))];
    const { data: finished } = await supabase
      .from("quote_requests")
      .select("email")
      .in("email", emails)
      .neq("status", "draft");
    const finishedEmails = new Set((finished ?? []).map((r) => r.email));
    const newestPerEmail = new Map<string, (typeof candidates)[number]>();
    for (const d of candidates) {
      if (finishedEmails.has(d.email)) continue;
      const prev = newestPerEmail.get(d.email);
      if (!prev || d.created_at > prev.created_at) newestPerEmail.set(d.email, d);
    }
    candidates = [...newestPerEmail.values()];
  }

  // Claim the whole batch atomically: only rows this run actually flips
  // (returned by select) get emailed, so overlapping runs can't double-send.
  const { data: claimed, error: claimErr } = await supabase
    .from("quote_requests")
    .update({ follow_up_sent_at: new Date().toISOString() })
    .in("id", candidates.map((d) => d.id))
    .is("follow_up_sent_at", null)
    .select("id");
  if (claimErr) {
    console.error("follow-up claim failed:", claimErr.message);
    return NextResponse.json({ ok: false, reason: claimErr.message }, { status: 500 });
  }
  const claimedIds = new Set((claimed ?? []).map((r) => r.id));
  const toSend = candidates.filter((d) => claimedIds.has(d.id));

  let sent = 0;
  const failed: string[] = [];

  // Small parallel chunks: fast enough to finish inside the function budget,
  // slow enough to stay under Resend's rate limit.
  for (let i = 0; i < toSend.length; i += 5) {
    const chunk = toSend.slice(i, i + 5);
    const results = await Promise.all(
      chunk.map((d) => sendFollowUp(d.email, d.postcode)),
    );
    results.forEach((ok, j) => {
      if (ok) sent++;
      else failed.push(chunk[j].id);
    });
  }

  // A send that FAILED in-band (not a crash) releases its claim, so the next
  // daily run retries instead of the lead losing their only nudge.
  if (failed.length > 0) {
    await supabase
      .from("quote_requests")
      .update({ follow_up_sent_at: null })
      .in("id", failed);
  }

  console.info(`follow-up cron: ${sent} sent, ${failed.length} failed (released for retry)`, failed);
  return NextResponse.json({ ok: true, sent, failed: failed.length, failedIds: failed });
}

async function sendFollowUp(to: string, postcode: string): Promise<boolean> {
  const [greeting, opener, link, promise, signoff] = followUpLines(postcode);
  return sendEmail(
    to,
    followUpSubject(postcode),
    brandedEmail(`<p style="margin:0 0 14px">${esc(greeting)}</p>
<p style="margin:0 0 14px">${esc(opener)}</p>
<p style="margin:0 0 24px"><a href="${appUrl()}/quote" style="display:inline-block;background:#d55a0a;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:999px">Finish my quote</a></p>
<p style="margin:0 0 14px;font-size:13px"><a href="${link}" style="color:#a84508">${link}</a></p>
<p style="margin:0 0 14px">${esc(promise)}</p>
<p style="margin:0 0 28px">${esc(signoff).replace(/\n/g, "<br/>")}</p>`),
  );
}

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
