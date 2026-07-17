import { strict as assert } from "node:assert";
import { test } from "node:test";
import { designSystem, designVerdict, NOISE_LIMIT_DB } from "./design.ts";
import type { DesignInput } from "./design.ts";
import { emptyConstraints, emptyMarketing, emptyPlanning } from "./intelligence.ts";
import type { PropertyIntel } from "./intelligence.ts";
import type { Survey, SurveyRoom } from "./types.ts";

function room(overrides: Partial<SurveyRoom> & { id: string; name: string }): SurveyRoom {
  return {
    type: "bedroom",
    size: "medium",
    floor: "first",
    glazing: "medium",
    orientation: "south",
    hasExternalWall: true,
    photos: [],
    ...overrides,
  };
}

function survey(rooms: SurveyRoom[], overrides?: Partial<Survey>): Survey {
  return {
    postcode: "SW16 2BE",
    addressLine: "12 Test Road",
    property: { type: "terraced", era: "pre-1930", bedrooms: 3, ownership: "owner" },
    rooms,
    outdoor: { location: "ground-rear", photos: [] },
    electrics: { condition: "modern-spare-ways", photos: [] },
    ...overrides,
  };
}

function intel(overrides?: Partial<PropertyIntel["constraints"]>): PropertyIntel {
  return {
    id: "test-1",
    address: { line1: "12 Test Road", postcode: "SW16 2BE", outcode: "SW16" },
    planning: emptyPlanning(),
    constraints: { ...emptyConstraints(), ...overrides },
    marketing: emptyMarketing(),
  };
}

test("clean three-room home auto-approves with one multi-split", () => {
  const input: DesignInput = {
    survey: survey([
      room({ id: "r1", name: "Main bedroom" }),
      room({ id: "r2", name: "Living room", type: "living-room", size: "large", floor: "ground" }),
      room({ id: "r3", name: "Office", type: "home-office" }),
    ]),
    intel: intel(),
  };
  const bp = designSystem(input);
  assert.equal(bp.verdict, "auto-approved");
  assert.equal(bp.systems.length, 1);
  assert.equal(bp.systems[0]!.topology, "multi");
  assert.ok(bp.systems[0]!.outdoor.ports >= 3);
  assert.equal(bp.rules.length, 8);
  assert.ok(bp.rules.every((r) => r.status === "pass"));
});

test("single room gets a single split", () => {
  const bp = designSystem({ survey: survey([room({ id: "r1", name: "Bedroom" })]), intel: intel() });
  assert.equal(bp.systems.length, 1);
  assert.equal(bp.systems[0]!.topology, "single");
  assert.equal(bp.systems[0]!.outdoor.ports, 1);
});

test("unknown electrics is a red light: cannot determine", () => {
  const s = survey([room({ id: "r1", name: "Bedroom" })]);
  s.electrics.condition = "unsure";
  const bp = designSystem({ survey: s, intel: intel() });
  assert.equal(bp.verdict, "cannot-determine");
  assert.equal(bp.rules.find((r) => r.id === "electrics")?.status, "fail");
});

test("conservation area needs review, never blocks the design", () => {
  const bp = designSystem({
    survey: survey([room({ id: "r1", name: "Bedroom" })]),
    intel: intel({ conservationArea: true }),
  });
  assert.equal(bp.verdict, "needs-review");
  assert.equal(bp.rules.find((r) => r.id === "planning")?.status, "review");
});

test("no external wall: pump specified, mounting flagged for review", () => {
  const bp = designSystem({
    survey: survey([
      room({ id: "r1", name: "Bedroom" }),
      room({ id: "r2", name: "Middle room", hasExternalWall: false }),
    ]),
    intel: intel(),
  });
  const middle = bp.systems.flatMap((s) => s.rooms).find((r) => r.roomName === "Middle room")!;
  assert.equal(middle.condensatePump, true);
  assert.equal(bp.rules.find((r) => r.id === "mounting")?.status, "review");
  assert.ok(bp.bom.some((l) => l.sku === "condensate-pump"));
});

test("six rooms split across two outdoor units and flag topology", () => {
  const rooms = Array.from({ length: 6 }, (_, i) =>
    room({ id: `r${i}`, name: `Room ${i + 1}` }),
  );
  const bp = designSystem({ survey: survey(rooms), intel: intel() });
  assert.equal(bp.systems.length, 2);
  assert.equal(bp.rules.find((r) => r.id === "topology")?.status, "review");
  assert.equal(
    bp.systems.reduce((n, s) => n + s.rooms.length, 0),
    6,
  );
});

test("undecided outdoor position cannot clear clearances or noise", () => {
  const s = survey([room({ id: "r1", name: "Bedroom" })]);
  s.outdoor.location = "unsure";
  const bp = designSystem({ survey: s, intel: intel() });
  assert.equal(bp.rules.find((r) => r.id === "clearances")?.status, "fail");
  assert.equal(bp.rules.find((r) => r.id === "noise")?.status, "fail");
  assert.equal(bp.verdict, "cannot-determine");
});

test("flat with a balcony position reviews noise against the guidance", () => {
  const s = survey([room({ id: "r1", name: "Bedroom" })], {
    property: { type: "flat", era: "2000+", bedrooms: 1, ownership: "owner" },
  });
  s.outdoor.location = "balcony";
  const bp = designSystem({ survey: s, intel: intel() });
  const noise = bp.rules.find((r) => r.id === "noise")!;
  assert.equal(noise.status, "review");
  assert.ok(noise.detail.includes(`${NOISE_LIMIT_DB}`));
});

test("refrigerant top-up appears only beyond the pre-charge", () => {
  const small = designSystem({ survey: survey([room({ id: "r1", name: "Bedroom", floor: "ground" })]), intel: intel() });
  assert.equal(small.systems[0]!.refrigerant.additionalChargeG, 0);

  const tall = designSystem({
    survey: survey([
      room({ id: "r1", name: "Loft room", floor: "loft" }),
      room({ id: "r2", name: "Second bedroom", floor: "second-plus" }),
      room({ id: "r3", name: "Main bedroom", floor: "first" }),
      room({ id: "r4", name: "Snug", floor: "ground" }),
    ]),
    intel: intel(),
  });
  assert.equal(tall.systems.length, 1);
  const sys = tall.systems[0]!;
  assert.ok(sys.refrigerant.totalPipeM > sys.refrigerant.prechargedPipeM);
  assert.ok(sys.refrigerant.additionalChargeG > 0);
  assert.ok(tall.bom.some((l) => l.sku === "r32-topup"));
});

test("bom covers every physical system: units, electrics, sleeves, consumables", () => {
  const bp = designSystem({
    survey: survey([
      room({ id: "r1", name: "Main bedroom" }),
      room({ id: "r2", name: "Living room", type: "living-room", size: "large", floor: "ground" }),
    ]),
    intel: intel(),
  });
  const skus = new Set(bp.bom.map((l) => l.sku));
  assert.ok(skus.has(bp.systems[0]!.outdoor.sku));
  assert.ok(skus.has("isolator-45"));
  assert.ok(skus.has("wall-sleeve"));
  assert.ok(skus.has("consumables"));
  assert.equal(bp.bom.find((l) => l.sku === "wall-sleeve")?.qty, bp.penetrations);
  const indoorQty = bp.bom
    .filter((l) => l.sku.startsWith("DIH-W"))
    .reduce((n, l) => n + l.qty, 0);
  assert.equal(indoorQty, 2);
});

test("verdict helper: worst light wins", () => {
  const pass = { id: "a", title: "", status: "pass" as const, detail: "" };
  const review = { ...pass, status: "review" as const };
  const fail = { ...pass, status: "fail" as const };
  assert.equal(designVerdict([pass, pass]), "auto-approved");
  assert.equal(designVerdict([pass, review]), "needs-review");
  assert.equal(designVerdict([pass, review, fail]), "cannot-determine");
});

test("occupants nudge living space loads upward", () => {
  const base = designSystem({
    survey: survey([room({ id: "r1", name: "Living room", type: "living-room", size: "large" })]),
    occupants: 2,
  });
  const busy = designSystem({
    survey: survey([room({ id: "r1", name: "Living room", type: "living-room", size: "large" })]),
    occupants: 6,
  });
  assert.ok(
    busy.systems[0]!.rooms[0]!.loadWatts > base.systems[0]!.rooms[0]!.loadWatts,
  );
});
