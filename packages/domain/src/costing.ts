import type { CatalogueItem } from "./catalogue.ts";
import type { DesignVariant } from "./design-record.ts";
import type { PilotSettings, TaxCodeId } from "./settings.ts";
import type { Survey } from "./types.ts";

/**
 * Costing: what a design costs us, and what we charge for it.
 *
 * Two numbers, kept apart on purpose. The list price is the pricing
 * engine re-run on the surveyed design (so any discount is off a genuine
 * reference price). The cost build-up is catalogue costs plus labour,
 * subcontract, access, delivery, contingency and overhead. Margin is the
 * gap, before and after discount, and a proposal below the minimum margin
 * can't issue without an override. All integer pence.
 *
 * Foundation ships the types; F4 owns the logic.
 */

export type CostCategory =
  | "equipment"
  | "materials"
  | "labour"
  | "subcontract"
  | "access"
  | "delivery"
  | "consumables"
  | "contingency"
  | "overhead";

export interface CostLine {
  id: string;
  category: CostCategory;
  label: string;
  qty: number;
  unit: string;
  unitCostPence: number | null;
  totalPence: number | null;
  source?: string;
  catalogueItemId?: string;
  verified: boolean;
}

export interface LabourPlan {
  crewSize: number;
  installerDays: number;
  electricianDays: number;
  techLeadDays: number;
}

export interface PriceLine {
  id: string;
  label: string;
  detail?: string;
  amountPence: number;
  kind: "system" | "room" | "extra" | "discount" | "fee";
}

export interface OptionPricing {
  pricingBasis: "engine" | "cost-plus" | "manual";
  manualReason?: string;
  listNetPence: number;
  discount?: { code: string; label: string; reason: string; amountPence: number };
  netPence: number;
  taxCode: TaxCodeId;
  taxPence: number;
  totalPence: number;
  costPence: number;
  unpricedCostLines: number;
  grossMarginPct: number;
  grossMarginPctBeforeDiscount: number;
  contributionPence: number;
  belowMinMargin: boolean;
}

/** round(generateQuote(survey).totalGbp * 100 / 1.2) */
export function engineListNetPence(survey: Survey): number {
  throw new Error("not implemented: engineListNetPence (F4)");
}

/** Includes unrecoverable input VAT when not VAT registered. */
export function buildCostLines(input: {
  variant: DesignVariant;
  catalogue: CatalogueItem[];
  labour: LabourPlan;
  settings: PilotSettings;
  extras?: CostLine[];
}): CostLine[] {
  throw new Error("not implemented: buildCostLines (F4)");
}

export function priceOption(input: {
  costLines: CostLine[];
  basis: OptionPricing["pricingBasis"];
  engineNetPence: number;
  manualNetPence?: number;
  manualReason?: string;
  discountCode?: string;
  customDiscountPence?: number;
  discountReason?: string;
  settings: PilotSettings;
  tier: "standard" | "premium";
}): OptionPricing {
  throw new Error("not implemented: priceOption (F4)");
}

export function defaultLabourPlan(variant: DesignVariant, settings: PilotSettings): LabourPlan {
  throw new Error("not implemented: defaultLabourPlan (F4)");
}
