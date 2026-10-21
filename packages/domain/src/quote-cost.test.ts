import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDefaultConfig } from "./defaultconfig.ts";
import { generateQuote } from "./pricing.ts";
import { PLANNING_COSTS, costQuote } from "./quote-cost.ts";
import { DEFAULT_SETTINGS, type PilotSettings } from "./settings.ts";
import type { Survey, SurveyRoom } from "./types.ts";

const room = (over: Partial<SurveyRoom> = {}): SurveyRoom => ({
  id: "r1",
  name: "Main bedroom",
  type: "bedroom",
  size: "medium",
  floor: "first",
  glazing: "medium",
  orientation: "south",
  hasExternalWall: true,
  photos: [],
  ...over,
});

const survey = (rooms: SurveyRoom[], over: Partial<Survey> = {}): Survey => ({
  postcode: "SW16 2QT",
  addressLine: "12 Larkhall Rise",
  property: { type: "semi-detached", era: "1930-1950", bedrooms: 3, ownership: "owner" },
  rooms,
  outdoor: { location: "ground-rear", photos: [] },
  electrics: { condition: "modern-spare-ways", photos: [] },
  ...over,
});

const threeBed = () => {
  const cfg = buildDefaultConfig({ type: "semi-detached", era: "1930-1950", bedrooms: 3, bathrooms: 1, layout: "separate", floorAreaM2: 95 });
  return survey(cfg.rooms, { outdoor: { location: cfg.outdoorDefault, photos: [] } });
};

test("one room: the kit, materials, labour, electrician, unreclaimable VAT and contingency, adding up", () => {
  const s = survey([room()]);
  const q = generateQuote(s);
  const c = costQuote(s, q, DEFAULT_SETTINGS);
  assert.equal(c.lines.reduce((sum, l) => sum + l.amountPence, 0), c.costPence);
  const kit = c.lines.find((l) => l.group === "equipment")!;
  assert.equal(kit.amountPence, PLANNING_COSTS.singleSplitKitPence.standard[q.systems[0]!.rooms[0]!.capacityKw]);
  assert.match(kit.basis, /Daikin Sensira/);
  assert.ok(c.lines.some((l) => l.group === "vat"), "not VAT registered by default: VAT on purchases is a cost");
  // Not registered: the whole price is ours.
  assert.equal(c.priceTotalPence, q.totalGbp * 100);
  assert.equal(c.priceNetPence, c.priceTotalPence);
  assert.equal(c.profitPence, c.priceNetPence - c.costPence);
  assert.equal(c.marginPct, Math.round(((c.profitPence / c.priceNetPence) * 100) * 10) / 10);
});

test("a multi-room home is costed as the engine designed it: multi outdoor units and heads", () => {
  const s = threeBed();
  const q = generateQuote(s);
  const c = costQuote(s, q, DEFAULT_SETTINGS);
  const heads = c.lines.filter((l) => / indoor head$/.test(l.label));
  assert.equal(heads.length, q.systems.filter((sys) => sys.topology === "multi").reduce((n, sys) => n + sys.rooms.length, 0));
  assert.ok(c.lines.some((l) => /multi-split outdoor unit/.test(l.label)));
  assert.equal(c.units.length, c.lines.filter((l) => l.group === "equipment").length);
});

test("premium costs more and is priced with the premium uplift from Settings", () => {
  const s = threeBed();
  const q = generateQuote(s);
  const std = costQuote(s, q, DEFAULT_SETTINGS, "standard");
  const pre = costQuote(s, q, DEFAULT_SETTINGS, "premium");
  assert.ok(pre.costPence > std.costPence);
  assert.equal(pre.priceTotalPence, Math.round(q.totalGbp * (1 + DEFAULT_SETTINGS.pricing.premiumUpliftPct / 100)) * 100);
});

test("VAT registered: no VAT cost line, and the margin is on the price net of VAT", () => {
  const settings: PilotSettings = {
    ...DEFAULT_SETTINGS,
    tax: { ...DEFAULT_SETTINGS.tax, vatRegistered: true, defaultTaxCode: "standard-20", accountantConfirmed: true },
  };
  const s = survey([room()]);
  const c = costQuote(s, generateQuote(s), settings);
  assert.ok(!c.lines.some((l) => l.group === "vat"));
  assert.equal(c.priceNetPence, Math.round(c.priceTotalPence / 1.2));
});

test("the price at the minimum margin really meets it, and the flag agrees", () => {
  for (const s of [survey([room()]), threeBed()]) {
    const c = costQuote(s, generateQuote(s), DEFAULT_SETTINGS);
    const marginAtMin = ((c.priceAtMinMarginPence - c.costPence) / c.priceAtMinMarginPence) * 100;
    assert.ok(marginAtMin >= c.minMarginPct - 0.01, `${marginAtMin} ≥ ${c.minMarginPct}`);
    assert.ok(c.priceAtMinMarginPence % 100 === 0, "whole pounds");
    assert.equal(c.belowMinMargin, c.marginPct < c.minMarginPct);
  }
});

test("one rule, every home: a day-rate change moves every home's cost by its labour days", () => {
  const dearer: PilotSettings = {
    ...DEFAULT_SETTINGS,
    pricing: { ...DEFAULT_SETTINGS.pricing, labourRates: { ...DEFAULT_SETTINGS.pricing.labourRates, installerDayPence: DEFAULT_SETTINGS.pricing.labourRates.installerDayPence + 1000 } },
  };
  for (const s of [survey([room()]), threeBed()]) {
    const q = generateQuote(s);
    const a = costQuote(s, q, DEFAULT_SETTINGS);
    const b = costQuote(s, q, dearer);
    const personDays = PLANNING_COSTS.crewSize * q.installDays;
    const extra = Math.round(personDays * 1000 * (1 + DEFAULT_SETTINGS.pricing.contingencyPct / 100));
    assert.ok(Math.abs(b.costPence - a.costPence - extra) <= 100, `${b.costPence - a.costPence} ≈ ${extra} (lines round to the pound)`);
  }
});

test("harder homes cost more: upstairs, no external wall, an old fuse board", () => {
  const easy = survey([room({ floor: "ground" })]);
  const hard = survey([room({ floor: "loft", hasExternalWall: false })], { electrics: { condition: "older-fuse-box", photos: [] } });
  const a = costQuote(easy, generateQuote(easy), DEFAULT_SETTINGS);
  const b = costQuote(hard, generateQuote(hard), DEFAULT_SETTINGS);
  assert.ok(b.costPence > a.costPence);
  assert.ok(b.lines.some((l) => /Condensate pump/.test(l.label)));
  assert.ok(b.lines.some((l) => /Electrician \(Part P\): 1 day/.test(l.label)));
});
