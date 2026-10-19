import {
  advancePo,
  goodsDeliverBy,
  kitCustomerSummary,
  kitSummary,
  poSchedule,
  posFromDesign,
  raiseReplacement,
  recordPoActualCosts,
  recordPoDelivery,
  recordPoInspection,
  updatePoDetails,
  type Blocker,
  type DesignRecord,
  type Issue,
  type PilotSettings,
  type PoStatus,
  type Project,
  type ProposalRecord,
  type PurchaseOrder,
  type StaffMember,
} from "@aircon/domain";
import { audit } from "./audit";
import { dispatch, londonToday, loadProject } from "./project-service";
import { db, type Row } from "./repo/base";
import * as catalogueRepo from "./repo/catalogue";
import * as designsRepo from "./repo/designs";
import * as issuesRepo from "./repo/issues";
import * as mediaRepo from "./repo/media";
import * as proposalsRepo from "./repo/proposals";
import * as purchaseOrdersRepo from "./repo/purchaseOrders";
import { getSettings } from "./settings-server";

/**
 * Purchasing on the server (F5): purchase orders from the accepted design,
 * every change through the pure rules in purchasing.ts, saved with an
 * optimistic check (two people on one order can't silently overwrite each
 * other), audited, then the project's kit status brought into line so the
 * customer hears only what someone has recorded.
 *
 * Permissions are the caller's job (requireStaff("purchasing.edit") and
 * requireProjectAccess); this module checks that the order belongs to the
 * project it was asked about.
 */

/* ------------------------------------------------------------------ */
/* Shared plumbing for F5's server modules                             */
/* ------------------------------------------------------------------ */

export type Outcome<T> =
  | { ok: true; value: T; message?: string; warning?: string }
  | { ok: false; error: string; status?: number; blockers?: Blocker[] };

export const fail = (error: string, status = 409, blockers?: Blocker[]): { ok: false; error: string; status: number; blockers?: Blocker[] } => ({
  ok: false,
  error,
  status,
  ...(blockers ? { blockers } : {}),
});

/**
 * Read a JSONB-backed row, change it with a pure function, and write it back
 * only if nobody saved in between (compared on updated_at); a lost race
 * re-reads and re-applies, up to three times.
 */
export async function mutateRow<T>(
  table: string,
  id: string,
  map: { fromRow: (row: Row) => T; toRow: (value: T) => Row },
  change: (current: T) => { ok: true; value: T } | { ok: false; error: string },
): Promise<Outcome<T>> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await db().from(table).select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`${table} read: ${error.message}`);
    if (!data) return fail("Not found.", 404);
    const res = change(map.fromRow(data as Row));
    if (!res.ok) return fail(res.error);
    let q = db()
      .from(table)
      .update({ ...map.toRow(res.value), updated_at: new Date().toISOString() })
      .eq("id", id);
    const seen = (data as Row).updated_at;
    if (seen) q = q.eq("updated_at", seen as string);
    const { data: saved, error: writeError } = await q.select("*");
    if (writeError) throw new Error(`${table} write: ${writeError.message}`);
    if ((saved ?? []).length === 0) continue;
    return { ok: true, value: map.fromRow(saved![0] as Row) };
  }
  return fail("Someone else changed this at the same moment. Refresh and try again.");
}

/** Media ids that really belong to this project (anything else is dropped). */
export async function projectMediaIds(projectId: string, ids: string[] | undefined): Promise<string[]> {
  const wanted = [...new Set((ids ?? []).filter(Boolean))].slice(0, 20);
  if (wanted.length === 0) return [];
  const items = await mediaRepo.listByIds(wanted);
  return items.filter((m) => m.projectId === projectId).map((m) => m.id);
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

export interface KitSource {
  proposal: ProposalRecord;
  design: DesignRecord;
  variantId: string;
  optionLabel: string;
}

/**
 * The design the kit comes from: the accepted proposal's chosen option and
 * the exact design version it was priced on. Null, with the reason, until
 * there's a signed contract to order for.
 */
export async function kitSource(projectId: string): Promise<{ ok: true; source: KitSource } | { ok: false; reason: string }> {
  const proposal = await proposalsRepo.acceptedForProject(projectId);
  if (!proposal || !proposal.acceptance) {
    return { ok: false, reason: "Purchase orders are raised from the accepted proposal, and nothing is accepted yet." };
  }
  const option = proposal.options.find((o) => o.id === proposal.acceptance!.optionId);
  if (!option) return { ok: false, reason: "The accepted option can't be found on the proposal record." };
  const design = (await designsRepo.get(proposal.designId)) ?? null;
  if (!design || design.version !== proposal.designVersion) {
    return { ok: false, reason: `The design (v${proposal.designVersion}) the proposal was priced on can't be found.` };
  }
  if (!design.variants.some((v) => v.id === option.designVariantId)) {
    return { ok: false, reason: `The design has no "${option.label}" variant to order from.` };
  }
  return { ok: true, source: { proposal, design, variantId: option.designVariantId, optionLabel: option.label } };
}

export interface KitView {
  project: Project;
  orders: (PurchaseOrder & { schedule: ReturnType<typeof poSchedule> })[];
  summary: ReturnType<typeof kitSummary>;
  source: { ok: true; optionLabel: string; designVersion: number } | { ok: false; reason: string };
  today: string;
  /** Open damage and missing-kit issues on this job. */
  kitIssues: Issue[];
}

/**
 * One order's dates against the install: on site two working days before
 * day 1, or, for a supply-and-install customer whose cancellation period
 * still waits on the kit, at their home early enough for the period to have
 * run by then (goodsDeliverBy).
 */
function scheduleFor(po: PurchaseOrder, project: Project, settings: PilotSettings, today: string): ReturnType<typeof poSchedule> {
  const start = project.booking.startDate;
  const deliverBy = start ? goodsDeliverBy(project, start, settings) : undefined;
  return poSchedule(po, start, today, settings.scheduling.workingDays, deliverBy ? { deliverBy } : {});
}

export async function loadKit(projectId: string): Promise<KitView | null> {
  const project = await loadProject(projectId);
  if (!project) return null;
  const [pos, settings, src, issues] = await Promise.all([
    purchaseOrdersRepo.listForProject(projectId),
    getSettings(),
    kitSource(projectId),
    issuesRepo.listForProject(projectId, { openOnly: true }),
  ]);
  const today = londonToday();
  return {
    project,
    orders: pos.map((po) => ({ ...po, schedule: scheduleFor(po, project, settings, today) })),
    summary: kitSummary(pos),
    source: src.ok ? { ok: true, optionLabel: src.source.optionLabel, designVersion: src.source.design.version } : { ok: false, reason: src.reason },
    today,
    kitIssues: issues.filter((i) => i.kind === "damage" || i.kind === "shortage"),
  };
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

/**
 * Raise the purchase orders for the accepted option. Refused while live
 * orders from the same design version exist, so a double click (or a second
 * person) can't order everything twice.
 */
export async function generatePurchaseOrders(projectId: string, staff: StaffMember): Promise<Outcome<PurchaseOrder[]>> {
  const src = await kitSource(projectId);
  if (!src.ok) return fail(src.reason);
  const { design, variantId } = src.source;
  const existing = (await purchaseOrdersRepo.listForProject(projectId)).filter((p) => p.status !== "cancelled");
  if (existing.some((p) => !p.replacementFor && (p.designId === undefined || p.designId === design.id))) {
    return fail("Purchase orders already exist for this design. Cancel them first to raise a fresh set.");
  }
  const catalogue = await catalogueRepo.listByIds(design.variants.find((v) => v.id === variantId)!.bom.map((b) => b.catalogueItemId ?? "").filter(Boolean));
  let pos: PurchaseOrder[];
  try {
    pos = posFromDesign(design, variantId, catalogue, projectId, () => crypto.randomUUID());
  } catch (err) {
    return fail(err instanceof Error ? err.message : "The design couldn't be turned into orders.");
  }
  if (pos.length === 0) return fail("The design's bill of materials is empty, so there's nothing to order.");
  const now = new Date().toISOString();
  for (const po of pos) {
    po.history.push({ at: now, by: staff.name, note: `Raised from design v${design.version} (${src.source.optionLabel}).`, status: "required" });
  }
  const saved = await purchaseOrdersRepo.insertMany(pos);
  await audit({ actor: staff, action: "purchasing.generate", entity: "project", entityId: projectId, detail: { orders: saved.map((p) => p.id), designId: design.id } });
  const sync = await syncKitStatus(projectId, staff);
  return { ok: true, value: saved, message: `${saved.length} purchase order${saved.length === 1 ? "" : "s"} raised.`, ...(sync.warning ? { warning: sync.warning } : {}) };
}

async function changePo(
  projectId: string,
  poId: string,
  staff: StaffMember,
  action: string,
  change: (po: PurchaseOrder) => { ok: true; po: PurchaseOrder } | { ok: false; error: string },
): Promise<Outcome<PurchaseOrder>> {
  const res = await mutateRow<PurchaseOrder>("purchase_orders", poId, purchaseOrdersRepo, (current) => {
    if (current.projectId !== projectId) return { ok: false, error: "That order isn't on this project." };
    const r = change(current);
    return r.ok ? { ok: true, value: r.po } : r;
  });
  if (!res.ok) return res;
  await audit({ actor: staff, action: `purchasing.${action}`, entity: "purchase_order", entityId: poId, detail: { projectId, status: res.value.status } });
  const sync = await syncKitStatus(projectId, staff);
  return { ok: true, value: res.value, ...(sync.warning ? { warning: sync.warning } : {}) };
}

export function advanceOrder(
  projectId: string,
  poId: string,
  to: PoStatus,
  staff: StaffMember,
  patch?: Partial<PurchaseOrder>,
  note?: string,
): Promise<Outcome<PurchaseOrder>> {
  return changePo(projectId, poId, staff, `advance.${to}`, (po) => advancePo(po, to, staff.name, new Date().toISOString(), patch, note));
}

export function updateOrder(projectId: string, poId: string, patch: Partial<PurchaseOrder>, staff: StaffMember): Promise<Outcome<PurchaseOrder>> {
  return changePo(projectId, poId, staff, "update", (po) => updatePoDetails(po, patch, staff.name, new Date().toISOString()));
}

/** What the supplier actually charged, line by line (ex VAT): the pilot's real cost and margin come from these. */
export function recordActualCosts(
  projectId: string,
  poId: string,
  lines: { lineId: string; actualUnitCostPence: number | null }[],
  staff: StaffMember,
): Promise<Outcome<PurchaseOrder>> {
  return changePo(projectId, poId, staff, "actual-costs", (po) => recordPoActualCosts(po, { by: staff.name, lines }, new Date().toISOString()));
}

export async function recordDelivery(
  projectId: string,
  poId: string,
  input: { by: string; at?: string; received: { lineId: string; qty: number }[]; note?: string; mediaIds?: string[] },
  staff: StaffMember,
): Promise<Outcome<PurchaseOrder>> {
  const mediaIds = await projectMediaIds(projectId, input.mediaIds);
  return changePo(projectId, poId, staff, "delivery", (po) =>
    recordPoDelivery(po, { ...input, by: input.by.trim() || staff.name, mediaIds }, new Date().toISOString()),
  );
}

/**
 * Record the kit check. Each newly damaged line raises a "damage" issue
 * (blocking day 1) so it can't be missed; the order keeps a link to it in
 * its history.
 */
export async function recordInspection(
  projectId: string,
  poId: string,
  input: { lines: { lineId: string; goodQty: number; damagedQty: number; serials?: string[] }[]; note?: string; mediaIds?: string[] },
  staff: StaffMember,
): Promise<Outcome<PurchaseOrder>> {
  const mediaIds = await projectMediaIds(projectId, input.mediaIds);
  let damaged: { lineId: string; label: string; qty: number }[] = [];
  const res = await changePo(projectId, poId, staff, "inspection", (po) => {
    const r = recordPoInspection(po, { by: staff.name, lines: input.lines, ...(input.note ? { note: input.note } : {}), mediaIds }, new Date().toISOString());
    if (!r.ok) return r;
    damaged = r.newlyDamaged;
    return { ok: true, po: r.po };
  });
  if (!res.ok || damaged.length === 0) return res;
  const issues: Issue[] = [];
  for (const d of damaged) {
    try {
      issues.push(await raiseDamageIssue(projectId, res.value, d, staff, mediaIds));
    } catch (err) {
      console.error(`[purchasing] damage issue for ${poId} failed:`, err);
      return { ...res, warning: "The check is saved, but the damage issue couldn't be raised. Raise it by hand from the project page." };
    }
  }
  return { ...res, message: `Saved. ${issues.length} damage issue${issues.length === 1 ? "" : "s"} raised: arrange the replacement below.` };
}

async function raiseDamageIssue(
  projectId: string,
  po: PurchaseOrder,
  d: { lineId: string; label: string; qty: number },
  staff: StaffMember,
  mediaIds: string[],
): Promise<Issue> {
  const now = new Date().toISOString();
  const title = `Damaged on delivery: ${d.qty} × ${d.label}`;
  const issue: Issue = {
    id: crypto.randomUUID(),
    projectId,
    number: await issuesRepo.nextNumber(projectId),
    kind: "damage",
    title,
    detail: `Found at the kit check on the ${po.supplier} order${po.reference ? ` (${po.reference})` : ""}. Order a replacement from the kit page, and claim with the supplier.`,
    severity: "high",
    status: "open",
    blocking: true,
    gate: "ready-to-install",
    ownerRole: "ops",
    nextAction: "Order a replacement and claim with the supplier",
    raisedBy: { kind: "staff", id: staff.id, name: staff.name },
    raisedAt: now,
    mediaIds,
    customerVisible: false,
    history: [{ at: now, by: staff.name, note: "Raised from the kit check.", status: "open" }],
  };
  const saved = await issuesRepo.insert(issue);
  await audit({ actor: staff, action: "issue.raise", entity: "issue", entityId: saved.id, detail: { projectId, kind: "damage", poId: po.id } });
  return saved;
}

/** Order a replacement for damaged units: a new order, and the original line no longer holds the kit. */
export async function orderReplacement(projectId: string, poId: string, lineId: string, qty: number, staff: StaffMember): Promise<Outcome<PurchaseOrder>> {
  let replacement: PurchaseOrder | null = null;
  const res = await mutateRow<PurchaseOrder>("purchase_orders", poId, purchaseOrdersRepo, (current) => {
    if (current.projectId !== projectId) return { ok: false, error: "That order isn't on this project." };
    const r = raiseReplacement(current, lineId, qty, () => crypto.randomUUID(), staff.name, new Date().toISOString());
    if (!r.ok) return r;
    replacement = r.replacement;
    return { ok: true, value: r.po };
  });
  if (!res.ok) return res;
  const saved = await purchaseOrdersRepo.insert(replacement!);
  await audit({ actor: staff, action: "purchasing.replacement", entity: "purchase_order", entityId: saved.id, detail: { projectId, replaces: poId, lineId, qty } });
  const sync = await syncKitStatus(projectId, staff);
  return { ok: true, value: saved, message: "Replacement order raised: approve and order it below.", ...(sync.warning ? { warning: sync.warning } : {}) };
}

/* ------------------------------------------------------------------ */
/* The project's kit status                                            */
/* ------------------------------------------------------------------ */

/**
 * Tell the project (and through it the customer) where the kit stands, from
 * the orders: dispatches kit-updated only when the status, date or shortages
 * actually changed, and only once the booking is confirmed (the reducer's
 * rule; booking confirmation runs this again). The wording the customer sees
 * is the reducer's, which only ever says what someone recorded.
 *
 * One thing can't wait for the booking: kit that has all reached the
 * customer's home starts a supply-and-install cancellation period on the day
 * the last of it arrived (goods-received), so the dates offered and checked
 * from then on count from the real delivery, not from the confirmation.
 */
export async function syncKitStatus(projectId: string, staff: StaffMember | null): Promise<{ changed: boolean; warning?: string }> {
  try {
    const [project, pos] = await Promise.all([loadProject(projectId), purchaseOrdersRepo.listForProject(projectId)]);
    if (!project) return { changed: false };
    const s = kitSummary(pos);
    if (project.booking.status !== "booked") {
      const pr = project.proposal;
      const home = (s.status === "delivered" || s.status === "inspected") && s.shortages === 0 && s.deliveredTo === "customer";
      if (!home || pr.status !== "accepted" || pr.contractType !== "supply-and-install" || pr.goodsReceivedOn || project.install.status !== "not-started") {
        return { changed: false };
      }
      const r = await dispatch(projectId, { type: "goods-received", ...(s.receivedOn ? { receivedOn: s.receivedOn } : {}) }, staff ?? { kind: "system", name: "purchasing" });
      if ("error" in r) {
        console.error(`[purchasing] goods-received on ${projectId} refused:`, r.error);
        return { changed: false, warning: `Saved, but the delivery date didn't reach the project: ${r.error}` };
      }
      return { changed: true };
    }
    const k = project.kit;
    let status = s.status;
    let summary = kitCustomerSummary(s);
    // Once the goods were delivered, the customer was told so, and it was true. A replacement
    // ordered after that (damage found at the check) is said as "delivered, N still to come",
    // never as the kit going back to "ordered".
    const order = ["not-ordered", "ordered", "confirmed", "dispatched", "delivered", "inspected"];
    if (order.indexOf(status) < order.indexOf("delivered") && (k.status === "delivered" || k.status === "inspected")) {
      status = "delivered";
      summary = s.shortages ? `${s.shortages} item${s.shortages === 1 ? "" : "s"} still to come` : "";
    }
    // Where it went decides when a supply-and-install cancellation period
    // starts: only kit at the customer's home starts it now (reg 30(3)).
    const arrived = status === "delivered" || status === "inspected";
    const same =
      k.status === status &&
      k.shortages === s.shortages &&
      (s.expectedDate === undefined || k.expectedDate === s.expectedDate) &&
      (k.summary ?? "") === summary &&
      (!arrived || (k.deliveredTo ?? "customer") === s.deliveredTo);
    if (same) return { changed: false };
    const result = await dispatch(
      projectId,
      {
        type: "kit-updated",
        status,
        ...(s.expectedDate ? { expectedDate: s.expectedDate } : {}),
        summary,
        shortages: s.shortages,
        ...(arrived ? { deliveredTo: s.deliveredTo } : {}),
        // The period runs from the day the last of it arrived, not this update.
        ...(arrived && s.receivedOn ? { receivedOn: s.receivedOn } : {}),
      },
      staff ?? { kind: "system", name: "purchasing" },
    );
    if ("error" in result) {
      console.error(`[purchasing] kit-updated on ${projectId} refused:`, result.error);
      return { changed: false, warning: `Saved, but the project's kit status didn't update: ${result.error}` };
    }
    return { changed: true };
  } catch (err) {
    console.error(`[purchasing] kit sync on ${projectId} failed:`, err);
    return { changed: false, warning: "Saved, but the project's kit status couldn't be updated. It will catch up on the next change." };
  }
}

/* ------------------------------------------------------------------ */
/* Across projects                                                     */
/* ------------------------------------------------------------------ */

export interface PurchasingRow {
  po: PurchaseOrder;
  project: { id: string; customer: string; postcode: string; installStart?: string; bookingConfirmed: boolean; pilot?: string };
  schedule: ReturnType<typeof poSchedule>;
}

/** Every order, with its project and its order-by / need-on-site dates, for /ops/purchasing. */
export async function listPurchasing(projects: { id: string; project: Project }[], pos: PurchaseOrder[]): Promise<PurchasingRow[]> {
  const settings = await getSettings();
  const today = londonToday();
  const byId = new Map(projects.map((p) => [p.id, p.project]));
  return pos
    .filter((po) => byId.has(po.projectId))
    .map((po) => {
      const p = byId.get(po.projectId)!;
      return {
        po,
        project: {
          id: p.id,
          customer: p.customer.name || "Customer",
          postcode: p.customer.postcode,
          ...(p.booking.startDate ? { installStart: p.booking.startDate } : {}),
          bookingConfirmed: p.booking.status === "booked",
          ...(p.pilot ? { pilot: `Pilot ${p.pilot.number}` } : {}),
        },
        schedule: scheduleFor(po, p, settings, today),
      };
    });
}
