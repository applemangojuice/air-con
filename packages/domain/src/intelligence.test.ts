import assert from "node:assert/strict";
import { test } from "node:test";
import { generateQuote } from "./pricing.ts";
import {
  businessCase,
  classifyProperty,
  defaultConfigFromIntel,
  emptyConstraints,
  emptyMarketing,
  emptyPlanning,
  mapEra,
  mapPropertyType,
  normaliseAddress,
  outcodeOf,
  prefillFromIntel,
  scoreMarketing,
  syntheticId,
  type PropertyIntel,
} from "./intelligence.ts";

function intel(overrides: Partial<PropertyIntel> = {}): PropertyIntel {
  return {
    id: "test-1",
    uprn: "100023336956",
    address: { line1: "12 Larkhall Rise", postcode: "SW16 2QT", outcode: "SW16" },
    epc: {
      propertyType: "House",
      builtForm: "Semi-Detached",
      constructionAgeBand: "England and Wales: 1930-1949",
      totalFloorAreaM2: 104,
      habitableRooms: 5,
      glazingDescription: "Fully double glazed",
      currentRating: "D",
    },
    planning: emptyPlanning(),
    constraints: emptyConstraints(),
    marketing: emptyMarketing(),
    ...overrides,
  };
}

test("address normalisation and synthetic ids are stable", () => {
  assert.equal(normaliseAddress("12a,  Larkhall   Rise."), "12A LARKHALL RISE");
  assert.equal(outcodeOf("sw16 2qt"), "SW16");
  assert.equal(outcodeOf("SW162QT"), "SW16");
  const a = syntheticId("12 Larkhall Rise", "SW16 2QT");
  const b = syntheticId("12,  larkhall rise", "sw162qt");
  assert.equal(a, b);
  assert.notEqual(a, syntheticId("14 Larkhall Rise", "SW16 2QT"));
});

test("EPC vocabulary maps onto survey vocabulary", () => {
  assert.equal(mapPropertyType("House", "Semi-Detached"), "semi-detached");
  assert.equal(mapPropertyType("House", "Mid-Terrace"), "terraced");
  assert.equal(mapPropertyType("House", "End-Terrace"), "terraced");
  assert.equal(mapPropertyType("House", "Detached"), "detached");
  assert.equal(mapPropertyType("Bungalow", "Detached"), "bungalow");
  assert.equal(mapPropertyType("Flat", ""), "flat");
  assert.equal(mapPropertyType("Maisonette", "Mid-Terrace"), "flat");

  assert.equal(mapEra("England and Wales: before 1900"), "pre-1930");
  assert.equal(mapEra("England and Wales: 1900-1929"), "pre-1930");
  assert.equal(mapEra("England and Wales: 1930-1949"), "1930-1950");
  assert.equal(mapEra("England and Wales: 1967-1975"), "1950-2000");
  assert.equal(mapEra("England and Wales: 2007-2011"), "2000+");
  assert.equal(mapEra(""), undefined);
});

test("classification finds an archetype from the EPC profile", () => {
  const cls = classifyProperty(intel());
  assert.equal(cls.propertyType, "semi-detached");
  assert.equal(cls.era, "1930-1950");
  assert.ok(cls.archetypeId, "expected an archetype id");
  assert.ok(cls.confidence > 40 && cls.confidence <= 80, `confidence ${cls.confidence}`);
  assert.equal(cls.planningRisk, "none");
});

test("a manual audit overrides the EPC classification", () => {
  const audited = intel({
    audit: {
      archetypeId: "victorian-terrace",
      difficulty: "standard",
      confidence: 92,
      auditedAt: "2026-07-01T10:00:00.000Z",
      auditor: "MH",
    },
  });
  const cls = classifyProperty(audited);
  assert.equal(cls.archetypeId, "victorian-terrace");
  assert.equal(cls.confidence, 92);
});

test("listed buildings carry high planning risk and sink the priority", () => {
  const listed = intel({
    constraints: { conservationArea: true, listedBuilding: true, article4: false },
  });
  assert.equal(classifyProperty(listed).planningRisk, "high");
  const { band } = scoreMarketing(listed);
  assert.ok(band === "low" || band === "standard", `got ${band}`);
});

test("loft-converted family houses rank hot", () => {
  const loft = intel({
    planning: { ...emptyPlanning(), loftConversion: true },
    epc: { ...intel().epc, totalFloorAreaM2: 130 },
  });
  const result = scoreMarketing(loft);
  assert.equal(result.band, "hot");
  assert.ok(result.reasons.some((r) => r.toLowerCase().includes("loft")));
});

test("customers and exclusions never make a mailing list", () => {
  const customer = intel({ marketing: { leadStatus: "customer" } });
  assert.equal(scoreMarketing(customer).band, "exclude");
});

test("prefill turns EPC data into funnel answers", () => {
  const prefill = prefillFromIntel(intel());
  assert.equal(prefill.type, "semi-detached");
  assert.equal(prefill.era, "1930-1950");
  assert.equal(prefill.bedrooms, 3); // 5 habitable rooms minus 2 receptions
  assert.equal(prefill.floorAreaM2, 104);
});

test("a full profile yields a priced default configuration", () => {
  const config = defaultConfigFromIntel(intel());
  assert.ok(config, "expected a default config");
  assert.ok(config!.rooms.length >= 3);
  const quote = generateQuote({
    postcode: "SW16 2QT",
    addressLine: "12 Larkhall Rise",
    archetypeId: config!.archetypeId,
    permutationId: config!.permutationId,
    property: { type: "semi-detached", era: "1930-1950", bedrooms: 3, ownership: "owner" },
    rooms: config!.rooms,
    outdoor: { location: config!.outdoorDefault, photos: [] },
    electrics: { condition: "unsure", photos: [] },
  });
  assert.ok(quote.totalGbp > 1500, `got £${quote.totalGbp}`);
});

test("thin profiles decline to classify instead of guessing", () => {
  const thin = intel({ epc: undefined });
  const cls = classifyProperty(thin);
  assert.equal(cls.confidence, 0);
  assert.equal(defaultConfigFromIntel(thin), undefined);
});

test("business case maths is deterministic and sane", () => {
  const bc = businessCase(1000);
  assert.equal(bc.mailed, 1000);
  assert.equal(bc.mailCostGbp, 850);
  assert.equal(bc.expectedQuotes, 20);
  assert.equal(bc.expectedInstalls, 5);
  assert.equal(bc.expectedRevenueGbp, 17000);
  assert.equal(bc.expectedGrossProfitGbp, 7650);
  assert.ok(bc.roi > 8);
});
