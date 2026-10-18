import type { CatalogueItem, CompatibilityRule, EquipmentSpecs } from "@aircon/domain";

/**
 * The DEMO catalogue the demo pilots' designs and proposals point at.
 * Fictional manufacturer, fictional models, plausible numbers. Every id
 * starts "demo-", every label ends "(DEMO)", and every item is provisional:
 * nothing here is a real product or a real price.
 */

const SOURCE = [{ url: "https://example.com/demo-catalogue", title: "DEMO catalogue (fictional)" }];
const COST_SOURCE = { supplier: "DEMO Aircon Supplies", note: "DEMO price, not a real quote", vatIncluded: true };

type Specs = Partial<EquipmentSpecs>;

function item(over: Partial<CatalogueItem> & Pick<CatalogueItem, "id" | "kind" | "label" | "costPence">): CatalogueItem {
  return {
    status: "available",
    confidence: "provisional",
    sources: SOURCE,
    costSource: COST_SOURCE,
    supplier: "DEMO Aircon Supplies",
    active: true,
    notes: "DEMO data for the demo pilots. Not a real product.",
    ...over,
  };
}

const indoorSpecs = (kw: number, heatKw: number, lowDb: number, w: number): Specs => ({
  coolingKw: kw,
  heatingKw: heatKw,
  seer: 8.5,
  scop: 4.6,
  soundPressureLowDb: lowDb,
  soundPressureHighDb: lowDb + 20,
  dimensionsMm: { w, h: 295, d: 230 },
  refrigerant: "R32",
  liquidPipeMm: 6.35,
  gasPipeMm: kw > 3 ? 12.7 : 9.52,
  wifi: "Built in (DEMO app)",
});

const outdoorSpecs = (kw: number, precharged: number, maxPipe: number, powerDb: number): Specs => ({
  coolingKw: kw,
  heatingKw: Math.round(kw * 1.25 * 10) / 10,
  refrigerant: "R32",
  soundPowerDb: powerDb,
  maxPipeM: maxPipe,
  maxHeightDiffM: 15,
  prechargedPipeM: precharged,
  additionalChargeGPerM: 20,
  powerSupply: "230 V single phase",
  recommendedBreakerA: kw > 4 ? 20 : 16,
  dimensionsMm: { w: 800, h: 550, d: 285 },
});

export const DEMO_CATALOGUE_ITEMS: CatalogueItem[] = [
  // Indoor units: standard (Breeze) and quiet (Whisper).
  item({ id: "demo-ind-brz25", kind: "indoor", manufacturer: "DEMO Aircon Co", series: "Breeze", model: "DM-BRZ25", label: "Breeze 25 wall unit (DEMO)", tier: "standard", multiSplitCapable: true, specs: indoorSpecs(2.5, 3.2, 21, 800), costPence: 38_000, customerBlurb: "Neat, efficient and quiet at night: 21 dB on its lowest setting.", category: "wall" }),
  item({ id: "demo-ind-brz35", kind: "indoor", manufacturer: "DEMO Aircon Co", series: "Breeze", model: "DM-BRZ35", label: "Breeze 35 wall unit (DEMO)", tier: "standard", multiSplitCapable: true, specs: indoorSpecs(3.5, 4.0, 22, 890), costPence: 45_000, customerBlurb: "The living-room size: cools a sunny room fast, heats it on chilly evenings.", category: "wall" }),
  item({ id: "demo-ind-whs25", kind: "indoor", manufacturer: "DEMO Aircon Co", series: "Whisper", model: "DM-WHS25", label: "Whisper 25 wall unit (DEMO)", tier: "premium", multiSplitCapable: true, specs: indoorSpecs(2.5, 3.4, 19, 800), costPence: 62_000, customerBlurb: "Whisper-quiet at 19 dB, with app control and an air purifying filter.", category: "wall" }),
  item({ id: "demo-ind-whs35", kind: "indoor", manufacturer: "DEMO Aircon Co", series: "Whisper", model: "DM-WHS35", label: "Whisper 35 wall unit (DEMO)", tier: "premium", multiSplitCapable: true, specs: indoorSpecs(3.5, 4.2, 19, 890), costPence: 70_000, customerBlurb: "Our quietest larger unit: 19 dB, app control, purifying filter.", category: "wall" }),

  // Outdoor units: single splits, and two multi-splits.
  item({ id: "demo-out-brz25", kind: "outdoor", manufacturer: "DEMO Aircon Co", series: "Breeze", model: "DM-BRZ25-O", label: "Breeze 25 outdoor unit (DEMO)", tier: "standard", ports: 1, pairedWith: "demo-ind-brz25", specs: outdoorSpecs(2.5, 15, 20, 59), costPence: 52_000 }),
  item({ id: "demo-out-brz35", kind: "outdoor", manufacturer: "DEMO Aircon Co", series: "Breeze", model: "DM-BRZ35-O", label: "Breeze 35 outdoor unit (DEMO)", tier: "standard", ports: 1, pairedWith: "demo-ind-brz35", specs: outdoorSpecs(3.5, 15, 20, 61), costPence: 60_000 }),
  item({ id: "demo-out-whs25", kind: "outdoor", manufacturer: "DEMO Aircon Co", series: "Whisper", model: "DM-WHS25-O", label: "Whisper 25 outdoor unit (DEMO)", tier: "premium", ports: 1, pairedWith: "demo-ind-whs25", specs: outdoorSpecs(2.5, 15, 20, 56), costPence: 66_000 }),
  item({ id: "demo-out-whs35", kind: "outdoor", manufacturer: "DEMO Aircon Co", series: "Whisper", model: "DM-WHS35-O", label: "Whisper 35 outdoor unit (DEMO)", tier: "premium", ports: 1, pairedWith: "demo-ind-whs35", specs: outdoorSpecs(3.5, 15, 20, 57), costPence: 74_000 }),
  item({ id: "demo-out-duo50", kind: "outdoor", manufacturer: "DEMO Aircon Co", series: "Duo", model: "DM-DUO50", label: "Duo 50 two-room outdoor unit (DEMO)", tier: "standard", multiSplitCapable: true, ports: 2, specs: outdoorSpecs(5.0, 20, 30, 62), costPence: 112_000 }),
  item({ id: "demo-out-trio52", kind: "outdoor", manufacturer: "DEMO Aircon Co", series: "Trio", model: "DM-TRIO52", label: "Trio 52 three-room outdoor unit (DEMO)", tier: "standard", multiSplitCapable: true, ports: 3, specs: outdoorSpecs(5.2, 30, 45, 63), costPence: 145_000 }),

  // Materials.
  item({ id: "demo-mat-lineset", kind: "material", label: "Insulated copper line set, 1/4 + 3/8 (DEMO)", unit: "m", category: "pipework", costPence: 900, supplier: "DEMO Trade Counter" }),
  item({ id: "demo-mat-trunking", kind: "material", label: "Line-set trunking, 2 m length (DEMO)", unit: "length", category: "pipework", costPence: 1_200, supplier: "DEMO Trade Counter" }),
  item({ id: "demo-mat-feet", kind: "material", label: "Ground mounting feet + anti-vibration pads (DEMO)", unit: "set", category: "mounting", costPence: 4_500, supplier: "DEMO Trade Counter" }),
  item({ id: "demo-mat-bracket", kind: "material", label: "Galvanised outdoor wall bracket (DEMO)", unit: "set", category: "mounting", costPence: 5_500, supplier: "DEMO Trade Counter" }),
  item({ id: "demo-mat-cable", kind: "material", label: "2.5 mm² twin and earth (DEMO)", unit: "m", category: "electrical", costPence: 180, supplier: "DEMO Trade Counter" }),
  item({ id: "demo-mat-rcbo", kind: "material", label: "16 A Type C RCBO (DEMO)", unit: "each", category: "electrical", costPence: 2_200, supplier: "DEMO Trade Counter" }),
  item({ id: "demo-mat-isolator", kind: "material", label: "20 A rotary isolator, IP65 (DEMO)", unit: "each", category: "electrical", costPence: 1_800, supplier: "DEMO Trade Counter" }),
  item({ id: "demo-mat-condensate", kind: "material", label: "Condensate hose and fittings (DEMO)", unit: "kit", category: "drainage", costPence: 1_500, supplier: "DEMO Trade Counter" }),
  item({ id: "demo-mat-sleeve", kind: "material", label: "Wall sleeve and fire-stop (DEMO)", unit: "each", category: "pipework", costPence: 600, supplier: "DEMO Trade Counter" }),
];

export const DEMO_COMPATIBILITY_RULES: CompatibilityRule[] = [
  {
    id: "demo-compat-duo50",
    outdoorModel: "DM-DUO50",
    maxIndoorUnits: 2,
    connectableIndoorSeries: ["Breeze", "Whisper"],
    connectableIndoorModels: ["DM-BRZ25", "DM-BRZ35", "DM-WHS25", "DM-WHS35"],
    minConnectedKw: 4.0,
    maxConnectedKw: 7.0,
    maxTotalPipeM: 30,
    maxPipePerRoomM: 20,
    source: { url: "https://example.com/demo-duo50-combinations", title: "DEMO combination table (fictional)" },
    confidence: "verified",
  },
  {
    id: "demo-compat-trio52",
    outdoorModel: "DM-TRIO52",
    maxIndoorUnits: 3,
    connectableIndoorSeries: ["Breeze", "Whisper"],
    connectableIndoorModels: ["DM-BRZ25", "DM-BRZ35", "DM-WHS25", "DM-WHS35"],
    minConnectedKw: 5.0,
    maxConnectedKw: 8.5,
    maxTotalPipeM: 45,
    maxPipePerRoomM: 20,
    source: { url: "https://example.com/demo-trio52-combinations", title: "DEMO combination table (fictional)" },
    confidence: "verified",
  },
];

const BY_ID = new Map(DEMO_CATALOGUE_ITEMS.map((i) => [i.id, i]));

/** A DEMO catalogue item by id; throws on a typo, so the seed can't reference something that isn't there. */
export function demoItem(id: string): CatalogueItem {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`demo catalogue: no item ${id}`);
  return found;
}
