import { NextResponse } from "next/server";
import { cronSecret } from "@/lib/env-placeholders";
import { constantTimeEqual } from "@/lib/auth/session";
import { appUrl } from "@/lib/brand";
import { escapeHtml, sendTeamEmail } from "@/lib/email";
import { fmtDate, fmtDayTime, londonDateOf, money } from "@/lib/format";
import { DUE_LEADS_SHOWN, loadDueLeads, type DueLead } from "@/lib/lead-follow-ups";
import { loadPulse, type Pulse } from "@/lib/ops-core-server";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * The daily heartbeat: one morning email with yesterday's numbers — quotes,
 * bookings, unfinished drafts, traffic — so the owner knows the state of the
 * business without opening a dashboard. Sent every day, quiet days included:
 * "nothing happened" is information too.
 *
 * Since the pilots (F7) it leads with today: surveys and install days,
 * blocked projects with what's blocking them, overdue next actions and
 * money owed; then the website leads whose follow-up is due today or
 * overdue (lib/lead-follow-ups). Names are escaped; nothing here goes to a
 * customer.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = cronSecret(); // a template value (.env.example) is no secret
  if (!secret || !constantTimeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceClient();
  if (!supabase) return NextResponse.json({ ok: true, demo: true });

  const since = new Date(Date.now() - 24 * 3600_000).toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const count = async (filter: (q: any) => any, table = "quote_requests") => {
    const { count: n } = await filter(
      supabase.from(table).select("*", { count: "exact", head: true }),
    );
    return n ?? 0;
  };

  const [newQuotes, newDrafts, newBookings, views24h, totalInbox, totalDrafts] =
    await Promise.all([
      count((q) => q.in("status", ["new", "reviewed"]).gte("created_at", since)),
      count((q) => q.eq("status", "draft").gte("created_at", since)),
      count((q) => q.eq("status", "booked").gte("booked_at", since)),
      count(
        (q) => q.eq("type", "page_view").gte("created_at", since),
        "analytics_events",
      ),
      count((q) => q.in("status", ["new", "reviewed"])),
      count((q) => q.eq("status", "draft")),
    ]);

  // Yesterday's finished quotes, named — the rows the owner will actually act on.
  const { data: recent } = await supabase
    .from("quote_requests")
    .select("customer_name, email, postcode, total_gbp, status")
    .neq("status", "draft")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(10);

  const gbp = (n: number) =>
    new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(n);

  // The pilots: today, what's stuck, what's owed. A failure here never stops the digest.
  let pulse: Pulse | null = null;
  try {
    pulse = await loadPulse();
  } catch (err) {
    console.error("[digest] pilot pulse failed:", err);
  }

  const due = await loadDueLeads(supabase, pulse?.today ?? londonDateOf(new Date().toISOString())).catch(() => null);

  const quiet = newQuotes + newDrafts + newBookings === 0;
  const today = pulse
    ? `${pulse.surveysToday.length} survey${pulse.surveysToday.length === 1 ? "" : "s"}, ${pulse.installsToday.length} install${pulse.installsToday.length === 1 ? "" : "s"} today${pulse.surveysUnassigned.length ? `, ${pulse.surveysUnassigned.length} survey${pulse.surveysUnassigned.length === 1 ? "" : "s"} with no surveyor` : ""}${pulse.blocked.length ? `, ${pulse.blocked.length} blocked` : ""}; `
    : "";
  const subject = quiet
    ? `Daily digest: ${today}quiet day (${views24h} page views)`
    : `Daily digest: ${today}${newQuotes} quote${newQuotes === 1 ? "" : "s"}, ${newBookings} booking${newBookings === 1 ? "" : "s"}, ${newDrafts} unfinished`;

  const rows = (recent ?? [])
    .map(
      (r) =>
        `<li>${escapeHtml(String(r.customer_name ?? r.email))} · ${escapeHtml(String(r.postcode))} · ${gbp(r.total_gbp)} · ${escapeHtml(String(r.status))}</li>`,
    )
    .join("");

  const base = appUrl();
  const sent = await sendTeamEmail(
    subject,
    `${pulse ? pilotSection(pulse, base) : ""}<p><strong>Last 24 hours</strong></p>
<ul>
  <li>New quotes: ${newQuotes}</li>
  <li>Bookings: ${newBookings} ${newBookings > 0 ? "🎉" : ""}</li>
  <li>Started but unfinished: ${newDrafts}</li>
  <li>Page views: ${views24h}</li>
</ul>
${rows ? `<p><strong>Yesterday's quotes</strong></p><ul>${rows}</ul>` : ""}
${leadsDueSection(due, base)}
<p><strong>Standing pipeline</strong>: ${totalInbox} in the inbox, ${totalDrafts} unfinished worth a nudge.</p>
<p>
  <a href="${base}/ops/quotes">Inbox</a> ·
  <a href="${base}/ops/quotes?tab=drafts">Follow-ups</a> ·
  <a href="${base}/ops/analytics">Analytics</a> ·
  <a href="${base}/ops/status">System status</a>
</p>`,
  );

  return NextResponse.json({ ok: true, sent, newQuotes, newBookings, newDrafts, views24h });
}

/** Website leads whose follow-up is due today or overdue. */
function leadsDueSection(due: { leads: DueLead[]; total: number } | null, base: string): string {
  if (!due) return `<p><strong>Website leads due today</strong>: couldn't be read. Check <a href="${base}/ops/quotes?sort=next">Quote requests</a>.</p>`;
  if (due.leads.length === 0) return `<p><strong>Website leads due today</strong>: none.</p>`;
  const items = due.leads
    .map((d) => `<li><a href="${base}/ops/quotes/${encodeURIComponent(d.id)}">${escapeHtml(d.name)}</a> · ${escapeHtml(d.action)} · ${escapeHtml(d.postcode)}${d.overdue ? ` <strong style="color:#b91c1c">overdue since ${escapeHtml(fmtDate(d.dueOn))}</strong>` : ""}</li>`)
    .join("");
  const more = due.total > DUE_LEADS_SHOWN ? `<li><a href="${base}/ops/quotes?tab=all&amp;sort=next">and ${due.total - DUE_LEADS_SHOWN} more</a></li>` : "";
  return `<p><strong>Website leads due today (${due.total})</strong></p><ul>${items}${more}</ul>`;
}

/** Today's pilot work, for the top of the digest. */
function pilotSection(p: Pulse, base: string): string {
  const link = (id: string, name: string) => `<a href="${base}/ops/projects/${encodeURIComponent(id)}">${escapeHtml(name)}</a>`;
  const list = (items: string[], empty: string) =>
    items.length ? `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>` : `<p style="color:#5d6371">${empty}</p>`;
  const on = [
    ...p.surveysToday.map(
      (c) =>
        `Survey: ${link(c.id, c.customer)} at ${escapeHtml(c.surveyAt ? (fmtDayTime(c.surveyAt).split(", ")[1] ?? "") : "")} (${escapeHtml(c.outcode)})${c.surveyUnassigned ? ' <strong style="color:#b45309">no surveyor</strong>' : ""}`,
    ),
    ...p.installsToday.map((c) => `Install day ${c.installDates.indexOf(p.today) + 1} of ${c.installDates.length}: ${link(c.id, c.customer)} (${escapeHtml(c.outcode)})`),
  ];
  const blocked = p.blocked.slice(0, 10).map((c) => `${link(c.id, c.customer)}: ${escapeHtml(c.topBlocker ?? c.nextAction.text)}`);
  const overdue = p.overdue
    .slice(0, 10)
    .map((c) => `${link(c.id, c.customer)}: ${escapeHtml(c.nextAction.text)} (due ${escapeHtml(fmtDate(c.nextAction.dueOn ?? p.today))})`);
  const owed = p.outstanding.invoices
    .slice(0, 10)
    .map((i) => `${link(i.projectId, i.customer)}: ${escapeHtml(i.number)}, ${escapeHtml(money(i.duePence))}${i.dueOn ? ` due ${escapeHtml(fmtDate(i.dueOn))}` : ""}`);
  const unassigned = p.surveysUnassigned.map(
    (c) => `${link(c.id, c.customer)}: survey ${escapeHtml(c.surveyAt ? fmtDayTime(c.surveyAt) : "")} (${escapeHtml(c.outcode)}). Assign a surveyor.`,
  );
  return `<p><strong>Today (${escapeHtml(fmtDate(p.today))})</strong></p>
${list(on, "No surveys or install days today.")}
${unassigned.length ? `<p><strong style="color:#b45309">Surveys with no surveyor (${unassigned.length})</strong></p>${list(unassigned, "")}` : ""}
<p><strong>Blocked (${p.blocked.length})</strong></p>
${list(blocked, "Nothing blocked.")}
<p><strong>Overdue next actions (${p.overdue.length})</strong></p>
${list(overdue, "Nothing overdue.")}
<p><strong>Owed to us: ${escapeHtml(money(p.outstanding.pence))}</strong></p>
${list(owed, "No unpaid invoices.")}
<p><a href="${base}/ops/projects">Open the board</a> · <a href="${base}/ops/messages">Messages</a></p>
<hr style="border:none;border-top:1px solid #ddd5c4;margin:20px 0"/>`;
}
