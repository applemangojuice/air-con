import Link from "next/link";
import type { Metadata } from "next";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";

export const metadata: Metadata = {
  title: "Platform — operations",
  robots: { index: false },
};

const modules = [
  {
    id: "crm",
    phase: "Year 1",
    title: "CRM & sales pipeline",
    body: "Lead management, conversion tracking, marketing attribution and postcode-level penetration analysis. Quote requests from the self-survey land here.",
  },
  {
    id: "design",
    phase: "Year 1–2",
    title: "Design studio",
    body: "Every AI-proposed design is editable: move indoor units, re-route pipes, swap outdoor units — price, labour and materials recalculate automatically.",
  },
  {
    id: "templates",
    phase: "Year 2",
    title: "Installation template library",
    body: "The moat. Victorian terrace, 1930s semi, townhouse, bungalow, flat — each template stores time, difficulty, materials, crew needs and outcomes.",
  },
  {
    id: "procurement",
    phase: "Year 2",
    title: "Procurement & warehouse",
    body: "Auto-ordering against booked installs, supplier lead times, MOQ management and demand forecasting.",
  },
  {
    id: "scheduling",
    phase: "Year 1–2",
    title: "Scheduling & logistics",
    body: "Crew routing, street batching, specialist equipment booking and weather-aware planning.",
  },
  {
    id: "installer",
    phase: "Year 1",
    title: "Installer app",
    body: "Job packs, step-by-step workflows with photo/measurement verification, and automatic commissioning documentation.",
  },
  {
    id: "monitoring",
    phase: "Year 3+",
    title: "Fleet monitoring & service",
    body: "Every installed system reports power, temperatures and errors. Predictive maintenance replaces blanket annual servicing.",
  },
  {
    id: "intelligence",
    phase: "Continuous",
    title: "Knowledge loop",
    body: "Actual install times, issues and outcomes feed back into pricing rules, heat-load factors and templates. Every install makes the next one better.",
  },
];

export default function OpsPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
        <span className="rounded-full bg-surface px-3 py-1 text-xs font-semibold text-ink-500">
          Internal · placeholder
        </span>
        <h1 className="mt-4 text-4xl font-display">
          The operating system for residential air conditioning
        </h1>
        <p className="mt-3 max-w-2xl text-ink-500">
          Customer quoting is live — incoming self-surveys are in{" "}
          <Link href="/ops/quotes" className="font-semibold text-accent-700 underline">
            quote requests
          </Link>
          , and installations in flight are in{" "}
          <Link href="/ops/projects" className="font-semibold text-accent-700 underline">
            projects
          </Link>{" "}
          (quote → floor plan → final quote → site visit → delivery →
          installation). These are the modules that follow — each one exists to
          reduce skilled labour, standardise installations, or learn from every
          job.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {modules.map((m) => (
            <div key={m.id} id={m.id} className="rounded-2xl border border-line p-6 scroll-mt-24">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold">{m.title}</h2>
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
            Every self-survey quote stores its full survey, the engine version
            and the computed price in Supabase (<code>quote_requests</code>).
            When these modules arrive, the historical data is already shaped for
            them — quotes can be replayed against newer pricing rules from day
            one.
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
