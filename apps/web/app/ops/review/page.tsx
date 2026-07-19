import Link from "next/link";
import type { Metadata } from "next";
import { PLAN_BASE, buildPlan } from "@aircon/domain";
import { gbp } from "@/lib/format";
import { getServiceClient } from "@/lib/supabase-server";

export const metadata: Metadata = {
  title: "Business review · ops",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/**
 * Plan vs actual: the weekly business review, automated. The left columns
 * are what really happened (from quote_requests); the right columns are what
 * the operating model said would happen (buildPlan, month 1 anchored to the
 * first real quote). The gap between them is the management conversation —
 * and when reality wins an argument, the assumption in finance.ts loses it.
 */

interface MonthActual {
  key: string; // "2026-07"
  quotes: number;
  booked: number;
  bookedValueGbp: number;
}

interface WeekStrip {
  quotesThis: number;
  quotesLast: number;
  bookedThis: number;
  bookedLast: number;
  viewsThis: number;
  viewsLast: number;
}

async function actuals(): Promise<{ months: MonthActual[]; week: WeekStrip; firstMonth: string | null } | null> {
  const supabase = getServiceClient();
  if (!supabase) return null;

  // Finalised quotes only (drafts aren't demand, they're intent).
  const rows: { created_at: string; status: string; total_gbp: number; booked_at: string | null }[] = [];
  const PAGE = 1000;
  for (let from = 0; from < 20000; from += PAGE) {
    const { data, error } = await supabase
      .from("quote_requests")
      .select("created_at, status, total_gbp, booked_at")
      .neq("status", "draft")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !data) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }

  const byMonth = new Map<string, MonthActual>();
  for (const r of rows) {
    const key = r.created_at.slice(0, 7);
    const m = byMonth.get(key) ?? { key, quotes: 0, booked: 0, bookedValueGbp: 0 };
    m.quotes++;
    if (r.status === "booked") {
      m.booked++;
      m.bookedValueGbp += r.total_gbp;
    }
    byMonth.set(key, m);
  }
  const months = [...byMonth.values()].sort((a, b) => a.key.localeCompare(b.key));

  // Week-over-week strip (rolling 7-day windows).
  const now = Date.now();
  const w1 = new Date(now - 7 * 86400_000).toISOString();
  const w2 = new Date(now - 14 * 86400_000).toISOString();
  const inWindow = (iso: string | null, from: string, to?: string) =>
    iso !== null && iso >= from && (to === undefined || iso < to);
  const week: WeekStrip = {
    quotesThis: rows.filter((r) => inWindow(r.created_at, w1)).length,
    quotesLast: rows.filter((r) => inWindow(r.created_at, w2, w1)).length,
    bookedThis: rows.filter((r) => inWindow(r.booked_at, w1)).length,
    bookedLast: rows.filter((r) => inWindow(r.booked_at, w2, w1)).length,
    viewsThis: 0,
    viewsLast: 0,
  };
  const countViews = async (from: string, to?: string) => {
    let q = supabase
      .from("analytics_events")
      .select("*", { count: "exact", head: true })
      .eq("type", "page_view")
      .gte("created_at", from);
    if (to) q = q.lt("created_at", to);
    const { count } = await q;
    return count ?? 0;
  };
  [week.viewsThis, week.viewsLast] = await Promise.all([countViews(w1), countViews(w2, w1)]);

  return { months, week, firstMonth: months[0]?.key ?? null };
}

function Delta({ now, prev }: { now: number; prev: number }) {
  if (prev === 0 && now === 0) return <span className="text-ink-300">—</span>;
  const up = now >= prev;
  return (
    <span className={up ? "text-sage-700" : "text-red-600"}>
      {up ? "▲" : "▼"} {prev === 0 ? "new" : `${Math.round(((now - prev) / prev) * 100)}%`}
    </span>
  );
}

export default async function ReviewPage() {
  const data = await actuals();
  const plan = buildPlan(PLAN_BASE);

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display">Business review</h1>
          <p className="mt-1 text-sm text-ink-500">
            What happened vs what the plan said would happen. When reality wins the argument,
            update the assumption in <code>domain/finance.ts</code>.
          </p>
        </div>
        <Link href="/ops" className="text-sm font-medium text-accent-700 hover:underline">
          ← All modules
        </Link>
      </div>

      {!data ? (
        <p className="rounded-2xl border border-line bg-surface p-6 text-sm text-ink-500">
          Demo mode — connect Supabase to see actuals against the plan.
        </p>
      ) : (
        <>
          {/* This week vs last week */}
          <section className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-line p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-300">
                Quotes (7d)
              </p>
              <p className="mt-1 text-2xl font-display">
                {data.week.quotesThis}{" "}
                <span className="text-sm font-sans">
                  <Delta now={data.week.quotesThis} prev={data.week.quotesLast} />
                </span>
              </p>
              <p className="text-xs text-ink-500">{data.week.quotesLast} the week before</p>
            </div>
            <div className="rounded-2xl border border-line p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-300">
                Bookings (7d)
              </p>
              <p className="mt-1 text-2xl font-display">
                {data.week.bookedThis}{" "}
                <span className="text-sm font-sans">
                  <Delta now={data.week.bookedThis} prev={data.week.bookedLast} />
                </span>
              </p>
              <p className="text-xs text-ink-500">{data.week.bookedLast} the week before</p>
            </div>
            <div className="rounded-2xl border border-line p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-300">
                Page views (7d)
              </p>
              <p className="mt-1 text-2xl font-display">
                {data.week.viewsThis.toLocaleString("en-GB")}{" "}
                <span className="text-sm font-sans">
                  <Delta now={data.week.viewsThis} prev={data.week.viewsLast} />
                </span>
              </p>
              <p className="text-xs text-ink-500">
                {data.week.viewsLast.toLocaleString("en-GB")} the week before
              </p>
            </div>
          </section>

          {/* Plan vs actual by month */}
          <section className="mt-8">
            <h2 className="text-lg font-display">Month by month, actual vs plan</h2>
            <p className="mt-1 text-sm text-ink-500">
              Plan month 1 is anchored to your first real quote
              {data.firstMonth ? ` (${data.firstMonth})` : ""}. Booked conversion assumption in the
              plan: {PLAN_BASE.quoteToInstallPct}% of quotes.
            </p>
            {data.months.length === 0 ? (
              <p className="mt-3 rounded-2xl border border-line bg-surface p-5 text-sm text-ink-500">
                No finalised quotes yet — the first row appears with your first real quote, and
                every month after that this table becomes the honest scoreboard.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-2xl border border-line">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line bg-surface text-left text-xs font-semibold text-ink-500">
                      <th className="px-4 py-2.5">Month</th>
                      <th className="px-4 py-2.5">Quotes</th>
                      <th className="px-4 py-2.5">Booked</th>
                      <th className="px-4 py-2.5">Conv %</th>
                      <th className="px-4 py-2.5">Booked value</th>
                      <th className="border-l border-line px-4 py-2.5">Plan installs</th>
                      <th className="px-4 py-2.5">Plan revenue</th>
                      <th className="px-4 py-2.5">vs plan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.months.map((m, i) => {
                      const planMonth = plan.months[i];
                      const conv = m.quotes > 0 ? Math.round((m.booked / m.quotes) * 100) : 0;
                      const vsPlan =
                        planMonth && planMonth.installs > 0
                          ? Math.round((m.booked / planMonth.installs) * 100)
                          : null;
                      return (
                        <tr key={m.key}>
                          <td className="whitespace-nowrap px-4 py-2.5 font-semibold">{m.key}</td>
                          <td className="px-4 py-2.5">{m.quotes}</td>
                          <td className="px-4 py-2.5">{m.booked}</td>
                          <td className="px-4 py-2.5">
                            {conv}%
                            <span className="ml-1 text-xs text-ink-300">
                              (plan {PLAN_BASE.quoteToInstallPct}%)
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5">{gbp(m.bookedValueGbp)}</td>
                          <td className="border-l border-line px-4 py-2.5 text-ink-500">
                            {planMonth?.installs ?? "—"}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-ink-500">
                            {planMonth ? gbp(planMonth.revenueGbp) : "—"}
                          </td>
                          <td className="px-4 py-2.5">
                            {vsPlan === null ? (
                              <span className="text-ink-300">—</span>
                            ) : (
                              <span
                                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                                  vsPlan >= 100
                                    ? "bg-sage-100 text-sage-700"
                                    : vsPlan >= 60
                                      ? "bg-amber-50 text-amber-700"
                                      : "bg-red-50 text-red-600"
                                }`}
                              >
                                {vsPlan}%
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="mt-8 rounded-2xl border border-line bg-surface p-5 text-sm text-ink-500">
            <p className="font-semibold text-ink-900">How to run the weekly review (15 minutes)</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>Top strip: is demand (quotes) moving the right way week on week?</li>
              <li>
                Conversion: actual vs the plan&apos;s {PLAN_BASE.quoteToInstallPct}%. Below plan →
                read this week&apos;s <Link href="/ops/quotes" className="text-accent-700 hover:underline">lost quotes</Link>{" "}
                and their notes; above plan → the plan is sandbagging, update it.
              </li>
              <li>
                vs-plan column: two consecutive red months is a strategy conversation, not a
                motivation conversation.
              </li>
              <li>
                Then walk the <Link href="/ops" className="text-accent-700 hover:underline">Due today</Link>{" "}
                list — the review is worthless if the follow-ups don&apos;t happen.
              </li>
            </ol>
          </section>
        </>
      )}
    </main>
  );
}
