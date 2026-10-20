import assert from "node:assert/strict";
import { test } from "node:test";
import { generateQuote } from "./pricing.ts";
import {
  ACCESS_EQUIPMENT_HEIGHT_M,
  PD_CHECKS,
  RISK_QUESTIONS,
  SURVEY_SECTIONS,
  diffAccuracyPct,
  diffSelfSurvey,
  electricsConditionFound,
  electricsFinding,
  emptyMeasuredSurvey,
  measuredRoomArea,
  measuredToEngineSurvey,
  prefillFromPropertyIntel,
  roomSizeForArea,
  roomSizeLabel,
  sectionProgress,
  surveyChecks,
  surveyCompleteness,
  type MeasuredRoom,
  type MeasuredSurvey,
  type OutdoorPosition,
} from "./survey-visit.ts";
import type { Survey } from "./types.ts";

/* ------------------------------------------------------------------ */
/* Fixtures (fictional DEMO home)                                      */
/* ------------------------------------------------------------------ */

function selfSurvey(over: Partial<Survey> = {}): Survey {
  return {
    postcode: "SW16 9ZZ",
    addressLine: "1 Demo Street",
    archetypeId: "thirties-semi",
    property: { type: "semi-detached", era: "1930-1950", bedrooms: 3, ownership: "owner" },
    rooms: [
      {
        id: "self-r1",
        name: "Main bedroom",
        type: "bedroom",
        size: "medium",
        floor: "first",
        glazing: "medium",
        orientation: "south",
        hasExternalWall: true,
        photos: [{ id: "cust-p1", kind: "room" }],
      },
      {
        id: "self-r2",
        name: "Living room",
        type: "living-room",
        size: "large",
        floor: "ground",
        glazing: "high",
        orientation: "unsure",
        hasExternalWall: true,
        photos: [],
      },
    ],
    outdoor: { location: "ground-rear", photos: [{ id: "cust-o1", kind: "outdoor-location" }] },
    electrics: { condition: "modern-spare-ways", photos: [] },
    ...over,
  };
}

/** A room measured properly: every check passes. */
function measuredRoom(base: MeasuredRoom, over: Partial<MeasuredRoom> = {}): MeasuredRoom {
  return {
    ...base,
    lengthM: 4,
    widthM: 3.5,
    areaM2: 14,
    ceilingHeightM: 2.4,
    orientation: base.orientation === "unsure" ? "west" : base.orientation,
    pipeRunM: 5,
    heightDropM: 2.5,
    route: "external-trunking",
    condensate: "gravity",
    mediaIds: ["11111111-1111-4111-8111-111111111111"],
    ...over,
  };
}

const chosenPosition = (over: Partial<OutdoorPosition> = {}): OutdoorPosition => ({
  id: "outdoor-1",
  label: "Rear patio",
  location: "ground-rear",
  base: "ground-feet",
  accessEquipment: "none",
  chosen: true,
  mediaId: "22222222-2222-4222-8222-222222222222",
  distanceToNeighbourWindowM: 6,
  reflectingSurfaces: "two",
  heightM: 0,
  defrostDrainage: "Gravel strip to the gully",
  ...over,
});

/** A fully answered survey built from the prefill, the way a surveyor would finish it. */
function complete(): MeasuredSurvey {
  const m = emptyMeasuredSurvey(selfSurvey());
  return {
    ...m,
    site: { ...m.site, confirmedAddress: true, decisionMaker: "Alex Rivers", ownerConfirmed: true, tenure: "owner" },
    wishes: { ...m.wishes, heatingUse: "supplementary", priorities: ["quiet"] },
    house: { ...m.house, asbestosRisk: "none-suspected" },
    rooms: m.rooms.map((r) => measuredRoom(r)),
    outdoor: { positions: [chosenPosition()] },
    electrics: {
      ...m.electrics,
      boardType: "modern-rcbo",
      spareWays: 2,
      cableRouteM: 9,
      mediaIds: ["33333333-3333-4333-8333-333333333333"],
    },
    permissions: { pd: Object.fromEntries(PD_CHECKS.map((c) => [c.id, "yes"])) },
    risks: { ...m.risks, answered: ["workingAtHeight", "structuralConcern", "concealedServicesConcern"] },
  };
}

const missingItems = (m: MeasuredSurvey) => surveyCompleteness(m).missing.map((x) => x.item);

/* ------------------------------------------------------------------ */
/* Bands                                                               */
/* ------------------------------------------------------------------ */

test("size bands match the funnel's copy", () => {
  assert.equal(roomSizeForArea(6), "small");
  assert.equal(roomSizeForArea(9.9), "small");
  assert.equal(roomSizeForArea(10), "medium");
  assert.equal(roomSizeForArea(15.9), "medium");
  assert.equal(roomSizeForArea(16), "large");
  assert.equal(roomSizeForArea(24), "xl");
  assert.equal(roomSizeLabel("medium"), "Medium (10–16 m²)");
  assert.equal(roomSizeLabel("small"), "Small (under 10 m²)");
  assert.equal(roomSizeLabel("xl"), "Very large (24 m² or more)");
});

test("measured area: length × width beats a typed area, never a guess", () => {
  assert.equal(measuredRoomArea({ lengthM: 4.2, widthM: 3.4 }), 14.3);
  assert.equal(measuredRoomArea({ lengthM: 4, widthM: 3, areaM2: 20 }), 12);
  assert.equal(measuredRoomArea({ areaM2: 18.26 }), 18.3);
  assert.equal(measuredRoomArea({ lengthM: 4 }), undefined);
  assert.equal(measuredRoomArea({ areaM2: 0 }), undefined);
  assert.equal(measuredRoomArea({ lengthM: Number.NaN, widthM: 3, areaM2: 9 }), 9);
});

/* ------------------------------------------------------------------ */
/* Prefill                                                             */
/* ------------------------------------------------------------------ */

test("emptyMeasuredSurvey carries the customer's answers over to confirm, and guesses nothing measured", () => {
  const m = emptyMeasuredSurvey(selfSurvey());
  assert.equal(m.version, 1);
  assert.equal(m.house.type, "semi-detached");
  assert.equal(m.house.era, "1930-1950");
  assert.equal(m.house.asbestosRisk, "not-assessed");
  assert.equal(m.house.listedOrConservation, "unknown");
  assert.equal(m.house.storeys, 2);
  assert.equal(m.site.tenure, "owner");
  assert.equal(m.site.ownerConfirmed, false, "ownership is confirmed in person, never assumed");

  assert.equal(m.rooms.length, 2);
  const [bed, living] = m.rooms;
  assert.equal(bed!.name, "Main bedroom");
  assert.equal(bed!.type, "bedroom");
  assert.equal(bed!.floor, "first");
  assert.equal(bed!.orientation, "south");
  assert.equal(bed!.glazing, "medium");
  assert.equal(bed!.hasExternalWall, true);
  assert.equal(bed!.include, true);
  assert.equal(bed!.selfSurveyRoomId, "self-r1");
  assert.equal(bed!.id, "self-r1");
  assert.equal(bed!.condensate, "tbc");
  assert.deepEqual(bed!.mediaIds, []);
  assert.equal(bed!.areaM2, undefined, "the size band is a hint on screen, not a measurement");
  assert.equal(bed!.pipeRunM, undefined);
  assert.equal(living!.orientation, "unsure");

  assert.equal(m.outdoor.positions.length, 1);
  const guess = m.outdoor.positions[0]!;
  assert.equal(guess.location, "ground-rear");
  assert.equal(guess.chosen, false, "the surveyor picks the position");
  assert.match(guess.label, /Customer's choice/);

  assert.equal(m.electrics.boardType, "modern-rcd");
  assert.equal(m.electrics.spareWays, undefined);
  assert.deepEqual(m.permissions.pd, {});
  assert.deepEqual(m.risks.answered, []);
  assert.deepEqual(m.assumptions, []);
  assert.deepEqual(m.unknowns, []);
});

test("emptyMeasuredSurvey without a self-survey: a blank record that still asks the asbestos question", () => {
  const m = emptyMeasuredSurvey();
  assert.deepEqual(m.rooms, []);
  assert.deepEqual(m.outdoor.positions, []);
  assert.equal(m.electrics.boardType, "unknown");
  assert.equal(m.site.tenure, "unknown");
  assert.notEqual(m.house.era, "2000+");
  assert.ok(missingItems(m).includes("Asbestos risk assessed (built before 2000)"));
  assert.ok(missingItems(m).includes("At least one room to survey"));
});

test("emptyMeasuredSurvey: electrics guess, renting, flats, odd room ids, unsure outdoor", () => {
  const m = emptyMeasuredSurvey(
    selfSurvey({
      property: { type: "flat", era: "2000+", bedrooms: 1, ownership: "renting" },
      rooms: [
        { id: "../../evil id", name: "  ", type: "bedroom", size: "small", floor: "first", glazing: "low", orientation: "north", hasExternalWall: false, photos: [] },
        { id: "dup", name: "A", type: "other", size: "small", floor: "ground", glazing: "low", orientation: "north", hasExternalWall: true, photos: [] },
        { id: "dup", name: "B", type: "other", size: "small", floor: "ground", glazing: "low", orientation: "north", hasExternalWall: true, photos: [] },
      ],
      outdoor: { location: "unsure", photos: [] },
      electrics: { condition: "modern-full", photos: [] },
    }),
  );
  assert.equal(m.site.tenure, "tenant");
  assert.equal(m.house.storeys, 1);
  assert.equal(m.rooms[0]!.id, "room-1", "unsafe ids are replaced");
  assert.equal(m.rooms[0]!.name, "Room 1");
  assert.equal(m.rooms[0]!.hasExternalWall, false);
  assert.notEqual(m.rooms[1]!.id, m.rooms[2]!.id, "duplicate ids are made unique");
  assert.deepEqual(m.outdoor.positions, [], "no position from an unsure guess");
  assert.equal(m.electrics.boardType, "modern-rcd");
  assert.equal(m.electrics.spareWays, 0);
  const old = emptyMeasuredSurvey(selfSurvey({ electrics: { condition: "older-fuse-box", photos: [] } }));
  assert.equal(old.electrics.boardType, "older-fuse-box");
});

test("prefillFromPropertyIntel: designations from the property record, only when not yet answered", () => {
  const m = emptyMeasuredSurvey(selfSurvey());
  const flagged = prefillFromPropertyIntel(m, { conservationArea: true, listedBuilding: false, article4: true });
  assert.equal(flagged.house.listedOrConservation, "yes");
  assert.match(flagged.house.notes!, /conservation area, Article 4 direction/);
  assert.deepEqual(flagged.permissions.pd, {}, "planning checks are never answered for the surveyor");
  const clear = prefillFromPropertyIntel(m, { conservationArea: false, listedBuilding: false, article4: false });
  assert.equal(clear.house.listedOrConservation, "no");
  assert.match(clear.house.notes!, /Confirm on site/);
  const answered = { ...m, house: { ...m.house, listedOrConservation: "no" as const } };
  assert.equal(prefillFromPropertyIntel(answered, { listedBuilding: true }), answered, "an answer stands");
  assert.equal(prefillFromPropertyIntel(m, null), m);
});

/* ------------------------------------------------------------------ */
/* Completeness                                                        */
/* ------------------------------------------------------------------ */

test("a finished survey is 100% with nothing missing", () => {
  const c = surveyCompleteness(complete());
  assert.deepEqual(c.missing, []);
  assert.equal(c.pct, 100);
});

test("a fresh prefilled survey lists exactly what the visit has to find out", () => {
  const c = surveyCompleteness(emptyMeasuredSurvey(selfSurvey()));
  const items = c.missing.map((m) => `${m.section}: ${m.item}`);
  for (const expected of [
    "Site & people: Address confirmed",
    "Site & people: Who makes the decision",
    "Site & people: Owner, or authority to go ahead, confirmed",
    "Wishes: How they'll use it: heating, or cooling only",
    "House: Asbestos risk assessed (built before 2000)",
    "Rooms: Main bedroom: measurements",
    "Rooms: Main bedroom: ceiling height",
    "Rooms: Main bedroom: photo of the unit wall",
    "Rooms: Main bedroom: pipe run length",
    "Rooms: Main bedroom: height difference to the outdoor unit",
    "Rooms: Main bedroom: pipe route",
    "Rooms: Main bedroom: condensate, gravity or pump",
    "Rooms: Living room: which way the windows face",
    "Outdoor: Choose the outdoor unit position",
    "Electrics: Photo of the fuse board",
    "Electrics: Cable route length",
    "Risks: Asked about working at height",
  ]) {
    assert.ok(items.includes(expected), `missing list should include "${expected}"`);
  }
  assert.ok(!items.includes("Site & people: Tenure"), "tenure carried over from the customer counts");
  assert.ok(!items.includes("Rooms: Main bedroom: which way the windows face"), "the customer's orientation stands until corrected");
  assert.ok(!items.includes("Electrics: Fuse board type"), "the customer's board guess stands until corrected");
  for (const check of PD_CHECKS) assert.ok(items.includes(`Permissions: ${check.label}`));
  assert.ok(c.pct > 0 && c.pct < 50, `a fresh survey is mostly to do (${c.pct}%)`);
  // Jump-link ids ride along.
  const bedPhoto = c.missing.find((m) => m.item === "Main bedroom: photo of the unit wall")!;
  assert.equal(bedPhoto.sectionId, "rooms");
  assert.equal(bedPhoto.roomId, "self-r1");
  assert.equal(bedPhoto.field, "photos");
});

test("pct is weighted by items and never rounds up to 100 with something missing", () => {
  const m = complete();
  const one = { ...m, site: { ...m.site, decisionMaker: "" } };
  const c = surveyCompleteness(one);
  const total = surveyChecks(m).length;
  assert.equal(c.missing.length, 1);
  assert.equal(c.pct, Math.floor(((total - 1) / total) * 100));
  assert.ok(c.pct < 100);
  // Even with hundreds of checks, one gap never reads 100.
  const many = { ...m, rooms: Array.from({ length: 30 }, (_, i) => ({ ...m.rooms[0]!, id: `r${i}` })) };
  many.rooms[0] = { ...many.rooms[0]!, ceilingHeightM: undefined };
  assert.equal(surveyCompleteness(many).pct, 99);
  const half = { ...m, rooms: m.rooms.map((r) => ({ ...r, mediaIds: [], ceilingHeightM: undefined })) };
  const expected = Math.floor(((total - 4) / total) * 100);
  assert.equal(surveyCompleteness(half).pct, expected);
});

test("rooms: excluded rooms don't count; direct area works; a missing measurement is named", () => {
  const m = complete();
  const rooms = m.rooms.map((r, i) => (i === 1 ? { ...r, include: false, lengthM: undefined, widthM: undefined, areaM2: undefined } : r));
  assert.equal(surveyCompleteness({ ...m, rooms }).pct, 100, "a left-out room asks for nothing");
  const direct = m.rooms.map((r) => ({ ...r, lengthM: undefined, widthM: undefined, areaM2: 13.2 }));
  assert.equal(surveyCompleteness({ ...m, rooms: direct }).pct, 100);
  const none = m.rooms.map((r) => ({ ...r, include: false }));
  assert.deepEqual(missingItems({ ...m, rooms: none }), ["At least one room to survey"]);
  const zero = m.rooms.map((r, i) => (i === 0 ? { ...r, pipeRunM: 0, heightDropM: 0 } : r));
  assert.deepEqual(missingItems({ ...m, rooms: zero }), ["Main bedroom: pipe run length"], "a zero height difference is a real answer");
});

test("rooms: no outside wall means the pipes can't go straight through", () => {
  const m = complete();
  const rooms = m.rooms.map((r, i) => (i === 0 ? { ...r, hasExternalWall: false, route: "through-wall" as const } : r));
  assert.deepEqual(missingItems({ ...m, rooms }), ["Main bedroom: pipe route (no outside wall, so not straight through)"]);
  const fixed = m.rooms.map((r, i) => (i === 0 ? { ...r, hasExternalWall: false, route: "via-loft" as const } : r));
  assert.equal(surveyCompleteness({ ...m, rooms: fixed }).pct, 100);
});

test("outdoor: a chosen position needs its photo, neighbour distance and drainage; height brings access equipment", () => {
  const m = complete();
  assert.deepEqual(missingItems({ ...m, outdoor: { positions: [chosenPosition({ chosen: false })] } }), ["Choose the outdoor unit position"]);
  assert.deepEqual(
    missingItems({ ...m, outdoor: { positions: [chosenPosition({ mediaId: undefined, distanceToNeighbourWindowM: undefined, reflectingSurfaces: undefined, defrostDrainage: " " })] } }),
    ["Rear patio: photo", "Rear patio: distance to the nearest neighbour's window", "Rear patio: hard surfaces within 1 m (for the noise calculation)", "Rear patio: where defrost water will drain"],
  );
  assert.deepEqual(
    missingItems({ ...m, outdoor: { positions: [chosenPosition({ base: "wall-bracket", heightM: undefined })] } }),
    ["Rear patio: mounting height"],
  );
  assert.deepEqual(
    missingItems({ ...m, outdoor: { positions: [chosenPosition({ base: "wall-bracket", heightM: 3.5 })] } }),
    ["Rear patio: access equipment for a unit 3.5 m up"],
  );
  assert.equal(surveyCompleteness({ ...m, outdoor: { positions: [chosenPosition({ base: "wall-bracket", heightM: 3.5, accessEquipment: "tower" })] } }).pct, 100);
  assert.equal(
    surveyCompleteness({ ...m, outdoor: { positions: [chosenPosition({ base: "wall-bracket", heightM: ACCESS_EQUIPMENT_HEIGHT_M - 0.5 })] } }).pct,
    100,
  );
  // An unchosen alternative asks for nothing.
  const both = [chosenPosition(), chosenPosition({ id: "outdoor-2", label: "Side passage", chosen: false, mediaId: undefined })];
  assert.equal(surveyCompleteness({ ...m, outdoor: { positions: both } }).pct, 100);
  const zero = { ...m, outdoor: { positions: [chosenPosition({ distanceToNeighbourWindowM: 0 })] } };
  assert.equal(surveyCompleteness(zero).pct, 100, "0 m is a real (bad) distance, not a missing one");
});

test("electrics: board, photo, cable route, and the flash-guard check on older boards", () => {
  const m = complete();
  assert.deepEqual(missingItems({ ...m, electrics: { ...m.electrics, boardType: "unknown", mediaIds: [], cableRouteM: undefined } }), [
    "Fuse board type",
    "Photo of the fuse board",
    "Cable route length",
  ]);
  const old = { ...m, electrics: { ...m.electrics, boardType: "older-fuse-box" as const } };
  assert.deepEqual(missingItems(old), ["Asbestos flash guard checked (older board)"]);
  assert.equal(surveyCompleteness({ ...old, electrics: { ...old.electrics, asbestosFlashGuard: "no" } }).pct, 100);
});

test("house: pre-2000 homes can't skip the asbestos question; a concern needs a note", () => {
  const m = complete();
  assert.deepEqual(missingItems({ ...m, house: { ...m.house, asbestosRisk: "not-assessed" } }), ["Asbestos risk assessed (built before 2000)"]);
  assert.equal(surveyCompleteness({ ...m, house: { ...m.house, era: "2000+", asbestosRisk: "not-assessed" } }).pct, 100);
  assert.deepEqual(missingItems({ ...m, house: { ...m.house, asbestosRisk: "suspected" } }), ["Asbestos: what you saw and where"]);
  assert.equal(surveyCompleteness({ ...m, house: { ...m.house, asbestosRisk: "possible", asbestosNote: "Artex ceiling, landing" } }).pct, 100);
});

test("permissions: every PD check answered; unsure is an answer (it goes to the planning route)", () => {
  const m = complete();
  const pd = { ...m.permissions.pd };
  delete pd["noise-ok"];
  assert.deepEqual(missingItems({ ...m, permissions: { pd } }), [PD_CHECKS.find((c) => c.id === "noise-ok")!.label]);
  const unsure = { ...m, permissions: { pd: { ...m.permissions.pd, "article4-checked": "unsure" as const } } };
  assert.equal(surveyCompleteness(unsure).pct, 100);
});

test("risks: each question must be asked; older records without the list count as asked; concerns need notes", () => {
  const m = complete();
  assert.deepEqual(missingItems({ ...m, risks: { ...m.risks, answered: ["workingAtHeight"] } }), [
    "Asked about structural concerns",
    "Asked about hidden pipes and cables",
  ]);
  const legacy = { ...m, risks: { workingAtHeight: false, structuralConcern: false, concealedServicesConcern: false } };
  assert.equal(surveyCompleteness(legacy).pct, 100);
  assert.equal(surveyCompleteness({ ...legacy, risks: { ...legacy.risks, concealedServicesConcern: true } }).pct, 100);
  assert.deepEqual(missingItems({ ...m, risks: { ...m.risks, structuralConcern: true } }), ["Say what the concern is"]);
  assert.equal(RISK_QUESTIONS.length, 3);
});

test("site: decision maker, owner confirmation and tenure", () => {
  const m = complete();
  assert.deepEqual(missingItems({ ...m, site: { ...m.site, tenure: "unknown", ownerConfirmed: false, decisionMaker: "   ", confirmedAddress: false } }), [
    "Address confirmed",
    "Who makes the decision",
    "Owner, or authority to go ahead, confirmed",
    "Tenure",
  ]);
  assert.deepEqual(missingItems({ ...m, wishes: { ...m.wishes, heatingUse: "unsure" } }), ["How they'll use it: heating, or cooling only"]);
});

test("completeness tolerates a partial record read back from the database", () => {
  const partial = { version: 1 } as unknown as MeasuredSurvey;
  const c = surveyCompleteness(partial);
  assert.ok(c.missing.length > 10);
  assert.ok(c.pct < 100);
  assert.doesNotThrow(() => surveyCompleteness({} as MeasuredSurvey));
});

test("sectionProgress counts per section and adds up to the checks", () => {
  const m = emptyMeasuredSurvey(selfSurvey());
  const progress = sectionProgress(m);
  assert.deepEqual(Object.keys(progress), SURVEY_SECTIONS.map((s) => s.id));
  const total = Object.values(progress).reduce((n, p) => n + p.total, 0);
  assert.equal(total, surveyChecks(m).length);
  assert.equal(progress.permissions.total, PD_CHECKS.length);
  assert.equal(progress.permissions.done, 0);
  const full = sectionProgress(complete());
  for (const p of Object.values(full)) assert.equal(p.done, p.total);
});

/* ------------------------------------------------------------------ */
/* Engines                                                             */
/* ------------------------------------------------------------------ */

test("measuredToEngineSurvey: measured areas, bands, floors and the chosen outdoor spot reach the engine", () => {
  const base = selfSurvey();
  const m = complete();
  m.rooms[0] = { ...m.rooms[0]!, lengthM: 5, widthM: 4.2, floor: "ground", hasExternalWall: false, route: "via-loft" };
  m.outdoor.positions = [chosenPosition({ chosen: false, location: "ground-rear" }), chosenPosition({ id: "o2", location: "wall-bracket", chosen: true, mediaId: "m-out" })];
  const engine = measuredToEngineSurvey(m, base);
  assert.equal(engine.postcode, base.postcode);
  assert.equal(engine.archetypeId, "thirties-semi");
  assert.equal(engine.rooms.length, 2);
  const bed = engine.rooms[0]!;
  assert.equal(bed.areaM2, 21);
  assert.equal(bed.size, "large");
  assert.equal(bed.floor, "ground");
  assert.equal(bed.hasExternalWall, false);
  assert.deepEqual(
    bed.photos.map((p) => p.id),
    ["cust-p1", "11111111-1111-4111-8111-111111111111"],
    "the customer's photos are kept and the survey's added",
  );
  assert.equal(engine.rooms[1]!.orientation, "west");
  assert.equal(engine.outdoor.location, "wall-bracket");
  assert.deepEqual(engine.outdoor.photos.map((p) => p.id), ["cust-o1", "m-out"]);
  assert.equal(engine.electrics.condition, "modern-spare-ways");
  assert.equal(engine.electrics.photos.at(-1)!.kind, "fuse-board");
  // The pricing engine runs on it.
  const quote = generateQuote(engine);
  assert.ok(quote.totalGbp > 0);
});

test("measuredToEngineSurvey: excluded rooms drop out; unmeasured rooms keep the customer's band", () => {
  const base = selfSurvey();
  const m = emptyMeasuredSurvey(base);
  m.rooms[0] = { ...m.rooms[0]!, include: false };
  const engine = measuredToEngineSurvey(m, base);
  assert.equal(engine.rooms.length, 1);
  assert.equal(engine.rooms[0]!.size, "large");
  assert.equal(engine.rooms[0]!.areaM2, undefined);
  assert.equal(engine.outdoor.location, "ground-rear", "no position chosen yet: the customer's guess stands");
  assert.equal(engine.electrics.condition, "modern-spare-ways", "modern board, ways not counted: keep the customer's answer");
});

test("measuredToEngineSurvey: electrics and tenure mapping", () => {
  const base = selfSurvey();
  const m = complete();
  const full = measuredToEngineSurvey({ ...m, electrics: { ...m.electrics, spareWays: 0 } }, base);
  assert.equal(full.electrics.condition, "modern-full");
  const old = measuredToEngineSurvey({ ...m, electrics: { ...m.electrics, boardType: "older-fuse-box" } }, base);
  assert.equal(old.electrics.condition, "older-fuse-box");
  const unknown = measuredToEngineSurvey({ ...m, electrics: { ...m.electrics, boardType: "unknown" } }, base);
  assert.equal(unknown.electrics.condition, "modern-spare-ways");
  assert.equal(measuredToEngineSurvey({ ...m, site: { ...m.site, tenure: "tenant" } }, base).property.ownership, "renting");
  assert.equal(measuredToEngineSurvey({ ...m, house: { ...m.house, type: "terraced" } }, base).property.type, "terraced");
});

test("electricsConditionFound and electricsFinding: plain, honest statuses", () => {
  assert.equal(electricsConditionFound({ boardType: "modern-rcbo", spareWays: 2 }), "modern-spare-ways");
  assert.equal(electricsConditionFound({ boardType: "modern-rcd", spareWays: 0 }), "modern-full");
  assert.equal(electricsConditionFound({ boardType: "modern-rcd" }), undefined);
  assert.equal(electricsConditionFound({ boardType: "unknown", spareWays: 3 }), undefined);

  const m = complete();
  assert.equal(electricsFinding(m)!.status, "validated");
  assert.match(electricsFinding(m)!.summary, /2 spare ways/);
  assert.equal(electricsFinding({ ...m, electrics: { ...m.electrics, spareWays: 1 } })!.summary.includes("1 spare way for the new circuit"), true);
  assert.doesNotMatch(electricsFinding(m)!.summary, /straightforward/, "spare ways alone don't say the supply can take it");
  assert.match(electricsFinding(m)!.summary, /electrician confirms your supply can take it/);
  assert.equal(electricsFinding({ ...m, electrics: { ...m.electrics, spareWays: 0 } })!.status, "attention");
  assert.equal(electricsFinding({ ...m, electrics: { ...m.electrics, spareWays: undefined } })!.status, "provisional");
  assert.equal(electricsFinding({ ...m, electrics: { ...m.electrics, boardType: "older-fuse-box" } })!.status, "attention");
  assert.match(electricsFinding({ ...m, electrics: { ...m.electrics, asbestosFlashGuard: "possible" } })!.summary, /asbestos/);
  assert.equal(electricsFinding({ ...m, electrics: { ...m.electrics, boardType: "unknown" } }), undefined);
});

/* ------------------------------------------------------------------ */
/* Diff                                                                */
/* ------------------------------------------------------------------ */

test("diffSelfSurvey: a customer who got everything right scores 100%", () => {
  const self = selfSurvey();
  const m = complete();
  // Measured sizes inside the customer's bands: medium (14 m²) and large (20 m²).
  m.rooms[1] = { ...m.rooms[1]!, lengthM: 5, widthM: 4 };
  const rows = diffSelfSurvey(self, m);
  assert.equal(diffAccuracyPct(rows), 100);
  const fields = rows.map((r) => `${r.room}|${r.field}`);
  for (const f of [
    "Whole home|Property type",
    "Whole home|Built",
    "Whole home|Rooms to air-condition",
    "Main bedroom|Size",
    "Main bedroom|Floor",
    "Main bedroom|Outside wall",
    "Living room|Size",
    "Outside|Outdoor unit spot",
    "Electrics|Fuse board",
  ]) {
    assert.ok(fields.includes(f), `diff should have ${f}`);
  }
  const size = rows.find((r) => r.room === "Main bedroom" && r.field === "Size")!;
  assert.equal(size.customerSaid, "Medium (10–16 m²)");
  assert.equal(size.measured, "14 m² (medium)");
});

test("diffSelfSurvey: mismatches, near-misses and things that can't be compared", () => {
  const self = selfSurvey({ electrics: { condition: "unsure", photos: [] } });
  const m = complete();
  m.rooms[0] = { ...m.rooms[0]!, lengthM: 4.1, widthM: 4, floor: "loft", hasExternalWall: false }; // 16.4 m², just over medium
  m.rooms[1] = { ...m.rooms[1]!, lengthM: 6, widthM: 5 }; // 30 m², xl, customer said large
  m.rooms.push({ ...m.rooms[1]!, id: "extra", name: "Home office", selfSurveyRoomId: undefined });
  m.outdoor.positions = [chosenPosition({ location: "ground-side" })];
  const rows = diffSelfSurvey(self, m);
  const row = (room: string, field: string) => rows.find((r) => r.room === room && r.field === field)!;
  assert.equal(row("Main bedroom", "Size").match, false);
  assert.equal(row("Main bedroom", "Size").note, "Just over the customer's band");
  assert.equal(row("Living room", "Size").note, "Bigger than the customer thought");
  assert.equal(row("Main bedroom", "Floor").match, false);
  assert.equal(row("Main bedroom", "Outside wall").match, false);
  assert.equal(row("Whole home", "Rooms to air-condition").match, false);
  assert.equal(row("Whole home", "Rooms to air-condition").measured, "3");
  assert.equal(row("Home office", "Room").measured, "Added at the survey");
  assert.equal(row("Home office", "Room").match, null);
  assert.equal(row("Outside", "Outdoor unit spot").match, false);
  assert.equal(row("Electrics", "Fuse board").match, null, "the customer wasn't sure");
  const pct = diffAccuracyPct(rows)!;
  assert.ok(pct > 0 && pct < 100);
});

test("diffSelfSurvey: rooms left out or never surveyed, unmeasured sizes, uncounted ways", () => {
  const self = selfSurvey();
  const m = emptyMeasuredSurvey(self);
  m.rooms[0] = { ...m.rooms[0]!, include: false };
  m.rooms = m.rooms.slice(0, 1);
  const rows = diffSelfSurvey(self, m);
  const find = (room: string, field: string) => rows.find((r) => r.room === room && r.field === field);
  assert.equal(find("Main bedroom", "Room")!.measured, "Left out at the survey");
  assert.equal(find("Living room", "Room")!.measured, "Not surveyed");
  assert.equal(find("Outside", "Outdoor unit spot")!.match, null, "nothing chosen yet");
  assert.equal(find("Electrics", "Fuse board")!.note, "Spare ways not counted");

  const unmeasured = diffSelfSurvey(self, emptyMeasuredSurvey(self));
  assert.equal(unmeasured.find((r) => r.room === "Living room" && r.field === "Size")!.measured, "Not measured");
  assert.equal(unmeasured.find((r) => r.room === "Living room" && r.field === "Size")!.match, null);
});

test("diffSelfSurvey uses the customer's own area when they gave one", () => {
  const self = selfSurvey();
  self.rooms[0] = { ...self.rooms[0]!, areaM2: 17 };
  const m = complete();
  const row = diffSelfSurvey(self, m).find((r) => r.room === "Main bedroom" && r.field === "Size")!;
  assert.equal(row.customerSaid, "17 m²");
  assert.equal(row.match, false);
  assert.equal(row.note, "Smaller than the customer thought");
});

test("diffAccuracyPct: only real comparisons count", () => {
  assert.equal(diffAccuracyPct([]), null);
  assert.equal(diffAccuracyPct([{ room: "a", field: "b", customerSaid: "", measured: "", match: null }]), null);
  assert.equal(
    diffAccuracyPct([
      { room: "a", field: "b", customerSaid: "", measured: "", match: true },
      { room: "a", field: "c", customerSaid: "", measured: "", match: false },
      { room: "a", field: "d", customerSaid: "", measured: "", match: true },
      { room: "a", field: "e", customerSaid: "", measured: "", match: null },
    ]),
    67,
  );
});
