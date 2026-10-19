import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { CatalogueItem } from "./catalogue.ts";
import type { DesignRecord, DesignVariant, RoomDesignInput, SystemSelection } from "./design-record.ts";
import {
  INSTALL_TEMPLATE_VERSION,
  JOB_TARGETS,
  buildCommissioningRecord,
  canRecord,
  canReviewExceptions,
  canSetOutcome,
  commissioningFromJob,
  commissioningSignErrors,
  dayOf,
  electricalRefsFromJob,
  equipmentFromJob,
  expectedAdditionalChargeG,
  fgasFromJob,
  flareSize,
  jobTargets,
  latestEvidence,
  openExceptions,
  plausibleValue,
  ramsAcknowledgements,
  runsheetDays,
  runsheetFromDesign,
  runsheetPercent,
  runsheetProgress,
  setJobTarget,
  slotView,
  stepView,
  stepsForDay,
  targetError,
  torqueCandidate,
  unconfirmedTargets,
  windowText,
  withExceptionReview,
  withStepStatus,
  buildRunsheet,
  NUMERIC_KINDS,
  type EvidenceRecord,
  type EvidenceSpec,
  type InstallJobV2,
  type InstallStep,
} from "./install.ts";
import type { StaffMember } from "./staff.ts";
import type { MeasuredSurvey } from "./survey-visit.ts";

/* ------------------------------------------------------------------ */
/* Fixtures: DEMO only                                                 */
/* ------------------------------------------------------------------ */

const ON = "2026-11-10";
const AT = "2026-11-10T09:00:00.000Z";

const item = (over: Partial<CatalogueItem> & Pick<CatalogueItem, "id" | "kind" | "label">): CatalogueItem => ({
  costPence: null,
  status: "available",
  confidence: "provisional",
  sources: [],
  active: true,
  ...over,
});

const CATALOGUE: CatalogueItem[] = [
  item({ id: "in-25", kind: "indoor", manufacturer: "Daikin", model: "DEMO-FTX25", label: "DEMO 2.5 kW wall unit", specs: { liquidPipeMm: 6.35, gasPipeMm: 9.52 } }),
  item({ id: "in-50", kind: "indoor", manufacturer: "Daikin", model: "DEMO-FTX50", label: "DEMO 5 kW wall unit", specs: { liquidPipeMm: 6.35, gasPipeMm: 12.7 } }),
  item({ id: "in-x", kind: "indoor", manufacturer: "DEMO Aircon Co", model: "DM-X", label: "DEMO unknown brand unit", specs: { liquidPipeMm: 6.35, gasPipeMm: 9.52 } }),
  item({ id: "out-1", kind: "outdoor", manufacturer: "Daikin", model: "DEMO-RX25", label: "DEMO single outdoor", specs: { prechargedPipeM: 10, additionalChargeGPerM: 20 } }),
  item({ id: "out-multi", kind: "outdoor", manufacturer: "Daikin", model: "DEMO-4MX", label: "DEMO four-port outdoor", specs: { prechargedPipeM: 30, additionalChargeGPerM: 20 } }),
];

const room = (n: number, over: Partial<RoomDesignInput> = {}): RoomDesignInput => ({
  roomId: `room-${n}`,
  roomName: ["Main bedroom", "Living room", "Home office", "Kids' room"][n - 1] ?? `Room ${n}`,
  floor: "first",
  preliminaryLoadW: 2000,
  suggestedKw: 2.5,
  chosenKw: 2.5,
  pipeRunM: 6 + n,
  heightDiffM: 3,
  condensate: "gravity",
  layoutMediaIds: [],
  ...over,
});

const system = (id: string, roomIds: string[], outdoorItemId: string, totalPipeM: number): SystemSelection => ({
  id,
  topology: roomIds.length > 1 ? "multi" : "single",
  outdoorItemId,
  roomIds,
  compatibility: { ok: true, errors: [], warnings: [] },
  electrical: { breaker: "16 A Type C RCBO", cableMm2: 2.5, isolator: "20 A rotary isolator" },
  refrigerant: { totalPipeM, prechargedPipeM: 10, additionalChargeG: 0 },
});

/** n rooms; "multi" puts them all on one outdoor unit, "single" gives each its own. */
function design(n: number, topology: "single" | "multi", opts: { pumpRoom?: number; indoor?: string; noRules?: boolean } = {}): DesignRecord {
  const rooms = Array.from({ length: n }, (_, i) => room(i + 1, opts.pumpRoom === i + 1 ? { condensate: "pump" } : {}));
  const systems =
    topology === "multi"
      ? [system("sys-a", rooms.map((r) => r.roomId), "out-multi", rooms.reduce((s, r) => s + r.pipeRunM, 0))]
      : rooms.map((r, i) => system(`sys-${i + 1}`, [r.roomId], "out-1", r.pipeRunM + (i === 0 ? 8 : 0)));
  const variant: DesignVariant = {
    id: "v-std",
    label: "Standard",
    tier: "standard",
    systems,
    roomUnits: rooms.map((r, i) => ({ roomId: r.roomId, indoorItemId: opts.indoor ?? (i === 1 ? "in-50" : "in-25") })),
    bom: [],
    rules: opts.noRules ? [] : [{ id: "noise", title: "Noise at nearest neighbour", status: "pass", detail: "DEMO: 36 dB(A) at the assessment position." }],
    verdict: "auto-approved",
    installDays: 3,
  };
  return {
    id: "design-1",
    projectId: "p-1",
    version: 1,
    status: "approved",
    rooms,
    variants: [variant],
    overrides: [],
    createdAt: AT,
  };
}

function measured(over: Partial<MeasuredSurvey["house"]> = {}, access: "none" | "tower" = "none"): MeasuredSurvey {
  return {
    version: 1,
    site: { confirmedAddress: true, ownerConfirmed: true, tenure: "owner", petsKids: "DEMO dog in the kitchen" },
    wishes: { priorities: ["quiet"], heatingUse: "supplementary" },
    house: {
      type: "semi-detached",
      era: "2000+",
      wallConstruction: "cavity",
      storeys: 2,
      loftAccess: true,
      listedOrConservation: "no",
      asbestosRisk: "none-suspected",
      ...over,
    },
    rooms: [],
    outdoor: { positions: [{ id: "pos-1", label: "Rear", location: "ground-rear", base: "ground-feet", accessEquipment: access, chosen: true }] },
    electrics: { boardType: "modern-rcbo", asbestosFlashGuard: "no", mediaIds: [] },
    permissions: { pd: {} },
    risks: { workingAtHeight: false, structuralConcern: false, concealedServicesConcern: false },
    assumptions: [],
    unknowns: [],
  };
}

const person = (over: Partial<StaffMember> & Pick<StaffMember, "roles">): StaffMember => ({
  id: `staff-${over.roles.join("-")}`,
  email: "demo@demo.dang.invalid",
  name: `DEMO ${over.roles.join(" ")}`,
  external: false,
  active: true,
  qualifications: [],
  ...over,
});
const FGAS = { kind: "fgas-cat1" as const, reference: "DEMO-FGAS-1", expiresOn: "2030-12-31", verifiedAt: "2026-01-05T10:00:00.000Z", mediaId: "media-fgas" };
const PARTP = { kind: "part-p" as const, reference: "DEMO-PARTP-1", expiresOn: "2030-12-31", verifiedAt: "2026-01-05T10:00:00.000Z", mediaId: "media-partp" };
const INSTALLER = person({ roles: ["installer"] });
const FGAS_INSTALLER = person({ roles: ["installer"], qualifications: [FGAS] });
const ELECTRICIAN = person({ roles: ["electrician"], qualifications: [PARTP] });
const TECH = person({ roles: ["tech-lead"], qualifications: [FGAS] });
const SURVEYOR = person({ roles: ["surveyor"] });

function job(steps: InstallStep[], evidence: EvidenceRecord[] = []): InstallJobV2 {
  return {
    id: "job-1",
    projectId: "p-1",
    templateVersion: INSTALL_TEMPLATE_VERSION,
    customer: "DEMO customer",
    postcode: "SW16 9ZZ",
    engineer: TECH.name,
    scheduledOn: ON,
    runsheet: steps,
    evidence,
    stepStatuses: [],
    exceptionReviews: [],
    qa: { status: "in-progress" },
  };
}

/** A capture that passes this slot (mid-window, or a plausible reading for record-only slots). */
function passing(spec: EvidenceSpec, i: number, at = AT): EvidenceRecord {
  const base = { id: `ev-${spec.id}-${i}`, specId: spec.id, at, by: TECH.name, byStaffId: TECH.id };
  if (NUMERIC_KINDS.has(spec.kind) || spec.kind === "measurement") {
    const v = plausibleValue(spec) ?? 10;
    return { ...base, value: v };
  }
  if (spec.kind === "photo" || spec.kind === "video" || spec.kind === "signature") return { ...base, mediaId: `m-${i}` };
  if (spec.kind === "gps") return { ...base, gps: { lat: 51.4, lng: -0.1 } };
  if (spec.kind === "check") return base;
  return { ...base, ref: `DEMO-${i}` };
}

/** Every slot of these steps captured, inside its window. */
function fill(j: InstallJobV2, steps: InstallStep[] = j.runsheet): InstallJobV2 {
  const evidence = [...j.evidence];
  let i = evidence.length;
  for (const s of steps) for (const spec of s.evidence) evidence.push(passing(spec, i++));
  return { ...j, evidence };
}

const specByRole = (steps: InstallStep[], role: string) => steps.flatMap((s) => s.evidence).filter((e) => e.role === role);

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

test("runsheet scales: 1 to 4 rooms, single and multi-split, unique stable ids", () => {
  for (const topology of ["single", "multi"] as const) {
    let lastSlots = 0;
    for (let n = 1; n <= 4; n++) {
      const steps = runsheetFromDesign(design(n, topology), "v-std", CATALOGUE);
      const slots = steps.flatMap((s) => s.evidence);
      assert.ok(slots.length > lastSlots, `${topology} ${n} rooms grows`);
      lastSlots = slots.length;
      assert.equal(new Set(steps.map((s) => s.id)).size, steps.length, "unique step ids");
      assert.equal(new Set(slots.map((s) => s.id)).size, slots.length, "unique slot ids");
      // Per-room steps repeat per room, per-system steps per outdoor unit.
      assert.equal(steps.filter((s) => s.title === "Condition photos" && s.roomId).length, n);
      const systems = topology === "multi" ? 1 : n;
      assert.equal(steps.filter((s) => s.title === "Strength and tightness test").length, systems);
      assert.equal(steps.filter((s) => s.title === "Vacuum and decay test").length, systems);
      assert.equal(steps.filter((s) => s.equipment?.kind === "outdoor").length, systems);
      assert.equal(steps.filter((s) => s.equipment?.kind === "indoor").length, n);
      // Deterministic: same input, same runsheet.
      assert.deepEqual(runsheetFromDesign(design(n, topology), "v-std", CATALOGUE), steps);
    }
  }
});

test("phase-ordered, every phase present, and mapped onto three suggested days", () => {
  const steps = runsheetFromDesign(design(2, "multi"), "v-std", CATALOGUE);
  const phases = steps.map((s) => s.phase);
  assert.deepEqual(phases, [...phases].sort((a, b) => a - b), "phase order");
  for (let p = 1; p <= 11; p++) assert.ok(phases.includes(p), `phase ${p}`);
  assert.deepEqual(runsheetDays(steps), [1, 2, 3]);
  const titles = (d: number) => new Set(stepsForDay(steps, d).map((s) => s.title));
  const d1 = titles(1);
  const d2 = titles(2);
  const d3 = titles(3);
  for (const t of ["On site and introduced", "Protection down", "Condition photos", "RAMS acknowledged", "Kit and serial check", "Marking out", "Core drilling", "Wall plate", "Outdoor base or bracket"]) assert.ok(d1.has(t), `day 1: ${t}`);
  for (const t of ["Indoor unit", "Outdoor unit", "Pipework", "Flares and torque", "Condensate", "Electrical circuit"]) assert.ok(d2.has(t), `day 2: ${t}`);
  for (const t of ["Strength and tightness test", "Vacuum and decay test", "Release and leak check", "Commissioning: cooling and heating", "Defrost water route", "Noise check (MCS 020(a))", "F-gas label and charge record", "Electrical certificate", "Customer walkthrough", "Finished photos", "Clean-up"]) assert.ok(d3.has(t), `day 3: ${t}`);
  // Each day's list stays phase-ordered.
  for (const d of [1, 2, 3]) {
    const ph = stepsForDay(steps, d).map((s) => s.phase);
    assert.deepEqual(ph, [...ph].sort((a, b) => a - b));
  }
  // Every step of the runsheet sits on exactly one day.
  assert.equal(stepsForDay(steps, 1).length + stepsForDay(steps, 2).length + stepsForDay(steps, 3).length, steps.length);
});

test("gates: refrigerant work needs F-gas, the circuit needs the electrician, tests are critical", () => {
  const steps = runsheetFromDesign(design(2, "single"), "v-std", CATALOGUE);
  const req = (title: string) => steps.filter((s) => s.title === title).map((s) => s.requires);
  for (const t of ["Strength and tightness test", "Vacuum and decay test", "Release and leak check", "F-gas label and charge record", "Flares and torque"]) {
    assert.ok(req(t).every((r) => r === "fgas"), t);
  }
  assert.ok(req("Electrical circuit").every((r) => r === "electrical"));
  assert.ok(req("Electrical certificate").every((r) => r === "electrical"));
  for (const s of steps.filter((s) => ["Strength and tightness test", "Vacuum and decay test", "Release and leak check", "Electrical circuit"].includes(s.title))) {
    assert.equal(s.critical, true, s.title);
  }
  // The walkthrough is done with the customer at handover.
  assert.equal(steps.find((s) => s.title === "Customer walkthrough")?.stage, "handover");
});

test("the wrong tests are gone: no boundary noise limit, no flat earth-continuity limit", () => {
  const steps = runsheetFromDesign(design(3, "multi"), "v-std", CATALOGUE);
  const slots = steps.flatMap((s) => s.evidence);
  assert.ok(!slots.some((e) => /boundary/i.test(e.label) || (e.unit === "dB(A)" && e.max === 42)), "no 42 dB(A) boundary measurement");
  assert.ok(!slots.some((e) => /earth continuity/i.test(e.label) || e.unit === "Ω"), "no ≤ 1 Ω earth continuity");
  // Noise: the design's MCS 020(a) result, plus an optional QA reading that never fails.
  const noise = steps.find((s) => s.title === "Noise check (MCS 020(a))")!;
  assert.match(noise.guidance ?? "", /36 dB\(A\) at the assessment position/);
  const measuredNoise = noise.evidence.find((e) => e.role === "noise-measured")!;
  assert.equal(measuredNoise.optional, true);
  assert.equal(measuredNoise.min, undefined);
  assert.equal(measuredNoise.max, undefined);
  // Electrics: the EIC and the scheme reference instead.
  assert.ok(specByRole(steps, "eic-ref").length === 1 && specByRole(steps, "scheme-ref").length === 1);
  // No design noise result → the step says so rather than inventing one.
  const bare = runsheetFromDesign(design(1, "single", { noRules: true }), "v-std", CATALOGUE);
  assert.match(bare.find((s) => s.title === "Noise check (MCS 020(a))")!.guidance ?? "", /no noise result/);
});

test("test pressure and vacuum start with no window: record the reading, tech lead confirms", () => {
  const steps = runsheetFromDesign(design(1, "single"), "v-std", CATALOGUE);
  for (const role of ["strength-test", "strength-hold", "vacuum", "vacuum-decay", "cooling-split", "heating-split"]) {
    for (const spec of specByRole(steps, role)) {
      assert.equal(spec.min, undefined, role);
      assert.equal(spec.max, undefined, role);
      assert.equal(spec.window?.basis, "record", role);
      if (role.startsWith("strength") || role.startsWith("vacuum")) assert.match(spec.window?.note ?? "", /tech lead confirms/);
    }
  }
});

test("flare torque by pipe size from the catalogue, as candidates marked for the tech lead", () => {
  const steps = runsheetFromDesign(design(2, "single"), "v-std", CATALOGUE);
  const flares = steps.filter((s) => s.title === "Flares and torque");
  // Room 1: 6.35 / 9.52; room 2: 6.35 / 12.7 (a 5 kW unit), both Daikin.
  const [r1, r2] = flares;
  const gas1 = r1!.evidence.find((e) => e.role === "flare-gas")!;
  const gas2 = r2!.evidence.find((e) => e.role === "flare-gas")!;
  const liq1 = r1!.evidence.find((e) => e.role === "flare-liquid")!;
  assert.deepEqual([liq1.min, liq1.max, liq1.targetKey], [15, 17, "torque.6.35"]);
  assert.deepEqual([gas1.min, gas1.max, gas1.targetKey], [33, 39, "torque.9.52"]);
  assert.deepEqual([gas2.min, gas2.max, gas2.targetKey], [50, 60, "torque.12.7"]);
  assert.equal(gas1.window?.basis, "candidate");
  assert.match(gas1.window?.note ?? "", /tech lead confirms/);
  // Unknown make: no invented window.
  const unknown = runsheetFromDesign(design(1, "single", { indoor: "in-x" }), "v-std", CATALOGUE);
  const flare = unknown.find((s) => s.title === "Flares and torque")!.evidence.find((e) => e.role === "flare-gas")!;
  assert.equal(flare.min, undefined);
  assert.equal(flare.window?.basis, "record");
  assert.equal(flare.targetKey, "torque.9.52", "still a target the tech lead sets");
  // Helpers.
  assert.equal(flareSize(9.5), 9.52);
  assert.equal(flareSize(8), null);
  assert.deepEqual(torqueCandidate(12.7, "Panasonic")?.min, 55);
  assert.equal(torqueCandidate(12.7, "Nobody"), null);
});

test("additional charge expected = max(0, run − pre-charge) × g/m, from the catalogue", () => {
  assert.equal(expectedAdditionalChargeG(18, 10, 20), 160);
  assert.equal(expectedAdditionalChargeG(7, 10, 20), 0);
  assert.equal(expectedAdditionalChargeG(Number.NaN, 10, 20), 0);
  const steps = runsheetFromDesign(design(1, "single"), "v-std", CATALOGUE);
  const charge = steps.find((s) => s.title === "F-gas label and charge record")!;
  // Room 1 run 7 m + 8 m = 15 m on the single: (15 − 10) × 20 = 100 g.
  assert.match(charge.evidence.find((e) => e.role === "additional-charge")!.label, /design: 100 g/);
  assert.match(charge.guidance ?? "", /R32, GWP 675/);
  assert.ok(charge.evidence.some((e) => e.role === "factory-charge" && e.unit === "kg"));
  assert.ok(charge.evidence.some((e) => e.role === "fgas-label" && e.kind === "photo"));
});

test("risks from the survey: asbestos check for older homes, access check at height, pump test", () => {
  const modern = runsheetFromDesign(design(1, "single"), "v-std", CATALOGUE, measured());
  assert.ok(!modern.some((s) => s.id === "d1-asbestos"), "post-2000, none suspected: no asbestos step");
  const older = runsheetFromDesign(design(1, "single"), "v-std", CATALOGUE, measured({ era: "1930-1950" }));
  const asb = older.find((s) => s.id === "d1-asbestos")!;
  assert.equal(asb.critical, true);
  assert.equal(asb.phase, 2, "before any drilling");
  // No survey at all: check anyway.
  assert.ok(runsheetFromDesign(design(1, "single"), "v-std", CATALOGUE).some((s) => s.id === "d1-asbestos"));
  const high = runsheetFromDesign(design(1, "single"), "v-std", CATALOGUE, measured({}, "tower"));
  assert.ok(high.find((s) => s.title === "Outdoor base or bracket")!.evidence.some((e) => /Tower inspected/.test(e.label)));
  assert.match(high.find((s) => s.id === "d1-rams")!.guidance ?? "", /working at height/);
  assert.match(high.find((s) => s.id === "d1-rams")!.guidance ?? "", /DEMO dog/);
  const pump = runsheetFromDesign(design(2, "multi", { pumpRoom: 2 }), "v-std", CATALOGUE);
  const cond = pump.filter((s) => s.title === "Condensate");
  assert.equal(cond[0]!.evidence.some((e) => /Pump test/.test(e.label)), false);
  assert.equal(cond[1]!.evidence.some((e) => /Pump test/.test(e.label)), true);
});

test("unknown variant or empty design is refused loudly", () => {
  assert.throws(() => runsheetFromDesign(design(1, "single"), "nope", CATALOGUE), /no variant/);
  const empty = design(1, "single");
  empty.variants[0]!.systems = [];
  assert.throws(() => runsheetFromDesign(empty, "v-std", CATALOGUE), /no systems/);
});

test("legacy demo runsheets still map to days by phase", () => {
  const legacy = buildRunsheet({ rooms: ["A"], outdoorUnits: 1 });
  assert.equal(dayOf(legacy.find((s) => s.phase === 2)!), 1);
  assert.equal(dayOf(legacy.find((s) => s.phase === 5)!), 2);
  assert.equal(dayOf(legacy.find((s) => s.phase === 9)!), 3);
  assert.equal(stepsForDay(legacy, 1).length + stepsForDay(legacy, 2).length + stepsForDay(legacy, 3).length, legacy.length);
});

/* ------------------------------------------------------------------ */
/* Who may record                                                      */
/* ------------------------------------------------------------------ */

test("canRecord: locked steps say who's needed", () => {
  const steps = runsheetFromDesign(design(1, "single"), "v-std", CATALOGUE);
  const pressure = steps.find((s) => s.title === "Strength and tightness test")!;
  const circuit = steps.find((s) => s.title === "Electrical circuit")!;
  const plain = steps.find((s) => s.title === "Pipework")!;
  assert.deepEqual(canRecord(pressure, INSTALLER, ON), { ok: false, reason: "Needs an F-gas engineer" });
  assert.equal(canRecord(pressure, FGAS_INSTALLER, ON).ok, true);
  assert.deepEqual(canRecord(circuit, INSTALLER, ON), { ok: false, reason: "Needs an electrician" });
  assert.equal(canRecord(circuit, ELECTRICIAN, ON).ok, true);
  assert.equal(canRecord(plain, INSTALLER, ON).ok, true);
  assert.equal(canRecord(plain, SURVEYOR, ON).ok, false, "no install permission");
  assert.equal(canRecord(plain, { ...INSTALLER, active: false }, ON).ok, false);
  // Expired certificate on the day: locked.
  const expired = person({ roles: ["installer"], qualifications: [{ ...FGAS, expiresOn: "2026-11-09" }] });
  assert.equal(canRecord(pressure, expired, ON).ok, false);
  assert.equal(canRecord({ ...plain, requires: "tech-lead" }, FGAS_INSTALLER, ON).reason, "Needs the tech lead");
});

test("canSetOutcome: reasons required, critical steps can't be N/A by installers, anyone can say Blocked", () => {
  const steps = runsheetFromDesign(design(1, "single"), "v-std", CATALOGUE);
  const pressure = steps.find((s) => s.title === "Strength and tightness test")!;
  const protection = steps.find((s) => s.title === "Protection down")!;
  const pipework = steps.find((s) => s.title === "Pipework")!;
  const asbestos = steps.find((s) => s.id === "d1-asbestos")!;
  assert.equal(canSetOutcome(protection, "na", INSTALLER, ON).ok, false, "N/A needs a reason");
  assert.equal(canSetOutcome(protection, "na", INSTALLER, ON, "Hard floors, nothing to protect").ok, true);
  assert.equal(canSetOutcome(pipework, "na", INSTALLER, ON, "DEMO reason").ok, false, "step doesn't allow N/A");
  assert.equal(canSetOutcome(pipework, "na", TECH, ON, "DEMO reason").ok, true, "tech lead may");
  assert.equal(canSetOutcome(asbestos, "na", FGAS_INSTALLER, ON, "Built 2005").ok, false, "critical: not by installers");
  assert.equal(canSetOutcome(asbestos, "na", TECH, ON, "Built 2005, confirmed").ok, true);
  assert.equal(canSetOutcome(pressure, "na", TECH, ON, "DEMO reason").ok, false, "critical, no N/A at all");
  assert.equal(canSetOutcome(pressure, "fail", INSTALLER, ON, "Dropped 2 bar").ok, false, "a fail is a test result");
  assert.equal(canSetOutcome(pressure, "blocked", INSTALLER, ON, "No F-gas engineer on site today").ok, true);
  assert.equal(canSetOutcome(pressure, "blocked", INSTALLER, ON, "").ok, false);
  assert.equal(canSetOutcome(pipework, "pass", INSTALLER, ON).ok, true);
  assert.equal(canReviewExceptions(TECH, ON).ok, true);
  assert.equal(canReviewExceptions(FGAS_INSTALLER, ON).ok, false);
});

/* ------------------------------------------------------------------ */
/* Progress                                                            */
/* ------------------------------------------------------------------ */

test("progress: nothing done, then done day by day, complete without the handover walkthrough", () => {
  const steps = runsheetFromDesign(design(2, "multi"), "v-std", CATALOGUE);
  let j = job(steps);
  let p = runsheetProgress(j);
  assert.equal(p.complete, false);
  assert.equal(p.byDay.length, 3);
  assert.ok(p.byDay.every((d) => d.done === 0 && d.total > 0));
  assert.equal(p.missing, steps.filter((s) => s.stage !== "handover").length);
  assert.equal(p.walkthroughDone, false);

  j = fill(j, stepsForDay(steps, 1));
  p = runsheetProgress(j);
  assert.equal(p.byDay[0]!.done, p.byDay[0]!.total);
  assert.equal(p.byDay[1]!.done, 0);

  // Everything but the walkthrough.
  j = fill(job(steps), steps.filter((s) => s.stage !== "handover"));
  p = runsheetProgress(j);
  assert.equal(p.complete, true, "install complete without the walkthrough");
  assert.equal(p.walkthroughDone, false);
  assert.equal(p.openExceptions, 0);
  j = fill(j, steps.filter((s) => s.stage === "handover"));
  assert.equal(runsheetProgress(j).walkthroughDone, true);
  assert.equal(runsheetPercent(j), 100);
});

test("optional slots don't hold up a step; a photo without its media isn't captured", () => {
  const steps = runsheetFromDesign(design(1, "single"), "v-std", CATALOGUE);
  const noise = steps.find((s) => s.title === "Noise check (MCS 020(a))")!;
  const calc = noise.evidence.find((e) => e.role === "noise-calc")!;
  const j = job(steps, [{ id: "e1", specId: calc.id, at: AT, by: "DEMO" }]);
  assert.equal(stepView(j, noise).state, "done");
  const finished = steps.find((s) => s.title === "Finished photos")!;
  const j2 = job(steps, [{ id: "e2", specId: finished.evidence[0]!.id, at: AT, by: "DEMO" }]);
  assert.equal(slotView(j2, finished.evidence[0]!).state, "missing");
});

test("blocked steps keep the runsheet incomplete; N/A with a reason finishes a step; a later pass clears a fail", () => {
  const steps = runsheetFromDesign(design(1, "single"), "v-std", CATALOGUE);
  let j = fill(job(steps), steps.filter((s) => s.stage !== "handover"));
  assert.equal(runsheetProgress(j).complete, true);
  const pipe = steps.find((s) => s.title === "Pipework")!;
  j = withStepStatus(j, { id: "st-1", stepId: pipe.id, outcome: "blocked", reason: "Trunking short", at: "2026-11-10T10:00:00.000Z", by: "DEMO" });
  let p = runsheetProgress(j);
  assert.equal(p.complete, false);
  assert.equal(p.blocked, 1);
  assert.equal(stepView(j, pipe).state, "blocked");
  // Idempotent on the record id.
  assert.equal(withStepStatus(j, { id: "st-1", stepId: pipe.id, outcome: "pass", at: "2026-11-10T11:00:00.000Z", by: "DEMO" }), j);
  j = withStepStatus(j, { id: "st-2", stepId: pipe.id, outcome: "pass", at: "2026-11-10T11:00:00.000Z", by: "DEMO" });
  assert.equal(runsheetProgress(j).complete, true, "pass after the block: evidence decides again");
  j = withStepStatus(j, { id: "st-3", stepId: pipe.id, outcome: "fail", reason: "Kinked", at: "2026-11-10T12:00:00.000Z", by: "DEMO" });
  p = runsheetProgress(j);
  assert.equal(stepView(j, pipe).state, "failed");
  assert.equal(p.missing, 1, "a failed step counts as missing");
  // N/A on an empty step finishes it.
  const prot = steps.find((s) => s.title === "Protection down")!;
  const bare = job(steps);
  assert.equal(stepView(withStepStatus(bare, { stepId: prot.id, outcome: "na", reason: "Hard floors", at: AT, by: "DEMO" }), prot).state, "na");
  assert.equal(stepView(withStepStatus(bare, { stepId: prot.id, outcome: "na", reason: " ", at: AT, by: "DEMO" }), prot).state, "todo", "N/A without a reason doesn't count");
});

test("exceptions: out-of-window readings wait for the tech lead; accept or ask for a recapture", () => {
  const steps = runsheetFromDesign(design(1, "single"), "v-std", CATALOGUE);
  let j = fill(job(steps), steps.filter((s) => s.stage !== "handover"));
  const flare = steps.find((s) => s.title === "Flares and torque")!;
  const gas = flare.evidence.find((e) => e.role === "flare-gas")!;
  j = { ...j, evidence: [...j.evidence, { id: "ev-bad", specId: gas.id, value: 45, at: "2026-11-10T13:00:00.000Z", by: "DEMO" }] };
  let p = runsheetProgress(j);
  assert.equal(p.openExceptions, 1);
  assert.equal(p.missing, 0, "one out-of-range reading is listed once: to review, not also as a step to finish");
  assert.deepEqual(commissioningSignErrors(j, TECH, "2026-11-10").filter((e) => /outside the window|still to finish/.test(e)), ["1 reading outside the window still to review."]);
  assert.equal(p.complete, false);
  assert.equal(stepView(j, flare).state, "exception");
  assert.equal(openExceptions(j).length, 1);
  // Accepted with a reason: the step is done, the exception closed.
  const accepted = withExceptionReview(j, { specId: gas.id, evidenceId: "ev-bad", resolution: "accepted", reason: "Wrench calibrated high; checked", by: TECH.name, at: "2026-11-10T14:00:00.000Z" });
  p = runsheetProgress(accepted);
  assert.equal(p.openExceptions, 0);
  assert.equal(p.complete, true);
  assert.equal(slotView(accepted, gas).state, "accepted");
  // Recapture required: missing until a new capture; the new one is judged afresh.
  let re = withExceptionReview(j, { specId: gas.id, evidenceId: "ev-bad", resolution: "recapture-required", reason: "Re-torque", by: TECH.name, at: "2026-11-10T14:00:00.000Z" });
  assert.equal(slotView(re, gas).state, "recapture");
  assert.equal(runsheetProgress(re).openExceptions, 0);
  assert.equal(runsheetProgress(re).complete, false);
  re = { ...re, evidence: [...re.evidence, { id: "ev-good", specId: gas.id, value: 36, at: "2026-11-10T15:00:00.000Z", by: "DEMO" }] };
  assert.equal(slotView(re, gas).state, "pass");
  assert.equal(runsheetProgress(re).complete, true);
  // A review without an evidence id covers captures before it, not after.
  const timed = withExceptionReview(j, { specId: gas.id, resolution: "accepted", reason: "OK", by: TECH.name, at: "2026-11-10T14:00:00.000Z" });
  assert.equal(slotView(timed, gas).state, "accepted");
  const later = { ...timed, evidence: [...timed.evidence, { id: "ev-worse", specId: gas.id, value: 48, at: "2026-11-10T16:00:00.000Z", by: "DEMO" }] };
  assert.equal(slotView(later, gas).state, "exception");
  assert.equal(windowText(gas), "33 to 39 N·m");
});

/* ------------------------------------------------------------------ */
/* Targets                                                             */
/* ------------------------------------------------------------------ */

test("targets: the job's targets, set by the tech lead, re-judge readings; commissioning waits for them", () => {
  const steps = runsheetFromDesign(design(2, "single"), "v-std", CATALOGUE);
  const keys = jobTargets(steps).map((t) => t.key);
  for (const k of ["pressure.test", "vacuum.target", "vacuum.decay", "torque.6.35", "torque.9.52", "torque.12.7", "condensate.fall"]) assert.ok(keys.includes(k as never), k);
  assert.equal(jobTargets(steps).find((t) => t.key === "pressure.test")!.specCount, 4, "two readings × two systems");
  assert.deepEqual(unconfirmedTargets(steps).length, keys.length);

  assert.equal(targetError("pressure.test", 30, undefined), "Set the maximum too: the outdoor unit's nameplate PS.");
  assert.equal(targetError("pressure.test", 40, 30), "The minimum is above the maximum.");
  assert.match(targetError("vacuum.target", 100, 500) ?? "", /maximum only/);
  assert.equal(targetError("condensate.fall", undefined, undefined), null, "record-only is a valid confirmation");
  assert.throws(() => setJobTarget(steps, { key: "pressure.test", min: -1, max: 40 }, TECH.name, AT), /positive/);

  let sheet = setJobTarget(steps, { key: "pressure.test", min: 30, max: 41.5, note: "DEMO manual p.12" }, TECH.name, AT);
  const test1 = sheet.flatMap((s) => s.evidence).find((e) => e.role === "strength-test")!;
  assert.deepEqual([test1.min, test1.max, test1.window?.basis, test1.window?.setBy], [30, 41.5, "tech-lead", TECH.name]);
  assert.ok(!unconfirmedTargets(sheet).includes("pressure.test"));
  // A reading recorded before the target existed is judged against it now.
  const j = { ...job(sheet), evidence: [{ id: "p1", specId: test1.id, value: 45, at: AT, by: "DEMO" }] };
  assert.equal(slotView(j, test1).state, "exception");
  // Confirm everything else (record only where that's what the manual says).
  for (const t of jobTargets(sheet)) {
    if (t.basis === "tech-lead") continue;
    sheet = setJobTarget(sheet, { key: t.key, ...(t.min !== undefined ? { min: t.min } : {}), ...(t.max !== undefined ? { max: t.max } : {}) }, TECH.name, AT);
  }
  assert.deepEqual(unconfirmedTargets(sheet), []);
  assert.ok(JOB_TARGETS["torque.9.52"].hint.includes("Daikin"));
});

/* ------------------------------------------------------------------ */
/* Commissioning                                                       */
/* ------------------------------------------------------------------ */

function commissionedJob(): InstallJobV2 {
  let steps = runsheetFromDesign(design(2, "multi"), "v-std", CATALOGUE);
  for (const t of jobTargets(steps)) steps = setJobTarget(steps, { key: t.key, ...(t.key === "pressure.test" ? { min: 30, max: 41.5 } : {}), ...(t.key === "vacuum.target" ? { max: 500 } : {}), ...(t.key === "vacuum.decay" ? { max: 700 } : {}), ...(t.key.startsWith("torque") ? { min: t.min ?? 10, max: t.max ?? 80 } : {}) }, TECH.name, AT);
  let j = job(steps);
  const value = (role: string, v: number, item?: string) => {
    for (const s of steps) {
      if (item && s.item !== item) continue;
      for (const e of s.evidence.filter((x) => x.role === role)) j.evidence.push({ id: `${e.id}-v`, specId: e.id, value: v, at: AT, by: TECH.name });
    }
  };
  const ref = (role: string, r: string, item?: string) => {
    for (const s of steps) {
      if (item && !(s.item ?? "").startsWith(item)) continue;
      for (const e of s.evidence.filter((x) => x.role === role)) j.evidence.push({ id: `${e.id}-r`, specId: e.id, ref: r, at: AT, by: TECH.name });
    }
  };
  j = fill(j);
  value("strength-test", 38);
  value("strength-hold", 37.9);
  value("vacuum", 320);
  value("vacuum-decay", 450);
  value("additional-charge", 0);
  value("factory-charge", 1.4);
  value("as-built-length", 21);
  value("cooling-split", 11.5, "Main bedroom");
  value("cooling-split", 12.1, "Living room");
  value("heating-split", 18.2, "Main bedroom");
  value("heating-split", 19, "Living room");
  value("noise-measured", 51);
  ref("serial-indoor", "SN-IN-1", "Main bedroom");
  ref("serial-indoor", "SN-IN-2", "Living room");
  ref("serial-outdoor", "SN-OUT-1");
  ref("eic-ref", "DEMO-EIC-42");
  ref("scheme-ref", "pending from scheme");
  return j;
}

test("commissioningFromJob: pressures, vacuum, charge, splits per room in both modes, serials", () => {
  const j = commissionedJob();
  const [r] = commissioningFromJob(j);
  assert.ok(r);
  assert.equal(r.system, "System");
  assert.equal(r.strengthTestBar, 38);
  assert.equal(r.holdBar, 37.9);
  assert.equal(r.vacuumMicrons, 320);
  assert.equal(r.decayMicrons, 450);
  assert.equal(r.additionalChargeG, 0);
  assert.equal(r.noiseDb, 51);
  assert.deepEqual(r.coolingSplitC, { "Main bedroom": 11.5, "Living room": 12.1 });
  assert.deepEqual(r.heatingSplitC, { "Main bedroom": 18.2, "Living room": 19 });
  assert.equal(r.serials[0]!.serial, "SN-OUT-1", "outdoor first");
  assert.deepEqual(r.serials.slice(1).map((s) => s.serial), ["SN-IN-1", "SN-IN-2"]);
  const fg = fgasFromJob(j)[0]!;
  assert.deepEqual(fg.record && [fg.record.factoryChargeKg, fg.record.additionalChargeKg, fg.record.totalKg, fg.record.tco2e, fg.record.gwp], [1.4, 0, 1.4, 0.945, 675]);
  assert.equal(fg.asBuiltLengthM, 21);
  assert.deepEqual(electricalRefsFromJob(j), { eic: "DEMO-EIC-42", scheme: "pending from scheme" });
  const eq = equipmentFromJob(j);
  assert.equal(eq.length, 3);
  assert.equal(eq[0]!.room, "Main bedroom");
  assert.equal(eq[2]!.room, "Outdoor");
  assert.equal(eq[2]!.serial, "SN-OUT-1");
});

test("commissioningFromJob: one result per outdoor unit on multiple singles", () => {
  const steps = runsheetFromDesign(design(3, "single"), "v-std", CATALOGUE);
  const j = fill(job(steps));
  const res = commissioningFromJob(j);
  assert.deepEqual(res.map((r) => r.system), ["System 1", "System 2", "System 3"]);
  assert.ok(res.every((r) => Object.keys(r.coolingSplitC).length === 1));
});

test("commissioning sign-off: tech lead only, runsheet complete, targets confirmed, no open exceptions", () => {
  const j = commissionedJob();
  assert.deepEqual(commissioningSignErrors(j, TECH, ON), []);
  assert.ok(commissioningSignErrors(j, FGAS_INSTALLER, ON).some((e) => /tech lead/.test(e)));
  const unsure = { ...j, runsheet: runsheetFromDesign(design(2, "multi"), "v-std", CATALOGUE) };
  assert.ok(commissioningSignErrors(unsure, TECH, ON).some((e) => /targets/.test(e)));
  const bad = { ...j, evidence: [...j.evidence, { id: "x", specId: specByRole(j.runsheet, "vacuum")[0]!.id, value: 900, at: "2026-11-10T18:00:00.000Z", by: "DEMO" }] };
  assert.ok(commissioningSignErrors(bad, TECH, ON).some((e) => /outside the window/.test(e)));
  const rec = buildCommissioningRecord(j, TECH, "2026-11-10T16:00:00.000Z", "  DEMO notes ");
  assert.equal(rec.signedBy.qualificationRef, "DEMO-FGAS-1");
  assert.equal(rec.notes, "DEMO notes");
  assert.equal(rec.results.length, 1);
  assert.ok(commissioningSignErrors({ ...j, commissioning: rec }, TECH, ON).includes("Commissioning is already signed."));
});

test("legacy demo runsheet: commissioning still derives from labels", () => {
  const legacy = buildRunsheet({ rooms: ["A", "B"], outdoorUnits: 1 });
  const j = fill(job(legacy));
  const [r] = commissioningFromJob(j);
  assert.ok(r && typeof r.strengthTestBar === "number" && typeof r.vacuumMicrons === "number");
  assert.equal(Object.keys(r.coolingSplitC).length, 2);
  // The demo runsheet's walkthrough is found by title.
  assert.equal(runsheetProgress(j).walkthroughDone, true);
  assert.equal(runsheetProgress(job(legacy)).walkthroughDone, false);
});

test("RAMS acknowledgements: once per person, earliest first", () => {
  const steps = runsheetFromDesign(design(1, "single"), "v-std", CATALOGUE);
  const rams = specByRole(steps, "rams")[0]!;
  const j = job(steps, [
    { id: "a", specId: rams.id, at: "2026-11-10T08:10:00.000Z", by: "DEMO Ivo", byStaffId: "s1" },
    { id: "b", specId: rams.id, at: "2026-11-10T08:05:00.000Z", by: "DEMO Tess", byStaffId: "s2" },
    { id: "c", specId: rams.id, at: "2026-11-10T08:20:00.000Z", by: "DEMO Ivo", byStaffId: "s1" },
  ]);
  assert.deepEqual(ramsAcknowledgements(j).map((r) => r.by), ["DEMO Tess", "DEMO Ivo"]);
  assert.equal(latestEvidence(j, rams.id)?.id, "c");
});
