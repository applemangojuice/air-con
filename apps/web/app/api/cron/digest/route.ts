import { NextResponse } from "next/server";
import { appUrl } from "@/lib/brand";
import { sendTeamEmail } from "@/lib/email";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * The daily heartbeat: one morning email with yesterday's numbers — quotes,
 * bookings, unfinished drafts, traffic — so the owner knows the state of the
 * business without opening a dashboard. Sent every day, quiet days included:
 * "nothing happened" is information too.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
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

  const quiet = newQuotes + newDrafts + newBookings === 0;
  const subject = quiet
    ? `Daily digest: quiet day (${views24h} page views)`
    : `Daily digest: ${newQuotes} quote${newQuotes === 1 ? "" : "s"}, ${newBookings} booking${newBookings === 1 ? "" : "s"}, ${newDrafts} unfinished`;

  const rows = (recent ?? [])
    .map(
      (r) =>
        `<li>${r.customer_name ?? r.email} · ${r.postcode} · ${gbp(r.total_gbp)} · ${r.status}</li>`,
    )
    .join("");

  const base = appUrl();
  const sent = await sendTeamEmail(
    subject,
    `<p><strong>Last 24 hours</strong></p>
<ul>
  <li>New quotes: ${newQuotes}</li>
  <li>Bookings: ${newBookings} ${newBookings > 0 ? "🎉" : ""}</li>
  <li>Started but unfinished: ${newDrafts}</li>
  <li>Page views: ${views24h}</li>
</ul>
${rows ? `<p><strong>Yesterday's quotes</strong></p><ul>${rows}</ul>` : ""}
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
