import assert from "node:assert/strict";
import { test } from "node:test";
import { DEMO_CATALOGUE, DEMO_COMPATIBILITY, type CatalogueItem } from "./catalogue.ts";
import { RESEARCHED_CATALOGUE, RESEARCHED_COMPATIBILITY } from "./catalogue-data.ts";
import {
  COMBINATION_TABLE_ACK,
  PRELIMINARY_LOAD_LABEL,
  addDecibels,
  applyDesignEdits,
  approveDesign,
  bomLineFlags,
  designApprovalErrors,
  designDeviations,
  designInputsKey,
  draftDesign,
  editsFromDesign,
  layoutMediaIdsOf,
  needsCombinationAck,
  recomputeVariant,
  refrigerantFor,
  soundPressureDb,
  type DesignEdits,
  type DesignRecord,
} from "./design-record.ts";
import { emptyConstraints, emptyMarketing, emptyPlanning, type PropertyIntel } from "./intelligence.ts";
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
  return { id: "o1", label: "Rear patio", location: "ground-rear", base: "ground-feet", accessEquipment: "none", distanceToNeighbourWindowM: 8, chosen: true, mediaId: "photo-out", ...over };
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

test("noise: MCS 020-style estimate from the unit's LWA and the measured distance", () => {
  assert.equal(Math.round(soundPressureDb(59, 6, 4) * 10) / 10, 38.5);
  assert.equal(Math.round(addDecibels([40, 40]) * 10) / 10, 43);
  const near = draft(ROOMS.slice(0, 1), { measured: { outdoor: { positions: [position({ distanceToNeighbourWindowM: 2 })] } } });
  assert.equal(rule(near, "standard", "noise").status, "review");
  assert.match(rule(near, "standard", "noise").detail, /over the 42 dB\(A\) limit/);
  const far = draft(ROOMS.slice(0, 1));
  assert.equal(rule(far, "standard", "noise").status, "pass");
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

test("dropping the Quiet option keeps Standard; dropping everything keeps what was there", () => {
  const d = draft(ROOMS.slice(0, 1));
  const edits = editsFromDesign(d);
  const one = applyDesignEdits(d, { ...edits, variants: edits.variants.filter((v) => v.id === "standard") }, ctx(d));
  assert.deepEqual(one.variants.map((v) => v.id), ["standard"]);
  const none = applyDesignEdits(d, { ...edits, variants: [] }, ctx(d));
  assert.deepEqual(none.variants.map((v) => v.id), ["standard", "premium"]);
});
