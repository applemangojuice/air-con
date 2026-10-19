"use server";

import { z } from "zod";
import { PO_FLOW, type PoStatus, type PurchaseOrder, type StaffMember } from "@aircon/domain";
import { requireProjectAccess, requireStaff } from "@/lib/auth/server";
import {
  advanceOrder,
  generatePurchaseOrders,
  orderReplacement,
  recordActualCosts,
  recordDelivery,
  recordInspection,
  updateOrder,
} from "@/lib/purchasing-server";
import { isUuid } from "@/lib/repo/base";
import { invalid, londonLocalToIso, poundsToPence, text, toState, type ActionState } from "../booking/_f5/action-state";

/**
 * Kit actions (purchasing.edit): raise orders from the design, move them on,
 * record deliveries and the kit check, order replacements. Every one checks
 * the session and the project itself and validates its input.
 */

async function guard(projectId: string): Promise<StaffMember | null> {
  const staff = await requireStaff("purchasing.edit");
  if (!isUuid(projectId)) return null;
  const access = await requireProjectAccess(projectId, { perm: "purchasing.edit" });
  return access?.kind === "staff" ? staff : null;
}

const NOT_FOUND: ActionState = { error: "That project isn't available to you." };
const poId = (form: FormData) => z.string().uuid().safeParse(form.get("poId"));
const dateField = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]);
const mediaIds = (form: FormData) => form.getAll("mediaId").map(String).filter((v) => isUuid(v)).slice(0, 20);

export async function generateAction(projectId: string, _prev: ActionState, _form: FormData): Promise<ActionState> {
  const staff = await guard(projectId);
  if (!staff) return NOT_FOUND;
  return toState(await generatePurchaseOrders(projectId, staff), "Purchase orders raised.");
}

export async function advanceAction(projectId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const staff = await guard(projectId);
  if (!staff) return NOT_FOUND;
  const id = poId(form);
  const to = z.enum(PO_FLOW as [PoStatus, ...PoStatus[]]).safeParse(form.get("to"));
  const eta = dateField.safeParse(form.get("eta") ?? "");
  if (!id.success || !to.success || !eta.success) return invalid();
  const patch: Partial<PurchaseOrder> = {};
  const reference = text(form, "reference", 80);
  const tracking = text(form, "trackingRef", 120);
  if (reference) patch.reference = reference;
  if (tracking) patch.trackingRef = tracking;
  if (eta.data) patch.eta = eta.data;
  // Placing it before a "before-kit-order" deposit is paid: an admin, with a reason (the server checks both).
  const depositOverride = text(form, "depositOverride", 300);
  return toState(
    await advanceOrder(projectId, id.data, to.data, staff, patch, text(form, "note", 500), depositOverride ? { depositOverride } : {}),
    "Order updated.",
  );
}

export async function cancelAction(projectId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const staff = await guard(projectId);
  if (!staff) return NOT_FOUND;
  const id = poId(form);
  if (!id.success) return invalid();
  const reason = text(form, "reason", 500);
  if (!reason) return invalid("Say why it's cancelled.");
  return toState(await advanceOrder(projectId, id.data, "cancelled", staff, undefined, reason), "Order cancelled.");
}

const detailsSchema = z.object({
  supplier: z.string().trim().min(1).max(120),
  reference: z.string().trim().max(80),
  destination: z.enum(["customer", "storage", "installer", "subcontractor"]),
  eta: dateField,
  trackingRef: z.string().trim().max(120),
  leadDays: z.union([z.literal(""), z.coerce.number().int().min(0).max(120)]),
  notes: z.string().trim().max(1000),
});

export async function updateAction(projectId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const staff = await guard(projectId);
  if (!staff) return NOT_FOUND;
  const id = poId(form);
  const parsed = detailsSchema.safeParse({
    supplier: form.get("supplier") ?? "",
    reference: form.get("reference") ?? "",
    destination: form.get("destination"),
    eta: form.get("eta") ?? "",
    trackingRef: form.get("trackingRef") ?? "",
    leadDays: form.get("leadDays") ?? "",
    notes: form.get("notes") ?? "",
  });
  if (!id.success || !parsed.success) return invalid("Check the supplier, dates and numbers.");
  const shipping = String(form.get("shipping") ?? "").trim();
  const shippingPence = shipping ? poundsToPence(shipping) : 0;
  if (shippingPence === null) return invalid("Shipping must be an amount in pounds.");
  const d = parsed.data;
  const patch: Partial<PurchaseOrder> = {
    supplier: d.supplier,
    reference: d.reference || undefined,
    destination: d.destination,
    eta: d.eta || undefined,
    trackingRef: d.trackingRef || undefined,
    leadDays: d.leadDays === "" ? undefined : d.leadDays,
    notes: d.notes || undefined,
    shippingPence,
  };
  return toState(await updateOrder(projectId, id.data, patch, staff), "Order details saved.");
}

/**
 * What the supplier actually charged, per line (ex VAT, per unit). A blank
 * box clears the line back to its expected cost; only lines whose box was
 * on the form are touched.
 */
export async function actualCostsAction(projectId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const staff = await guard(projectId);
  if (!staff) return NOT_FOUND;
  const id = poId(form);
  if (!id.success) return invalid();
  const lines: { lineId: string; actualUnitCostPence: number | null }[] = [];
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("actual:")) continue;
    const lineId = key.slice(7);
    if (!lineId || lineId.length > 64) return invalid();
    const raw = String(value).trim();
    if (!raw) {
      lines.push({ lineId, actualUnitCostPence: null });
      continue;
    }
    const pence = poundsToPence(raw);
    if (pence === null) return invalid("Actual costs are amounts in pounds, like 450 or 12.50.");
    lines.push({ lineId, actualUnitCostPence: pence });
  }
  if (lines.length === 0 || lines.length > 100) return invalid("Nothing to save on this order.");
  return toState(await recordActualCosts(projectId, id.data, lines, staff), "Actual costs saved.");
}

export async function deliveryAction(projectId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const staff = await guard(projectId);
  if (!staff) return NOT_FOUND;
  const id = poId(form);
  if (!id.success) return invalid();
  const at = londonLocalToIso(String(form.get("at") ?? ""));
  if (!at) return invalid("When did it arrive? Give the date and time.");
  const by = text(form, "by", 120);
  if (!by) return invalid("Who took the delivery?");
  const received: { lineId: string; qty: number }[] = [];
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("qty:")) continue;
    const qty = Number(String(value).trim() || "0");
    if (!Number.isInteger(qty) || qty < 0 || qty > 999) return invalid("Quantities are whole numbers.");
    if (qty > 0) received.push({ lineId: key.slice(4), qty });
  }
  return toState(
    await recordDelivery(projectId, id.data, { by, at, received, note: text(form, "note", 500), mediaIds: mediaIds(form) }, staff),
    "Delivery recorded.",
  );
}

export async function inspectionAction(projectId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const staff = await guard(projectId);
  if (!staff) return NOT_FOUND;
  const id = poId(form);
  if (!id.success) return invalid();
  const lineIds = form.getAll("lineId").map(String).slice(0, 100);
  const lines: { lineId: string; goodQty: number; damagedQty: number; serials: string[] }[] = [];
  for (const lineId of lineIds) {
    const good = Number(String(form.get(`good:${lineId}`) ?? "0").trim() || "0");
    const damaged = Number(String(form.get(`damaged:${lineId}`) ?? "0").trim() || "0");
    if (![good, damaged].every((n) => Number.isInteger(n) && n >= 0 && n <= 999)) return invalid("Quantities are whole numbers.");
    const serials = String(form.get(`serials:${lineId}`) ?? "")
      .split(/[\n,;]+/)
      .map((s) => s.trim().slice(0, 64))
      .filter(Boolean);
    lines.push({ lineId, goodQty: good, damagedQty: damaged, serials });
  }
  if (lines.length === 0) return invalid("Nothing to check on this order yet.");
  return toState(
    await recordInspection(projectId, id.data, { lines, note: text(form, "note", 500), mediaIds: mediaIds(form) }, staff),
    "Kit check saved.",
  );
}

export async function replacementAction(projectId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const staff = await guard(projectId);
  if (!staff) return NOT_FOUND;
  const id = poId(form);
  const lineId = z.string().min(1).max(64).safeParse(form.get("lineId"));
  const qty = z.coerce.number().int().min(1).max(99).safeParse(form.get("qty"));
  if (!id.success || !lineId.success || !qty.success) return invalid("How many need replacing?");
  return toState(await orderReplacement(projectId, id.data, lineId.data, qty.data, staff), "Replacement order raised.");
}
