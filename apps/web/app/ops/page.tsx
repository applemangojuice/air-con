import type { Metadata } from "next";
import Link from "next/link";
import { can } from "@aircon/domain";
import { Badge } from "@/components/kit/badge";
import { LinkButton } from "@/components/kit/button";
import { PageHeader } from "@/components/kit/layout";
import { requireStaff } from "@/lib/auth/server";
import { fmtDay, fmtDayTime, money } from "@/lib/format";
import { loadPulse, type Pulse } from "@/lib/ops-core-server";
import { getServiceClient } from "@/lib/supabase-server";
import { tabByKey } from "./quotes/tabs";

export const metadata: Metadata = { title: "Console · ops", robots: { index: false } };
export const dynamic = "force-dynamic";

/** New leads from the website: the funnel's side of the pulse. Nulls when a count can't be read. */
async function leads() {
  const db = getServiceClient();
  if (!db) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const count = async (filter: (q: any) => any) => {
    const { count: n, error } = await filter(db.from("quote_requests").select("*", { count: "exact", head: true }));
    return error ? null : (n ?? 0);
  };
  const [inbox, drafts, unworked] = await Promise.all([
    count((q) => q.in("status", tabByKey("inbox")!.statuses!)),
    count((q) => q.in("status", tabByKey("drafts")!.statuses!)),
    count((q) => q.in("status", tabByKey("inbox")!.statuses!).is("next_action_at", null)),
  ]);
  return { inbox, drafts, unworked };
}

type Module = { title: string; href: string; body: string; status: "Live" | "Demo" | "Older view" };

const MODULES: { group: string; items: Module[] }[] = [
  {
    group: "Running the pilots",
    items: [
      { title: "Board", href: "/ops/projects", body: "Every project by stage, with its next action, owner and what's blocking it.", status: "Live" },
      { title: "New pilot", href: "/ops/projects/new", body: "Set up a household in thirty seconds: instant price, project page, optional link by email.", status: "Live" },
      { title: "Calendar", href: "/ops/calendar", body: "Surveys, deliveries and install days, with crew and qualification checks.", status: "Live" },
      { title: "Purchasing", href: "/ops/purchasing", body: "Purchase orders from the approved design, from required to checked on site.", status: "Live" },
      { title: "Catalogue", href: "/ops/catalogue", body: "Equipment, materials and labour rates with costs, sources and compatibility.", status: "Live" },
      { title: "Pilots", href: "/ops/pilots", body: "Pilot 1 against 2, 3 and 4: price, cost, hours, quality, and what we learned.", status: "Live" },
      { title: "Messages", href: "/ops/messages", body: "Every email and text with its status, previews, resend, and the daily jobs.", status: "Live" },
    ],
  },
  {
    group: "Set-up",
    items: [
      { title: "Staff", href: "/ops/staff", body: "The team and subcontractors, roles, and certificates with expiry dates.", status: "Live" },
      { title: "Settings", href: "/ops/settings", body: "Company and legal details, VAT, pricing, discounts, payments, scheduling.", status: "Live" },
      { title: "Go-live checklist", href: "/ops/launch", body: "Everything the pilots depend on, green, amber or red, with the exact fix.", status: "Live" },
      { title: "System status", href: "/ops/status", body: "Database, storage and keys, checked live.", status: "Live" },
    ],
  },
  {
    group: "Leads and the business",
    items: [
      { title: "Quote requests", href: "/ops/quotes", body: "Website quotes with answers, photos, notes and next actions.", status: "Live" },
      { title: "Property intelligence", href: "/ops/intel", body: "The homes we understand, scored and filtered for mailings.", status: "Live" },
      { title: "Usage analytics", href: "/ops/analytics", body: "Visitors, sources and the quote funnel, cookieless.", status: "Live" },
      { title: "Business review", href: "/ops/review", body: "Plan against actual, month by month.", status: "Live" },
      { title: "Collateral", href: "/ops/collateral", body: "Print-ready letters, cards and the one-pager.", status: "Live" },
      { title: "Business case", href: "/ops/finance", body: "The planning model: P&L, scenarios and the raise. Assumptions, not results.", status: "Live" },
      { title: "Template library", href: "/ops/templates", body: "House archetypes and install patterns with sample prices.", status: "Live" },
    ],
  },
  {
    group: "Earlier prototypes",
    items: [
      { title: "Design studio", href: "/ops/design", body: "The original design-rules demo on sample data. Real designs are on each project.", status: "Demo" },
      { title: "Installation OS", href: "/ops/install", body: "The original runsheet demo on sample data. Real installs run in the field app.", status: "Demo" },
      { title: "Schedule", href: "/ops/schedule", body: "The six-week view from before the calendar.", status: "Older view" },
      { title: "Procurement", href: "/ops/procurement", body: "The order book from before purchase orders.", status: "Older view" },
    ],
  },
];

function Tile({ label, value, href, tone = "neutral", hint }: { label: string; value: string; href: string; tone?: "neutral" | "danger" | "warn"; hint?: string }) {
  const cls = { neutral: "text-ink-900", danger: "text-red-700", warn: "text-amber-800" }[tone];
  return (
    <Link href={href} className="rounded-2xl border border-line bg-white p-4 transition hover:border-accent-400">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${cls}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-500">{hint}</p>}
    </Link>
  );
}

export default async function ConsolePage() {
  const staff = await requireStaff("projects.view-all");
  let pulse: Pulse | null = null;
  let pulseFailed = false;
  if (getServiceClient()) {
    try {
      pulse = await loadPulse();
    } catch (err) {
      console.error("[console] pulse failed:", err);
      pulseFailed = true;
    }
  }
  const lead = await leads().catch(() => null);
  const canCreate = can(staff, "projects.edit");

  return (
    <main className="mx-auto w-full min-w-0 max-w-6xl px-4 pb-16 pt-6 sm:px-6">
      <PageHeader
        title="Today"
        subtitle={pulse ? `${fmtDay(pulse.today)}. ${pulse.live} project${pulse.live === 1 ? "" : "s"} in flight.` : "The team's home: today first, then everything else."}
        actions={
          <>
            <LinkButton href="/ops/projects" variant="secondary">
              Open the board
            </LinkButton>
            {canCreate && <LinkButton href="/ops/projects/new">New pilot</LinkButton>}
          </>
        }
      />

      {pulseFailed && (
        <p role="alert" className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-900">
          Today&apos;s numbers couldn&apos;t load. The board and everything else still work; reload in a moment.
        </p>
      )}
      {!getServiceClient() && (
        <p className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">No database is connected, so there are no projects to show. Check System status.</p>
      )}

      {pulse && (
        <section aria-labelledby="today">
          <h2 id="today" className="sr-only">
            Today
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Tile label="Installs today" value={String(pulse.installsToday.length)} href="/ops/calendar" />
            <Tile label="Surveys today" value={String(pulse.surveysToday.length)} href="/ops/calendar" />
            <Tile label="Blocked" value={String(pulse.blocked.length)} href="/ops/projects?blocked=1" tone={pulse.blocked.length ? "danger" : "neutral"} />
            <Tile label="Owed to us" value={money(pulse.outstanding.pence)} hint={`${pulse.outstanding.count} invoice${pulse.outstanding.count === 1 ? "" : "s"}`} href="/ops/projects" tone={pulse.outstanding.count ? "warn" : "neutral"} />
            <Tile label="Open issues" value={String(pulse.openIssues)} href="/ops/projects" tone={pulse.openIssues ? "warn" : "neutral"} />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-line bg-white p-4">
              <h3 className="text-sm font-semibold text-ink-900">On today</h3>
              {pulse.installsToday.length + pulse.surveysToday.length === 0 ? (
                <p className="mt-2 text-sm text-ink-500">No surveys or install days today.</p>
              ) : (
                <ul className="mt-2 space-y-1.5 text-sm">
                  {pulse.surveysToday.map((c) => (
                    <li key={`s-${c.id}`}>
                      <Link href={`/ops/projects/${c.id}`} className="font-semibold text-accent-700 hover:underline">
                        {c.customer}
                      </Link>{" "}
                      <span className="text-ink-500">· survey {c.surveyAt ? fmtDayTime(c.surveyAt).split(", ")[1] : ""} · {c.outcode}</span>
                    </li>
                  ))}
                  {pulse.installsToday.map((c) => (
                    <li key={`i-${c.id}`}>
                      <Link href={`/ops/projects/${c.id}`} className="font-semibold text-accent-700 hover:underline">
                        {c.customer}
                      </Link>{" "}
                      <span className="text-ink-500">
                        · install day {c.installDates.indexOf(pulse!.today) + 1} of {c.installDates.length} · {c.outcode}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-2xl border border-line bg-white p-4">
              <h3 className="text-sm font-semibold text-ink-900">Overdue next actions</h3>
              {pulse.overdue.length === 0 ? (
                <p className="mt-2 text-sm text-ink-500">Nothing overdue.</p>
              ) : (
                <ul className="mt-2 space-y-1.5 text-sm">
                  {pulse.overdue.slice(0, 8).map((c) => (
                    <li key={c.id}>
                      <Link href={`/ops/projects/${c.id}`} className="font-semibold text-accent-700 hover:underline">
                        {c.customer}
                      </Link>{" "}
                      <span className="text-ink-500">
                        · {c.nextAction.text} · due {c.nextAction.dueOn ? fmtDay(c.nextAction.dueOn) : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}

      {lead && (
        <p className="mt-4 text-sm text-ink-700">
          <span className="font-semibold">Website leads:</span>{" "}
          <Link href="/ops/quotes" className="text-accent-700 hover:underline">
            {lead.inbox ?? "–"} in the inbox
          </Link>
          {" · "}
          <Link href="/ops/quotes?tab=drafts" className="text-accent-700 hover:underline">
            {lead.drafts ?? "–"} unfinished
          </Link>
          {(lead.unworked ?? 0) > 0 && <span className="font-semibold text-red-700"> · {lead.unworked} with no next action</span>}
        </p>
      )}

      {MODULES.map((g) => (
        <section key={g.group} className="mt-10" aria-labelledby={`g-${g.group}`}>
          <h2 id={`g-${g.group}`} className="font-display text-xl text-ink-900">
            {g.group}
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.items.map((m) => (
              <Link key={m.href} href={m.href} className="group rounded-2xl border border-line bg-white p-4 transition hover:border-accent-400 hover:shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-ink-900 group-hover:text-accent-700">{m.title}</h3>
                  <Badge tone={m.status === "Live" ? "success" : m.status === "Demo" ? "warn" : "neutral"}>{m.status}</Badge>
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{m.body}</p>
              </Link>
            ))}
          </div>
        </section>
      ))}

      <section className="mt-10" aria-labelledby="customer-side">
        <h2 id="customer-side" className="font-display text-xl text-ink-900">
          The customer side
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            { title: "Quote funnel", href: "/quote" },
            { title: "Project page (demo)", href: "/p/demo" },
            { title: "Customer portal", href: "/portal" },
          ].map((c) => (
            <Link key={c.href} href={c.href} className="inline-flex min-h-10 items-center rounded-full border border-line bg-white px-4 text-sm font-medium text-ink-700 hover:border-accent-400 hover:text-accent-700">
              {c.title} →
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
