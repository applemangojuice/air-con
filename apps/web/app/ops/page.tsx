import Link from "next/link";
import type { Metadata } from "next";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { getServiceClient } from "@/lib/supabase-server";
import { tabByKey } from "./quotes/tabs";

export const metadata: Metadata = {
  title: "Admin console",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/** The console's pulse: live numbers, or nulls in demo mode. */
async function pulse() {
  const supabase = getServiceClient();
  if (!supabase) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const count = async (table: string, filter?: (q: any) => any) => {
    let q = supabase.from(table).select("*", { count: "exact", head: true });
    if (filter) q = filter(q);
    const { count: n, error } = await q;
    return error ? null : (n ?? 0);
  };
  const sevenDays = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [inbox, drafts, booked, properties, views7d] = await Promise.all([
    count("quote_requests", (q) => q.in("status", tabByKey("inbox")!.statuses!)),
    count("quote_requests", (q) => q.in("status", tabByKey("drafts")!.statuses!)),
    count("quote_requests", (q) => q.in("status", tabByKey("booked")!.statuses!)),
    count("properties"),
    count("analytics_events", (q) => q.eq("type", "page_view").gte("created_at", sevenDays)),
  ]);
  return { inbox, drafts, booked, properties, views7d };
}

/**
 * The admin console home. Live modules up top, honest status on the rest.
 * Subpages sit behind basic auth (OPS_PASSWORD): browser prompts, any
 * username, that password.
 */

const live = [
  {
    title: "Property intelligence",
    href: "/ops/intel",
    body: "The book: every property we understand, scored and filtered. Build target lists, export mailings with per-address pages, run the business case.",
  },
  {
    title: "Projects",
    href: "/ops/projects",
    body: "Every installation in flight on the quote → floor plan → final quote → site visit → delivery → installation timeline. Issue final quotes, record site visits, dispatch kit, assign installers.",
  },
  {
    title: "Quote requests",
    href: "/ops/quotes",
    body: "Incoming self-surveys with answers, computed loads, photos and status.",
  },
  {
    title: "Collateral",
    href: "/ops/collateral",
    body: "Print-ready pieces generated from the live platform: the street mailing letter (with per-address proofs), the A5 door-drop card, and the investor one-pager whose numbers come from the operating model.",
  },
  {
    title: "Usage analytics",
    href: "/ops/analytics",
    body: "Who's on the site and where they came from: visitors, sources, campaigns, geography, and the quote funnel from landing to saved. Cookieless, first-party.",
  },
  {
    title: "System status",
    href: "/ops/status",
    body: "Is the database actually working? Live check of every table, storage bucket and env var, with the exact fix when something's red.",
  },
  {
    title: "Launch readiness",
    href: "/ops/launch",
    body: "Are we ready to go public? Eight live platform checks plus the launch-day walk: domain, email deliverability, the money path end-to-end, uptime alarm.",
  },
  {
    title: "Template library",
    href: "/ops/templates",
    body: "Every house archetype and install pattern we fit: stock floor plans, pipe routes, price adders, pre-checks, and a sample price for each.",
  },
  {
    title: "Design studio",
    href: "/ops/design",
    body: "The engineering assistant: eight design rules score every property green, amber or red, then one button selects the full system: units, pipes, cables, breaker, refrigerant, the lot.",
  },
  {
    title: "Installation OS",
    href: "/ops/install",
    body: "Airline-checklist installs built on required evidence: photos, readings, scans and signatures at every step. Jobs score themselves; humans review exceptions only.",
  },
  {
    title: "Schedule",
    href: "/ops/schedule",
    body: "The next six weeks on one board: installs, site visits and deliveries from live projects, double-bookings flagged, street-batching wins surfaced.",
  },
  {
    title: "Procurement",
    href: "/ops/procurement",
    body: "Booked installs turned into an order book: weekly purchase totals, per-install pick lists, and order-by dates from supplier lead times.",
  },
  {
    title: "Business case & P&L",
    href: "/ops/finance",
    body: "The seed case end to end: monthly P&L with cost dials and scenarios, bottom-up TAM/SAM/SOM, LTV:CAC, the round and dilution, sensitivity on the ask, and the milestone road to Series A, all from one live model.",
  },
];

const customerSide = [
  { title: "Quote funnel", href: "/quote" },
  { title: "Project timeline (demo)", href: "/p/demo" },
  { title: "Per-address mailing page (demo)", href: "/a/demo" },
  { title: "Customer portal (placeholder)", href: "/portal" },
];

const roadmap = [
  {
    id: "installer",
    phase: "Later",
    title: "Installer mobile app",
    body: "The Installation OS runsheet is live in this console; the phone app wraps it with a camera, barcode scanner and offline capture. Same domain package, same evidence rules.",
  },
  {
    id: "monitoring",
    phase: "Later",
    title: "Fleet monitoring & service",
    body: "Every installed system reports power, temperatures and errors. Predictive maintenance replaces blanket annual servicing.",
  },
  {
    id: "intelligence",
    phase: "Continuous",
    title: "Knowledge loop",
    body: "Actual install times, issues and outcomes feed back into pricing rules, heat-load factors and templates. The property_assessments table is ready to receive install actuals.",
  },
];

function Pulse({ label, value, href }: { label: string; value: number | null; href: string }) {
  return (
    <Link href={href} className="rounded-2xl border border-line bg-white p-4 transition hover:border-accent-400">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-300">{label}</p>
      <p className="mt-1 text-2xl font-display">
        {value === null ? "—" : value.toLocaleString("en-GB")}
      </p>
    </Link>
  );
}

export default async function OpsPage() {
  const stats = await pulse();

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
        <span className="rounded-full bg-surface px-3 py-1 text-xs font-semibold text-ink-500">
          Internal · admin console
        </span>
        <h1 className="mt-4 text-4xl font-display">Mission control</h1>
        <p className="mt-3 max-w-2xl text-ink-500">
          Everything the team runs the business from. The modules below are
          live now; subpages are protected by the ops password
          (<code>OPS_PASSWORD</code>): your browser asks once, any username,
          that password.
        </p>

        {stats && (
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Pulse label="Quote inbox" value={stats.inbox} href="/ops/quotes" />
            <Pulse label="Unfinished" value={stats.drafts} href="/ops/quotes?tab=drafts" />
            <Pulse label="Booked" value={stats.booked} href="/ops/quotes?tab=booked" />
            <Pulse label="Properties" value={stats.properties} href="/ops/intel" />
            <Pulse label="Views (7d)" value={stats.views7d} href="/ops/analytics" />
          </div>
        )}

        <h2 className="mt-10 text-xl font-display">Live now</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {live.map((m) => (
            <Link
              key={m.href}
              href={m.href}
              className="group rounded-2xl border border-line bg-white p-6 transition hover:border-accent-400 hover:shadow-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold group-hover:text-accent-700">{m.title}</h3>
                <span className="shrink-0 rounded-full bg-sage-100 px-2.5 py-0.5 text-xs font-semibold text-sage-700">
                  Live
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-ink-500">{m.body}</p>
              <span className="mt-3 inline-block text-sm font-semibold text-accent-700">
                Open →
              </span>
            </Link>
          ))}
        </div>

        <h2 className="mt-10 text-xl font-display">The customer side, for reference</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {customerSide.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="rounded-full border border-line bg-white px-4 py-2 text-sm font-medium text-ink-700 transition hover:border-accent-400 hover:text-accent-700"
            >
              {c.title} →
            </Link>
          ))}
        </div>

        <h2 className="mt-10 text-xl font-display">Not built yet</h2>
        <p className="mt-2 max-w-2xl text-sm text-ink-500">
          Each of these exists to reduce skilled labour, standardise
          installations, or learn from every job. The data they need is
          already being collected.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {roadmap.map((m) => (
            <div key={m.id} id={m.id} className="scroll-mt-24 rounded-2xl border border-dashed border-line p-6">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold text-ink-700">{m.title}</h3>
                <span className="shrink-0 rounded-full bg-surface px-2.5 py-0.5 text-xs font-medium text-ink-500">
                  {m.phase}
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-ink-500">{m.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-12 rounded-2xl border border-line bg-surface p-6 text-sm text-ink-500">
          <p className="font-semibold text-ink-900">Where the data already flows</p>
          <p className="mt-2">
            Quotes store the full survey + engine version (<code>quote_requests</code>),
            installations run as JSONB state machines (<code>projects</code>), and every
            home we understand lives in <code>properties</code> with an append-only
            assessment log. When the modules above arrive, their data is
            already shaped and waiting.
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
