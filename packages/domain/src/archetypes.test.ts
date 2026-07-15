import assert from "node:assert/strict";
import { test } from "node:test";
import { ARCHETYPES, buildPresetRoom, getPermutation, suggestArchetypes } from "./archetypes.ts";
import { generateQuote } from "./pricing.ts";
import type { Survey } from "./types.ts";

test("archetype library has 15 archetypes, each with at least one permutation", () => {
  assert.equal(ARCHETYPES.length, 15);
  for (const a of ARCHETYPES) {
    assert.ok(a.permutations.length >= 1, `${a.id} has no permutations`);
    const ids = new Set(a.permutations.map((p) => p.id));
    assert.equal(ids.size, a.permutations.length, `${a.id} has duplicate permutation ids`);
  }
});

test("every archetype ships a stock floor plan with popular defaults", () => {
  for (const a of ARCHETYPES) {
    assert.ok(a.typicalRooms.length >= 2, `${a.id} has too few typical rooms`);
    assert.ok(
      a.typicalRooms.some((room) => room.popular),
      `${a.id} has no popular (pre-ticked) rooms`,
    );
  }
});

test("preset rooms materialise deterministically and price without AI", () => {
  const archetype = ARCHETYPES.find((a) => a.id === "thirties-semi")!;
  const rooms = archetype.typicalRooms
    .filter((room) => room.popular)
    .map((room, i) => buildPresetRoom(archetype.id, room, i));
  assert.deepEqual(
    rooms,
    archetype.typicalRooms.filter((room) => room.popular).map((room, i) => buildPresetRoom(archetype.id, room, i)),
  );

  const quote = generateQuote({
    postcode: "SW1A 1AA",
    addressLine: "1 Test Street",
    archetypeId: archetype.id,
    permutationId: archetype.permutations[0]!.id,
    property: { type: "semi-detached", era: "1930-1950", bedrooms: 3, ownership: "owner" },
    rooms,
    outdoor: { location: archetype.permutations[0]!.outdoorLocation, photos: [] },
    electrics: { condition: "unsure", photos: [] },
  });
  assert.ok(quote.totalGbp > 2000);
});

test("suggestArchetypes ranks the 1930s semi first for a 1930-1979 semi", () => {
  const suggestions = suggestArchetypes({ type: "semi-detached", era: "1930-1950" });
  assert.equal(suggestions[0]!.id, "thirties-semi");
  assert.ok(suggestions.length >= 3);
});

test("suggestArchetypes ranks flat archetypes first for flats", () => {
  const suggestions = suggestArchetypes({ type: "flat", era: "2000+" });
  assert.ok(suggestions.some((a) => a.id === "low-rise-flat"));
  // Type matches outrank era-only matches, so flats lead the list.
  assert.ok(suggestions[0]!.matches.types.includes("flat"));
});

test("permutation adder and checks flow into the quote", () => {
  const survey: Survey = {
    postcode: "SW1A 1AA",
    addressLine: "1 Test Street",
    archetypeId: "townhouse",
    permutationId: "courtyard-multi",
    property: { type: "terraced", era: "1950-2000", bedrooms: 3, ownership: "owner" },
    rooms: [
      {
        id: "r1",
        name: "Main bedroom",
        type: "bedroom",
        size: "medium",
        floor: "second-plus",
        glazing: "medium",
        orientation: "south",
        hasExternalWall: true,
        photos: [],
      },
    ],
    outdoor: { location: "ground-rear", photos: [] },
    electrics: { condition: "modern-spare-ways", photos: [] },
  };
  const quote = generateQuote(survey);
  const adder = getPermutation("townhouse", "courtyard-multi")!.adderGbp;
  assert.ok(quote.lines.some((l) => l.label.includes("Install pattern") && l.amount === adder));
  assert.ok(quote.reviewFlags.some((f) => f.startsWith("Pattern check:")));
});

test("unknown permutation ids are ignored gracefully", () => {
  const survey: Survey = {
    postcode: "SW1A 1AA",
    addressLine: "1 Test Street",
    archetypeId: "not-a-real-archetype",
    permutationId: "nope",
    property: { type: "detached", era: "2000+", bedrooms: 4, ownership: "owner" },
    rooms: [
      {
        id: "r1",
        name: "Office",
        type: "home-office",
        size: "small",
        floor: "ground",
        glazing: "low",
        orientation: "north",
        hasExternalWall: true,
        photos: [],
      },
    ],
    outdoor: { location: "ground-rear", photos: [] },
    electrics: { condition: "unsure", photos: [] },
  };
  const quote = generateQuote(survey);
  assert.ok(!quote.lines.some((l) => l.label.includes("Install pattern")));
});
