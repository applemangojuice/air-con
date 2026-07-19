import Link from "next/link";
import type { Metadata } from "next";
import { analyticsSummary, type AnalyticsSummary, type Count } from "@/lib/analytics-server";

export const metadata: Metadata = {
  title: "Usage analytics · ops",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/**
 * First-party usage analytics: who's on the site, where they came from, and
 * how far they get through the quote funnel. Cookieless, no third parties.
 */
export default async function OpsAnalyticsPage() {
  const s = await analyticsSummary(30);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display">Usage analytics</h1>
          <p className="mt-1 text-sm text-ink-500">
            First-party, cookieless. Last {s.windowDays} days unless noted.
          </p>
        </div>
        <Link href="/ops" className="text-sm font-medium text-accent-700 hover:underline">
          ← All modules
        </Link>
      </div>

      {!s.configured && (
        <Notice tone="amber" title="Demo mode — nothing tracked">
          Set <code>SUPABASE_URL</code> and <code>SUPABASE_SERVICE_ROLE_KEY</code> to start
          recording usage.
        </Notice>
      )}
      {s.configured && !s.hasTable && (
        <Notice tone="red" title="Analytics table missing">
          The <code>analytics_events</code> table isn&apos;t there yet ({s.error}). Run{" "}
          <code>supabase/migrations/0007_analytics.sql</code>, then check{" "}
          <Link href="/ops/status" className="underline">
            system status
          </Link>
          .
        </Notice>
      )}

      {s.configured && s.hasTable && (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Visitors" value={num(s.uniqueVisitors)} hint={`${num(s.uniqueVisitors7d)} in last 7 days`} />
            <Stat label="Page views" value={num(s.pageViews)} hint={`${num(s.pageViews7d)} in last 7 days`} />
            <Stat label="Sessions" value={num(s.sessions)} />
            <Stat label="Events logged" value={num(s.totalEvents)} hint="All types" />
          </div>

          {s.serverErrors > 0 && (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <strong>{num(s.serverErrors)} server-side failures</strong> in this window (failed
              database writes and similar). Check{" "}
              <Link href="/ops/status" className="underline">
                system status
              </Link>{" "}
              and the Vercel logs.
            </div>
          )}

          <Trend daily={s.daily} />

          <Funnel s={s} />

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <ListCard title="Top pages" rows={s.topPages} empty="No page views yet." />
            <ListCard
              title="Where they came from"
              rows={s.topReferrers}
              empty="No referrers yet (direct visits, or nothing recorded)."
            />
            <ListCard title="Campaign sources (utm_source)" rows={s.topSources} empty="No tagged campaigns yet." />
            <ListCard title="Campaigns (utm_campaign)" rows={s.topCampaigns} empty="No tagged campaigns yet." />
            <ListCard title="Countries" rows={s.countries} empty="No geo data yet." />
            <ListCard title="Towns / cities" rows={s.cities} empty="No geo data yet." />
            <ListCard title="Devices" rows={s.devices} empty="No device data yet." />
          </div>

          <p className="mt-6 text-xs text-ink-300">
            Cookieless and first-party: a random id in the browser, edge geo (country/region/city,
            never the raw IP), no third-party trackers. UTM tags on your mailing and ad links flow
            straight through to the columns above.
          </p>
        </>
      )}
    </main>
  );
}

function Funnel({ s }: { s: AnalyticsSummary }) {
  const f = s.funnel;
  const steps = [
    { label: "Visited /quote", value: f.quotePageViews },
    { label: "Started (gave address + email)", value: f.quoteStarts },
    { label: "Answered house questions", value: f.quoteConfiguredHouse },
    { label: "Chose their rooms", value: f.quoteChoseRooms },
    { label: "Submitted", value: f.quoteSubmits },
    { label: "Saved to database", value: f.quoteSaved },
  ];
  const max = Math.max(1, ...steps.map((x) => x.value));
  return (
    <section className="mt-6 rounded-2xl border border-line p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">Quote funnel</h2>
        {f.quoteFailed > 0 && (
          <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-600">
            {num(f.quoteFailed)} failed to save
          </span>
        )}
      </div>
      <div className="mt-3 space-y-2">
        {steps.map((step, i) => {
          const prev = i > 0 ? steps[i - 1].value : null;
          const conv = prev && prev > 0 ? Math.round((step.value / prev) * 100) : null;
          return (
            <div key={step.label} className="flex items-center gap-3 text-sm">
              <span className="w-56 shrink-0">{step.label}</span>
              <div className="h-4 flex-1 overflow-hidden rounded-full bg-surface">
                <div
                  className="h-full rounded-full bg-accent-500"
                  style={{ width: `${Math.round((step.value / max) * 100)}%` }}
                />
              </div>
              <span className="w-28 shrink-0 text-right text-xs text-ink-500">
                {num(step.value)}
                {conv !== null && <span className="text-ink-300"> · {conv}%</span>}
              </span>
            </div>
          );
        })}
      </div>
      {f.quoteFailed > 0 && (
        <p className="mt-3 text-xs text-red-600">
          {num(f.quoteFailed)} completed submissions failed to save. Check{" "}
          <Link href="/ops/status" className="underline">
            system status
          </Link>{" "}
          — the database is likely missing a table.
        </p>
      )}
    </section>
  );
}

function Trend({ daily }: { daily: AnalyticsSummary["daily"] }) {
  const max = Math.max(1, ...daily.map((d) => d.views));
  return (
    <section className="mt-6 rounded-2xl border border-line p-5">
      <h2 className="font-bold">Last 14 days</h2>
      <div className="mt-4 flex items-end gap-1.5" style={{ height: 120 }}>
        {daily.map((d) => (
          <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex w-full flex-1 items-end">
              <div
                className="w-full rounded-t bg-accent-400"
                style={{ height: `${Math.round((d.views / max) * 100)}%` }}
                title={`${d.date}: ${d.views} views, ${d.visitors} visitors`}
              />
            </div>
            <span className="text-[9px] text-ink-300">{d.date.slice(8)}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-ink-500">Bars are page views per day. Hover for visitors.</p>
    </section>
  );
}

function ListCard({ title, rows, empty }: { title: string; rows: Count[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className="rounded-2xl border border-line p-5">
      <h2 className="font-bold">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink-300">{empty}</p>
      ) : (
        <div className="mt-3 space-y-1.5">
          {rows.map((r) => (
            <div key={r.key} className="flex items-center gap-3 text-sm">
              <span className="w-48 shrink-0 truncate" title={r.key}>
                {r.key}
              </span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface">
                <div
                  className="h-full rounded-full bg-sage-400"
                  style={{ width: `${Math.round((r.count / max) * 100)}%` }}
                />
              </div>
              <span className="w-12 shrink-0 text-right text-xs text-ink-500">{num(r.count)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-300">{label}</p>
      <p className="mt-1 text-2xl font-display">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: "amber" | "red";
  title: string;
  children: React.ReactNode;
}) {
  const cls =
    tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-red-200 bg-red-50 text-red-600";
  const titleCls = tone === "amber" ? "text-amber-800" : "text-red-700";
  return (
    <div className={`rounded-2xl border p-5 ${cls}`}>
      <p className={`font-semibold ${titleCls}`}>{title}</p>
      <p className="mt-1 text-sm">{children}</p>
    </div>
  );
}

function num(n: number): string {
  return n.toLocaleString("en-GB");
}
