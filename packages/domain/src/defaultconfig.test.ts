import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDefaultConfig } from "./defaultconfig.ts";
import { generateQuote } from "./pricing.ts";

test("a 3-bed semi generates living space + 3 bedrooms and prices instantly", () => {
  const config = buildDefaultConfig({
    type: "semi-detached",
    era: "1930-1950",
    bedrooms: 3,
    bathrooms: 1,
    layout: "separate",
  });
  assert.equal(config.rooms.filter((r) => r.type === "bedroom").length, 3);
  assert.ok(config.rooms.some((r) => r.type === "living-room"));
  assert.equal(config.excluded.length, 0);
  assert.deepEqual(config.outdoorOptions, ["ground-rear", "ground-side"]);
  assert.equal(config.archetypeId, "thirties-semi");

  const quote = generateQuote({
    postcode: "SW1A 1AA",
    addressLine: "1 Test Street",
    archetypeId: config.archetypeId,
    permutationId: config.permutationId,
    property: { type: "semi-detached", era: "1930-1950", bedrooms: 3, bathrooms: 1, ownership: "owner" },
    rooms: config.rooms,
    outdoor: { location: config.outdoorDefault, photos: [] },
    electrics: { condition: "unsure", photos: [] },
  });
  assert.ok(quote.totalGbp > 3000, `got £${quote.totalGbp}`);
});

test("a 4-bed mid-terrace excludes middle bedrooms (external walls only)", () => {
  const config = buildDefaultConfig({
    type: "terraced",
    era: "pre-1930",
    bedrooms: 4,
    bathrooms: 1,
    layout: "open-plan",
  });
  assert.equal(config.rooms.filter((r) => r.type === "bedroom").length, 2);
  assert.equal(config.excluded.length, 2);
  assert.ok(config.excluded[0]!.reason.includes("external wall"));
  assert.deepEqual(config.outdoorOptions, ["ground-rear"]);
});

test("floor area allocates m² across rooms and sizes them accordingly", () => {
  const config = buildDefaultConfig({
    type: "detached",
    era: "2000+",
    bedrooms: 4,
    bathrooms: 2,
    layout: "open-plan",
    floorAreaM2: 140,
  });
  for (const room of config.rooms) {
    assert.ok(room.areaM2 && room.areaM2 >= 5, `${room.name} has no area`);
  }
  const openPlan = config.rooms.find((r) => r.type === "kitchen-diner")!;
  const smallestBedroom = [...config.rooms]
    .filter((r) => r.type === "bedroom")
    .sort((a, b) => a.areaM2! - b.areaM2!)[0]!;
  assert.ok(openPlan.areaM2! > smallestBedroom.areaM2!);
  assert.ok(["large", "xl"].includes(openPlan.size));
});

test("bungalows and flats put bedrooms on the ground floor", () => {
  const config = buildDefaultConfig({
    type: "bungalow",
    era: "1950-2000",
    bedrooms: 2,
    bathrooms: 1,
    layout: "separate",
  });
  assert.ok(config.rooms.every((r) => r.floor === "ground"));
});

test("config is deterministic", () => {
  const input = {
    type: "semi-detached" as const,
    era: "1930-1950" as const,
    bedrooms: 3,
    bathrooms: 2,
    layout: "two-receptions" as const,
    floorAreaM2: 110,
  };
  assert.deepEqual(buildDefaultConfig(input), buildDefaultConfig(input));
});
