import Link from "next/link";
import type { Metadata } from "next";
import { followUpMailto } from "@/lib/follow-up";
import { fmtDay, gbp } from "@/lib/format";
import { QUOTE_TABS, tabByKey } from "./tabs";
import { getServiceClient } from "@/lib/supabase-server";

export const metadata: Metadata = {
  title: "Quote requests · ops",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

const STATUS_CLS: Record<string, string> = {
  new: "bg-accent-100 text-accent-700",
  draft: "bg-amber-50 text-amber-700",
  reviewed: "bg-surface text-ink-500",
  booked: "bg-sage-100 text-sage-700",
  declined: "bg-red-50 text-red-600",
};

interface QuoteRow {
  id: string;
  created_at: string;
  customer_name: string | null;
  email: string;
  postcode: string;
  total_gbp: number;
  room_count: number;
  confidence_score: number;
  confidence_band: string;
  status: string;
  timeframe: string | null;
  utm_source: string | null;
  follow_up_sent_at: string | null;
}

export default async function OpsQuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: tabKey } = await searchParams;
  const tab = tabByKey(tabKey) ?? QUOTE_TABS[0];

  const supabase = getServiceClient();

  if (!supabase) {
    return (
      <Shell tab={tab.key} counts={{}}>
        <div className="rounded-2xl border border-line bg-surface p-6 text-sm text-ink-500">
          <p className="font-semibold text-ink-900">Demo mode, no database connected</p>
          <p className="mt-2">
            Set <code>SUPABASE_URL</code> and <code>SUPABASE_SERVICE_ROLE_KEY</code> to see
            customer quote requests here. Set <code>OPS_PASSWORD</code> to protect this page.
          </p>
        </div>
      </Shell>
    );
  }

  let query = supabase
    .from("quote_requests")
    .select(
      "id, created_at, customer_name, email, postcode, total_gbp, room_count, confidence_score, confidence_band, status, timeframe, utm_source, follow_up_sent_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (tab.statuses) query = query.in("status", tab.statuses);

  const [{ data, error }, counts] = await Promise.all([query, tabCounts(supabase)]);

  if (error) {
    return (
      <Shell tab={tab.key} counts={counts}>
        <p className="text-sm text-red-600">Failed to load quotes: {error.message}</p>
      </Shell>
    );
  }

  const quotes = (data ?? []) as QuoteRow[];

  return (
    <Shell tab={tab.key} counts={counts}>
      {tab.key === "drafts" && quotes.length > 0 && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-semibold">These people started a quote and didn&apos;t finish.</p>
          <p className="mt-1">
            They gave an address and an email, so they&apos;re warm. A short personal email
            (&ldquo;your price is one tap away&rdquo;) recovers a surprising number — the email
            link on each row is pre-written.
          </p>
        </div>
      )}
      {quotes.length === 0 ? (
        <p className="text-sm text-ink-500">
          {tab.key === "drafts"
            ? "No unfinished quotes right now. That's either great funnel completion or no traffic — /ops/analytics knows which."
            : "Nothing here yet. Share the funnel link."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface text-left text-xs font-semibold text-ink-500">
                <th className="px-4 py-3">Received</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Postcode</th>
                <th className="px-4 py-3">Rooms</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Confidence</th>
                <th className="px-4 py-3">Timeframe</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Status</th>
                {tab.key === "drafts" && <th className="px-4 py-3">Follow up</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {quotes.map((q) => (
                <tr key={q.id} className="hover:bg-surface/50">
                  <td className="whitespace-nowrap px-4 py-3 text-ink-500">
                    {fmtDay(q.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/ops/quotes/${q.id}`}
                      className="font-semibold text-accent-700 hover:underline"
                    >
                      {q.customer_name ?? q.email}
                    </Link>
                    {q.customer_name && (
                      <span className="block text-xs text-ink-300">{q.email}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">{q.postcode}</td>
                  <td className="px-4 py-3">{q.room_count}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-semibold">{gbp(q.total_gbp)}</td>
                  <td className="px-4 py-3">
                    {q.confidence_score}/100{" "}
                    <span className="text-xs text-ink-300">({q.confidence_band})</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-500">
                    {q.timeframe ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-500">
                    {q.utm_source ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_CLS[q.status] ?? "bg-surface text-ink-500"}`}
                    >
                      {q.status}
                    </span>
                  </td>
                  {tab.key === "drafts" && (
                    <td className="whitespace-nowrap px-4 py-3">
                      {q.follow_up_sent_at ? (
                        // The cron already sent the one promised nudge —
                        // don't offer a second email.
                        <span className="text-xs text-ink-300">
                          Nudged {fmtDay(q.follow_up_sent_at)}
                        </span>
                      ) : (
                        <a
                          className="font-semibold text-accent-700 hover:underline"
                          href={followUpMailto(q.email, q.postcode)}
                        >
                          Email them →
                        </a>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function tabCounts(supabase: any): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  await Promise.all(
    QUOTE_TABS.filter((t) => t.statuses).map(async (t) => {
      const { count } = await supabase
        .from("quote_requests")
        .select("*", { count: "exact", head: true })
        .in("status", t.statuses!);
      counts[t.key] = count ?? 0;
    }),
  );
  return counts;
}

function Shell({
  children,
  tab,
  counts,
}: {
  children: React.ReactNode;
  tab: string;
  counts: Record<string, number>;
}) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display">Quote requests</h1>
          <p className="mt-1 text-sm text-ink-500">Customer self-survey submissions</p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={`/ops/quotes/export?tab=${tab}`}
            className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink-700 transition hover:bg-surface"
          >
            Download CSV
          </a>
          <Link href="/ops" className="text-sm font-medium text-accent-700 hover:underline">
            ← All modules
          </Link>
        </div>
      </div>
      <nav className="mb-6 flex flex-wrap gap-2">
        {QUOTE_TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === "inbox" ? "/ops/quotes" : `/ops/quotes?tab=${t.key}`}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              tab === t.key
                ? "bg-ink-900 text-white"
                : "border border-line text-ink-700 hover:bg-surface"
            }`}
          >
            {t.label}
            {counts[t.key] !== undefined && (
              <span className={tab === t.key ? "ml-1.5 text-white/60" : "ml-1.5 text-ink-300"}>
                {counts[t.key]}
              </span>
            )}
          </Link>
        ))}
      </nav>
      {children}
    </main>
  );
}
