import assert from "node:assert/strict";
import { test } from "node:test";
import { DEMO_CATALOGUE, DEMO_COMPATIBILITY, type CatalogueItem } from "./catalogue.ts";
import { RESEARCHED_CATALOGUE, RESEARCHED_COMPATIBILITY } from "./catalogue-data.ts";
import {
  A2L_ROOM_CHECK_ABOVE_KG,
  COMBINATION_TABLE_ACK,
  PRELIMINARY_LOAD_LABEL,
  a2lMaxChargeKg,
  a2lMinFloorAreaM2,
  addDecibels,
  applyDesignEdits,
  approveDesign,
  bomLineFlags,
  designApprovalErrors,
  designDeviations,
  designInputsKey,
  draftDesign,
  editsFromDesign,
  hydrateDesign,
  layoutMediaIdsOf,
  manufacturerLimitsCheck,
  needsCombinationAck,
  recomputeVariant,
  refrigerantFor,
  soundPressureDb,
  type DesignEdits,
  type DesignRecord,
} from "./design-record.ts";
import { emptyConstraints, emptyMarketing, emptyPlanning, type PropertyIntel } from "./intelligence.ts";
import { runsheetFromDesign } from "./install.ts";
import { premiumIsQuieter } from "./proposal.ts";
import type { MeasuredRoom, MeasuredSurvey, OutdoorPosition } from "./survey-visit.ts";
import type { Survey } from "./types.ts";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const NOW = "2026-10-18T10:00:00.000Z";

function room(id: string, name: string, over: Partial<MeasuredRoom> = {}): MeasuredRoom {
  return {
    id,
    name,
    type: "bedroom",
    floor: "first",
    include: true,
    lengthM: 4,
    widthM: 3.5,
    ceilingHeightM: 2.4,
    glazing: "medium",
    orientation: "south",
    hasExternalWall: true,
    pipeRunM: 6,
    heightDropM: 3,
    route: "external-trunking",
    condensate: "gravity",
    mediaIds: [`photo-${id}`],
    ...over,
  };
}

const ROOMS = [
  room("r1", "Main bedroom"),
  room("r2", "Living room", { type: "living-room", floor: "ground", lengthM: 5.5, widthM: 4, pipeRunM: 3, heightDropM: 0.5, route: "through-wall" }),
  room("r3", "Office", { type: "home-office", lengthM: 3, widthM: 2.6, pipeRunM: 9 }),
  room("r4", "Second bedroom", { pipeRunM: 8 }),
];

function position(over: Partial<OutdoorPosition> = {}): OutdoorPosition {
  return { id: "o1", label: "Rear patio", location: "ground-rear", base: "ground-feet", reflectingSurfaces: "two", accessEquipment: "none", distanceToNeighbourWindowM: 8, chosen: true, mediaId: "photo-out", ...over };
}

function survey(rooms: MeasuredRoom[], over: Partial<MeasuredSurvey> = {}): MeasuredSurvey {
  return {
    version: 1,
    site: { confirmedAddress: true, ownerConfirmed: true, tenure: "owner" },
    wishes: { priorities: ["quiet"], heatingUse: "supplementary" },
    house: { type: "semi-detached", era: "1930-1950", wallConstruction: "cavity", storeys: 2, loftAccess: true, listedOrConservation: "no", asbestosRisk: "none-suspected" },
    rooms,
    outdoor: { positions: [position()] },
    electrics: { boardType: "modern-rcbo", spareWays: 2, earthing: "TN-C-S", cableRouteM: 9, asbestosFlashGuard: "no", mediaIds: [] },
    permissions: {
      pd: { "heating-use": "yes", "not-listed": "yes", "not-conservation-front": "yes", "volume-ok": "yes", "unit-count-ok": "yes", "noise-ok": "yes", "siting-minimises-impact": "yes", "article4-checked": "yes" },
    },
    risks: { workingAtHeight: false, structuralConcern: false, concealedServicesConcern: false },
    assumptions: [],
    unknowns: [],
    ...over,
  };
}

const BASE: Survey = {
  postcode: "SW16 1AA",
  addressLine: "1 Test Road",
  property: { type: "semi-detached", era: "1930-1950", bedrooms: 3, ownership: "owner" },
  rooms: [],
  outdoor: { location: "ground-rear", photos: [] },
  electrics: { condition: "modern-spare-ways", photos: [] },
};

const INTEL: PropertyIntel = {
  id: "t",
  address: { line1: "1 Test Road", postcode: "SW16 1AA", outcode: "SW16" },
  planning: emptyPlanning(),
  constraints: emptyConstraints(),
  marketing: emptyMarketing(),
};

function draft(rooms: MeasuredRoom[], opts: { catalogue?: CatalogueItem[]; compat?: typeof DEMO_COMPATIBILITY; measured?: Partial<MeasuredSurvey>; intel?: PropertyIntel | null } = {}): DesignRecord {
  return draftDesign({
    projectId: "p1",
    id: "d1",
    version: 1,
    measured: survey(rooms, opts.measured),
    baseSurvey: BASE,
    catalogue: opts.catalogue ?? DEMO_CATALOGUE,
    compatibility: opts.compat ?? DEMO_COMPATIBILITY,
    ...(opts.intel === null ? {} : { intel: opts.intel ?? INTEL }),
    now: NOW,
  });
}

const rule = (d: DesignRecord, variant: string, id: string) => {
  const r = d.variants.find((v) => v.id === variant)!.rules.find((x) => x.id === id);
  assert.ok(r, `rule ${id}`);
  return r;
};
const standard = (d: DesignRecord) => d.variants.find((v) => v.id === "standard")!;

const ctx = (d: DesignRecord, catalogue = DEMO_CATALOGUE, compatibility = DEMO_COMPATIBILITY) => ({
  catalogue,
  compatibility,
  by: "Tess Lead (DEMO)",
  at: "2026-10-19T09:00:00.000Z",
  id: "d2",
  version: d.version + 1,
});

/* ------------------------------------------------------------------ */
/* Drafting: 1, 2, 3 and 4 rooms                                       */
/* ------------------------------------------------------------------ */

test("one room: a single split on its listed pair, Standard and Quiet", () => {
  const d = draft(ROOMS.slice(0, 1));
  assert.equal(d.status, "draft");
  assert.deepEqual(d.variants.map((v) => [v.id, v.label, v.tier]), [["standard", "Standard", "standard"], ["premium", "Quiet", "premium"]]);
  const s = standard(d);
  assert.equal(s.systems.length, 1);
  assert.equal(s.systems[0]!.topology, "single");
  assert.equal(s.systems[0]!.outdoorItemId, "demo-out-brz25");
  assert.deepEqual(s.roomUnits, [{ roomId: "r1", indoorItemId: "demo-ind-brz25" }]);
  assert.equal(d.variants[1]!.roomUnits[0]!.indoorItemId, "demo-ind-whs25");
  assert.equal(s.systems[0]!.outdoorPositionId, "o1");
  assert.deepEqual(s.systems[0]!.layoutMediaIds, ["photo-out"]);
  assert.equal(s.installDays, 1);
  // The load is labelled as a rule of thumb, with the numbers.
  assert.ok(rule(d, "standard", "capacity").detail.includes(PRELIMINARY_LOAD_LABEL));
  assert.match(rule(d, "standard", "capacity").detail, /Main bedroom: 1,778 W → DM-BRZ25 \(2\.5 kW\)/);
  assert.equal(d.rooms[0]!.preliminaryLoadW, 1778);
  assert.equal(d.rooms[0]!.suggestedKw, 2.5);
  assert.deepEqual(d.rooms[0]!.layoutMediaIds, ["photo-r1"]);
  assert.deepEqual(designApprovalErrors(d), []);
  // Round 9: an outdoor unit whose charge rate the catalogue doesn't have can't be approved (the install day would read "0 g").
  const unknownCharge = { ...d, variants: d.variants.map((v) => ({ ...v, systems: v.systems.map((x) => ({ ...x, refrigerant: { ...x.refrigerant, chargeKnown: false } })) })) };
  assert.ok(designApprovalErrors(unknownCharge).some((e) => /no pre-charged pipe length or extra charge per metre/.test(e)));
});

test("two rooms: one verified multi-split; no acknowledgement needed", () => {
  const d = draft(ROOMS.slice(0, 2));
  const s = standard(d);
  assert.equal(s.systems.length, 1);
  assert.equal(s.systems[0]!.topology, "multi");
  assert.equal(s.systems[0]!.outdoorItemId, "demo-out-duo50");
  assert.equal(s.systems[0]!.ruleConfidence, "verified");
  assert.deepEqual(s.systems[0]!.compatibility, { ok: true, errors: [], warnings: [] });
  assert.equal(needsCombinationAck(d), false);
  assert.equal(rule(d, "standard", "compatibility").status, "pass");
  assert.equal(rule(d, "standard", "unit-count").status, "pass");
  assert.equal(s.installDays, 2);
});

test("three rooms: the three-port multi-split", () => {
  const d = draft(ROOMS.slice(0, 3));
  const s = standard(d);
  assert.deepEqual(s.systems.map((x) => [x.outdoorItemId, x.roomIds]), [["demo-out-trio52", ["r1", "r2", "r3"]]]);
  assert.equal(s.systems[0]!.refrigerant.totalPipeM, 18);
});

test("four rooms: too much for one outdoor unit, so two multi-splits, and the planning limit says so", () => {
  const d = draft(ROOMS);
  const s = standard(d);
  assert.equal(s.systems.length, 2);
  assert.ok(s.systems.every((x) => x.topology === "multi" && x.outdoorItemId === "demo-out-duo50"));
  assert.deepEqual(s.systems.map((x) => x.roomIds), [["r1", "r3"], ["r2", "r4"]]);
  assert.equal(rule(d, "standard", "unit-count").status, "review");
  assert.match(rule(d, "standard", "unit-count").detail, /permitted development allows 1/);
  assert.equal(rule(d, "standard", "topology").status, "review");
  assert.equal(s.installDays, 3);
});

test("no multi-split rule in the catalogue: separate single splits, never a guessed multi", () => {
  const d = draft(ROOMS.slice(0, 2), { compat: [] });
  const s = standard(d);
  assert.deepEqual(s.systems.map((x) => [x.topology, x.outdoorItemId]), [["single", "demo-out-brz25"], ["single", "demo-out-brz35"]]);
  assert.ok(s.systems.every((x) => x.compatibility.ok));
  assert.equal(rule(d, "standard", "unit-count").status, "review");
});

test("the researched catalogue: one brand per option, multi-splits on provisional rules need the tech lead's check", () => {
  const d = draft(ROOMS.slice(0, 2), { catalogue: RESEARCHED_CATALOGUE, compat: RESEARCHED_COMPATIBILITY });
  const s = standard(d);
  assert.equal(s.manufacturer, "Panasonic");
  assert.equal(s.systems[0]!.outdoorItemId, "panasonic-cu-2z50cbe");
  assert.equal(s.systems[0]!.ruleConfidence, "provisional");
  const quiet = d.variants.find((v) => v.id === "premium")!;
  assert.deepEqual(quiet.roomUnits.map((u) => u.indoorItemId), ["panasonic-cs-z25ckew", "panasonic-cs-z35ckew"]); // the main model, not the silver variant
  assert.ok(needsCombinationAck(d));
  assert.ok(designApprovalErrors(d).some((e) => e.includes(COMBINATION_TABLE_ACK)));
  assert.equal(rule(d, "standard", "compatibility").status, "review");
  // Panasonic outdoor units have no published LWA in the research: the noise rule can't run.
  assert.equal(rule(d, "standard", "noise").status, "fail");
  assert.match(rule(d, "standard", "noise").detail, /add the outdoor unit's sound power \(LWA\) for CU-2Z50CBE/);
  assert.equal(s.verdict, "cannot-determine");

  const signed = approveDesign(d, { staffId: "s1", name: "Tess Lead (DEMO)", qualificationRef: "FGAS-123" }, NOW, { combinationTableChecked: true });
  assert.equal(signed.ok, true);
  if (signed.ok) {
    assert.equal(signed.design.status, "approved");
    assert.deepEqual(signed.design.acknowledgements, { combinationTable: { by: "Tess Lead (DEMO)", at: NOW } });
    assert.deepEqual(signed.design.approval, { staffId: "s1", name: "Tess Lead (DEMO)", qualificationRef: "FGAS-123", at: NOW });
  }
  const unticked = approveDesign(d, { staffId: "s1", name: "Tess", qualificationRef: "FGAS-123" }, NOW, { combinationTableChecked: false });
  assert.equal(unticked.ok, false);
});

test("a preferred brand wins when it has units in the tier", () => {
  const d = draftDesign({
    projectId: "p1",
    id: "d1",
    version: 1,
    measured: survey(ROOMS.slice(0, 1)),
    baseSurvey: BASE,
    catalogue: RESEARCHED_CATALOGUE,
    compatibility: RESEARCHED_COMPATIBILITY,
    now: NOW,
    manufacturer: "Mitsubishi Electric",
  });
  assert.ok(d.variants.every((v) => v.manufacturer === "Mitsubishi Electric"));
  assert.ok(d.variants.every((v) => v.roomUnits.every((u) => u.indoorItemId.startsWith("mitsubishi-electric-"))));
});

test("a tier with nothing in the catalogue is left out; an empty catalogue says so plainly", () => {
  const standardOnly = DEMO_CATALOGUE.filter((i) => i.tier !== "premium");
  assert.deepEqual(draft(ROOMS.slice(0, 1), { catalogue: standardOnly }).variants.map((v) => v.id), ["standard"]);
  const empty = draft(ROOMS.slice(0, 1), { catalogue: [] });
  assert.equal(empty.variants.length, 1);
  assert.ok(designApprovalErrors(empty).some((e) => e.includes("choose an indoor unit for Main bedroom")));
  const none = draft([{ ...ROOMS[0]!, include: false }]);
  assert.equal(none.rooms.length, 0);
  assert.equal(standard(none).rules[0]!.status, "fail");
  assert.ok(designApprovalErrors(none).includes("No rooms are included in the design."));
});

/* ------------------------------------------------------------------ */
/* Measured vs estimated, charge, noise, electrics, BOM                */
/* ------------------------------------------------------------------ */

test("blank survey fields are estimated and flagged, never passed off as measured", () => {
  const d = draft([room("r1", "Box room", { pipeRunM: undefined, heightDropM: undefined, condensate: "tbc", lengthM: undefined, widthM: undefined, areaM2: undefined, hasExternalWall: false })]);
  const r = d.rooms[0]!;
  assert.deepEqual(r.estimated, ["area", "pipeRunM", "heightDiffM", "condensate"]);
  assert.equal(r.pipeRunM, 11); // first floor + no external wall
  assert.equal(r.condensate, "pump");
  assert.equal(rule(d, "standard", "pipe-limits").status, "review");
  assert.match(rule(d, "standard", "pipe-limits").detail, /Estimated, not measured: Box room/);
  assert.equal(rule(d, "standard", "drainage").status, "review");
  assert.equal(rule(d, "standard", "mounting").status, "review");
  const bom = standard(d).bom;
  assert.ok(bom.some((l) => l.catalogueItemId === "demo-mat-pump"));
});

test("additional charge = max(0, run − chargeless length) × g/m, from the outdoor unit's own figures", () => {
  const pan = RESEARCHED_CATALOGUE.find((i) => i.id === "panasonic-cu-z25cke")!; // 7.5 m chargeless, 10 g/m
  assert.deepEqual(refrigerantFor(pan, [12]), { totalPipeM: 12, prechargedPipeM: 7.5, additionalChargeG: 45, chargeKnown: true });
  assert.equal(refrigerantFor(pan, [7]).additionalChargeG, 0);
  const daikinMulti = RESEARCHED_CATALOGUE.find((i) => i.id === "daikin-3mxm52a2v1b8")!; // 30 m, 20 g/m
  assert.equal(refrigerantFor(daikinMulti, [12, 14, 9]).additionalChargeG, 100);
  const unknown = RESEARCHED_CATALOGUE.find((i) => i.id === "mitsubishi-electric-muz-ay35vg")!;
  assert.equal(refrigerantFor(unknown, [5]).chargeKnown, false);

  // A long run past the factory charge shows up in the rule and the bill.
  const long = draft([room("r1", "Main bedroom", { pipeRunM: 18 })]);
  const sys = standard(long).systems[0]!;
  assert.equal(sys.refrigerant.additionalChargeG, 60); // (18 − 15) × 20
  assert.match(rule(long, "standard", "refrigerant").detail, /add 60 g of R32/);
  const r32 = standard(long).bom.find((l) => l.catalogueItemId === "demo-mat-r32")!;
  assert.equal(r32.qty, 0.1);
});

test("the refrigerant rule says 'cannot determine' rather than inventing a charge", () => {
  const blind = DEMO_CATALOGUE.map((i) => (i.id === "demo-out-brz25" ? { ...i, specs: { ...i.specs, prechargedPipeM: null } } : i));
  const d = draft(ROOMS.slice(0, 1), { catalogue: blind });
  assert.equal(rule(d, "standard", "refrigerant").status, "fail");
  assert.match(rule(d, "standard", "refrigerant").detail, /Cannot determine the extra charge/);
});

test("noise: the MCS 020(a) estimate from the unit's LWA, the measured distance and the counted surfaces", () => {
  assert.equal(Math.round(soundPressureDb(59, 6, 4) * 10) / 10, 38.5);
  assert.equal(Math.round(addDecibels([40, 40]) * 10) / 10, 43);
  const near = draft(ROOMS.slice(0, 1), { measured: { outdoor: { positions: [position({ distanceToNeighbourWindowM: 2 })] } } });
  assert.equal(rule(near, "standard", "noise").status, "review");
  assert.match(rule(near, "standard", "noise").detail, /over the 37\.0 dB\(A\) MCS 020\(a\) allows the heat pump at the assessment position \(the 42 dB\(A\) limit includes an assumed 40 dB\(A\) background\)/);
  // DM-BRZ25-O, 59 dB(A) LWA, 8 m, against one wall (Q4): 36.0 dB(A), at least 1 dB under 37.0.
  const far = draft(ROOMS.slice(0, 1));
  assert.equal(rule(far, "standard", "noise").status, "pass");
  assert.match(rule(far, "standard", "noise").detail, /^About 36 dB\(A\) from the heat pump, under the 37\.0 dB\(A\)/);
  // The review's case: 38.5 dB(A) (61 dB(A) LWA at 7.5 m, Q4) used to pass "3.5 dB inside 42"; MCS 020(a) fails it.
  assert.equal(Math.round(soundPressureDb(61, 7.5, 4) * 10) / 10, 38.5);
  const louder = draft(ROOMS.slice(0, 1), { measured: { outdoor: { positions: [position({ distanceToNeighbourWindowM: 7.5 })] } }, catalogue: DEMO_CATALOGUE.map((i) => (i.id === "demo-out-brz25" ? { ...i, specs: { ...i.specs, soundPowerDb: 61 } } : i)) });
  assert.equal(rule(louder, "standard", "noise").status, "review");
  assert.match(rule(louder, "standard", "noise").detail, /About 38\.5 dB\(A\) from the heat pump, over the 37\.0/);
  // In a corner or a London side return (three surfaces, Q8) the same unit is 3 dB louder again.
  const corner = draft(ROOMS.slice(0, 1), { measured: { outdoor: { positions: [position({ reflectingSurfaces: "three" })] } } });
  assert.match(rule(corner, "standard", "noise").detail, /About 39 dB\(A\)[\s\S]*Q8/);
  assert.equal(rule(corner, "standard", "noise").status, "review");
  // Surfaces not counted at the survey: never a pass, and it says what to count.
  const uncounted = draft(ROOMS.slice(0, 1), { measured: { outdoor: { positions: [position({ reflectingSurfaces: undefined })] } } });
  assert.equal(rule(uncounted, "standard", "noise").status, "review");
  assert.match(rule(uncounted, "standard", "noise").detail, /Count the hard surfaces within 1 m of "Rear patio"/);
  // Within 1 dB of the limit: review, with what to check.
  const close = draft(ROOMS.slice(0, 1), { measured: { outdoor: { positions: [position({ distanceToNeighbourWindowM: 7.5 })] } } });
  assert.equal(rule(close, "standard", "noise").status, "review");
  assert.match(rule(close, "standard", "noise").detail, /within 1 dB of the 37\.0/);
  const unmeasured = draft(ROOMS.slice(0, 1), { measured: { outdoor: { positions: [position({ distanceToNeighbourWindowM: undefined })] } } });
  assert.equal(rule(unmeasured, "standard", "noise").status, "fail");
  assert.match(rule(unmeasured, "standard", "noise").detail, /measure the distance/);
});

test("planning is never 'no planning needed': no property record, a 'no' answer or a listing all go to review", () => {
  assert.equal(rule(draft(ROOMS.slice(0, 1)), "standard", "planning").status, "pass");
  assert.match(rule(draft(ROOMS.slice(0, 1)), "standard", "planning").detail, /isn't a planning decision/);
  assert.equal(rule(draft(ROOMS.slice(0, 1), { intel: null }), "standard", "planning").status, "review");
  const listed = draft(ROOMS.slice(0, 1), { intel: { ...INTEL, constraints: { ...emptyConstraints(), listedBuilding: true } } });
  assert.equal(rule(listed, "standard", "planning").status, "review");
  const no = draft(ROOMS.slice(0, 1), { measured: { permissions: { pd: { "heating-use": "no" } } } });
  assert.match(rule(no, "standard", "planning").detail, /planning application route/);
});

test("electrics: the manufacturer's breaker when known, else a labelled rule of thumb", () => {
  const d = draft(ROOMS.slice(0, 1));
  assert.deepEqual(
    { ...standard(d).systems[0]!.electrical, routeNote: undefined },
    { breaker: "16 A RCBO", cableMm2: 2.5, isolator: "20 A weatherproof rotary isolator", routeNote: undefined, breakerSource: "manufacturer" },
  );
  assert.equal(rule(d, "standard", "electrics").status, "pass");
  const daikin = draftDesign({ projectId: "p", id: "d", version: 1, measured: survey(ROOMS.slice(0, 1)), baseSurvey: BASE, catalogue: RESEARCHED_CATALOGUE, compatibility: RESEARCHED_COMPATIBILITY, now: NOW, manufacturer: "Daikin" });
  const sys = standard(daikin).systems[0]!;
  assert.equal(sys.electrical.breakerSource, "rule-of-thumb");
  assert.equal(rule(daikin, "standard", "electrics").status, "review");
  const full = draft(ROOMS.slice(0, 1), { measured: { electrics: { boardType: "modern-rcbo", spareWays: 0, asbestosFlashGuard: "possible", mediaIds: [] } } });
  assert.match(rule(full, "standard", "electrics").detail, /0 spare ways/);
  assert.match(rule(full, "standard", "electrics").detail, /asbestos/);
});

test("the bill of materials follows the runs, the diameters, the drain and the mounting", () => {
  const d = draft(ROOMS.slice(0, 3), { catalogue: RESEARCHED_CATALOGUE, compat: RESEARCHED_COMPATIBILITY });
  const bom = standard(d).bom;
  const line = (id: string) => bom.find((l) => l.catalogueItemId === id);
  assert.equal(line("panasonic-cs-tz25ckew")!.qty, 2);
  assert.equal(line("panasonic-cu-3z68cbe")!.qty, 1);
  assert.equal(line("pipe-14-38-3m")!.qty, 1); // the 3 m living-room run fits one coil
  assert.equal(line("pipe-14-38-per-m")!.qty, 15); // 6 m + 9 m cut by the metre
  assert.equal(line("cable-4c-1.5-per-m")!.qty, 21); // runs + 1 m each
  assert.equal(line("rcbo-20a")!.qty, 1); // CU-3Z68CBE: 20 A
  assert.equal(line("isolator-20a")!.qty, 1);
  assert.equal(line("ground-feet-600")!.qty, 1);
  assert.equal(line("condensate-gravity-fittings")!.qty, 3);
  assert.equal(line("trunking-80-2m")!.qty, 9); // 6 + 2 (through-wall) + 9 = 17 m in 2 m lengths
  assert.ok(bom.every((l) => l.category !== "equipment" || l.catalogueItemId));
  assert.ok(!bom.some((l) => l.catalogueItemId?.startsWith("tool-")));
  const flags = bomLineFlags(line("pipe-14-38-per-m")!, RESEARCHED_CATALOGUE);
  assert.deepEqual(flags, { notInCatalogue: false, unpriced: true, provisional: true, uncertain: false });

  const bracketed = draft(ROOMS.slice(0, 1), { measured: { outdoor: { positions: [position({ base: "wall-bracket" })] } } });
  assert.ok(standard(bracketed).bom.some((l) => l.catalogueItemId === "demo-mat-bracket"));
  assert.ok(!standard(bracketed).bom.some((l) => l.catalogueItemId === "demo-mat-feet"));
  // Something the catalogue doesn't stock still appears, flagged.
  const bare = draft(ROOMS.slice(0, 1), { catalogue: DEMO_CATALOGUE.filter((i) => i.kind !== "material") });
  const generic = standard(bare).bom.filter((l) => !l.catalogueItemId);
  assert.ok(generic.length > 3);
  assert.ok(generic.every((l) => l.note?.startsWith("Not in the catalogue yet")));
});

/* ------------------------------------------------------------------ */
/* Recompute, overrides, approval                                      */
/* ------------------------------------------------------------------ */

test("recomputeVariant with nothing changed gives back what was drafted", () => {
  const d = draft(ROOMS.slice(0, 3), { catalogue: RESEARCHED_CATALOGUE, compat: RESEARCHED_COMPATIBILITY });
  for (const v of d.variants) assert.deepEqual(recomputeVariant(d, v.id, RESEARCHED_CATALOGUE, RESEARCHED_COMPATIBILITY), v);
  assert.throws(() => recomputeVariant(d, "nope", DEMO_CATALOGUE, DEMO_COMPATIBILITY), /No variant "nope"/);
  assert.deepEqual(designDeviations(d), []);
});

test("changing a room's size needs a reason; the reason is kept with who gave it and when", () => {
  const d = draft(ROOMS.slice(0, 1));
  const edits = editsFromDesign(d);
  edits.rooms[0]!.chosenKw = 3.5;
  edits.variants = edits.variants.map((v) => ({ ...v, roomUnits: v.roomUnits.map((u) => ({ ...u, indoorItemId: v.id === "standard" ? "demo-ind-brz35" : "demo-ind-whs35" })), systems: v.systems.map((s) => ({ ...s, outdoorItemId: v.id === "standard" ? "demo-out-brz35" : "demo-out-whs35" })) }));
  const next = applyDesignEdits(d, edits, ctx(d));
  assert.equal(next.version, 2);
  assert.equal(next.id, "d2");
  // Only the size change deviates: the units follow the engine's pick for the new size.
  assert.deepEqual(designDeviations(next).map((x) => [x.field, x.from, x.to]), [["rooms.r1.chosenKw", "2.5", "3.5"]]);
  assert.ok(designApprovalErrors(next).includes("Give a reason for the change to Main bedroom: capacity."));

  const reasoned = applyDesignEdits(d, { ...edits, reasons: { "rooms.r1.chosenKw": "South-facing loft conversion above; runs hot" } }, ctx(d));
  assert.deepEqual(designApprovalErrors(reasoned), []);
  assert.equal(reasoned.rooms[0]!.reason, "South-facing loft conversion above; runs hot");
  assert.deepEqual(reasoned.overrides, [
    { field: "rooms.r1.chosenKw", from: "2.5", to: "3.5", reason: "South-facing loft conversion above; runs hot", by: "Tess Lead (DEMO)", at: "2026-10-19T09:00:00.000Z" },
  ]);
  // A later save by someone else keeps the original author of an unchanged reason.
  const again = applyDesignEdits(reasoned, { ...editsFromDesign(reasoned), notes: "Checked." }, { ...ctx(reasoned), by: "Someone Else", at: "2026-10-20T09:00:00.000Z" });
  assert.equal(again.overrides[0]!.by, "Tess Lead (DEMO)");
  assert.equal(again.notes, "Checked.");
});

test("swapping a unit or splitting a multi-split is a deviation too; a mismatched pair is a compatibility error", () => {
  const d = draft(ROOMS.slice(0, 2));
  const edits = editsFromDesign(d);
  const std = edits.variants.find((v) => v.id === "standard")!;
  std.systems = [
    { outdoorItemId: "demo-out-brz25", roomIds: ["r1"] },
    { outdoorItemId: "demo-out-brz35", roomIds: ["r2"] },
  ];
  const singles = applyDesignEdits(d, edits, ctx(d));
  assert.deepEqual(designDeviations(singles).map((x) => x.field), ["variants.standard.systems"]);
  assert.equal(standard(singles).systems.length, 2);

  const swapped = editsFromDesign(d);
  swapped.variants.find((v) => v.id === "standard")!.roomUnits[0]!.indoorItemId = "demo-ind-whs25";
  const mixed = applyDesignEdits(d, swapped, ctx(d));
  assert.deepEqual(designDeviations(mixed).map((x) => x.field), ["variants.standard.rooms.r1.indoor"]);

  const wrong = editsFromDesign(d);
  wrong.variants.find((v) => v.id === "standard")!.systems = [{ outdoorItemId: "demo-out-whs25", roomIds: ["r1"] }, { outdoorItemId: "demo-out-brz35", roomIds: ["r2"] }];
  const bad = applyDesignEdits(d, { ...wrong, reasons: { "variants.standard.systems": "Testing" } }, ctx(d));
  assert.ok(designApprovalErrors(bad).some((e) => e.includes("DM-WHS25-O isn't listed as the pair for DM-BRZ25")));
  assert.equal(rule(bad, "standard", "compatibility").status, "fail");
});

test("an edit that leaves a room out of every system puts it back on its own single split", () => {
  const d = draft(ROOMS.slice(0, 2));
  const edits = editsFromDesign(d);
  edits.variants.find((v) => v.id === "standard")!.systems = [{ outdoorItemId: "demo-out-brz25", roomIds: ["r1", "ghost"] }];
  const next = applyDesignEdits(d, { ...edits, reasons: { "variants.standard.systems": "Separate units" } }, ctx(d));
  assert.deepEqual(standard(next).systems.map((s) => [s.outdoorItemId, s.roomIds]), [["demo-out-brz25", ["r1"]], ["demo-out-brz35", ["r2"]]]);
});

test("pipe run changes need a reason, and flow through to limits and the bill", () => {
  const d = draft(ROOMS.slice(0, 1));
  const edits = editsFromDesign(d);
  edits.rooms[0]!.pipeRunM = 24;
  const next = applyDesignEdits(d, edits, ctx(d));
  assert.deepEqual(designDeviations(next).map((x) => [x.field, x.from, x.to]), [["rooms.r1.pipeRunM", "6", "24"]]);
  assert.match(standard(next).systems[0]!.compatibility.errors.join(" "), /24 m is over DM-BRZ25-O's 20 m limit/);
  assert.equal(rule(next, "standard", "pipe-limits").status, "fail");
  assert.equal(standard(next).bom.find((l) => l.catalogueItemId === "demo-mat-lineset")!.qty, 24);
});

test("approval needs a layout photo for every room, and a qualified approver", () => {
  const d = draft(ROOMS.slice(0, 1));
  const edits = editsFromDesign(d);
  edits.rooms[0]!.layoutMediaIds = [];
  const bare = applyDesignEdits(d, edits, ctx(d));
  assert.deepEqual(designApprovalErrors(bare), ["Main bedroom: choose at least one layout photo."]);
  const noRef = approveDesign(d, { staffId: "s", name: "Someone", qualificationRef: " " }, NOW, { combinationTableChecked: false });
  assert.equal(noRef.ok, false);
  const ok = approveDesign(d, { staffId: "s", name: "Someone", qualificationRef: "REF-1" }, NOW, { combinationTableChecked: false });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.deepEqual(designApprovalErrors(ok.design), ["This version is already approved."]);
    assert.deepEqual(layoutMediaIdsOf(ok.design), ["photo-r1", "photo-out"]);
    // The next version starts as a draft with no approval carried over.
    const next = applyDesignEdits(ok.design, editsFromDesign(ok.design), ctx(ok.design));
    assert.equal(next.status, "draft");
    assert.equal(next.approval, undefined);
  }
});

test("designInputsKey: a no-op edit is no change; a real one is", () => {
  const d = draft(ROOMS.slice(0, 2));
  const same = applyDesignEdits(d, editsFromDesign(d), ctx(d));
  assert.equal(designInputsKey(same), designInputsKey(d));
  const edits: DesignEdits = editsFromDesign(d);
  edits.notes = "Customer prefers the unit left of the window.";
  assert.notEqual(designInputsKey(applyDesignEdits(d, edits, ctx(d))), designInputsKey(d));
});

test("hydrateDesign fills an older record from its survey, keeping existing override baselines", () => {
  const d = draft(ROOMS.slice(0, 2));
  const old: DesignRecord = {
    ...d,
    site: undefined,
    rooms: d.rooms.map(({ survey: _s, areaM2: _a, type: _t, route: _r, ...r }) => ({ ...r, ...(r.roomId === "r1" ? { pipeRunM: 15 } : {}) })),
    variants: d.variants.map(({ manufacturer: _m, suggested: _g, ...v }) => ({ ...v, systems: v.systems.map(({ layoutMediaIds: _l, ...s }) => s) })),
    overrides: [{ field: "rooms.r1.pipeRunM", from: "6", to: "15", reason: "Loft route (DEMO)", by: "DEMO Sam", at: NOW }],
  };
  delete old.site;
  const h = hydrateDesign(old, survey(ROOMS.slice(0, 2)), { catalogue: DEMO_CATALOGUE, intel: INTEL });
  assert.deepEqual(h.site, d.site);
  assert.equal(h.rooms[0]!.areaM2, 14);
  assert.equal(h.rooms[0]!.type, "bedroom");
  assert.deepEqual(h.rooms[0]!.survey, { pipeRunM: 6, heightDiffM: 3, condensate: "gravity" }); // from the override
  assert.deepEqual(h.rooms[1]!.survey, { pipeRunM: 3, heightDiffM: 0.5, condensate: "gravity" }); // from the survey
  assert.equal(h.variants[0]!.manufacturer, "DEMO Aircon Co");
  assert.deepEqual(h.variants[0]!.systems[0]!.layoutMediaIds, ["photo-out"]);
  // The kept override still explains the deviation, so nothing new is asked for.
  assert.deepEqual(designDeviations(h).map((x) => x.field), ["rooms.r1.pipeRunM"]);
  assert.ok(!designApprovalErrors(h).some((e) => e.includes("pipe run")));
  // A complete record comes back unchanged.
  assert.deepEqual(hydrateDesign(d, survey(ROOMS.slice(0, 2)), { catalogue: DEMO_CATALOGUE }), d);
});

test("dropping the Quiet option keeps Standard; dropping everything keeps what was there", () => {
  const d = draft(ROOMS.slice(0, 1));
  const edits = editsFromDesign(d);
  const one = applyDesignEdits(d, { ...edits, variants: edits.variants.filter((v) => v.id === "standard") }, ctx(d));
  assert.deepEqual(one.variants.map((v) => v.id), ["standard"]);
  const none = applyDesignEdits(d, { ...edits, variants: [] }, ctx(d));
  assert.deepEqual(none.variants.map((v) => v.id), ["standard", "premium"]);
});

/* ------------------------------------------------------------------ */
/* R32 (A2L) charge and room size                                      */
/* ------------------------------------------------------------------ */

test("R32 room size: the IEC 60335-2-40 Annex GG formula for a wall unit at 1.8 m", () => {
  assert.equal(A2L_ROOM_CHECK_ABOVE_KG, 1.84);
  assert.equal(a2lMinFloorAreaM2(1.8, 1.8), 3.1); // Daikin's R32 table: 1.8 kg needs 3.09 m² for a wall unit
  assert.equal(a2lMinFloorAreaM2(2.78, 1.8), 7.4);
  assert.equal(a2lMinFloorAreaM2(3.22, 1.8), 9.9);
  assert.equal(a2lMinFloorAreaM2(4.2, 1.8), 16.7);
  assert.equal(a2lMinFloorAreaM2(2.78, 0.6), 65.8, "a floor unit releases low, so the room must be far bigger");
  assert.equal(a2lMaxChargeKg(6.5, 1.8), 2.62);
  assert.ok(a2lMaxChargeKg(a2lMinFloorAreaM2(2.78, 1.8), 1.8) >= 2.78);
});

/** A London terrace: three good rooms and a 6.5 m² box room, on the researched Panasonic range. */
const TERRACE = [
  room("liv", "Living", { type: "living-room", floor: "ground", lengthM: 5, widthM: 4, pipeRunM: 14 }),
  room("mb", "Main bed", { lengthM: 4, widthM: 3.5, pipeRunM: 12 }),
  room("b2", "Bed 2", { lengthM: 3.2, widthM: 3.125, pipeRunM: 12 }),
  room("box", "Box room", { lengthM: 2.6, widthM: 2.5, pipeRunM: 10 }),
];
const pana = (rooms: MeasuredRoom[]) =>
  draftDesign({ projectId: "p1", id: "d1", version: 1, measured: survey(rooms, { house: { ...survey([]).house, type: "terraced" } }), baseSurvey: BASE, catalogue: RESEARCHED_CATALOGUE, compatibility: RESEARCHED_COMPATIBILITY, intel: INTEL, now: NOW, manufacturer: "Panasonic" });

test("R32 room size: the engine never drafts a box room onto a multi-split with too much refrigerant for it", () => {
  const d = pana(TERRACE);
  for (const v of d.variants) {
    for (const s of v.systems) {
      if (!s.roomIds.includes("box")) continue;
      assert.ok((s.refrigerant.totalChargeKg ?? 0) <= a2lMaxChargeKg(6.5, 1.8), `${v.id}: ${s.outdoorItemId} holds ${s.refrigerant.totalChargeKg} kg`);
    }
    assert.notEqual(rule(d, v.id, "refrigerant-room").status, "fail");
    assert.ok(!designApprovalErrors(d).some((e) => /minimum floor area/.test(e)));
  }
});

test("R32 room size: all four rooms forced onto the CU-4Z80CBE (2.78 kg) blocks approval for the box room", () => {
  const d = pana(TERRACE);
  const edits = editsFromDesign(d);
  const ids = TERRACE.map((r) => r.id);
  const forced = applyDesignEdits(
    d,
    {
      ...edits,
      variants: edits.variants.map((v) => ({ ...v, roomUnits: ids.map((roomId) => ({ roomId, indoorItemId: roomId === "liv" ? "panasonic-cs-z35ckew" : "panasonic-cs-z25ckew" })), systems: [{ outdoorItemId: "panasonic-cu-4z80cbe", roomIds: ids }] })),
      reasons: { "variants.standard.systems": "One outdoor unit (DEMO)", "variants.premium.systems": "One outdoor unit (DEMO)" },
    },
    ctx(d, RESEARCHED_CATALOGUE, RESEARCHED_COMPATIBILITY),
  );
  const s = standard(forced).systems[0]!;
  assert.equal(s.refrigerant.factoryChargeKg, 2.72);
  assert.equal(s.refrigerant.totalChargeKg, 2.78);
  assert.ok(s.compatibility.errors.some((e) => /^Box room: 6\.5 m² is below the 7\.4 m² minimum floor area for 2\.78 kg of R32 on CU-4Z80CBE/.test(e)), s.compatibility.errors.join(" | "));
  const r = rule(forced, "standard", "refrigerant-room");
  assert.equal(r.status, "fail");
  assert.match(r.detail, /Box room: 6\.5 m² is BELOW the 7\.4 m² minimum/);
  assert.match(r.detail, /installation manual's own table decides and can be stricter/);
  assert.ok(designApprovalErrors(forced).some((e) => /Box room: 6\.5 m² is below the 7\.4 m² minimum floor area/.test(e)));

  // The same system without the box room is fine, and the runsheet carries the limit to the charge step.
  const three = applyDesignEdits(
    d,
    {
      ...edits,
      variants: edits.variants.map((v) => ({ ...v, roomUnits: ids.map((roomId) => ({ roomId, indoorItemId: roomId === "liv" ? "panasonic-cs-z35ckew" : "panasonic-cs-z25ckew" })), systems: [{ outdoorItemId: "panasonic-cu-4z80cbe", roomIds: ["liv", "mb", "b2"] }, { outdoorItemId: "panasonic-cu-z25cke", roomIds: ["box"] }] })),
      reasons: {},
    },
    ctx(d, RESEARCHED_CATALOGUE, RESEARCHED_COMPATIBILITY),
  );
  assert.ok(!standard(three).systems.some((x) => x.compatibility.errors.some((e) => /floor area/.test(e))));
  assert.equal(rule(three, "standard", "refrigerant-room").status, "pass");
  const steps = runsheetFromDesign(three, "standard", RESEARCHED_CATALOGUE);
  const charge = steps.find((x) => x.id.startsWith("d3-charge-") && x.evidence.some((e) => e.role === "additional-charge") && /4Z80|Free Multi|4-room|4 room/i.test(`${x.item}`)) ?? steps.filter((x) => x.id.startsWith("d3-charge-"))[0]!;
  const added = charge.evidence.find((e) => e.role === "additional-charge")!;
  // The smallest room on the 4Z80 is Bed 2 (10 m²): at most 3.25 kg, so at most 530 g on top of the 2.72 kg factory charge.
  assert.equal(a2lMaxChargeKg(10, 1.8), 3.25);
  assert.equal(added.max, 530);
  assert.match(charge.guidance ?? "", /at or under 3\.25 kg, the most Bed 2 \(10 m²\) may hold/);
});

test("R32 room size: an unmeasured room on a big system, and a multi-split with no factory charge, block approval", () => {
  const d = pana(TERRACE);
  const edits = editsFromDesign(d);
  const ids = TERRACE.map((r) => r.id);
  const units = ids.map((roomId) => ({ roomId, indoorItemId: roomId === "liv" ? "panasonic-cs-z35ckew" : "panasonic-cs-z25ckew" }));
  const big = { ...edits, variants: edits.variants.map((v) => ({ ...v, roomUnits: units, systems: [{ outdoorItemId: "panasonic-cu-4z80cbe", roomIds: ["liv", "mb", "b2"] }, { outdoorItemId: "panasonic-cu-z25cke", roomIds: ["box"] }] })), reasons: {} };
  // Bed 2 never measured: the area is an estimate.
  const unmeasured = { ...d, rooms: d.rooms.map((r) => (r.roomId === "b2" ? { ...r, estimated: [...(r.estimated ?? []), "area" as const] } : r)) };
  const u = applyDesignEdits(unmeasured, big, ctx(d, RESEARCHED_CATALOGUE, RESEARCHED_COMPATIBILITY));
  assert.ok(designApprovalErrors(u).some((e) => /Bed 2: measure the floor area\. CU-4Z80CBE holds 2\.72 kg of R32, so every room it serves needs at least 7 m²/.test(e)), designApprovalErrors(u).join(" | "));
  // No factory charge on record for the multi-split: it can't be checked, so it can't be approved.
  const noCharge = RESEARCHED_CATALOGUE.map((i) => (i.id === "panasonic-cu-4z80cbe" ? { ...i, specs: { ...i.specs, factoryChargeKg: null } } : i));
  const n = applyDesignEdits(d, big, { ...ctx(d, noCharge, RESEARCHED_COMPATIBILITY) });
  assert.ok(designApprovalErrors(n).some((e) => /No factory charge on record for CU-4Z80CBE/.test(e)));
  assert.equal(rule(n, "standard", "refrigerant-room").status, "fail");
  // A small single split is under 1.84 kg: no minimum applies, and the rule says so.
  const single = pana(TERRACE.slice(3));
  assert.equal(rule(single, "standard", "refrigerant-room").status, "pass");
  assert.match(rule(single, "standard", "refrigerant-room").detail, /not over 1\.84 kg, so no minimum room size applies/);
});

test("the Quiet option may say 'quieter' only when every room's unit is quieter than Standard's", () => {
  const one = (maker: string) =>
    draftDesign({ projectId: "p1", id: "d1", version: 1, measured: survey([room("r1", "Bedroom", { lengthM: 3.5, widthM: 3 })]), baseSurvey: BASE, catalogue: RESEARCHED_CATALOGUE, compatibility: RESEARCHED_COMPATIBILITY, intel: INTEL, now: NOW, manufacturer: maker });
  const units = (d: DesignRecord) => d.variants.map((v) => [v.tier, v.roomUnits[0]!.indoorItemId, RESEARCHED_CATALOGUE.find((i) => i.id === v.roomUnits[0]!.indoorItemId)?.specs?.soundPressureLowDb]);
  // Mitsubishi at 2.5 kW: Standard MSZ-AY25VGK (18 dB) is quieter than Quiet MSZ-LN25VG2W (19 dB).
  const mitsubishi = one("Mitsubishi Electric");
  const quiet = mitsubishi.variants.find((v) => v.tier === "premium")!;
  assert.deepEqual(units(mitsubishi), [["standard", "mitsubishi-electric-msz-ay25vgk", 18], ["premium", "mitsubishi-electric-msz-ln25vg2w", 19]]);
  assert.equal(premiumIsQuieter({ design: mitsubishi, catalogue: RESEARCHED_CATALOGUE }, quiet), false);
  // Panasonic: the premium unit is quieter, so the copy may say so.
  const panasonic = one("Panasonic");
  const [std, prem] = units(panasonic).map((u) => u[2] as number);
  assert.ok(prem! < std!, JSON.stringify(units(panasonic)));
  assert.equal(premiumIsQuieter({ design: panasonic, catalogue: RESEARCHED_CATALOGUE }, panasonic.variants.find((v) => v.tier === "premium")!), true);
});

/* ------------------------------------------------------------------ */
/* The manufacturer's minimums and multi-split limits                  */
/* ------------------------------------------------------------------ */

const item = (id: string) => RESEARCHED_CATALOGUE.find((i) => i.id === id)!;
const ruleFor = (model: string) => RESEARCHED_COMPATIBILITY.find((r) => r.outdoorModel === model);
const at = (roomName: string, pipeRunM: number, heightDiffM = 3) => ({ roomName, pipeRunM, heightDiffM });

test("the researched seed carries only the limits each item's own notes state; the rest are unknown, never invented", () => {
  // Panasonic CU-2Z50CBE: "Min 3 m pipe per indoor unit; min 2 indoor units connected ... Total pipe 6-30 m, 3-20 m per room".
  const two = item("panasonic-cu-2z50cbe").specs!;
  assert.deepEqual([two.minPipeM, two.maxPipePerBranchM, two.minTotalPipeM, two.maxTotalPipeM, two.minIndoorUnits, two.maxIndoorHeightDiffM], [3, 20, 6, 30, 2, null]);
  // Daikin 2MXM50A8: "20 m per room, 30 m total, 15 m IU-OU level, 7.5 m IU-IU, min 3 m per room".
  const mxm = item("daikin-2mxm50a2v1b8").specs!;
  assert.deepEqual([mxm.minPipeM, mxm.maxPipePerBranchM, mxm.maxTotalPipeM, mxm.maxIndoorHeightDiffM, mxm.minIndoorUnits], [3, 20, 30, 7.5, null]);
  assert.equal(item("daikin-rxf25f5v1b").specs!.minPipeM, 1.5, "Minimum pipe 1.5 m (installer guide)");
  assert.equal(item("daikin-rxf35f5v1b").specs!.minPipeM, null, "the RXF35F's notes give no minimum: not copied from its sibling");
  assert.equal(item("daikin-2mxm40a2v1b9").specs!.maxPipePerBranchM, null, "a figure 'assumed same' as another model isn't filled");
  assert.equal(item("mitsubishi-electric-muz-ap25vg").specs!.minPipeM, null);
  // Only outdoor units carry them.
  for (const i of RESEARCHED_CATALOGUE.filter((x) => x.kind === "indoor")) {
    for (const k of ["minPipeM", "maxPipePerBranchM", "minTotalPipeM", "maxTotalPipeM", "maxIndoorHeightDiffM", "minIndoorUnits", "minConnectedKw"] as const) assert.equal(i.specs?.[k] ?? null, null, `${i.id} ${k}`);
  }
});

test("limits: a run under the minimum, too few indoor units and a short total are errors with the figures", () => {
  const out = item("panasonic-cu-2z50cbe");
  const z25 = item("panasonic-cs-z25ckew");
  const ok = manufacturerLimitsCheck(out, ruleFor("CU-2Z50CBE"), [at("Main bedroom", 6), at("Office", 8)], [z25, z25]);
  assert.deepEqual(ok.errors, []);
  assert.match(ok.passes.join(" "), /every run at least 3 m/);
  // A 2.5 m back-to-back run is under the 3 m minimum; with a 3 m run the total of 5.5 m is under 6 m too.
  const short = manufacturerLimitsCheck(out, ruleFor("CU-2Z50CBE"), [at("Main bedroom", 2.5), at("Office", 3)], [z25, z25]);
  assert.ok(short.errors.some((e) => /^Main bedroom: 2\.5 m pipe run is under CU-2Z50CBE's 3 m minimum per indoor unit/.test(e)), short.errors.join(" | "));
  assert.ok(short.errors.some((e) => /^Total pipe 5\.5 m is under CU-2Z50CBE's 6 m minimum total/.test(e)));
  // One room on a two-room outdoor unit.
  const lonely = manufacturerLimitsCheck(out, ruleFor("CU-2Z50CBE"), [at("Main bedroom", 6)], [z25]);
  assert.ok(lonely.errors.some((e) => /CU-2Z50CBE runs with at least 2 indoor units; this has 1/.test(e)));
  // Height between indoor units isn't on record for the Panasonic: unknown, for review.
  assert.ok(ok.unknown.includes("the most two indoor units may be apart in height"));
});

test("limits: the height between indoor units from the survey's outdoor-to-indoor heights, at least |a − b|, at most a + b", () => {
  const out = item("daikin-2mxm50a2v1b8");
  const ftxm = RESEARCHED_CATALOGUE.find((i) => i.kind === "indoor" && i.manufacturer === "Daikin")!;
  const rule = ruleFor("2MXM50A2V1B8");
  // Ground floor 0.5 m and loft room 9 m above the outdoor unit: at least 8.5 m apart, over 7.5 m.
  const far = manufacturerLimitsCheck(out, rule, [at("Living room", 6, 0.5), at("Loft", 12, 9)], [ftxm, ftxm]);
  assert.ok(far.errors.some((e) => /^Living room and Loft: at least 8\.5 m apart in height, over 2MXM50A2V1B8's 7\.5 m between indoor units/.test(e)), far.errors.join(" | "));
  // 3 m and 5 m: 2 m apart if both are above it, 8 m if it sits between them: for review.
  const maybe = manufacturerLimitsCheck(out, rule, [at("Main bedroom", 6, 3), at("Office", 7, 5)], [ftxm, ftxm]);
  assert.deepEqual(maybe.errors, []);
  assert.match(maybe.review[0]!, /could be up to 8 m apart in height if the outdoor unit sits between them/);
  // 3 m and 4 m: at most 7 m apart whatever the outdoor unit does.
  assert.deepEqual(manufacturerLimitsCheck(out, rule, [at("Main bedroom", 6, 3), at("Office", 7, 4)], [ftxm, ftxm]).review, []);
  // The rule's own limits (20 m a room) are validateCombination's message, not a second one here.
  assert.deepEqual(manufacturerLimitsCheck(out, rule, [at("Main bedroom", 22), at("Office", 7)], [ftxm, ftxm]).errors, []);
  // A catalogue figure stricter than the rule's is checked here.
  const strict = { ...out, specs: { ...out.specs, maxPipePerBranchM: 15, maxTotalPipeM: 20 } };
  const tight = manufacturerLimitsCheck(strict, rule, [at("Main bedroom", 16), at("Office", 7)], [ftxm, ftxm]);
  assert.ok(tight.errors.some((e) => /Main bedroom: 16 m pipe run is over 2MXM50A2V1B8's 15 m maximum per indoor unit/.test(e)));
  assert.ok(tight.errors.some((e) => /Total pipe 23 m is over 2MXM50A2V1B8's 20 m maximum total/.test(e)));
});

test("limits: not on record is review in the design, never a pass; outside a limit blocks approval", () => {
  // A Mitsubishi single split: no minimum run on record.
  const mits = draftDesign({ projectId: "p1", id: "d1", version: 1, measured: survey([room("r1", "Bedroom", { lengthM: 3.5, widthM: 3 })]), baseSurvey: BASE, catalogue: RESEARCHED_CATALOGUE, compatibility: RESEARCHED_COMPATIBILITY, intel: INTEL, now: NOW, manufacturer: "Mitsubishi Electric" });
  const r = rule(mits, "standard", "pipe-limits");
  assert.equal(r.status, "review");
  assert.match(r.detail, /not on record, check the installation manual: the shortest pipe run per indoor unit/);
  // A Panasonic single split on a 2 m back-to-back run: under its 3 m minimum, so approval is blocked with the figures.
  const pan = draftDesign({ projectId: "p1", id: "d1", version: 1, measured: survey([room("r1", "Bedroom", { lengthM: 3.5, widthM: 3, pipeRunM: 2 })]), baseSurvey: BASE, catalogue: RESEARCHED_CATALOGUE, compatibility: RESEARCHED_COMPATIBILITY, intel: INTEL, now: NOW, manufacturer: "Panasonic" });
  assert.equal(rule(pan, "standard", "pipe-limits").status, "fail");
  assert.ok(designApprovalErrors(pan).some((e) => /Bedroom: 2 m pipe run is under CU-\w+CKE's 3 m minimum per indoor unit/.test(e)), designApprovalErrors(pan).join(" | "));
  // At 3 m it's fine.
  const pan3 = draftDesign({ projectId: "p1", id: "d1", version: 1, measured: survey([room("r1", "Bedroom", { lengthM: 3.5, widthM: 3, pipeRunM: 3 })]), baseSurvey: BASE, catalogue: RESEARCHED_CATALOGUE, compatibility: RESEARCHED_COMPATIBILITY, intel: INTEL, now: NOW, manufacturer: "Panasonic" });
  assert.ok(!designApprovalErrors(pan3).some((e) => /minimum per indoor unit/.test(e)));
});

test("limits: the engine never suggests a multi-split a room's run is too short for", () => {
  // Two Panasonic rooms, one on a 2 m run: no Panasonic multi-split takes it (each needs 3 m a room), so two single splits.
  const d = pana([room("a", "Main bedroom", { pipeRunM: 2 }), room("b", "Office", { lengthM: 3, widthM: 2.6, pipeRunM: 8 })]);
  const std = standard(d);
  assert.ok(std.systems.every((s) => s.topology === "single"), JSON.stringify(std.systems.map((s) => [s.outdoorItemId, s.roomIds])));
});

test("limits reach the install day: each room's as-built run and the system's total are checked against the catalogue's limits", () => {
  const d = pana([room("a", "Main bedroom", { pipeRunM: 6 }), room("b", "Office", { lengthM: 3, widthM: 2.6, pipeRunM: 8 })]);
  const variant = d.variants.find((v) => v.systems.some((s) => s.outdoorItemId === "panasonic-cu-2z50cbe")) ?? d.variants[0]!;
  const steps = runsheetFromDesign(d, variant.id, RESEARCHED_CATALOGUE);
  assert.equal(variant.systems[0]!.outdoorItemId, "panasonic-cu-2z50cbe");
  assert.match(rule(d, variant.id, "pipe-limits").detail, /14 m in total \(6 to 30 m\)/);
  const pipework = steps.filter((s) => s.title === "Pipework");
  const run = pipework[0]!.evidence.find((e) => e.role === "as-built-run")!;
  assert.deepEqual([run.min, run.max, run.window?.basis], [3, 20, "catalogue"]);
  assert.match(pipework[0]!.guidance ?? "", /Design run 6 m\. CU-2Z50CBE's manual \(catalogue\): 3 to 20 m to one indoor unit\. Never cut it shorter than 3 m/);
  const charge = steps.find((s) => s.title === "F-gas label and charge record")!;
  const total = charge.evidence.find((e) => e.role === "as-built-length")!;
  assert.deepEqual([total.min, total.max, total.label], [6, 30, "As-built pipe length, all runs added up (one way)"]);
  // A single split's run: the unit's own minimum and maximum; a unit with none on record says so.
  const single = runsheetFromDesign(pana([room("r1", "Bedroom", { lengthM: 3.5, widthM: 3 })]), "standard", RESEARCHED_CATALOGUE);
  const singleRun = single.find((s) => s.title === "Pipework")!.evidence.find((e) => e.role === "as-built-run")!;
  assert.deepEqual([singleRun.min, singleRun.window?.basis], [3, "catalogue"]);
  const mits = draftDesign({ projectId: "p1", id: "d1", version: 1, measured: survey([room("r1", "Bedroom", { lengthM: 3.5, widthM: 3 })]), baseSurvey: BASE, catalogue: RESEARCHED_CATALOGUE, compatibility: RESEARCHED_COMPATIBILITY, intel: INTEL, now: NOW, manufacturer: "Mitsubishi Electric" });
  const m = runsheetFromDesign(mits, "standard", RESEARCHED_CATALOGUE).find((s) => s.title === "Pipework")!;
  const mRun = m.evidence.find((e) => e.role === "as-built-run")!;
  assert.equal(mRun.min, undefined);
  assert.equal(mRun.max, 20, "the maximum is on record, the minimum isn't");
  assert.match(m.guidance ?? "", /at most 20 m for the run/);
});

