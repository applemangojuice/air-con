import assert from "node:assert/strict";
import { test } from "node:test";
import { generateQuote } from "./pricing.ts";
import type { Survey, SurveyRoom } from "./types.ts";

function room(overrides: Partial<SurveyRoom> = {}): SurveyRoom {
  return {
    id: "r1",
    name: "Main bedroom",
    type: "bedroom",
    size: "medium",
    floor: "first",
    glazing: "medium",
    orientation: "south",
    hasExternalWall: true,
    photos: [{ id: "p1", kind: "room" }],
    ...overrides,
  };
}

function survey(rooms: SurveyRoom[], overrides: Partial<Survey> = {}): Survey {
  return {
    postcode: "SW1A 1AA",
    addressLine: "1 Test Street",
    property: { type: "semi-detached", era: "1930-1979", bedrooms: 3, ownership: "owner" },
    rooms,
    outdoor: { location: "ground-rear", photos: [{ id: "p2", kind: "outdoor-location" }] },
    electrics: { condition: "modern-spare-ways", photos: [{ id: "p3", kind: "fuse-board" }] },
    ...overrides,
  };
}

test("single bedroom gets a single-split system at a sane fixed price", () => {
  const quote = generateQuote(survey([room()]));
  assert.equal(quote.systems.length, 1);
  assert.equal(quote.systems[0]!.topology, "single");
  assert.ok(quote.totalGbp >= 1500 && quote.totalGbp <= 3500, `got £${quote.totalGbp}`);
  assert.equal(quote.installDays, 1);
});

test("three rooms share one multi-split outdoor unit", () => {
  const rooms = [
    room({ id: "r1", name: "Bedroom 1" }),
    room({ id: "r2", name: "Bedroom 2", size: "small" }),
    room({ id: "r3", name: "Living room", type: "living-room", size: "large", floor: "ground" }),
  ];
  const quote = generateQuote(survey(rooms));
  assert.equal(quote.systems.length, 1);
  assert.equal(quote.systems[0]!.rooms.length, 3);
  assert.ok(quote.totalGbp > 3000, `got £${quote.totalGbp}`);
});

test("five rooms split across two outdoor units", () => {
  const rooms = Array.from({ length: 5 }, (_, i) => room({ id: `r${i}`, name: `Room ${i + 1}` }));
  const quote = generateQuote(survey(rooms));
  assert.equal(quote.systems.length, 2);
  assert.equal(quote.systems.reduce((n, s) => n + s.rooms.length, 0), 5);
});

test("quote is deterministic for identical surveys", () => {
  const s = survey([room()]);
  assert.deepEqual(generateQuote(s), generateQuote(s));
});

test("complete survey with photos scores high confidence", () => {
  const quote = generateQuote(survey([room()]));
  assert.equal(quote.confidence.band, "high");
});

test("missing photos and unsure answers drop confidence and add gaps", () => {
  const quote = generateQuote(
    survey([room({ photos: [] })], {
      outdoor: { location: "unsure", photos: [] },
      electrics: { condition: "unsure", photos: [] },
    }),
  );
  assert.equal(quote.confidence.band, "low");
  assert.ok(quote.confidence.gaps.length >= 3);
  assert.ok(quote.reviewFlags.length >= 1);
});

test("no external wall adds internal routing line and review flag", () => {
  const quote = generateQuote(survey([room({ hasExternalWall: false })]));
  assert.ok(quote.lines.some((l) => l.label.includes("internal pipe routing")));
  assert.ok(quote.reviewFlags.some((f) => f.includes("no external wall")));
});

test("finance options include deposit and monthly payment", () => {
  const quote = generateQuote(survey([room()]));
  assert.equal(quote.finance.length, 3);
  for (const f of quote.finance) {
    assert.equal(f.depositGbp, Math.round(quote.totalGbp * 0.1));
    assert.ok(f.monthlyGbp > 0);
    assert.ok(f.totalPayableGbp > quote.totalGbp); // interest > 0
  }
});
