import Link from "next/link";
import type { Metadata } from "next";
import { OPS_CAPACITY, buildProcurementPlan } from "@aircon/domain";
import { fmtDay } from "@/lib/format";
import { loadScheduledJobs } from "@/lib/ops-server";
import { getServiceClient } from "@/lib/supabase-server";

export const metadata: Metadata = {
  title: "Procurement · admin",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/**
 * Procurement & warehouse: booked installs turned into an order book.
 * Every job's kit list, when it must be on site, the last day to order it
 * (supplier lead time), and the aggregated weekly totals to order against.
 */
export default async function ProcurementPage() {
  const demo = !getServiceClient();
  const jobs = await loadScheduledJobs();
  const plan = buildProcurementPlan(jobs, new Date().toISOString());

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display">Procurement</h1>
          <p className="mt-1 text-sm text-ink-500">
            {demo ? "Demo pipeline. " : ""}Auto-built from booked installs: supplier lead time{" "}
            {OPS_CAPACITY.supplierLeadDays} days, kit lands two days before install day.
          </p>
        </div>
        <Link href="/ops" className="text-sm font-medium text-accent-700 hover:underline">
          ← Console
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Installs to supply" value={String(plan.jobs.length)} />
        <Stat
          label="Order weeks open"
          value={String(plan.weekly.length)}
          hint="Aggregated below, one purchase order per week"
        />
        <Stat
          label="Late orders"
          value={String(plan.lateOrders)}
          hint={plan.lateOrders ? "Order-by date already passed: chase today" : "All on time"}
          alert={plan.lateOrders > 0}
        />
      </div>

      {/* Weekly order book */}
      <h2 className="mt-8 text-xl font-display">Weekly order book</h2>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        {plan.weekly.map((week) => (
          <section key={week.weekOf} className="rounded-2xl border border-line p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-bold">Order in week of {fmtDay(week.weekOf)}</h3>
              <span className="text-xs font-semibold text-ink-500">
                {week.jobs} install{week.jobs === 1 ? "" : "s"}
              </span>
            </div>
            <ul className="mt-3 divide-y divide-line/60">
              {week.lines.map((line) => (
                <li key={line.sku} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
                  <span>{line.label}</span>
                  <span className="shrink-0 font-semibold">× {line.qty}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {plan.weekly.length === 0 && (
          <p className="text-sm text-ink-500">
            Nothing to order: no upcoming installs with dates yet.
          </p>
        )}
      </div>

      {/* Per-job pick lists */}
      <h2 className="mt-10 text-xl font-display">Per-install pick lists</h2>
      <div className="mt-3 overflow-x-auto rounded-2xl border border-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface text-left text-xs font-semibold text-ink-500">
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Postcode</th>
              <th className="px-4 py-3">Install</th>
              <th className="px-4 py-3">Kit on site</th>
              <th className="px-4 py-3">Order by</th>
              <th className="px-4 py-3">Kit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {plan.jobs.map((p) => (
              <tr key={p.job.projectId} className={p.late ? "bg-red-50" : "hover:bg-surface/50"}>
                <td className="whitespace-nowrap px-4 py-3 font-semibold">{p.job.customer}</td>
                <td className="whitespace-nowrap px-4 py-3">{p.job.postcode}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  {p.job.installOn ? fmtDay(p.job.installOn) : "-"}
                </td>
                <td className="whitespace-nowrap px-4 py-3">{fmtDay(p.needOnSite)}</td>
                <td
                  className={`whitespace-nowrap px-4 py-3 ${p.late ? "font-bold text-red-600" : ""}`}
                >
                  {fmtDay(p.orderBy)}
                  {p.late ? " · late" : ""}
                </td>
                <td className="px-4 py-3 text-xs text-ink-500">
                  {p.bom.map((l) => `${l.qty}× ${l.label}`).join(" · ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {plan.jobs.length === 0 && (
          <p className="px-4 py-6 text-sm text-ink-500">No upcoming installs to pick for.</p>
        )}
      </div>

      <p className="mt-6 text-xs text-ink-300">
        The bill of materials per install is the template standard (units parsed from the quote,
        pipe kits, trunking, electrical kit, consumables). As install actuals land, per-template
        quantities replace these defaults.
      </p>
    </main>
  );
}

function Stat({
  label,
  value,
  hint,
  alert,
}: {
  label: string;
  value: string;
  hint?: string;
  alert?: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${alert ? "border-red-300 bg-red-50" : "border-line"}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-300">{label}</p>
      <p className={`mt-1 text-2xl font-display ${alert ? "text-red-600" : ""}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}
