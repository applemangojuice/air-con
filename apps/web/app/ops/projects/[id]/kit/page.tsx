import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  PO_DESTINATION_LABEL,
  PO_FLAG_TEXT,
  PO_STATUS_LABEL,
  poLineEffectiveQty,
  poLineGoodQty,
  poTotals,
  type PoFlag,
  type PoStatus,
  type PurchaseOrder,
} from "@aircon/domain";
import { Badge, Card, EmptyState, Money, Section, Stat, StatusChip } from "@/components/kit";
import { requireProjectAccess, requireStaff } from "@/lib/auth/server";
import { fmtDate, fmtDay } from "@/lib/format";
import { loadKit } from "@/lib/purchasing-server";
import { isUuid } from "@/lib/repo/base";
import { ActionForm } from "../booking/_f5/action-form";
import { fmtLondon, isoToLondonLocal } from "../booking/_f5/action-state";
import { JobHeader } from "../booking/_f5/job-header";
import { PhotoUpload } from "../booking/_f5/photo-upload";
import { advanceAction, cancelAction, deliveryAction, generateAction, inspectionAction, replacementAction, updateAction } from "./actions";

export const metadata: Metadata = { title: "Kit · ops", robots: { index: false } };
export const dynamic = "force-dynamic";

const FLAG_TONE: Record<PoFlag, "danger" | "warn"> = {
  "order-late": "danger",
  "order-soon": "warn",
  "no-eta": "warn",
  "eta-after-need": "danger",
  "eta-passed": "warn",
  "delivery-late": "danger",
};

const field = "min-h-12 w-full rounded-full border border-line bg-white px-4 text-base text-ink-900 outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100";
const small = "min-h-11 w-20 rounded-xl border border-line bg-white px-3 text-base tabular-nums outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100";
const label = "mb-1.5 block text-sm font-semibold text-ink-900";

/**
 * Kit (purchasing.edit): purchase orders from the accepted design, each
 * moved on by a named person: ordered, confirmed, delivered (who, when,
 * how many of each line, photos), checked (good, damaged, serials), with
 * replacements for damage. The customer hears only what's recorded here.
 */
export default async function KitPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff("purchasing.edit");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const access = await requireProjectAccess(id, { perm: "purchasing.edit" });
  if (!access || access.kind !== "staff") notFound();
  const view = await loadKit(id);
  if (!view) notFound();
  const { project: p, summary: s } = view;
  const live = view.orders.filter((o) => o.status !== "cancelled");
  const cancelled = view.orders.filter((o) => o.status === "cancelled");
  const need = live.find((o) => o.schedule.needOnSiteBy)?.schedule.needOnSiteBy;
  const nowLocal = isoToLondonLocal(new Date().toISOString());

  return (
    <main className="mx-auto w-full min-w-0 max-w-5xl px-4 py-8 sm:px-6">
      <JobHeader
        project={p}
        current="kit"
        title="Kit"
        subtitle={
          view.source.ok
            ? `Ordered from the accepted option (${view.source.optionLabel}, design v${view.source.designVersion}).`
            : "Purchase orders come from the accepted proposal's design."
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Lines needed" value={String(s.requiredLines)} hint={live.length ? `${live.length} order${live.length === 1 ? "" : "s"}` : "No orders yet"} />
        <Stat label="Delivered" value={`${s.deliveredLines} of ${s.requiredLines}`} tone={s.requiredLines > 0 && s.deliveredLines === s.requiredLines ? "success" : "neutral"} hint="Recorded by a person, never from an ETA" />
        <Stat label="Checked good" value={`${s.inspectedLines} of ${s.requiredLines}`} tone={s.requiredLines > 0 && s.inspectedLines === s.requiredLines ? "success" : "neutral"} />
        <Stat
          label="Needed on site"
          value={need ? fmtDay(need) : "No dates yet"}
          tone={s.damaged > 0 ? "danger" : "neutral"}
          hint={s.damaged > 0 ? `${s.damaged} damaged, not yet replaced` : p.booking.startDate ? `Install day 1: ${fmtDay(p.booking.startDate)}` : "Set install dates on Booking"}
        />
      </div>

      <p className="mt-3 text-sm text-ink-500">
        Customer sees: <span className="font-medium text-ink-900">{customerKitLine(p.kit.status, p.kit.expectedDate)}</span>
        {p.booking.status !== "booked" && " (kit updates reach the customer once the booking is confirmed)"}
      </p>

      {view.kitIssues.length > 0 && (
        <div role="alert" className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <p className="font-semibold">
            {view.kitIssues.length} open kit issue{view.kitIssues.length === 1 ? "" : "s"}: install day 1 waits until {view.kitIssues.length === 1 ? "it's" : "they're"} resolved
          </p>
          <ul className="mt-1 space-y-0.5">
            {view.kitIssues.map((i) => (
              <li key={i.id}>
                #{i.number} {i.title}
                {i.nextAction ? `. Next: ${i.nextAction}.` : ""}
              </li>
            ))}
          </ul>
          <Link href={`/ops/projects/${p.id}`} className="mt-1 inline-flex min-h-10 items-center font-semibold underline">
            Resolve on the project page
          </Link>
        </div>
      )}

      {live.length === 0 && (
        <div className="mt-8">
          <EmptyState
            title={cancelled.length ? "Every order on this job is cancelled" : "No purchase orders yet"}
            body={
              view.source.ok
                ? "Raise them from the accepted design: one order per supplier, every line from the bill of materials, with the catalogue's expected costs."
                : view.source.reason
            }
            action={
              view.source.ok ? (
                <ActionForm flash action={generateAction.bind(null, p.id)} submitLabel="Raise purchase orders" busyLabel="Raising orders…" />
              ) : (
                <Link className="font-semibold text-accent-700 underline" href={`/ops/projects/${p.id}/proposal`}>
                  Go to the proposal
                </Link>
              )
            }
          />
        </div>
      )}

      <div className="mt-8 space-y-6">
        {live.map((po) => (
          <OrderCard key={po.id} po={po} projectId={p.id} staffName={staff.name} nowLocal={nowLocal} />
        ))}
      </div>

      {cancelled.length > 0 && (
        <Section className="mt-10" title="Cancelled orders">
          <ul className="space-y-2">
            {cancelled.map((po) => (
              <li key={po.id} className="rounded-2xl border border-line bg-white/60 px-4 py-3 text-sm text-ink-700">
                <span className="font-semibold text-ink-900">{po.supplier}</span>
                {po.reference ? ` · ${po.reference}` : ""} · {po.lines.length} line{po.lines.length === 1 ? "" : "s"} · {po.cancelledReason ?? "Cancelled"}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </main>
  );
}

function customerKitLine(status: string, expected?: string): string {
  switch (status) {
    case "ordered":
      return "Your kit is ordered.";
    case "confirmed":
    case "dispatched":
      return expected ? `The supplier has confirmed your kit for ${fmtDay(expected)}.` : "The supplier has confirmed your kit order.";
    case "delivered":
      return "Your kit has been delivered.";
    case "inspected":
      return "Your kit has been checked by your installer.";
    default:
      return "Nothing yet.";
  }
}

const NEXT: Partial<Record<PoStatus, { to: PoStatus; label: string }>> = {
  required: { to: "approved", label: "Approve to order" },
  approved: { to: "ordered", label: "Mark as ordered" },
  ordered: { to: "confirmed", label: "Supplier confirmed a date" },
  confirmed: { to: "dispatched", label: "Mark as dispatched" },
};

function OrderCard({
  po,
  projectId,
  staffName,
  nowLocal,
}: {
  po: PurchaseOrder & { schedule: { needOnSiteBy?: string; orderBy?: string; flags: PoFlag[] } };
  projectId: string;
  staffName: string;
  nowLocal: string;
}) {
  const totals = poTotals(po);
  const next = NEXT[po.status];
  const receiving = ["ordered", "confirmed", "dispatched"].includes(po.status);
  const checking = po.status === "delivered" || (receiving && po.lines.some((l) => l.receivedQty > l.inspectedQty));
  const damaged = po.lines.filter((l) => l.damagedQty - (l.replacedQty ?? 0) > 0);
  const canCancel = po.lines.every((l) => l.receivedQty === 0) && !["delivered", "inspected"].includes(po.status);

  return (
    <Card as="article" padded={false} className="overflow-hidden">
      <div className="border-b border-line px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-xl text-ink-900">{po.supplier}</h2>
            <p className="mt-1 text-sm text-ink-500">
              {po.reference ? `Ref ${po.reference} · ` : ""}
              To {PO_DESTINATION_LABEL[po.destination].toLowerCase()}
              {po.eta ? ` · ETA ${fmtDay(po.eta)}` : ""}
              {po.trackingRef ? ` · Tracking ${po.trackingRef}` : ""}
              {po.replacementFor ? " · Replacement order" : ""}
            </p>
          </div>
          <StatusChip status={po.status} label={PO_STATUS_LABEL[po.status]} />
        </div>
        {(po.schedule.orderBy || po.schedule.flags.length > 0) && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            {po.schedule.orderBy && ["required", "approved"].includes(po.status) && <Badge tone="neutral">Order by {fmtDay(po.schedule.orderBy)}</Badge>}
            {po.schedule.needOnSiteBy && !["delivered", "inspected"].includes(po.status) && <Badge tone="neutral">Needed on site {fmtDay(po.schedule.needOnSiteBy)}</Badge>}
            {po.schedule.flags.map((f) => (
              <Badge key={f} tone={FLAG_TONE[f]} dot>
                {PO_FLAG_TEXT[f]}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Lines */}
      <div className="px-5 py-4 sm:px-6">
        <table className="w-full text-sm">
          <caption className="sr-only">Lines on this order</caption>
          <thead className="hidden text-left text-xs uppercase tracking-wide text-ink-500 sm:table-header-group">
            <tr>
              <th className="pb-2 font-semibold">Item</th>
              <th className="pb-2 text-right font-semibold">Qty</th>
              <th className="pb-2 text-right font-semibold">Unit cost</th>
              <th className="pb-2 text-right font-semibold">Arrived</th>
              <th className="pb-2 text-right font-semibold">Checked OK</th>
              <th className="pb-2 text-right font-semibold">Damaged</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {po.lines.map((l) => {
              const need = poLineEffectiveQty(l);
              return (
                <tr key={l.id} className="grid grid-cols-3 gap-x-3 gap-y-1 py-2.5 sm:table-row">
                  <td className="col-span-3 sm:py-2.5 sm:pr-3">
                    <span className="font-medium text-ink-900">{l.label}</span>
                    {!l.required && <span className="ml-2 align-middle"><Badge tone="neutral">Van stock</Badge></span>}
                    {l.serials.length > 0 && <span className="mt-0.5 block text-xs text-ink-500">Serials: {l.serials.join(", ")}</span>}
                    {(l.replacedQty ?? 0) > 0 && <span className="mt-0.5 block text-xs text-ink-500">{l.replacedQty} replaced on another order</span>}
                  </td>
                  <td className="text-ink-700 sm:py-2.5 sm:text-right">
                    <span className="text-xs text-ink-500 sm:hidden">Qty </span>
                    {l.qty}
                    {l.unit ? ` ${l.unit}` : ""}
                  </td>
                  <td className="text-ink-700 sm:py-2.5 sm:text-right">
                    <span className="text-xs text-ink-500 sm:hidden">Each </span>
                    <Money pence={l.actualUnitCostPence ?? l.unitCostPence} />
                  </td>
                  <td className={`sm:py-2.5 sm:text-right ${l.receivedQty >= need && need > 0 ? "font-semibold text-emerald-800" : "text-ink-700"}`}>
                    <span className="text-xs font-normal text-ink-500 sm:hidden">Arrived </span>
                    {l.receivedQty}
                  </td>
                  <td className="text-ink-700 sm:py-2.5 sm:text-right">
                    <span className="text-xs text-ink-500 sm:hidden">OK </span>
                    {poLineGoodQty(l)}
                  </td>
                  <td className={`sm:py-2.5 sm:text-right ${l.damagedQty > 0 ? "font-semibold text-red-700" : "text-ink-700"}`}>
                    <span className="text-xs font-normal text-ink-500 sm:hidden">Damaged </span>
                    {l.damagedQty}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-3 text-sm text-ink-500">
          Expected <Money pence={totals.expectedPence} className="font-semibold text-ink-900" />
          {totals.unpricedLines > 0 && ` (${totals.unpricedLines} line${totals.unpricedLines === 1 ? "" : "s"} not priced in the catalogue)`}
          {po.shippingPence > 0 && <>, including <Money pence={po.shippingPence} /> shipping</>}.
        </p>
      </div>

      {/* The next step */}
      <div className="border-t border-line bg-surface/40 px-5 py-4 sm:px-6">
        {next && (
          <ActionForm flash action={advanceAction.bind(null, projectId)} submitLabel={next.label} variant={receiving ? "secondary" : "primary"} busyLabel="Saving…">
            <input type="hidden" name="poId" value={po.id} />
            <input type="hidden" name="to" value={next.to} />
            {next.to === "ordered" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={label} htmlFor={`ref-${po.id}`}>Supplier&apos;s order reference</label>
                  <input id={`ref-${po.id}`} name="reference" defaultValue={po.reference ?? ""} maxLength={80} className={field} />
                </div>
                <div>
                  <label className={label} htmlFor={`eta-o-${po.id}`}>Expected delivery (if they gave one)</label>
                  <input id={`eta-o-${po.id}`} name="eta" type="date" defaultValue={po.eta ?? ""} className={field} />
                </div>
              </div>
            )}
            {next.to === "confirmed" && (
              <div className="max-w-xs">
                <label className={label} htmlFor={`eta-c-${po.id}`}>Date the supplier confirmed</label>
                <input id={`eta-c-${po.id}`} name="eta" type="date" required defaultValue={po.eta ?? ""} className={field} />
              </div>
            )}
            {next.to === "dispatched" && (
              <div className="max-w-sm">
                <label className={label} htmlFor={`track-${po.id}`}>Tracking reference (optional)</label>
                <input id={`track-${po.id}`} name="trackingRef" defaultValue={po.trackingRef ?? ""} maxLength={120} className={field} />
              </div>
            )}
          </ActionForm>
        )}
        {po.status === "inspected" && (
          <p className="text-sm text-ink-700">
            Checked{po.inspectedBy ? ` by ${po.inspectedBy}` : ""}
            {po.inspectedAt ? ` on ${fmtLondon(po.inspectedAt)}` : ""}. Nothing more to do on this order.
          </p>
        )}
        {po.status === "delivered" && <p className="text-sm font-medium text-ink-900">Delivered{po.deliveredBy ? ` (taken in by ${po.deliveredBy})` : ""}. Next: check every box against the design.</p>}

        <div className="mt-4 space-y-2">
          {receiving && (
            <Panel title="Record a delivery" open={po.status === "dispatched"}>
              <ActionForm flash action={deliveryAction.bind(null, projectId)} submitLabel="Save the delivery" busyLabel="Saving…" resetOnSuccess>
                <input type="hidden" name="poId" value={po.id} />
                <fieldset>
                  <legend className={label}>What arrived in this delivery</legend>
                  <ul className="space-y-2">
                    {po.lines.map((l) => {
                      const left = Math.max(0, l.qty - l.receivedQty);
                      return (
                        <li key={l.id} className="flex items-center justify-between gap-3">
                          <label htmlFor={`qty-${l.id}`} className="min-w-0 text-sm text-ink-900">
                            {l.label}
                            <span className="block text-xs text-ink-500">{left} still to come</span>
                          </label>
                          <input id={`qty-${l.id}`} name={`qty:${l.id}`} type="number" inputMode="numeric" min={0} max={left} defaultValue={left} disabled={left === 0} className={small} />
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={label} htmlFor={`by-${po.id}`}>Taken in by</label>
                    <input id={`by-${po.id}`} name="by" required defaultValue={staffName} maxLength={120} className={field} />
                  </div>
                  <div>
                    <label className={label} htmlFor={`at-${po.id}`}>When (UK time)</label>
                    <input id={`at-${po.id}`} name="at" type="datetime-local" required defaultValue={nowLocal} max={nowLocal} className={field} />
                  </div>
                </div>
                <div className="mt-4">
                  <PhotoUpload projectId={projectId} tag="kit" label="Photos of the boxes (optional)" hint="The delivery note and any damage to the packaging." />
                </div>
                <div className="mt-4">
                  <label className={label} htmlFor={`dn-${po.id}`}>Note (optional)</label>
                  <input id={`dn-${po.id}`} name="note" maxLength={500} className={field} />
                </div>
              </ActionForm>
            </Panel>
          )}

          {checking && (
            <Panel title="Check the kit against the design" open={po.status === "delivered"}>
              <ActionForm flash action={inspectionAction.bind(null, projectId)} submitLabel="Save the check" busyLabel="Saving…">
                <input type="hidden" name="poId" value={po.id} />
                <p className="mb-3 text-sm text-ink-500">For each line: how many units are good and how many are damaged, out of what arrived. Damage raises an issue that holds install day 1.</p>
                <ul className="space-y-4">
                  {po.lines
                    .filter((l) => l.receivedQty > 0)
                    .map((l) => (
                      <li key={l.id} className="rounded-2xl border border-line bg-white p-3">
                        <input type="hidden" name="lineId" value={l.id} />
                        <p className="text-sm font-semibold text-ink-900">
                          {l.label} <span className="font-normal text-ink-500">({l.receivedQty} arrived)</span>
                        </p>
                        <div className="mt-2 flex flex-wrap items-end gap-4">
                          <div>
                            <label className="mb-1 block text-xs font-semibold text-ink-700" htmlFor={`good-${l.id}`}>Good</label>
                            <input id={`good-${l.id}`} name={`good:${l.id}`} type="number" inputMode="numeric" min={0} max={l.receivedQty} defaultValue={l.receivedQty - l.damagedQty} className={small} />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-semibold text-ink-700" htmlFor={`dmg-${l.id}`}>Damaged</label>
                            <input id={`dmg-${l.id}`} name={`damaged:${l.id}`} type="number" inputMode="numeric" min={0} max={l.receivedQty} defaultValue={l.damagedQty} className={small} />
                          </div>
                          {l.category === "equipment" && (
                            <div className="min-w-0 flex-1">
                              <label className="mb-1 block text-xs font-semibold text-ink-700" htmlFor={`sn-${l.id}`}>Serial numbers</label>
                              <input id={`sn-${l.id}`} name={`serials:${l.id}`} defaultValue={l.serials.join(", ")} placeholder="Comma between each" className={field} />
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                </ul>
                <div className="mt-4">
                  <PhotoUpload projectId={projectId} tag="serial" label="Photos (serial labels, any damage)" />
                </div>
                <div className="mt-4">
                  <label className={label} htmlFor={`cn-${po.id}`}>Note (optional)</label>
                  <input id={`cn-${po.id}`} name="note" maxLength={500} className={field} />
                </div>
              </ActionForm>
            </Panel>
          )}

          {damaged.length > 0 && (
            <Panel title="Order replacements for damaged units" open>
              {damaged.map((l) => {
                const open = l.damagedQty - (l.replacedQty ?? 0);
                return (
                  <ActionForm flash key={l.id} action={replacementAction.bind(null, projectId)} submitLabel={`Order ${open} replacement${open === 1 ? "" : "s"}`} variant="secondary" className="mb-3">
                    <input type="hidden" name="poId" value={po.id} />
                    <input type="hidden" name="lineId" value={l.id} />
                    <input type="hidden" name="qty" value={open} />
                    <p className="text-sm text-ink-900">
                      {l.label}: {open} damaged, not yet replaced.
                    </p>
                  </ActionForm>
                );
              })}
            </Panel>
          )}

          {po.status !== "inspected" && (
            <Panel title="Edit order details">
              <ActionForm flash action={updateAction.bind(null, projectId)} submitLabel="Save details" variant="secondary">
                <input type="hidden" name="poId" value={po.id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={label} htmlFor={`sup-${po.id}`}>Supplier</label>
                    <input id={`sup-${po.id}`} name="supplier" required defaultValue={po.supplier} maxLength={120} readOnly={!["required", "approved"].includes(po.status)} className={field} />
                  </div>
                  <div>
                    <label className={label} htmlFor={`r2-${po.id}`}>Order reference</label>
                    <input id={`r2-${po.id}`} name="reference" defaultValue={po.reference ?? ""} maxLength={80} className={field} />
                  </div>
                  <div>
                    <label className={label} htmlFor={`dest-${po.id}`}>Deliver to</label>
                    <select id={`dest-${po.id}`} name="destination" defaultValue={po.destination} className={`${field} pr-10`}>
                      {Object.entries(PO_DESTINATION_LABEL).map(([v, t]) => (
                        <option key={v} value={v}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={label} htmlFor={`eta2-${po.id}`}>ETA</label>
                    <input id={`eta2-${po.id}`} name="eta" type="date" defaultValue={po.eta ?? ""} className={field} />
                  </div>
                  <div>
                    <label className={label} htmlFor={`trk-${po.id}`}>Tracking reference</label>
                    <input id={`trk-${po.id}`} name="trackingRef" defaultValue={po.trackingRef ?? ""} maxLength={120} className={field} />
                  </div>
                  <div>
                    <label className={label} htmlFor={`lead-${po.id}`}>Supplier lead time (working days)</label>
                    <input id={`lead-${po.id}`} name="leadDays" type="number" inputMode="numeric" min={0} max={120} defaultValue={po.leadDays ?? ""} placeholder="5" className={field} />
                  </div>
                  <div>
                    <label className={label} htmlFor={`ship-${po.id}`}>Shipping (£)</label>
                    <input id={`ship-${po.id}`} name="shipping" inputMode="decimal" defaultValue={po.shippingPence ? (po.shippingPence / 100).toFixed(2) : ""} className={field} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={label} htmlFor={`notes-${po.id}`}>Notes</label>
                    <input id={`notes-${po.id}`} name="notes" defaultValue={po.notes ?? ""} maxLength={1000} className={field} />
                  </div>
                </div>
                {po.destination === "storage" || po.destination === "installer" ? (
                  <p className="mt-3 text-xs text-ink-500">
                    Kit delivered to us or the installer reaches the customer at install: their cancellation period counts from then (legal review required).
                  </p>
                ) : null}
              </ActionForm>
            </Panel>
          )}

          {canCancel && (
            <Panel title="Cancel this order">
              <ActionForm flash action={cancelAction.bind(null, projectId)} submitLabel="Cancel the order" variant="danger" confirm="Cancel this purchase order? This can't be undone.">
                <input type="hidden" name="poId" value={po.id} />
                <label className={label} htmlFor={`why-${po.id}`}>Why</label>
                <input id={`why-${po.id}`} name="reason" required maxLength={500} className={field} />
              </ActionForm>
            </Panel>
          )}

          <Panel title={`History (${po.history.length})`}>
            <ol className="space-y-2 text-sm">
              {[...po.history].reverse().map((h, i) => (
                <li key={`${h.at}-${i}`} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                  <span className="shrink-0 text-xs text-ink-500 sm:w-40">{fmtLondon(h.at)}</span>
                  <span className="text-ink-900">
                    {h.note} <span className="text-ink-500">({h.by})</span>
                  </span>
                </li>
              ))}
              {po.history.length === 0 && <li className="text-ink-500">Nothing recorded yet.</li>}
            </ol>
            {po.orderedOn && <p className="mt-3 text-xs text-ink-500">Ordered on {fmtDate(po.orderedOn)}.</p>}
          </Panel>
        </div>
      </div>
    </Card>
  );
}

function Panel({ title, open = false, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details open={open} className="group rounded-2xl border border-line bg-white">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-semibold text-ink-900">
        {title}
        <span aria-hidden className="text-ink-500 transition group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="border-t border-line px-4 py-4">{children}</div>
    </details>
  );
}
