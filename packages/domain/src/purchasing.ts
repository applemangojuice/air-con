import type { CatalogueItem } from "./catalogue.ts";
import type { DesignBomLine, DesignRecord } from "./design-record.ts";
import type { Project } from "./project.ts";

/**
 * Purchasing: purchase orders from the approved design, tracked line by
 * line from required to inspected.
 *
 * Forward-only, except cancel. "Delivered" needs a person to record when it
 * arrived; nothing is delivered because an ETA passed. Partial deliveries
 * are normal, and actual costs feed the pilot margin.
 *
 * Quantities per line:
 *  * receivedQty: units a person has recorded arriving;
 *  * inspectedQty: units checked against the design (good or bad);
 *  * damagedQty: of those checked, the ones that aren't usable;
 *  * replacedQty: damaged units a replacement order now covers, so the
 *    original line only still needs `qty − replacedQty` good units.
 */

export type PoStatus =
  | "required"
  | "approved"
  | "ordered"
  | "confirmed"
  | "dispatched"
  | "delivered"
  | "inspected"
  | "cancelled";

/** The forward path. Cancel can happen before delivery. */
export const PO_FLOW: PoStatus[] = ["required", "approved", "ordered", "confirmed", "dispatched", "delivered", "inspected"];

export const PO_STATUS_LABEL: Record<PoStatus, string> = {
  required: "Required",
  approved: "Approved to order",
  ordered: "Ordered",
  confirmed: "Supplier confirmed",
  dispatched: "Dispatched",
  delivered: "Delivered",
  inspected: "Checked",
  cancelled: "Cancelled",
};

export type PoDestination = "customer" | "storage" | "installer" | "subcontractor";

export const PO_DESTINATION_LABEL: Record<PoDestination, string> = {
  customer: "The customer's home",
  storage: "Our storage",
  installer: "The installer",
  subcontractor: "The subcontractor",
};

/** Placeholder supplier for catalogue items without one: nothing can be ordered until it's named. */
export const UNKNOWN_SUPPLIER = "Supplier to confirm";
/** Working days from order to delivery when the order doesn't say. */
export const DEFAULT_SUPPLIER_LEAD_DAYS = 5;
/** Kit should be on site this many working days before install day 1. */
export const KIT_ON_SITE_BUFFER_DAYS = 2;

export interface PoLine {
  id: string;
  catalogueItemId?: string;
  label: string;
  qty: number;
  unitCostPence: number | null;
  actualUnitCostPence?: number;
  receivedQty: number;
  inspectedQty: number;
  damagedQty: number;
  serials: string[];
  required: boolean;
  sku?: string;
  unit?: string;
  category?: DesignBomLine["category"];
  /** Damaged units a replacement order now covers. */
  replacedQty?: number;
  /** On a replacement order: the original line it replaces. */
  replacesLineId?: string;
}

export interface PurchaseOrder {
  id: string;
  projectId: string;
  supplier: string;
  reference?: string;
  status: PoStatus;
  destination: PoDestination;
  lines: PoLine[];
  expectedTotalPence: number;
  actualTotalPence?: number;
  shippingPence: number;
  orderedOn?: string;
  eta?: string;
  trackingRef?: string;
  deliveredAt?: string;
  inspectedAt?: string;
  notes?: string;
  mediaIds: string[];
  history: { at: string; by: string; note: string; status?: PoStatus }[];
  /** Working days from order to delivery (default DEFAULT_SUPPLIER_LEAD_DAYS). */
  leadDays?: number;
  /** Who recorded the delivery and the check. */
  deliveredBy?: string;
  inspectedBy?: string;
  /** A replacement order: the order whose damaged units it replaces. */
  replacementFor?: string;
  cancelledReason?: string;
  /** Design version it was raised from. */
  designId?: string;
  designVersion?: number;
}

export type PoResult = { ok: true; po: PurchaseOrder } | { ok: false; error: string };

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const statusIndex = (s: PoStatus) => PO_FLOW.indexOf(s);
const dateOf = (iso: string) => iso.slice(0, 10);
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) && Number.isFinite(Date.parse(s.slice(0, 10)));

/** Good units the line still needs: ordered, less damaged units a replacement order covers. */
export function poLineEffectiveQty(line: PoLine): number {
  return Math.max(0, line.qty - (line.replacedQty ?? 0));
}

/** Units checked and usable. */
export function poLineGoodQty(line: PoLine): number {
  return Math.max(0, line.inspectedQty - line.damagedQty);
}

/** Expected (catalogue) and actual totals, lines plus shipping. Unpriced lines are counted, never treated as free. */
export function poTotals(po: PurchaseOrder): { expectedPence: number; actualPence: number | null; unpricedLines: number } {
  let expected = 0;
  let actual = 0;
  let actualKnown = true;
  let unpriced = 0;
  for (const l of po.lines) {
    if (l.unitCostPence === null) unpriced++;
    else expected += l.unitCostPence * l.qty;
    const unit = l.actualUnitCostPence ?? l.unitCostPence;
    if (unit === null || unit === undefined) actualKnown = false;
    else actual += unit * l.qty;
  }
  expected += po.shippingPence;
  actual += po.shippingPence;
  return {
    expectedPence: expected,
    actualPence: po.actualTotalPence ?? (actualKnown ? actual : null),
    unpricedLines: unpriced,
  };
}

const CATEGORY_ORDER: Record<DesignBomLine["category"], number> = { equipment: 0, materials: 1, consumables: 2 };

/* ------------------------------------------------------------------ */
/* Raising orders                                                      */
/* ------------------------------------------------------------------ */

/**
 * Purchase orders for one design variant's bill of materials, one per
 * supplier (the catalogue item's supplier; lines with none go on a
 * "Supplier to confirm" order that can't be placed until it's named). The
 * same item twice is one line. Equipment and materials are required for the
 * install; consumables are van stock, listed but not required. Expected
 * costs are the catalogue's (null when unpriced).
 */
export function posFromDesign(
  design: DesignRecord,
  variantId: string,
  catalogue: CatalogueItem[],
  projectId: string,
  makeId: () => string,
): PurchaseOrder[] {
  const variant = design.variants.find((v) => v.id === variantId);
  if (!variant) throw new Error(`Design ${design.id} v${design.version} has no variant ${variantId}`);
  const byId = new Map(catalogue.map((c) => [c.id, c]));
  const orders = new Map<string, PurchaseOrder>();
  const lineKey = new Map<string, PoLine>();

  const sorted = [...variant.bom]
    .filter((b) => Number.isFinite(b.qty) && b.qty > 0)
    .sort((a, b) => CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category]);

  for (const b of sorted) {
    const item = b.catalogueItemId ? byId.get(b.catalogueItemId) : undefined;
    const supplier = (item?.supplier ?? item?.costSource?.supplier ?? "").trim() || UNKNOWN_SUPPLIER;
    let po = orders.get(supplier);
    if (!po) {
      po = {
        id: makeId(),
        projectId,
        supplier,
        status: "required",
        destination: "customer",
        lines: [],
        expectedTotalPence: 0,
        shippingPence: 0,
        mediaIds: [],
        history: [],
        designId: design.id,
        designVersion: design.version,
      };
      orders.set(supplier, po);
    }
    const key = `${supplier}|${b.catalogueItemId ?? b.sku}|${b.category}`;
    const qty = Math.ceil(b.qty);
    const existing = lineKey.get(key);
    if (existing) {
      existing.qty += qty;
      continue;
    }
    const line: PoLine = {
      id: makeId(),
      ...(b.catalogueItemId ? { catalogueItemId: b.catalogueItemId } : {}),
      label: item?.label ?? b.label,
      qty,
      unitCostPence: item ? item.costPence : null,
      receivedQty: 0,
      inspectedQty: 0,
      damagedQty: 0,
      serials: [],
      required: b.category !== "consumables",
      sku: b.sku,
      ...(b.unit ?? item?.unit ? { unit: b.unit ?? item?.unit } : {}),
      category: b.category,
    };
    po.lines.push(line);
    lineKey.set(key, line);
  }

  // Van stock rides along on a supplier's order for the real kit, never as an order of its own.
  return [...orders.values()]
    .filter((po) => po.lines.some((l) => l.required))
    .map((po) => ({ ...po, expectedTotalPence: poTotals(po).expectedPence }));
}

/* ------------------------------------------------------------------ */
/* Moving an order on                                                   */
/* ------------------------------------------------------------------ */

/** The fields a person may change on an order (status moves through advancePo). */
const EDITABLE: (keyof PurchaseOrder)[] = [
  "supplier",
  "reference",
  "destination",
  "eta",
  "trackingRef",
  "orderedOn",
  "deliveredAt",
  "inspectedAt",
  "notes",
  "shippingPence",
  "actualTotalPence",
  "mediaIds",
  "lines",
  "leadDays",
];

function applyPatch(po: PurchaseOrder, patch: Partial<PurchaseOrder> | undefined): PurchaseOrder {
  const next = clone(po);
  if (!patch) return next;
  for (const key of EDITABLE) {
    if (!(key in patch)) continue;
    const v = patch[key];
    if (v === undefined || v === "") delete (next as unknown as Record<string, unknown>)[key];
    else (next as unknown as Record<string, unknown>)[key] = clone(v);
  }
  return next;
}

function validate(po: PurchaseOrder): string | null {
  if (!po.supplier.trim()) return "Name the supplier.";
  if (!["customer", "storage", "installer", "subcontractor"].includes(po.destination)) return "Where is it being delivered?";
  if (po.eta !== undefined && !isDate(po.eta)) return "The ETA must be a date.";
  if (po.orderedOn !== undefined && !isDate(po.orderedOn)) return "The order date must be a date.";
  if (!Number.isInteger(po.shippingPence) || po.shippingPence < 0) return "Shipping must be whole pence, zero or more.";
  if (po.actualTotalPence !== undefined && (!Number.isInteger(po.actualTotalPence) || po.actualTotalPence < 0)) {
    return "The actual total must be whole pence.";
  }
  if (po.leadDays !== undefined && (!Number.isInteger(po.leadDays) || po.leadDays < 0 || po.leadDays > 120)) {
    return "Lead time is a whole number of working days.";
  }
  for (const l of po.lines) {
    if (!Number.isInteger(l.qty) || l.qty < 1) return `${l.label}: the quantity must be a whole number, 1 or more.`;
    for (const [name, v] of [
      ["received", l.receivedQty],
      ["checked", l.inspectedQty],
      ["damaged", l.damagedQty],
    ] as const) {
      if (!Number.isInteger(v) || v < 0) return `${l.label}: the ${name} quantity must be a whole number.`;
    }
    if (l.receivedQty > l.qty) return `${l.label}: more received (${l.receivedQty}) than ordered (${l.qty}).`;
    if (l.inspectedQty > l.receivedQty) return `${l.label}: more checked (${l.inspectedQty}) than received (${l.receivedQty}).`;
    if (l.damagedQty > l.inspectedQty) return `${l.label}: more damaged (${l.damagedQty}) than checked (${l.inspectedQty}).`;
    if (l.actualUnitCostPence !== undefined && (!Number.isInteger(l.actualUnitCostPence) || l.actualUnitCostPence < 0)) {
      return `${l.label}: the actual unit cost must be whole pence.`;
    }
  }
  return null;
}

const fullyReceived = (po: PurchaseOrder) =>
  po.lines.every((l) => !l.required || l.receivedQty >= poLineEffectiveQty(l));
const fullyChecked = (po: PurchaseOrder) => po.lines.every((l) => l.inspectedQty >= l.receivedQty);

/**
 * Move an order to `to`, as the named person, now. Forward-only (skipping
 * ahead is fine: a supplier that confirms by delivering), except cancel,
 * which is refused once anything has arrived (that's a return: raise an
 * issue). The rules that keep it honest:
 *  * ordered needs a named supplier; confirmed needs the date they gave;
 *  * delivered needs a person and a time, never in the future, with every
 *    required line received (`lines` in the patch, or everything when none
 *    are given: the person is saying it all arrived);
 *  * inspected needs delivery first and every received unit checked.
 */
export function advancePo(
  po: PurchaseOrder,
  to: PoStatus,
  by: string,
  now: string,
  patch?: Partial<PurchaseOrder>,
  note?: string,
): PoResult {
  const fail = (error: string): PoResult => ({ ok: false, error });
  const who = by.trim();
  if (!who) return fail("Who's recording this?");
  if (po.status === "cancelled") return fail("This order is cancelled.");
  if (po.status === "inspected" && to !== "inspected") return fail("This order has been checked: it's finished.");
  if (to === po.status) return fail(`This order is already ${PO_STATUS_LABEL[to].toLowerCase()}.`);
  if (to !== "cancelled" && !PO_FLOW.includes(to)) return fail("Unknown status.");

  let next = applyPatch(po, patch);
  const text = note?.trim();

  if (to === "cancelled") {
    if (po.lines.some((l) => l.receivedQty > 0) || statusIndex(po.status) >= statusIndex("delivered")) {
      return fail("Kit has arrived on this order, so it can't be cancelled. Raise an issue to return it.");
    }
    if (!text) return fail("Say why it's cancelled.");
    next.status = "cancelled";
    next.cancelledReason = text;
    next.history.push({ at: now, by: who, note: `Cancelled: ${text}`, status: "cancelled" });
    return { ok: true, po: next };
  }

  if (statusIndex(to) < statusIndex(po.status)) {
    return fail(`Orders only move forward: this one is already ${PO_STATUS_LABEL[po.status].toLowerCase()}.`);
  }

  const today = dateOf(now);
  if (statusIndex(to) >= statusIndex("ordered")) {
    if (!next.supplier.trim() || next.supplier.trim() === UNKNOWN_SUPPLIER) return fail("Name the supplier before ordering.");
    next.orderedOn ??= today;
  }
  if (to === "confirmed" && !next.eta) return fail("Add the delivery date the supplier confirmed.");

  if (to === "delivered" || to === "inspected") {
    if (to === "inspected" && statusIndex(po.status) < statusIndex("delivered")) {
      return fail("Record the delivery before the check.");
    }
    if (to === "delivered") {
      if (!patch?.lines) {
        next.lines = next.lines.map((l) => ({ ...l, receivedQty: Math.max(l.receivedQty, poLineEffectiveQty(l)) }));
      }
      const at = patch?.deliveredAt ?? now;
      if (!Number.isFinite(Date.parse(at))) return fail("When did it arrive?");
      if (Date.parse(at) > Date.parse(now) + 5 * 60_000) return fail("A delivery can't be recorded for a time that hasn't happened yet.");
      if (!fullyReceived(next)) {
        return fail("Not every required line has arrived: record a part delivery instead.");
      }
      next.deliveredAt = at;
      next.deliveredBy = who;
    } else {
      if (!fullyChecked(next)) return fail("Check every unit that arrived, line by line, first.");
      next.inspectedAt = patch?.inspectedAt ?? now;
      next.inspectedBy = who;
    }
  }

  next.status = to;
  const problem = validate(next);
  if (problem) return fail(problem);
  next.history.push({ at: now, by: who, note: text || defaultNote(to, next), status: to });
  next = { ...next, expectedTotalPence: poTotals(next).expectedPence };
  return { ok: true, po: next };
}

function defaultNote(to: PoStatus, po: PurchaseOrder): string {
  switch (to) {
    case "approved":
      return "Approved to order.";
    case "ordered":
      return `Ordered from ${po.supplier}${po.reference ? `, ref ${po.reference}` : ""}.`;
    case "confirmed":
      return `Supplier confirmed delivery for ${po.eta}.`;
    case "dispatched":
      return po.trackingRef ? `Dispatched, tracking ${po.trackingRef}.` : "Dispatched by the supplier.";
    case "delivered":
      return "Delivered: every line arrived.";
    case "inspected":
      return "Checked against the design.";
    default:
      return PO_STATUS_LABEL[to];
  }
}

/** Change an order's details without moving it on; the change goes in its history. */
export function updatePoDetails(po: PurchaseOrder, patch: Partial<PurchaseOrder>, by: string, now: string): PoResult {
  const who = by.trim();
  if (!who) return { ok: false, error: "Who's recording this?" };
  if (po.status === "cancelled") return { ok: false, error: "This order is cancelled." };
  if ("lines" in patch || "deliveredAt" in patch || "inspectedAt" in patch) {
    return { ok: false, error: "Deliveries and checks are recorded on their own." };
  }
  if (po.status !== "required" && po.status !== "approved" && "supplier" in patch && patch.supplier !== po.supplier) {
    return { ok: false, error: "The order has been placed, so the supplier can't change. Cancel it and raise a new one." };
  }
  const next = applyPatch(po, patch);
  const problem = validate(next);
  if (problem) return { ok: false, error: problem };
  const changes = (Object.keys(patch) as (keyof PurchaseOrder)[])
    .filter((k) => JSON.stringify(po[k] ?? null) !== JSON.stringify(next[k] ?? null))
    .map((k) => DETAIL_LABEL[k] ?? String(k));
  if (changes.length === 0) return { ok: false, error: "Nothing changed." };
  next.history.push({ at: now, by: who, note: `Updated ${changes.join(", ")}.` });
  return { ok: true, po: { ...next, expectedTotalPence: poTotals(next).expectedPence } };
}

const DETAIL_LABEL: Partial<Record<keyof PurchaseOrder, string>> = {
  supplier: "supplier",
  reference: "reference",
  destination: "delivery address",
  eta: "ETA",
  trackingRef: "tracking",
  orderedOn: "order date",
  notes: "notes",
  shippingPence: "shipping",
  actualTotalPence: "actual total",
  mediaIds: "photos",
  leadDays: "lead time",
};

/**
 * Record what arrived (all or part of the order), by a named person at a
 * time that has happened. When every required line is in, the order becomes
 * delivered; until then it keeps its status and the part delivery is in
 * its history. Quantities are what arrived in THIS delivery.
 */
export function recordPoDelivery(
  po: PurchaseOrder,
  input: { by: string; at?: string; received: { lineId: string; qty: number }[]; note?: string; mediaIds?: string[] },
  now: string,
): PoResult {
  const fail = (error: string): PoResult => ({ ok: false, error });
  const who = input.by.trim();
  if (!who) return fail("Who took the delivery?");
  if (po.status === "cancelled") return fail("This order is cancelled.");
  if (statusIndex(po.status) < statusIndex("ordered")) return fail("Mark the order as placed before recording a delivery.");
  if (statusIndex(po.status) >= statusIndex("delivered")) return fail("Everything on this order is already delivered.");
  const at = input.at ?? now;
  if (!Number.isFinite(Date.parse(at))) return fail("When did it arrive?");
  if (Date.parse(at) > Date.parse(now) + 5 * 60_000) return fail("A delivery can't be recorded for a time that hasn't happened yet.");

  const next = clone(po);
  let units = 0;
  for (const r of input.received) {
    const line = next.lines.find((l) => l.id === r.lineId);
    if (!line) return fail("That line isn't on this order.");
    if (!Number.isInteger(r.qty) || r.qty < 0) return fail(`${line.label}: arrived must be a whole number.`);
    if (line.receivedQty + r.qty > line.qty) {
      return fail(`${line.label}: that's more than ordered (${line.qty}, ${line.receivedQty} already in).`);
    }
    line.receivedQty += r.qty;
    units += r.qty;
  }
  if (units === 0) return fail("Nothing recorded as arrived.");
  next.mediaIds = [...new Set([...next.mediaIds, ...(input.mediaIds ?? [])])];
  const text = input.note?.trim();
  const complete = fullyReceived(next);
  if (complete) {
    next.status = "delivered";
    next.deliveredAt = at;
    next.deliveredBy = who;
  }
  const summary = next.lines
    .filter((l) => l.required)
    .map((l) => `${l.receivedQty}/${poLineEffectiveQty(l)}`)
    .join(", ");
  next.history.push({
    at: now,
    by: who,
    note: `${complete ? "Delivered" : "Part delivery"} (${units} unit${units === 1 ? "" : "s"}; arrived so far ${summary})${text ? `: ${text}` : "."}`,
    ...(complete ? { status: "delivered" as const } : {}),
  });
  const problem = validate(next);
  if (problem) return fail(problem);
  return { ok: true, po: next };
}

/**
 * Record the check: per line, how many units are good and how many are
 * damaged (totals, replacing what was recorded before), plus serial
 * numbers. Newly damaged units come back so the caller can raise a damage
 * issue. When the order is delivered and every unit that arrived is
 * checked, it becomes inspected.
 */
export function recordPoInspection(
  po: PurchaseOrder,
  input: {
    by: string;
    lines: { lineId: string; goodQty: number; damagedQty: number; serials?: string[] }[];
    note?: string;
    mediaIds?: string[];
  },
  now: string,
): { ok: true; po: PurchaseOrder; newlyDamaged: { lineId: string; label: string; qty: number }[] } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  const who = input.by.trim();
  if (!who) return fail("Who checked it?");
  if (po.status === "cancelled") return fail("This order is cancelled.");
  if (po.status === "inspected") return fail("This order has already been checked.");
  const next = clone(po);
  const newlyDamaged: { lineId: string; label: string; qty: number }[] = [];
  for (const r of input.lines) {
    const line = next.lines.find((l) => l.id === r.lineId);
    if (!line) return fail("That line isn't on this order.");
    if (![r.goodQty, r.damagedQty].every((n) => Number.isInteger(n) && n >= 0)) {
      return fail(`${line.label}: quantities must be whole numbers.`);
    }
    const checked = r.goodQty + r.damagedQty;
    if (checked > line.receivedQty) return fail(`${line.label}: ${checked} checked, but only ${line.receivedQty} arrived.`);
    if (r.damagedQty > line.damagedQty) newlyDamaged.push({ lineId: line.id, label: line.label, qty: r.damagedQty - line.damagedQty });
    if (r.damagedQty < (line.replacedQty ?? 0)) {
      return fail(`${line.label}: a replacement order already covers ${line.replacedQty} damaged.`);
    }
    line.inspectedQty = checked;
    line.damagedQty = r.damagedQty;
    if (r.serials) {
      line.serials = [...new Set(r.serials.map((s) => s.trim()).filter(Boolean))].slice(0, 50);
    }
  }
  next.mediaIds = [...new Set([...next.mediaIds, ...(input.mediaIds ?? [])])];
  const text = input.note?.trim();
  const complete = next.status === "delivered" && fullyChecked(next);
  if (complete) {
    next.status = "inspected";
    next.inspectedAt = now;
    next.inspectedBy = who;
  }
  const damaged = newlyDamaged.reduce((s, d) => s + d.qty, 0);
  next.history.push({
    at: now,
    by: who,
    note: `${complete ? "Checked against the design" : "Partly checked"}${damaged ? `; ${damaged} damaged` : ""}${text ? `: ${text}` : "."}`,
    ...(complete ? { status: "inspected" as const } : {}),
  });
  const problem = validate(next);
  if (problem) return fail(problem);
  return { ok: true, po: next, newlyDamaged };
}

/**
 * Order replacements for damaged units on one line: a new order (same
 * supplier, same delivery address) starting at required, and the original
 * line marked as covered, so it no longer holds the kit up.
 */
export function raiseReplacement(
  po: PurchaseOrder,
  lineId: string,
  qty: number,
  makeId: () => string,
  by: string,
  now: string,
): { ok: true; po: PurchaseOrder; replacement: PurchaseOrder } | { ok: false; error: string } {
  const who = by.trim();
  if (!who) return { ok: false, error: "Who's ordering the replacement?" };
  const line = po.lines.find((l) => l.id === lineId);
  if (!line) return { ok: false, error: "That line isn't on this order." };
  const open = line.damagedQty - (line.replacedQty ?? 0);
  if (!Number.isInteger(qty) || qty < 1) return { ok: false, error: "Replace at least one unit." };
  if (qty > open) {
    return { ok: false, error: open > 0 ? `Only ${open} damaged unit${open === 1 ? " is" : "s are"} not yet replaced.` : "Nothing on this line is recorded as damaged." };
  }
  const original = clone(po);
  const target = original.lines.find((l) => l.id === lineId)!;
  target.replacedQty = (target.replacedQty ?? 0) + qty;
  const replacement: PurchaseOrder = {
    id: makeId(),
    projectId: po.projectId,
    supplier: po.supplier,
    status: "required",
    destination: po.destination,
    lines: [
      {
        id: makeId(),
        ...(line.catalogueItemId ? { catalogueItemId: line.catalogueItemId } : {}),
        label: line.label,
        qty,
        unitCostPence: line.unitCostPence,
        receivedQty: 0,
        inspectedQty: 0,
        damagedQty: 0,
        serials: [],
        required: true,
        ...(line.sku ? { sku: line.sku } : {}),
        ...(line.unit ? { unit: line.unit } : {}),
        ...(line.category ? { category: line.category } : {}),
        replacesLineId: line.id,
      },
    ],
    expectedTotalPence: (line.unitCostPence ?? 0) * qty,
    shippingPence: 0,
    mediaIds: [],
    history: [
      {
        at: now,
        by: who,
        note: `Replacement for ${qty} damaged ${line.label}${po.reference ? ` (order ${po.reference})` : ""}.`,
        status: "required",
      },
    ],
    replacementFor: po.id,
    ...(po.leadDays !== undefined ? { leadDays: po.leadDays } : {}),
    ...(po.designId ? { designId: po.designId } : {}),
    ...(po.designVersion !== undefined ? { designVersion: po.designVersion } : {}),
  };
  original.history.push({ at: now, by: who, note: `Replacement ordered for ${qty} damaged ${line.label}.` });
  return { ok: true, po: original, replacement };
}

/* ------------------------------------------------------------------ */
/* Kit summary                                                          */
/* ------------------------------------------------------------------ */

const KIT_RANK: Record<PoStatus, Project["kit"]["status"]> = {
  required: "not-ordered",
  approved: "not-ordered",
  ordered: "ordered",
  confirmed: "confirmed",
  dispatched: "dispatched",
  delivered: "dispatched", // an order "delivered" that still owes required units can only mean part of it
  inspected: "dispatched",
  cancelled: "not-ordered",
};
const KIT_ORDER: Project["kit"]["status"][] = ["not-ordered", "ordered", "confirmed", "dispatched", "delivered", "inspected"];

/**
 * Where the kit stands across every live order, for readiness and the
 * customer. Conservative: the project's kit status is the least advanced
 * order still owing required units; "delivered" only once every required
 * line has been recorded as arrived, "inspected" only once every one has
 * been checked good. `expectedDate` is the last ETA among orders still to
 * arrive, and only when every one of them has an ETA. `shortages` counts
 * required lines still to come once anything has arrived. `damaged` counts
 * damaged units no replacement order covers yet.
 */
export function kitSummary(pos: PurchaseOrder[]): {
  requiredLines: number;
  deliveredLines: number;
  inspectedLines: number;
  damaged: number;
  status: Project["kit"]["status"];
  expectedDate?: string;
  shortages: number;
} {
  const live = pos.filter((p) => p.status !== "cancelled");
  const required = live.flatMap((po) =>
    po.lines.filter((l) => l.required && poLineEffectiveQty(l) > 0).map((l) => ({ po, l })),
  );
  const delivered = required.filter(({ l }) => l.receivedQty >= poLineEffectiveQty(l));
  const inspected = required.filter(({ l }) => poLineGoodQty(l) >= poLineEffectiveQty(l));
  const damaged = live.flatMap((po) => po.lines).reduce((sum, l) => sum + Math.max(0, l.damagedQty - (l.replacedQty ?? 0)), 0);
  const anyArrived = live.some((po) => po.lines.some((l) => l.receivedQty > 0));
  const owing = live.filter((po) => po.lines.some((l) => l.required && poLineEffectiveQty(l) > 0 && l.receivedQty < poLineEffectiveQty(l)));

  let status: Project["kit"]["status"];
  if (required.length === 0) status = "not-ordered";
  else if (inspected.length === required.length) status = "inspected";
  else if (delivered.length === required.length) status = "delivered";
  else {
    status = owing.reduce<Project["kit"]["status"]>(
      (lowest, po) => (KIT_ORDER.indexOf(KIT_RANK[po.status]) < KIT_ORDER.indexOf(lowest) ? KIT_RANK[po.status] : lowest),
      "dispatched",
    );
  }

  const etas = owing.map((po) => po.eta);
  const expectedDate =
    owing.length > 0 && etas.every((e): e is string => isDate(e))
      ? etas.map(dateOf).sort().at(-1)
      : undefined;

  return {
    requiredLines: required.length,
    deliveredLines: delivered.length,
    inspectedLines: inspected.length,
    damaged,
    status,
    ...(expectedDate ? { expectedDate } : {}),
    shortages: anyArrived ? required.length - delivered.length : 0,
  };
}

/* ------------------------------------------------------------------ */
/* When to order                                                        */
/* ------------------------------------------------------------------ */

const MON_FRI = [1, 2, 3, 4, 5];

function addDays(iso: string, days: number): string {
  const d = new Date(`${dateOf(iso)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isWorkingDay(iso: string, workingDays: number[]): boolean {
  const dow = new Date(`${dateOf(iso)}T12:00:00Z`).getUTCDay();
  return (workingDays.length ? workingDays : MON_FRI).includes(dow === 0 ? 7 : dow);
}

/** n working days before (negative n) or after a date. The date itself doesn't count. */
export function shiftWorkingDays(iso: string, n: number, workingDays: number[] = MON_FRI): string {
  let d = dateOf(iso);
  const step = n < 0 ? -1 : 1;
  for (let left = Math.abs(Math.trunc(n)); left > 0; ) {
    d = addDays(d, step);
    if (isWorkingDay(d, workingDays)) left -= 1;
  }
  return d;
}

/** The kit needs to be on site this day: install day 1 less the buffer, in working days. */
export function needOnSiteBy(installStart: string, workingDays: number[] = MON_FRI): string {
  return shiftWorkingDays(installStart, -KIT_ON_SITE_BUFFER_DAYS, workingDays);
}

/** The last day to place an order that takes `leadDays` working days to arrive. */
export function orderByDate(needOnSite: string, leadDays: number = DEFAULT_SUPPLIER_LEAD_DAYS, workingDays: number[] = MON_FRI): string {
  return shiftWorkingDays(needOnSite, -Math.max(0, Math.round(leadDays)), workingDays);
}

export type PoFlag = "order-late" | "order-soon" | "no-eta" | "eta-after-need" | "eta-passed" | "delivery-late";

export const PO_FLAG_TEXT: Record<PoFlag, string> = {
  "order-late": "Should have been ordered by now",
  "order-soon": "Order within the next two working days",
  "no-eta": "No delivery date from the supplier yet",
  "eta-after-need": "Due after it's needed on site",
  "eta-passed": "ETA has passed: not recorded as delivered",
  "delivery-late": "Not here, and it's needed on site already",
};

/** Late or at-risk flags for one order against the install date. No install date: only the ETA checks. */
export function poSchedule(
  po: PurchaseOrder,
  installStart: string | undefined,
  todayIso: string,
  workingDays: number[] = MON_FRI,
): { needOnSiteBy?: string; orderBy?: string; flags: PoFlag[] } {
  const today = dateOf(todayIso);
  const flags: PoFlag[] = [];
  // Nothing on it holds the install (van stock only): no deadlines to chase.
  if (!po.lines.some((l) => l.required && poLineEffectiveQty(l) > 0)) return { flags };
  const done = po.status === "delivered" || po.status === "inspected" || po.status === "cancelled";
  const placed = statusIndex(po.status) >= statusIndex("ordered") && !done;
  const eta = po.eta && isDate(po.eta) ? dateOf(po.eta) : undefined;
  if (placed && !eta) flags.push("no-eta");
  if (placed && eta && eta < today) flags.push("eta-passed");
  if (!installStart || !isDate(installStart)) return { flags };

  const need = needOnSiteBy(installStart, workingDays);
  const orderBy = orderByDate(need, po.leadDays ?? DEFAULT_SUPPLIER_LEAD_DAYS, workingDays);
  if (!done) {
    if (po.status === "required" || po.status === "approved") {
      if (today > orderBy) flags.push("order-late");
      else if (shiftWorkingDays(today, 2, workingDays) >= orderBy) flags.push("order-soon");
    }
    if (placed && eta && eta > need) flags.push("eta-after-need");
    if (today > need) flags.push("delivery-late");
  }
  return { needOnSiteBy: need, orderBy, flags };
}

/**
 * The kit line a customer may see, from the summary: only what someone has
 * recorded. Empty until something has arrived; then how much is here.
 */
export function kitCustomerSummary(summary: Pick<ReturnType<typeof kitSummary>, "requiredLines" | "deliveredLines" | "status">): string {
  if (summary.status === "delivered" || summary.status === "inspected" || summary.deliveredLines === 0) return "";
  return `${summary.deliveredLines} of ${summary.requiredLines} items delivered so far`;
}
