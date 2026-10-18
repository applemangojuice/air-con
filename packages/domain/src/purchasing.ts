import type { CatalogueItem } from "./catalogue.ts";
import type { DesignRecord } from "./design-record.ts";
import type { Project } from "./project.ts";

/**
 * Purchasing: purchase orders from the approved design, tracked line by
 * line from required to inspected.
 *
 * Forward-only, except cancel. "Delivered" needs a person to record when it
 * arrived; nothing is delivered because an ETA passed. Partial deliveries
 * are normal, and actual costs feed the pilot margin.
 *
 * Foundation ships the types; F5 owns the logic.
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
}

export interface PurchaseOrder {
  id: string;
  projectId: string;
  supplier: string;
  reference?: string;
  status: PoStatus;
  destination: "customer" | "storage" | "installer" | "subcontractor";
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
}

/** Grouped by supplier, required lines. */
export function posFromDesign(
  design: DesignRecord,
  variantId: string,
  catalogue: CatalogueItem[],
  projectId: string,
  makeId: () => string,
): PurchaseOrder[] {
  throw new Error("not implemented: posFromDesign (F5)");
}

/** Forward-only except cancel; "delivered" needs a deliveredAt recorded by a person. */
export function advancePo(
  po: PurchaseOrder,
  to: PoStatus,
  by: string,
  now: string,
  patch?: Partial<PurchaseOrder>,
): { ok: true; po: PurchaseOrder } | { ok: false; error: string } {
  throw new Error("not implemented: advancePo (F5)");
}

export function kitSummary(pos: PurchaseOrder[]): {
  requiredLines: number;
  deliveredLines: number;
  inspectedLines: number;
  damaged: number;
  status: Project["kit"]["status"];
  expectedDate?: string;
  shortages: number;
} {
  throw new Error("not implemented: kitSummary (F5)");
}
