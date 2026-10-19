import assert from "node:assert/strict";
import { test } from "node:test";
import { customerChecks, generateQuote } from "./pricing.ts";
import { permutationForLocation } from "./archetypes.ts";
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
    property: { type: "semi-detached", era: "1930-1950", bedrooms: 3, ownership: "owner" },
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

test("the engine works out no finance: no APR, no monthly figures", () => {
  const quote = generateQuote(survey([room()]));
  assert.equal("finance" in quote, false);
  assert.doesNotMatch(JSON.stringify(quote), /apr|monthly/i);
});

test("customers see the surveyor's checks in plain words, never the office's pattern notes", () => {
  // A 3-bed 1930s semi on the default back-wall spot, five rooms: two outdoor units.
  const rooms = Array.from({ length: 5 }, (_, i) => room({ id: `r${i}`, name: `Room ${i + 1}` }));
  const quote = generateQuote(survey(rooms, { archetypeId: "thirties-semi", permutationId: "rear-patio-multi" }));
  assert.ok(quote.reviewFlags.some((f) => /^Pattern check:/.test(f)), "the office still gets its checks");
  assert.ok(quote.reviewFlags.some((f) => /serves up to 4 rooms and you asked for 5/.test(f)));
  const checks = customerChecks(quote.reviewFlags, { outdoorUnits: quote.systems.length });
  assert.deepEqual(checks, [
    "The best spots for your outdoor units, and how the pipes and condensate run to them.",
    "Where your second outdoor unit goes.",
  ]);
  for (const c of checks) assert.doesNotMatch(c, /Pattern check|multi-split|you asked for|Rear patio/);

  // One unit: singular; narration notes stay in ops; the older "lock this line in" is softened; other flags pass through.
  assert.deepEqual(
    customerChecks(["Pattern check: Patio drainage", "From narration: unsure about loft", "Electrics unconfirmed. A fuse board photo lets us lock this line in.", "Bedroom has no external wall, so the pipe route needs a design check."]),
    [
      "The best spot for your outdoor unit, and how the pipes and condensate run to it.",
      "Electrics unconfirmed. A fuse board photo helps us firm up this line.",
      "Bedroom has no external wall, so the pipe route needs a design check.",
    ],
  );
  assert.deepEqual(customerChecks([]), []);
});

test("moving the outdoor unit moves the install pattern with it", () => {
  assert.equal(permutationForLocation("thirties-semi", "ground-rear")?.id, "rear-patio-multi");
  assert.equal(permutationForLocation("thirties-semi", "ground-side")?.outdoorLocation, "ground-side");
  assert.equal(permutationForLocation("victorian-terrace", "ground-side"), undefined, "no side pattern for a terrace: the survey decides");
  assert.equal(permutationForLocation(undefined, "ground-rear"), undefined);
  // The side spot's quote carries no rear-patio checks.
  const side = permutationForLocation("thirties-semi", "ground-side")!;
  const quote = generateQuote(survey([room()], { archetypeId: "thirties-semi", permutationId: side.id, outdoor: { location: "ground-side", photos: [] } }));
  assert.ok(!quote.reviewFlags.some((f) => /Patio/.test(f)));
});
