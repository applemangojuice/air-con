import { NextResponse } from "next/server";
import { cronSecret } from "@/lib/env-placeholders";
import { constantTimeEqual } from "@/lib/auth/session";
import { appUrl } from "@/lib/brand";
import { brandedEmail, emailConfigured, sendEmail } from "@/lib/email";
import { spendEmailBudget } from "@/lib/email-budget";
import { FOLLOW_UPS_PER_RUN, followUpLines, followUpSubject, pickFollowUps, reminderAllowed, type FollowUpDraft, type FollowUpRelated } from "@/lib/follow-up";
import { getSettings } from "@/lib/settings-server";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Daily cron: one friendly follow-up email to people who started the quote
 * funnel and stopped. The rules are deliberately conservative:
 *
 *  - Only drafts whose owner saw "Email me one reminder if I don't finish"
 *    next to the step-1 email and left it ticked (the draft records the
 *    wording version: lib/follow-up-notice.ts). Older drafts, and any a
 *    script made without the box, are never reminded.
 *  - Only drafts between 24 hours and 7 days old. Younger might still
 *    finish on their own; older is stale (and prevents a mass-mail of
 *    historic drafts the first time this is enabled).
 *  - One email per person, ever: never an address that finished a quote or
 *    was already reminded (follow_up_sent_at is the flag, set BEFORE
 *    sending so a crash can't cause double-sends).
 *  - At most FOLLOW_UPS_PER_RUN a run, each spent from the `follow-up`
 *    email budget (lib/email-budget.ts), so nobody typing addresses into
 *    the form can use up the email plan the office's own emails need.
 *    One the budget holds back is released for the next run.
 *
 * PECR footing: they gave us this address in the course of asking us to
 * price this exact service, were offered the choice at collection, and the
 * email says why they got it, that there'll be no further chasing (and
 * there isn't), and how to have the quote deleted.
 *
 * Trigger: Vercel Cron (vercel.json). When CRON_SECRET is set, Vercel sends
 * it as a bearer token; we reject anything else.
 */
export const dynamic = "force-dynamic";

/** How many recent drafts one run looks through for ones that may be reminded. */
const SCAN = 200;

export async function GET(request: Request) {
  const secret = cronSecret(); // a template value (.env.example) is no secret
  if (!secret || !constantTimeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
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
    .select("id, email, postcode, created_at, attribution")
    .eq("status", "draft")
    .is("follow_up_sent_at", null)
    .gt("created_at", weekAgo)
    .lt("created_at", dayAgo)
    .order("created_at", { ascending: true })
    .limit(SCAN);

  if (error) {
    console.error("follow-up scan failed:", error.message);
    return NextResponse.json({ ok: false, reason: error.message }, { status: 500 });
  }

  // Only the ones that may be reminded, oldest first; then rule out anyone
  // who finished a quote (another device or row) or was already reminded.
  const allowed = ((data ?? []) as FollowUpDraft[]).filter((d) => reminderAllowed(d.attribution)).slice(0, 50);
  let candidates: FollowUpDraft[] = [];
  if (allowed.length > 0) {
    // Addresses are saved lower-case now; older rows may not be, so look both up.
    const lower = (e: unknown) => String(e ?? "").trim().toLowerCase();
    const emails = [...new Set(allowed.flatMap((d) => [d.email, lower(d.email)]))];
    const { data: related, error: relatedErr } = await supabase
      .from("quote_requests")
      .select("email, status, follow_up_sent_at")
      .in("email", emails);
    if (relatedErr) {
      // Without it we can't tell who already finished or was reminded: send nothing.
      console.error("follow-up lookup failed:", relatedErr.message);
      return NextResponse.json({ ok: false, reason: relatedErr.message }, { status: 500 });
    }
    candidates = pickFollowUps(allowed, (related ?? []) as FollowUpRelated[], FOLLOW_UPS_PER_RUN);
  }
  if (candidates.length === 0) return NextResponse.json({ ok: true, sent: 0, failed: 0, failedIds: [] });

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
  const heldBack: string[] = [];
  // Replies go to the company address in settings, whatever EMAIL_FROM is.
  const replyTo = await getSettings().then((s) => s.company.email).catch(() => undefined);

  // Small parallel chunks: fast enough to finish inside the function budget,
  // slow enough to stay under Resend's rate limit. Each send is spent from
  // the budget first; once it's used up, the rest wait for the next run.
  for (let i = 0; i < toSend.length; i += 5) {
    const chunk: FollowUpDraft[] = [];
    for (const d of toSend.slice(i, i + 5)) {
      if (heldBack.length === 0 && (await spendEmailBudget("follow-up"))) chunk.push(d);
      else heldBack.push(d.id);
    }
    const results = await Promise.all(chunk.map((d) => sendFollowUp(d.email, d.postcode, replyTo)));
    results.forEach((ok, j) => {
      if (ok) sent++;
      else failed.push(chunk[j]!.id);
    });
    if (heldBack.length) {
      heldBack.push(...toSend.slice(i + 5).map((d) => d.id));
      break;
    }
  }

  // A send that FAILED in-band (not a crash), or one the budget held back,
  // releases its claim, so the next daily run tries again instead of the
  // lead losing their only nudge.
  const release = [...failed, ...heldBack];
  if (release.length > 0) {
    await supabase
      .from("quote_requests")
      .update({ follow_up_sent_at: null })
      .in("id", release);
  }

  console.info(`follow-up cron: ${sent} sent, ${failed.length} failed, ${heldBack.length} held back by the email budget (released for the next run)`, release);
  return NextResponse.json({ ok: true, sent, failed: failed.length, failedIds: failed, heldBack: heldBack.length });
}

async function sendFollowUp(to: string, postcode: string, replyTo: string | undefined): Promise<boolean> {
  const [greeting, opener, link, promise, why, signoff] = followUpLines(postcode, replyTo);
  return sendEmail(
    to,
    followUpSubject(postcode),
    brandedEmail(`<p style="margin:0 0 14px">${esc(greeting!)}</p>
<p style="margin:0 0 14px">${esc(opener!)}</p>
<p style="margin:0 0 24px"><a href="${appUrl()}/quote" style="display:inline-block;background:#a84508;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:999px">Finish my quote</a></p>
<p style="margin:0 0 14px;font-size:13px"><a href="${link}" style="color:#a84508">${link}</a></p>
<p style="margin:0 0 14px">${esc(promise!)}</p>
<p style="margin:0 0 28px">${esc(signoff!).replace(/\n/g, "<br/>")}</p>
<p style="margin:0 0 14px;font-size:13px;color:#5d6371">${esc(why!)}</p>`),
    { replyTo },
  );
}

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
