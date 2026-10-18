/**
 * The equipment and materials catalogue, plus verified compatibility rules.
 *
 * Every item carries where its numbers came from and how sure we are:
 * `verified` (checked against a manufacturer source), `provisional`
 * (plausible, needs checking) or `stale`. Provisional items can be designed
 * with, but are labelled as such. Multi-split combinations are only allowed
 * when a compatibility rule says so; nothing is guessed.
 *
 * Foundation ships the types; F3 owns the logic and the demo data.
 */

export type CatalogueKind = "indoor" | "outdoor" | "material" | "labour" | "tool" | "service";

export interface EquipmentSpecs {
  coolingKw: number | null;
  heatingKw: number | null;
  seer: number | null;
  scop: number | null;
  energyClassCooling: string | null;
  energyClassHeating: string | null;
  soundPressureLowDb: number | null;
  soundPressureHighDb: number | null;
  soundPowerDb: number | null;
  dimensionsMm: { w: number; h: number; d: number } | null;
  weightKg: number | null;
  refrigerant: string | null;
  liquidPipeMm: number | null;
  gasPipeMm: number | null;
  maxPipeM: number | null;
  maxHeightDiffM: number | null;
  prechargedPipeM: number | null;
  additionalChargeGPerM: number | null;
  powerSupply: string | null;
  recommendedBreakerA: number | null;
  wifi: string | null;
  operatingRangeCoolingC: string | null;
  operatingRangeHeatingC: string | null;
}

export interface CatalogueItem {
  id: string;
  kind: CatalogueKind;
  manufacturer?: string;
  series?: string;
  model?: string;
  label: string;
  tier?: "standard" | "premium";
  multiSplitCapable?: boolean;
  ports?: number | null;
  pairedWith?: string | null;
  specs?: Partial<EquipmentSpecs>;
  unit?: string;
  category?: string;
  customerBlurb?: string;
  costPence: number | null;
  costSource?: { url?: string; supplier?: string; observedAt?: string; vatIncluded?: boolean; note?: string };
  supplier?: string;
  status: "available" | "uncertain" | "discontinued";
  confidence: "verified" | "provisional" | "stale";
  verifiedAt?: string;
  sources: { url: string; title?: string }[];
  warranty?: string | null;
  notes?: string;
  active: boolean;
}

export interface CompatibilityRule {
  id: string;
  outdoorModel: string;
  maxIndoorUnits: number;
  connectableIndoorSeries: string[];
  connectableIndoorModels: string[];
  minConnectedKw: number | null;
  maxConnectedKw: number | null;
  maxTotalPipeM: number | null;
  maxPipePerRoomM: number | null;
  source: { url: string; title?: string } | null;
  confidence: "verified" | "provisional";
}

export interface CombinationCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validateCombination(
  rule: CompatibilityRule | undefined,
  outdoor: CatalogueItem,
  indoors: CatalogueItem[],
  pipeRunsM: number[],
): CombinationCheck {
  throw new Error("not implemented: validateCombination (F3)");
}

export function singlePairFor(indoor: CatalogueItem, catalogue: CatalogueItem[]): CatalogueItem | undefined {
  throw new Error("not implemented: singlePairFor (F3)");
}

export function catalogueToCsv(items: CatalogueItem[]): string {
  throw new Error("not implemented: catalogueToCsv (F3)");
}

export function catalogueFromCsv(csv: string): { items: CatalogueItem[]; errors: string[] } {
  throw new Error("not implemented: catalogueFromCsv (F3)");
}

/** Provisional items may be designed with but are labelled. */
export function isCustomerSafe(item: CatalogueItem): boolean {
  throw new Error("not implemented: isCustomerSafe (F3)");
}

/** Fictional-but-plausible DEMO-labelled items for demo mode and tests. */
export const DEMO_CATALOGUE: CatalogueItem[] = []; // F3: replace
export const DEMO_COMPATIBILITY: CompatibilityRule[] = []; // F3: replace
