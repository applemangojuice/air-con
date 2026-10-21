import type { Metadata } from "next";
import Link from "next/link";
import { PO_FLAG_TEXT, PO_STATUS_LABEL, poTotals, type PoFlag, type PoStatus } from "@aircon/domain";
import { Badge, EmptyState, Money, PageHeader, Stat, StatusChip } from "@/components/kit";
import { requireStaff } from "@/lib/auth/server";
import { fmtDay } from "@/lib/format";
import { loadOpsProjects } from "@/lib/ops-server";
import { listPurchasing, type PurchasingRow } from "@/lib/purchasing-server";
import * as purchaseOrdersRepo from "@/lib/repo/purchaseOrders";
import { getServiceClient } from "@/lib/supabase-server";

export const metadata: Metadata = { title: "Purchasing · ops", robots: { index: false } };
export const dynamic = "force-dynamic";

const GROUPS: { title: string; statuses: PoStatus[]; empty: string }[] = [
  { title: "To order", statuses: ["required", "approved"], empty: "Nothing waiting to be ordered." },
  { title: "On order", statuses: ["ordered", "confirmed", "dispatched"], empty: "Nothing on order." },
  { title: "Delivered, to check", statuses: ["delivered"], empty: "Nothing waiting for its kit check." },
];

const LATE: PoFlag[] = ["order-late", "eta-after-need", "delivery-late"];
const FLAG_TONE: Record<PoFlag, "danger" | "warn"> = {
  "order-late": "danger",
  "order-soon": "warn",
  "no-eta": "warn",
  "eta-after-need": "danger",
  "eta-passed": "warn",
  "delivery-late": "danger",
};

/**
 * Purchasing across every job (purchasing.edit): each order with its
 * order-by date (kit needed on site two working days before install day 1,
 * less the supplier's lead time) and anything late, grouped by where it is.
 * Each row opens the job's kit page, where orders are moved on.
 */
export default async function PurchasingPage() {
  await requireStaff("purchasing.edit");
  const hasDb = Boolean(getServiceClient());
  const [projects, pos] = hasDb ? await Promise.all([loadOpsProjects(), purchaseOrdersRepo.list()]) : [[], []];
  const rows = await listPurchasing(projects, pos);
  const live = rows.filter((r) => r.po.status !== "cancelled");
  const late = live.filter((r) => r.schedule.flags.some((f) => LATE.includes(f)));
  const toOrder = live.filter((r) => r.po.status === "required" || r.po.status === "approved");
  const done = live.filter((r) => r.po.status === "inspected");
  const sortRows = (list: PurchasingRow[]) =>
    [...list].sort((a, b) => (a.schedule.orderBy ?? a.po.eta ?? "9999").localeCompare(b.schedule.orderBy ?? b.po.eta ?? "9999"));

  return (
    <main className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader title="Purchasing" subtitle="Every purchase order across the live jobs, with when it has to be ordered by." />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Late or at risk" value={String(late.length)} tone={late.length ? "danger" : "success"} hint={late.length ? "Needs action today" : "Nothing late"} />
        <Stat label="To order" value={String(toOrder.length)} />
        <Stat label="On order" value={String(live.filter((r) => ["ordered", "confirmed", "dispatched"].includes(r.po.status)).length)} />
        <Stat label="Checked" value={String(done.length)} hint="Delivered and checked against the design" />
      </div>

      {!hasDb && <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">No database is connected, so there are no orders to show.</p>}

      {live.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="No purchase orders yet"
            body="Orders are raised on each job's Kit page, from the accepted proposal's design. They'll all show here."
            action={
              <Link href="/ops/projects" className="font-semibold text-accent-700 underline">
                Go to the board
              </Link>
            }
          />
        </div>
      ) : (
        <div className="mt-8 space-y-10">
          {GROUPS.map((g) => {
            const list = sortRows(live.filter((r) => g.statuses.includes(r.po.status)));
            return (
              <section key={g.title} aria-labelledby={`h-${g.title}`}>
                <h2 id={`h-${g.title}`} className="mb-3 font-display text-xl text-ink-900 sm:text-2xl">
                  {g.title} <span className="font-sans text-base font-semibold text-ink-500">({list.length})</span>
                </h2>
                {list.length === 0 ? <p className="text-sm text-ink-500">{g.empty}</p> : <Rows rows={list} />}
              </section>
            );
          })}
          {done.length > 0 && (
            <details className="rounded-2xl border border-line bg-white px-4">
              <summary className="flex min-h-12 cursor-pointer items-center text-sm font-semibold text-ink-900">Delivered and checked ({done.length})</summary>
              <div className="pb-4">
                <Rows rows={done} />
              </div>
            </details>
          )}
        </div>
      )}
    </main>
  );
}

function Rows({ rows }: { rows: PurchasingRow[] }) {
  return (
    <ul className="space-y-2">
      {rows.map(({ po, project, schedule }) => {
        const totals = poTotals(po);
        const required = po.lines.filter((l) => l.required).length;
        return (
          <li key={po.id}>
            <Link
              href={`/ops/projects/${project.id}/kit`}
              className={`block rounded-2xl border bg-white px-4 py-3 transition hover:border-accent-400 ${schedule.flags.some((f) => LATE.includes(f)) ? "border-red-300" : "border-line"}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-ink-900">
                    {project.customer}
                    {project.pilot ? <span className="ml-2 align-middle"><Badge tone="accent">{project.pilot}</Badge></span> : null}
                  </p>
                  <p className="text-sm text-ink-500">
                    {po.supplier}
                    {po.reference ? ` · ${po.reference}` : ""} · {required} line{required === 1 ? "" : "s"} · <Money pence={totals.expectedPence} />
                    {totals.unpricedLines ? ` (+${totals.unpricedLines} unpriced)` : ""}
                  </p>
                </div>
                <StatusChip status={po.status} label={PO_STATUS_LABEL[po.status]} />
              </div>
              <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-700">
                <div>
                  <dt className="inline text-ink-500">Install </dt>
                  <dd className="inline font-semibold">{project.installStart ? `${fmtDay(project.installStart)}${project.bookingConfirmed ? "" : " (not confirmed)"}` : "No dates"}</dd>
                </div>
                {schedule.orderBy && ["required", "approved"].includes(po.status) && (
                  <div>
                    <dt className="inline text-ink-500">Order by </dt>
                    <dd className="inline font-semibold">{fmtDay(schedule.orderBy)}</dd>
                  </div>
                )}
                {schedule.needOnSiteBy && (
                  <div>
                    <dt className="inline text-ink-500">{schedule.needFor === "cancellation-period" ? "At the home by (cancellation period) " : "On site by "}</dt>
                    <dd className="inline font-semibold">{fmtDay(schedule.needOnSiteBy)}</dd>
                  </div>
                )}
                {po.eta && (
                  <div>
                    <dt className="inline text-ink-500">ETA </dt>
                    <dd className="inline font-semibold">{fmtDay(po.eta)}</dd>
                  </div>
                )}
              </dl>
              {schedule.flags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {schedule.flags.map((f) => (
                    <Badge key={f} tone={FLAG_TONE[f]} dot>
                      {PO_FLAG_TEXT[f]}
                    </Badge>
                  ))}
                </div>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
