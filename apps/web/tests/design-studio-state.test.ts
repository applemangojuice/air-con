import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEMO_CATALOGUE,
  DEMO_COMPATIBILITY,
  designDeviations,
  draftDesign,
  editsFromDesign,
  type MeasuredRoom,
  type MeasuredSurvey,
  type Survey,
} from "@aircon/domain";
import {
  assignRoom,
  carry,
  dropVariant,
  isEdits,
  previewOf,
  restoreVariant,
  setIndoor,
  setManufacturer,
  setRoom,
  systemsKey,
  takeSuggestedIndoor,
  takeSuggestedSystems,
  toggleRoomPhoto,
} from "../components/ops/design/studio-state.ts";

/** The studio's editing rules on a DEMO design: choices follow the engine until someone picks by hand. */

const room = (id: string, name: string, over: Partial<MeasuredRoom> = {}): MeasuredRoom => ({
  id,
  name,
  type: "bedroom",
  floor: "first",
  include: true,
  lengthM: 4,
  widthM: 3.5,
  glazing: "medium",
  orientation: "south",
  hasExternalWall: true,
  pipeRunM: 6,
  heightDropM: 3,
  route: "external-trunking",
  condensate: "gravity",
  mediaIds: [`photo-${id}`],
  ...over,
});

const measured: MeasuredSurvey = {
  version: 1,
  site: { confirmedAddress: true, ownerConfirmed: true, tenure: "owner" },
  wishes: { priorities: [], heatingUse: "supplementary" },
  house: { type: "detached", era: "2000+", wallConstruction: "cavity", storeys: 2, loftAccess: true, listedOrConservation: "no", asbestosRisk: "none-suspected" },
  rooms: [room("r1", "Main bedroom"), room("r2", "Living room", { type: "living-room", floor: "ground", lengthM: 5.5, widthM: 4, pipeRunM: 3 })],
  outdoor: { positions: [{ id: "o1", label: "Rear patio (DEMO)", location: "ground-rear", base: "ground-feet", reflectingSurfaces: "two", accessEquipment: "none", distanceToNeighbourWindowM: 8, chosen: true, mediaId: "photo-out" }] },
  electrics: { boardType: "modern-rcbo", spareWays: 2, cableRouteM: 8, asbestosFlashGuard: "no", mediaIds: [] },
  permissions: { pd: {} },
  risks: { workingAtHeight: false, structuralConcern: false, concealedServicesConcern: false },
  assumptions: [],
  unknowns: [],
};

const base: Survey = {
  postcode: "SW16 1AA",
  addressLine: "1 Demo Street",
  property: { type: "detached", era: "2000+", bedrooms: 3, ownership: "owner" },
  rooms: [],
  outdoor: { location: "ground-rear", photos: [] },
  electrics: { condition: "modern-spare-ways", photos: [] },
};

const design = draftDesign({ projectId: "p", id: "d1", version: 1, measured, baseSurvey: base, catalogue: DEMO_CATALOGUE, compatibility: DEMO_COMPATIBILITY, now: "2026-10-18T10:00:00.000Z" });
const ctx = { design, catalogue: DEMO_CATALOGUE, compatibility: DEMO_COMPATIBILITY, by: "DEMO Tess" };
const std = (e: ReturnType<typeof editsFromDesign>) => e.variants.find((v) => v.id === "standard")!;

test("the draft starts on one multi-split, and an unchanged studio has nothing to explain", () => {
  const e = editsFromDesign(design);
  assert.equal(std(e).systems.length, 1);
  assert.equal(std(e).systems[0]!.outdoorItemId, "demo-out-duo50");
  assert.deepEqual(designDeviations(previewOf(ctx, e)), []);
});

test("a size change carries the following unit with it; only the size needs a reason", () => {
  const e = setRoom(ctx, editsFromDesign(design), "r1", { chosenKw: 3.5 });
  assert.equal(std(e).roomUnits.find((u) => u.roomId === "r1")!.indoorItemId, "demo-ind-brz35");
  assert.equal(e.variants.find((v) => v.id === "premium")!.roomUnits.find((u) => u.roomId === "r1")!.indoorItemId, "demo-ind-whs35");
  assert.deepEqual(designDeviations(previewOf(ctx, e)).map((d) => d.field), ["rooms.r1.chosenKw"]);
});

test("a hand-picked unit stays put when the size changes, and asks for its own reason", () => {
  let e = setIndoor(ctx, editsFromDesign(design), "standard", "r1", "demo-ind-whs25");
  e = setRoom(ctx, e, "r1", { chosenKw: 3.5 });
  assert.equal(std(e).roomUnits.find((u) => u.roomId === "r1")!.indoorItemId, "demo-ind-whs25");
  assert.deepEqual(designDeviations(previewOf(ctx, e)).map((d) => d.field).sort(), ["rooms.r1.chosenKw", "variants.standard.rooms.r1.indoor"]);
  const back = takeSuggestedIndoor(ctx, e, "standard", "r1");
  assert.equal(std(back).roomUnits.find((u) => u.roomId === "r1")!.indoorItemId, "demo-ind-brz35");
});

test("moving a room to its own outdoor unit picks that unit's pair; the suggestion can be taken back", () => {
  const e = assignRoom(ctx, editsFromDesign(design), "standard", "r2", "new");
  const systems = std(e).systems;
  assert.deepEqual(systems.map((s) => [s.outdoorItemId, s.roomIds]), [["demo-out-brz25", ["r1"]], ["demo-out-brz35", ["r2"]]]);
  assert.equal(systems[0]!.outdoorPositionId, "o1"); // kept from the system it came from
  assert.deepEqual(designDeviations(previewOf(ctx, e)).map((d) => d.field), ["variants.standard.systems"]);
  const undone = takeSuggestedSystems(ctx, e, "standard");
  assert.equal(systemsKey(std(undone).systems), systemsKey(std(editsFromDesign(design)).systems));
});

test("switching brand rebuilds the option from the engine; options can be dropped and restored", () => {
  const e = setManufacturer(ctx, editsFromDesign(design), "standard", "DEMO Aircon Co");
  assert.equal(std(e).manufacturer, "DEMO Aircon Co");
  const one = dropVariant(e, "premium");
  assert.deepEqual(one.variants.map((v) => v.id), ["standard"]);
  assert.deepEqual(dropVariant(one, "standard").variants.map((v) => v.id), ["standard"]); // never the last one
  assert.deepEqual(restoreVariant(design, one, "premium").variants.map((v) => v.id), ["standard", "premium"]);
});

test("layout photos toggle; positions travel with their rooms; restored drafts are shape-checked", () => {
  const off = toggleRoomPhoto(editsFromDesign(design), "r1", "photo-r1");
  assert.deepEqual(off.rooms.find((r) => r.roomId === "r1")!.layoutMediaIds, []);
  assert.deepEqual(toggleRoomPhoto(off, "r1", "photo-r1").rooms.find((r) => r.roomId === "r1")!.layoutMediaIds, ["photo-r1"]);
  const carried = carry([{ outdoorItemId: "x", roomIds: ["r2"] }], [{ id: "s9", outdoorItemId: "y", roomIds: ["r1", "r2"], outdoorPositionId: "o1", layoutMediaIds: ["m"] }]);
  assert.deepEqual(carried, [{ id: "s9", outdoorItemId: "x", roomIds: ["r2"], outdoorPositionId: "o1", layoutMediaIds: ["m"] }]);
  assert.equal(isEdits(editsFromDesign(design)), true);
  assert.equal(isEdits({ rooms: [], variants: [] }), false);
  assert.equal(isEdits("nope"), false);
});
