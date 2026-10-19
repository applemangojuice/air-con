import assert from "node:assert/strict";
import { test } from "node:test";
import type { CatalogueItem } from "./catalogue.ts";
import {
  PricingError,
  buildCostLines,
  defaultLabourPlan,
  engineListNetPence,
  marginPct,
  markupPct,
  priceOption,
  roundToPound,
  type CostLine,
  type LabourPlan,
} from "./costing.ts";
import type { DesignVariant } from "./design-record.ts";
import { generateQuote } from "./pricing.ts";
import { DEFAULT_SETTINGS, mergeSettings, type PilotSettings } from "./settings.ts";
import type { Survey } from "./types.ts";

/* Fixtures: fictional DEMO kit, round numbers so the sums can be checked by hand. */

const item = (over: Partial<CatalogueItem> & Pick<CatalogueItem, "id" | "kind" | "label" | "costPence">): CatalogueItem => ({
  status: "available",
  confidence: "provisional",
  sources: [],
  active: true,
  costSource: { supplier: "DEMO Supplies" },
  ...over,
});

const CATALOGUE: CatalogueItem[] = [
  item({ id: "ind25", kind: "indoor", label: "DEMO Breeze 25 wall unit", costPence: 40_000, confidence: "verified", specs: { coolingKw: 2.5 } }),
  item({ id: "out25", kind: "outdoor", label: "DEMO Breeze 25 outdoor unit", costPence: 60_000 }),
  item({ id: "lineset", kind: "material", label: "DEMO line set", unit: "m", costPence: 900 }),
  item({ id: "bracket", kind: "material", label: "DEMO wall bracket", unit: "set", costPence: null }),
  item({ id: "condensate", kind: "material", label: "DEMO condensate kit", unit: "kit", costPence: 1_200, costSource: { supplier: "DEMO", vatIncluded: true } }),
];

const VARIANT: DesignVariant = {
  id: "v-std",
  label: "Standard",
  tier: "standard",
  systems: [
    {
      id: "sys1",
      topology: "single",
      outdoorItemId: "out25",
      roomIds: ["r1"],
      compatibility: { ok: true, errors: [], warnings: [] },
      electrical: { breaker: "16 A RCBO", cableMm2: 2.5, isolator: "20 A" },
      refrigerant: { totalPipeM: 6, prechargedPipeM: 15, additionalChargeG: 0 },
    },
  ],
  roomUnits: [{ roomId: "r1", indoorItemId: "ind25" }],
  bom: [
    { catalogueItemId: "ind25", sku: "IND25", label: "Indoor", qty: 1, category: "equipment" },
    { catalogueItemId: "out25", sku: "OUT25", label: "Outdoor", qty: 1, category: "equipment" },
    { catalogueItemId: "lineset", sku: "LS", label: "Line set", qty: 6, unit: "m", category: "materials" },
    { catalogueItemId: "bracket", sku: "BR", label: "Bracket", qty: 1, category: "materials" },
    { catalogueItemId: "condensate", sku: "CK", label: "Condensate", qty: 1, category: "materials" },
    { sku: "DEMO-CONS", label: "Sealant and fixings (DEMO)", qty: 1, unit: "kit", category: "consumables" },
  ],
  rules: [],
  verdict: "auto-approved",
  installDays: 3,
};

const LABOUR: LabourPlan = { crewSize: 2, installerDays: 3, electricianDays: 0.5, techLeadDays: 1 };

const REGISTERED: PilotSettings = mergeSettings({
  tax: { vatRegistered: true, defaultTaxCode: "standard-20", accountantConfirmed: true, rationale: "DEMO" },
});

const build = (over: Partial<Parameters<typeof buildCostLines>[0]> = {}) =>
  buildCostLines({ variant: VARIANT, catalogue: CATALOGUE, labour: LABOUR, settings: DEFAULT_SETTINGS, ...over });

const byId = (lines: CostLine[]) => new Map(lines.map((l) => [l.id, l]));
const total = (lines: CostLine[]) => lines.reduce((a, l) => a + (l.totalPence ?? 0), 0);

/* ------------------------------------------------------------------ */

test("engineListNetPence: the online price less the tax the proposal adds back, so an unchanged design costs what the quote said", () => {
  const survey: Survey = {
    postcode: "SW16 9ZZ",
    addressLine: "1 Demo Street",
    property: { type: "semi-detached", era: "1930-1950", bedrooms: 3, ownership: "owner" },
    rooms: [
      { id: "r1", name: "Bedroom", type: "bedroom", size: "medium", floor: "first", glazing: "medium", orientation: "south", hasExternalWall: true, photos: [] },
    ],
    outdoor: { location: "ground-rear", photos: [] },
    electrics: { condition: "modern-spare-ways", photos: [] },
  };
  const gbp = generateQuote(survey).totalGbp;
  const registered = (code: "standard-20" | "zero-esm" | "reduced-5") =>
    mergeSettings({ ...DEFAULT_SETTINGS, tax: { ...DEFAULT_SETTINGS.tax, vatRegistered: true, defaultTaxCode: code } });
  // Registered at 20%: the engine's total includes VAT.
  assert.equal(engineListNetPence(survey, registered("standard-20")), Math.round((gbp * 100) / 1.2));
  // Not registered (the default) or zero-rated: no VAT comes off, because none goes back on.
  assert.equal(engineListNetPence(survey, DEFAULT_SETTINGS), Math.round(gbp * 100));
  assert.equal(engineListNetPence(survey, registered("zero-esm")), Math.round(gbp * 100));
  assert.ok(Number.isInteger(engineListNetPence(survey, registered("standard-20"))));
  // The promise, under every tax code: for an unchanged survey (standard tier,
  // no discount) the proposal total is the online instant price (to the pound).
  const instantPence = Math.round(gbp * 100);
  for (const settings of [DEFAULT_SETTINGS, registered("standard-20"), registered("zero-esm"), registered("reduced-5")]) {
    const p = priceOption({ costLines: [], basis: "engine", engineNetPence: engineListNetPence(survey, settings), settings, tier: "standard" });
    assert.ok(Math.abs(p.totalPence - instantPence) <= 100, `${p.taxCode}: ${p.totalPence} vs instant ${instantPence}`);
  }
});

test("defaultLabourPlan: crew of two for the install block, half a day's electrics, a commissioning day", () => {
  assert.deepEqual(defaultLabourPlan(VARIANT, DEFAULT_SETTINGS), { crewSize: 2, installerDays: 3, electricianDays: 0.5, techLeadDays: 1 });
  const bigger: DesignVariant = { ...VARIANT, roomUnits: [...VARIANT.roomUnits, { roomId: "r2", indoorItemId: "ind25" }, { roomId: "r3", indoorItemId: "ind25" }] };
  assert.equal(defaultLabourPlan(bigger, DEFAULT_SETTINGS).electricianDays, 1);
  const noDays: DesignVariant = { ...VARIANT, installDays: 0 };
  assert.equal(defaultLabourPlan(noDays, DEFAULT_SETTINGS).installerDays, DEFAULT_SETTINGS.scheduling.installBlockDays);
});

test("buildCostLines, not VAT registered: catalogue costs, labour, subcontract, unrecoverable input VAT, contingency", () => {
  const lines = build();
  const m = byId(lines);
  assert.equal(m.get("bom:ind25:equipment")!.totalPence, 40_000);
  assert.equal(m.get("bom:ind25:equipment")!.verified, true);
  assert.equal(m.get("bom:out25:equipment")!.verified, false, "provisional catalogue cost isn't verified");
  assert.equal(m.get("bom:lineset:materials")!.totalPence, 5_400);
  // Unpriced stays unpriced: never £0.
  assert.equal(m.get("bom:bracket:materials")!.unitCostPence, null);
  assert.equal(m.get("bom:bracket:materials")!.totalPence, null);
  assert.equal(m.get("bom:DEMO-CONS:consumables")!.totalPence, null);
  assert.equal(m.has("consumables"), false, "the BOM already lists consumables");
  // Labour: 2 installers × 3 days, a tech lead day, half a day of a subcontracted electrician.
  assert.equal(m.get("labour:installers")!.qty, 6);
  assert.equal(m.get("labour:installers")!.totalPence, 132_000);
  assert.equal(m.get("labour:tech-lead")!.totalPence, 28_000);
  assert.equal(m.get("subcontract:electrician")!.category, "subcontract");
  assert.equal(m.get("subcontract:electrician")!.totalPence, 12_500);
  assert.equal(m.get("delivery")!.totalPence, null, "no delivery price in the catalogue: unpriced");
  // 20% on supplier costs we can't reclaim, except the line already bought VAT-inclusive.
  assert.equal(m.get("input-vat")!.totalPence, Math.round((40_000 + 60_000 + 5_400 + 12_500) * 0.2));
  assert.equal(m.get("input-vat")!.category, "overhead");
  assert.equal(m.get("bom:condensate:materials")!.totalPence, 1_200, "VAT-inclusive cost used gross");
  const beforeContingency = 40_000 + 60_000 + 5_400 + 1_200 + 132_000 + 28_000 + 12_500 + 23_580;
  assert.equal(m.get("contingency")!.totalPence, Math.round(beforeContingency * 0.05));
  assert.equal(m.has("overhead"), false, "no overhead line while the setting is £0");
  assert.equal(total(lines), beforeContingency + 15_134);
  assert.equal(lines.filter((l) => l.totalPence === null).length, 3);
});

test("buildCostLines, VAT registered: no input VAT line, VAT-inclusive costs taken net", () => {
  const m = byId(build({ settings: REGISTERED }));
  assert.equal(m.has("input-vat"), false);
  assert.equal(m.get("bom:condensate:materials")!.unitCostPence, 1_000);
  const subtotal = 40_000 + 60_000 + 5_400 + 1_000 + 132_000 + 28_000 + 12_500;
  assert.equal(m.get("contingency")!.totalPence, Math.round(subtotal * 0.05));
});

test("buildCostLines: overrides fill unpriced lines (ex VAT) but never the derived ones", () => {
  const m = byId(
    build({
      overrides: {
        "bom:bracket:materials": { unitCostPence: 5_500, note: "DEMO supplier quote" },
        "input-vat": { unitCostPence: 0 },
        contingency: { unitCostPence: 0 },
        delivery: { unitCostPence: -10 },
      },
    }),
  );
  assert.equal(m.get("bom:bracket:materials")!.totalPence, 5_500);
  assert.match(m.get("bom:bracket:materials")!.source ?? "", /Entered on the proposal: DEMO supplier quote/);
  assert.equal(m.get("input-vat")!.totalPence, Math.round((40_000 + 60_000 + 5_400 + 5_500 + 12_500) * 0.2));
  assert.ok((m.get("contingency")!.totalPence ?? 0) > 0);
  assert.equal(m.get("delivery")!.totalPence, null, "a negative override is ignored");
});

test("buildCostLines: in-house electrician, access tower, install-only, overhead and extras", () => {
  const inHouse = byId(build({ inHouseElectrician: true }));
  assert.equal(inHouse.has("subcontract:electrician"), false);
  assert.equal(inHouse.get("labour:electrician")!.category, "labour");
  assert.equal(inHouse.get("input-vat")!.totalPence, Math.round((40_000 + 60_000 + 5_400) * 0.2), "own labour carries no VAT");

  const tower = byId(build({ accessEquipment: ["ladder", "tower"] }));
  assert.equal(tower.get("access:tower")!.totalPence, null, "no tower in the catalogue: unpriced");
  const priced = byId(
    build({
      accessEquipment: ["tower"],
      catalogue: [...CATALOGUE, item({ id: "tower-hire", kind: "service", label: "DEMO tower hire, one week", category: "access", costPence: 9_500 })],
    }),
  );
  assert.equal(priced.get("access:tower")!.totalPence, 9_500);
  assert.equal(priced.get("access:tower")!.catalogueItemId, "tower-hire");

  const installOnly = build({ contractType: "install-only" });
  assert.equal(installOnly.some((l) => l.category === "equipment"), false, "the customer supplies the equipment");
  assert.equal(installOnly.some((l) => l.id === "delivery"), false);

  const withOverhead = byId(build({ settings: mergeSettings({ pricing: { ...DEFAULT_SETTINGS.pricing, overheadPerJobPence: 15_000 } }) }));
  assert.equal(withOverhead.get("overhead")!.totalPence, 15_000);

  const extra: CostLine = { id: "extra:skip", category: "materials", label: "DEMO skip hire", qty: 1, unit: "hire", unitCostPence: 20_000, totalPence: 20_000, verified: false };
  const withExtra = byId(build({ extras: [extra] }));
  assert.equal(withExtra.get("extra:skip")!.totalPence, 20_000);
  assert.equal(withExtra.get("input-vat")!.totalPence, Math.round((40_000 + 60_000 + 5_400 + 12_500 + 20_000) * 0.2));
});

/* ------------------------------------------------------------------ */

const COSTS = build(); // £3,178.14 of priced cost, 3 unpriced lines
const COST = total(COSTS);
const price = (over: Partial<Parameters<typeof priceOption>[0]> = {}) =>
  priceOption({ costLines: COSTS, basis: "engine", engineNetPence: 500_000, settings: DEFAULT_SETTINGS, tier: "standard", ...over });

test("priceOption, engine basis with PILOT15: discount off the genuine list price, no VAT, margins either side", () => {
  assert.equal(COST, 317_814);
  const p = price({ discountCode: "PILOT15" });
  assert.equal(p.pricingBasis, "engine");
  assert.equal(p.listNetPence, 500_000);
  assert.deepEqual(p.discount, { code: "PILOT15", label: "Pilot discount (15%)", reason: "Early pilot home", amountPence: 75_000 });
  assert.equal(p.netPence, 425_000);
  assert.equal(p.taxCode, "outside-scope");
  assert.equal(p.taxPence, 0);
  assert.equal(p.totalPence, 425_000);
  assert.equal(p.costPence, 317_814);
  assert.equal(p.unpricedCostLines, 3);
  assert.equal(p.grossMarginPct, 25.2);
  assert.equal(p.grossMarginPctBeforeDiscount, 36.4);
  assert.equal(p.contributionPence, 425_000 - 317_814);
  assert.equal(p.belowMinMargin, false);
});

test("priceOption: PILOT30 drops below the minimum margin", () => {
  const p = price({ discountCode: "pilot30" });
  assert.equal(p.netPence, 350_000);
  assert.equal(p.grossMarginPct, 9.2);
  assert.equal(p.belowMinMargin, true);
});

test("priceOption: premium uplift and rounding the engine price to the pound", () => {
  assert.equal(price({ tier: "premium" }).listNetPence, 590_000);
  assert.equal(price({ engineNetPence: 166_250 }).listNetPence, 166_300);
  assert.equal(roundToPound(12_349), 12_300);
  assert.throws(() => price({ engineNetPence: 0 }), PricingError);
});

test("priceOption, cost-plus: cost / (1 − target), rounded up to £10", () => {
  const p = price({ basis: "cost-plus", targetMarginPct: 30 });
  assert.equal(p.listNetPence, 455_000);
  assert.ok(p.grossMarginPct >= 30);
  assert.equal(price({ basis: "cost-plus" }).listNetPence, 424_000, "defaults to the minimum margin");
  assert.throws(() => price({ basis: "cost-plus", targetMarginPct: 100 }), PricingError);
  assert.throws(() => price({ basis: "cost-plus", costLines: [] }), /priced cost line/);
});

test("priceOption, manual: needs an amount and a reason", () => {
  assert.throws(() => price({ basis: "manual", manualNetPence: 400_000 }), /reason/);
  assert.throws(() => price({ basis: "manual", manualReason: "Agreed on the phone" }), /manual price/);
  const p = price({ basis: "manual", manualNetPence: 400_000, manualReason: " Matching the survey estimate " });
  assert.equal(p.listNetPence, 400_000);
  assert.equal(p.manualReason, "Matching the survey estimate");
});

test("priceOption: custom discounts need an amount and a reason, and never exceed the price", () => {
  assert.throws(() => price({ discountCode: "PILOTCUSTOM", discountReason: "Case study home" }), /amount/);
  assert.throws(() => price({ discountCode: "PILOTCUSTOM", customDiscountPence: 12_345 }), /why/);
  const p = price({ discountCode: "PILOTCUSTOM", customDiscountPence: 12_345, discountReason: "Neighbour of pilot 1" });
  assert.equal(p.discount?.amountPence, 12_300, "to the nearest pound");
  assert.equal(p.discount?.reason, "Neighbour of pilot 1");
  const free = price({ customDiscountPence: 900_000, discountReason: "DEMO" });
  assert.equal(free.discount?.code, "CUSTOM");
  assert.equal(free.netPence, 0);
  assert.equal(free.belowMinMargin, true);
  assert.equal(free.grossMarginPct, 0);
  assert.throws(() => price({ customDiscountPence: 5_000 }), /reason/);
  assert.throws(() => price({ discountCode: "NOPE" }), /isn't active/);
  const inactive = mergeSettings({ discounts: [{ code: "PILOT15", label: "x", pct: 15, reason: "x", active: false }] });
  assert.throws(() => price({ discountCode: "PILOT15", settings: inactive }), /isn't active/);
});

test("priceOption, VAT registered: tax on the discounted net, an override code only when registered", () => {
  const p = price({ settings: REGISTERED, discountCode: "PILOT15" });
  assert.equal(p.taxCode, "standard-20");
  assert.equal(p.taxPence, 85_000);
  assert.equal(p.totalPence, 510_000);
  const zero = price({ settings: mergeSettings({ ...REGISTERED, tax: { ...REGISTERED.tax, defaultTaxCode: "zero-esm" } }) });
  assert.equal(zero.taxCode, "zero-esm");
  assert.equal(zero.taxPence, 0);
  const reduced = price({ settings: REGISTERED, taxCode: "reduced-5", discountCode: "PILOT15" });
  assert.equal(reduced.taxCode, "reduced-5");
  assert.equal(reduced.taxPence, 21_250);
  const notRegistered = price({ taxCode: "standard-20" });
  assert.equal(notRegistered.taxCode, "outside-scope", "never VAT without registration");
  assert.equal(notRegistered.taxPence, 0);
});

test("priceOption: contribution leaves out the overhead allocation; margin vs markup", () => {
  const settings = mergeSettings({ pricing: { ...DEFAULT_SETTINGS.pricing, overheadPerJobPence: 20_000 } });
  const lines = build({ settings });
  const p = priceOption({ costLines: lines, basis: "engine", engineNetPence: 500_000, settings, tier: "standard" });
  assert.equal(p.costPence, total(lines));
  assert.equal(p.contributionPence, 500_000 - (total(lines) - 20_000));
  assert.equal(marginPct(15_000, 10_000), 33.3);
  assert.equal(markupPct(15_000, 10_000), 50);
  assert.equal(markupPct(15_000, 0), null);
  assert.equal(marginPct(0, 10_000), 0);
});
