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
  customerWorkDone,
  customerWorkNext,
  listInWords,
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
  photoContexts,
  photoGroups,
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
  carryTargets,
  decayRetestMarkers,
  decayTest,
  withDecayTests,
  withRetestMarkers,
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

/** Real-shaped readings for a decay test's slots: 30 bar g held at 15 °C for an hour on a 0.1 bar gauge; 350 micron rising to 400. */
const DECAY_READING: Record<string, number> = {
  "strength-test": 30,
  "strength-start-temp": 15,
  "strength-hold": 30,
  "strength-end-temp": 15,
  "strength-hold-time": 60,
  "gauge-resolution": 0.1,
  vacuum: 350,
  "vacuum-hold-time": 60,
  "vacuum-decay": 400,
};

/** A capture that passes this slot (mid-window, or a plausible reading for record-only slots). */
function passing(spec: EvidenceSpec, i: number, at = AT): EvidenceRecord {
  const base = { id: `ev-${spec.id}-${i}`, specId: spec.id, at, by: TECH.name, byStaffId: TECH.id };
  if (NUMERIC_KINDS.has(spec.kind) || spec.kind === "measurement") {
    const v = plausibleValue(spec) ?? (spec.role ? DECAY_READING[spec.role] : undefined) ?? 10;
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
  for (const role of ["strength-test", "strength-start-temp", "strength-hold", "strength-end-temp", "strength-hold-time", "gauge-resolution", "vacuum", "vacuum-hold-time", "vacuum-decay", "cooling-split", "heating-split"]) {
    const specs = specByRole(steps, role);
    assert.equal(specs.length, 1, role);
    for (const spec of specs) {
      assert.equal(spec.min, undefined, role);
      assert.equal(spec.max, undefined, role);
      assert.equal(spec.window?.basis, "record", role);
    }
  }
  assert.match(specByRole(steps, "strength-test")[0]!.window?.note ?? "", /tech lead confirms/);
  assert.match(specByRole(steps, "vacuum")[0]!.window?.note ?? "", /500 micron/);
  // The two tests are judged as steps, with their own limit (the allowed fall, the rise limit), unset.
  const pressure = steps.find((s) => s.title === "Strength and tightness test")!;
  const vacuum = steps.find((s) => s.title === "Vacuum and decay test")!;
  assert.deepEqual([pressure.decay?.kind, pressure.decay?.limit.targetKey, pressure.decay?.limit.max], ["pressure", "pressure.decay", undefined]);
  assert.deepEqual([vacuum.decay?.kind, vacuum.decay?.limit.targetKey, vacuum.decay?.limit.max], ["vacuum", "vacuum.rise", undefined]);
  assert.deepEqual(
    pressure.evidence.map((e) => e.id.split(".")[1]),
    ["applied", "start-temp", "held", "end-temp", "hold-time", "resolution", "gauge"],
    "the readings in the order they're taken",
  );
  assert.deepEqual(vacuum.evidence.map((e) => e.id.split(".")[1]), ["reached", "hold-time", "decay", "gauge"]);
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
  for (const k of ["pressure.test", "pressure.hold", "pressure.decay", "vacuum.target", "vacuum.hold", "vacuum.decay", "vacuum.rise", "torque.6.35", "torque.9.52", "torque.12.7", "condensate.fall"]) assert.ok(keys.includes(k as never), k);
  assert.equal(jobTargets(steps).find((t) => t.key === "pressure.test")!.specCount, 2, "the applied pressure × two systems");
  assert.equal(jobTargets(steps).find((t) => t.key === "pressure.decay")!.specCount, 2, "one allowed fall per system's test");
  assert.deepEqual(unconfirmedTargets(steps).length, keys.length);

  assert.equal(targetError("pressure.test", 30, undefined), "Set the maximum too: the outdoor unit's nameplate PS.");
  assert.equal(targetError("pressure.test", 40, 30), "The minimum is above the maximum.");
  assert.match(targetError("vacuum.target", 100, 500) ?? "", /maximum only/);
  assert.equal(targetError("condensate.fall", undefined, undefined), null, "record-only is a valid confirmation");
  assert.equal(targetError("pressure.decay", undefined, undefined), null, "the allowed fall may stay at the gauge's resolution");
  assert.equal(targetError("vacuum.target", undefined, undefined), null, "the vacuum target may stay at 500 micron");
  for (const k of ["pressure.test", "pressure.hold", "vacuum.hold", "vacuum.rise"] as const) assert.ok(targetError(k, undefined, undefined), `${k} needs a number from the manual`);
  assert.equal(targetError("pressure.test", undefined, 41.5), "Set the minimum too: the manual's test pressure.");
  assert.match(targetError("pressure.hold", 0, undefined) ?? "", /more than 0/);
  assert.match(targetError("vacuum.target", undefined, 1000) ?? "", /500 micron always applies/, "a looser vacuum target would change nothing, so it isn't taken");
  assert.equal(targetError("vacuum.target", undefined, 250), null);
  assert.throws(() => setJobTarget(steps, { key: "pressure.test", min: -1, max: 40 }, TECH.name, AT), /positive/);

  let sheet = setJobTarget(steps, { key: "pressure.test", min: 30, max: 41.5, note: "DEMO manual p.12" }, TECH.name, AT);
  const test1 = sheet.flatMap((s) => s.evidence).find((e) => e.role === "strength-test")!;
  assert.deepEqual([test1.min, test1.max, test1.window?.basis, test1.window?.setBy], [30, 41.5, "tech-lead", TECH.name]);
  assert.ok(!unconfirmedTargets(sheet).includes("pressure.test"));
  // A reading recorded before the target existed is judged against it now.
  const j = { ...job(sheet), evidence: [{ id: "p1", specId: test1.id, value: 45, at: AT, by: "DEMO" }] };
  assert.equal(slotView(j, test1).state, "exception");
  // Confirm everything else (record only where that's what the manual says; a number where one is needed).
  const NEEDED: Partial<Record<string, { min?: number; max?: number }>> = { "pressure.hold": { min: 60 }, "vacuum.hold": { min: 60 }, "vacuum.rise": { max: 200 } };
  for (const t of jobTargets(sheet)) {
    if (t.basis === "tech-lead") continue;
    sheet = setJobTarget(sheet, { key: t.key, ...(t.min !== undefined ? { min: t.min } : {}), ...(t.max !== undefined ? { max: t.max } : {}), ...NEEDED[t.key] }, TECH.name, AT);
  }
  assert.deepEqual(unconfirmedTargets(sheet), []);
  assert.ok(JOB_TARGETS["torque.9.52"].hint.includes("Daikin"));
});

/* ------------------------------------------------------------------ */
/* Commissioning                                                       */
/* ------------------------------------------------------------------ */

/** Every target set as a tech lead would from a (DEMO) manual: 30 to 41.5 bar g held an hour, 500 micron, an hour's decay hold rising at most 200. */
function confirmAll(steps: InstallStep[]): InstallStep[] {
  let out = steps;
  for (const t of jobTargets(steps)) {
    const n =
      t.key === "pressure.test"
        ? { min: 30, max: 41.5 }
        : t.key === "pressure.hold" || t.key === "vacuum.hold"
          ? { min: 60 }
          : t.key === "vacuum.target"
            ? { max: 500 }
            : t.key === "vacuum.decay"
              ? { max: 700 }
              : t.key === "vacuum.rise"
                ? { max: 200 }
                : t.key.startsWith("torque")
                  ? { min: t.min ?? 10, max: t.max ?? 80 }
                  : {};
    out = setJobTarget(out, { key: t.key, ...n }, TECH.name, AT);
  }
  return out;
}

function commissionedJob(): InstallJobV2 {
  let steps = runsheetFromDesign(design(2, "multi"), "v-std", CATALOGUE);
  steps = confirmAll(steps);
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
  // A second, complete run of each test (the first, from fill, passed too): 38 bar g at 14 °C, 37.9 at 13 °C an hour later.
  value("strength-test", 38);
  value("strength-start-temp", 14);
  value("strength-hold", 37.9);
  value("strength-end-temp", 13);
  value("strength-hold-time", 60);
  value("gauge-resolution", 0.1);
  value("vacuum", 320);
  value("vacuum-hold-time", 60);
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
  const bad = { ...j, evidence: [...j.evidence, { id: "x", specId: specByRole(j.runsheet, "flare-gas")[0]!.id, value: 900, at: "2026-11-10T18:00:00.000Z", by: "DEMO" }] };
  assert.ok(commissioningSignErrors(bad, TECH, ON).some((e) => /outside the window/.test(e)));
  // One vacuum reading typed again starts a new run: the step isn't finished until the whole decay test is taken again.
  const retyped = { ...j, evidence: [...j.evidence, { id: "y", specId: specByRole(j.runsheet, "vacuum")[0]!.id, value: 900, at: "2026-11-10T18:00:00.000Z", by: "DEMO" }] };
  assert.ok(commissioningSignErrors(retyped, TECH, ON).some((e) => /1 step still to finish/.test(e)));
  // A whole run that fails holds the signature, with the reason and what to do.
  const wet = {
    ...j,
    evidence: [
      ...j.evidence,
      ...[["vacuum", 900], ["vacuum-hold-time", 60], ["vacuum-decay", 1400]].map(([role, value], i) => ({ id: `w${i}`, specId: specByRole(j.runsheet, role as string)[0]!.id, value: value as number, at: "2026-11-10T18:00:00.000Z", by: "DEMO" })),
    ],
  };
  const errs = commissioningSignErrors(wet, TECH, ON);
  assert.ok(errs.some((e) => /vacuum decay test failed and hasn't been done again \(Reached 900 micron, above the 500 micron target/.test(e)), errs.join(" | "));
  const rec = buildCommissioningRecord(j, TECH, "2026-11-10T16:00:00.000Z", "  DEMO notes ");
  assert.equal(rec.signedBy.qualificationRef, "DEMO-FGAS-1");
  assert.equal(rec.notes, "DEMO notes");
  assert.equal(rec.results.length, 1);
  assert.ok(commissioningSignErrors({ ...j, commissioning: rec }, TECH, ON).includes("Commissioning is already signed."));
});

/* ------------------------------------------------------------------ */
/* Decay tests                                                         */
/* ------------------------------------------------------------------ */

/** One run of a decay test: each reading, in the order taken, a minute apart. */
function run(steps: InstallStep[], readings: [string, number][], tag: string, systemItem?: string): EvidenceRecord[] {
  return readings.map(([role, value], i) => {
    const spec = steps.filter((s) => !systemItem || s.item === systemItem).flatMap((s) => s.evidence).find((e) => e.role === role)!;
    return { id: `${tag}-${i}`, specId: spec.id, value, at: `2026-11-10T1${Math.min(9, i)}:00:00.000Z`, by: TECH.name, byStaffId: TECH.id };
  });
}

/** The gauge photos on both tests (the steps' other required slot). */
const gaugePhotos = (steps: InstallStep[]): EvidenceRecord[] =>
  steps
    .filter((s) => s.decay)
    .flatMap((s) => s.evidence.filter((e) => e.kind === "photo"))
    .map((e, i) => ({ id: `photo-${i}`, specId: e.id, mediaId: `m-gauge-${i}`, at: AT, by: TECH.name }));

const PRESSURE_OK: [string, number][] = [
  ["strength-test", 30],
  ["strength-start-temp", 20],
  ["strength-hold", 29.4],
  ["strength-end-temp", 15],
  ["strength-hold-time", 60],
  ["gauge-resolution", 0.1],
];

test("decay: a fall the temperature explains passes, with the correction on the record", () => {
  const steps = confirmAll(runsheetFromDesign(design(1, "single"), "v-std", CATALOGUE));
  const step = steps.find((s) => s.decay?.kind === "pressure")!;
  const j = job(steps, [...gaugePhotos(steps), ...run(steps, PRESSURE_OK, "p1")]);
  const t = decayTest(j, step)!;
  assert.equal(t.result, "pass");
  assert.equal(t.failedRuns, 0);
  assert.ok(Math.abs(t.pressure!.endCorrectedBarG! - 29.928) < 0.001);
  assert.equal(t.pressure!.allowanceFrom, "gauge-resolution");
  assert.equal(stepView(j, step).state, "done");
  const [r] = commissioningFromJob(j);
  assert.deepEqual([r!.strengthTestBar, r!.holdBar, r!.pressureTest?.result], [30, 29.4, "pass"]);
});

test("decay: a fall beyond the gauge fails the step; re-typing one reading never clears it; a full retest does", () => {
  const steps = confirmAll(runsheetFromDesign(design(1, "single"), "v-std", CATALOGUE));
  const step = steps.find((s) => s.decay?.kind === "pressure")!;
  // 30.0 bar g to 29.4 at a steady 15 °C: 0.6 bar lost.
  const leak: [string, number][] = PRESSURE_OK.map(([r, v]) => [r, r === "strength-start-temp" ? 15 : v]);
  let j = job(steps, [...gaugePhotos(steps), ...run(steps, leak, "p1")]);
  let t = decayTest(j, step)!;
  assert.deepEqual([t.result, t.retestNeeded, t.failedRuns], ["fail", true, 1]);
  assert.match(t.fails[0]!, /^Fell 0\.6 bar/);
  let v = stepView(j, step);
  assert.equal(v.state, "failed");
  assert.ok(v.slots.filter((s) => s.spec.role !== undefined).every((s) => s.state === "recapture"), "every reading is to take again");
  assert.ok(commissioningSignErrors(j, TECH, ON).some((e) => /strength and tightness test failed/.test(e)));
  // A tap on Pass doesn't clear it.
  j = withStepStatus(j, { stepId: step.id, outcome: "pass", at: AT, by: TECH.name });
  assert.equal(stepView(j, step).state, "failed");
  // Typing the end pressure again (a "better" number) starts a retest; the failure stands meanwhile.
  j = { ...j, evidence: [...j.evidence, ...run(steps, [["strength-hold", 30]], "p2")] };
  t = decayTest(j, step)!;
  assert.deepEqual([t.result, t.retestNeeded, t.toTake.length], ["fail", true, 5]);
  assert.equal(stepView(j, step).state, "failed");
  // The rest of the retest: joints remade, held again, every reading taken again.
  j = { ...j, evidence: [...j.evidence, ...run(steps, PRESSURE_OK.filter(([r]) => r !== "strength-hold"), "p3")] };
  t = decayTest(j, step)!;
  assert.deepEqual([t.result, t.retestNeeded, t.failedRuns], ["pass", false, 1], "the earlier failure is counted, not hidden");
  // 30 bar g at 20 °C, 30 at 15 °C: it rose once corrected.
  assert.ok(t.pressure!.fallBar! < 0);
  assert.equal(stepView(j, step).state, "done");
  assert.equal(commissioningFromJob(j)[0]!.pressureTest?.failedRuns, 1);
});

test("decay: a target change can't pass a failed test; the retest is judged against it", () => {
  const steps = confirmAll(runsheetFromDesign(design(1, "single"), "v-std", CATALOGUE));
  const step = steps.find((s) => s.decay?.kind === "pressure")!;
  // 0.15 bar lost at a steady temperature: over the 0.1 bar gauge, under a 0.2 bar manual allowance.
  const slow: [string, number][] = PRESSURE_OK.map(([r, v]) => [r, r === "strength-start-temp" ? 15 : r === "strength-hold" ? 29.85 : v]);
  const j = job(steps, run(steps, slow, "p1"));
  assert.equal(decayTest(j, step)!.result, "fail");
  const next = setJobTarget(steps, { key: "pressure.decay", max: 0.2, note: "DEMO manual p.20" }, TECH.name, AT);
  assert.equal(decayTest(j, next.find((s) => s.id === step.id)!)!.result, "pass", "on its own the change would pass it");
  const markers = decayRetestMarkers(j, next);
  assert.deepEqual(markers.map((m) => [m.stepId, m.evidenceId]), [[step.id, "p1-5"]]);
  const marked = withRetestMarkers(next, markers);
  const ms = marked.find((s) => s.id === step.id)!;
  const held = decayTest(j, ms)!;
  assert.deepEqual([held.result, held.retestNeeded], ["fail", true]);
  assert.match(held.fails[0]!, /more than the 0\.1 bar allowed \(the gauge's resolution\)/, "the reason it failed when it was taken");
  // The same fall on a retest now passes against the manual's 0.2 bar.
  const retest = { ...j, runsheet: marked, evidence: [...j.evidence, ...run(marked, slow, "p2")] };
  const t = decayTest(retest, ms)!;
  assert.deepEqual([t.result, t.failedRuns, t.pressure!.allowanceFrom], ["pass", 1, "tech-lead"]);
  // Nothing to mark when nothing has failed.
  assert.deepEqual(decayRetestMarkers(retest, marked), []);
});

test("vacuum decay: 350 micron rising to 420 in an hour passes; climbing to 1,900 fails until the whole test is retaken", () => {
  const steps = confirmAll(runsheetFromDesign(design(1, "single"), "v-std", CATALOGUE));
  const step = steps.find((s) => s.decay?.kind === "vacuum")!;
  const dry = job(steps, [...gaugePhotos(steps), ...run(steps, [["vacuum", 350], ["vacuum-hold-time", 60], ["vacuum-decay", 420]], "v1")]);
  const t = decayTest(dry, step)!;
  assert.deepEqual([t.result, t.vacuum!.riseMicron, t.vacuum!.riseMaxMicron, t.vacuum!.targetMicron], ["pass", 70, 200, 500]);
  const wet = job(steps, [...gaugePhotos(steps), ...run(steps, [["vacuum", 350], ["vacuum-hold-time", 60], ["vacuum-decay", 1900]], "v1")]);
  assert.equal(stepView(wet, step).state, "failed");
  assert.match(decayTest(wet, step)!.fails[0]!, /moisture or a leak/);
  const again = { ...wet, evidence: [...wet.evidence, ...run(steps, [["vacuum", 300], ["vacuum-hold-time", 60], ["vacuum-decay", 380]], "v2")] };
  assert.equal(stepView(again, step).state, "done");
  // An out-of-window decay reading is judged by the test, never an exception to accept.
  assert.deepEqual(openExceptions(wet), []);
});

test("decay: readings that can't be right wait to be taken again, without forcing a retest", () => {
  const steps = confirmAll(runsheetFromDesign(design(1, "single"), "v-std", CATALOGUE));
  const step = steps.find((s) => s.decay?.kind === "pressure")!;
  const typo: [string, number][] = PRESSURE_OK.map(([r, v]) => [r, r === "strength-end-temp" ? 150 : v]);
  let j = job(steps, run(steps, typo, "p1"));
  let t = decayTest(j, step)!;
  assert.equal(t.result, "incomplete");
  assert.match(t.invalid[0]!, /150 °C/);
  assert.equal(stepView(j, step).state, "in-progress");
  j = { ...j, evidence: [...j.evidence, ...run(steps, [["strength-end-temp", 15]], "p2")] };
  t = decayTest(j, step)!;
  assert.equal(t.result, "pass");
});

test("withDecayTests: a runsheet from before the decay tests gains their readings, keeps its ids and the tech lead's targets", () => {
  const fresh = runsheetFromDesign(design(1, "single"), "v-std", CATALOGUE);
  // The pilot-runsheet-1 shape: applied, held (on the test-pressure target), gauge photo; applied, decay, photo.
  const old: InstallStep[] = fresh.map((s) => {
    if (!s.decay) return s;
    const { decay: _decay, ...rest } = s;
    const keep = s.decay.kind === "pressure" ? ["strength-test", "strength-hold"] : ["vacuum", "vacuum-decay"];
    return {
      ...rest,
      evidence: s.evidence
        .filter((e) => !e.role || keep.includes(e.role))
        .map((e) => (e.role === "strength-hold" ? { ...e, targetKey: "pressure.test" as const } : e)),
    };
  });
  const set = setJobTarget(old, { key: "pressure.test", min: 30, max: 41.5, note: "DEMO manual" }, TECH.name, AT);
  const up = withDecayTests(set);
  const p = up.find((s) => s.title === "Strength and tightness test")!;
  assert.equal(p.decay?.kind, "pressure");
  assert.deepEqual(p.evidence.map((e) => e.id.split(".")[1]), ["applied", "start-temp", "held", "end-temp", "hold-time", "resolution", "gauge"]);
  const applied = p.evidence.find((e) => e.role === "strength-test")!;
  assert.deepEqual([applied.min, applied.max, applied.window?.basis, applied.window?.note], [30, 41.5, "tech-lead", "DEMO manual"]);
  const v = up.find((s) => s.title === "Vacuum and decay test")!;
  assert.deepEqual(v.evidence.map((e) => e.id.split(".")[1]), ["reached", "hold-time", "decay", "gauge"]);
  assert.equal(withDecayTests(up), up, "idempotent");
  const other = up.find((s) => s.title === "Release and leak check")!;
  assert.equal(other, set.find((s) => s.id === other.id), "other steps untouched");
});

test("carryTargets: a rebuilt runsheet keeps every target the tech lead set", () => {
  const before = setJobTarget(
    setJobTarget(runsheetFromDesign(design(1, "single"), "v-std", CATALOGUE), { key: "vacuum.rise", max: 150, note: "DEMO p.9" }, TECH.name, AT),
    { key: "pressure.test", min: 30, max: 41.5 },
    TECH.name,
    AT,
  );
  const after = carryTargets(before, runsheetFromDesign(design(1, "single"), "v-std", CATALOGUE));
  const rise = jobTargets(after).find((t) => t.key === "vacuum.rise")!;
  assert.deepEqual([rise.max, rise.basis, rise.setBy, rise.setAt, rise.note], [150, "tech-lead", TECH.name, AT, "DEMO p.9"]);
  assert.equal(jobTargets(after).find((t) => t.key === "pressure.test")!.min, 30);
  assert.equal(jobTargets(after).find((t) => t.key === "vacuum.hold")!.basis, "record", "unset stays unset");
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

test("customerWorkDone: the real work in the customer's words, by phase, nothing that matters left out", () => {
  const steps = runsheetFromDesign(design(3, "multi"), "v-std", CATALOGUE);
  const day1 = stepsForDay(steps, 1);
  const words = customerWorkDone(day1, steps);
  // No admin: arrival, protection, as-found photos, RAMS, the kit check.
  assert.doesNotMatch(words.join(" | "), /on site|protection|condition|RAMS|kit|serial|asbestos/i);
  assert.deepEqual(words, ["unit positions marked out", "holes drilled and sealed", "wall plates up", "the outdoor base in"]);
  assert.equal(`Today: ${listInWords(words)}.`, "Today: unit positions marked out, holes drilled and sealed, wall plates up and the outdoor base in.");
  // Only some rooms done: it says how many.
  const partial = day1.filter((s) => s.title !== "Core drilling" || s.roomId === "room-1");
  assert.ok(customerWorkDone(partial, steps).includes("the hole drilled and sealed in one of 3 rooms"));
  const two = day1.filter((s) => s.title !== "Core drilling" || s.roomId !== "room-3");
  assert.ok(customerWorkDone(two, steps).includes("holes drilled and sealed in 2 of 3 rooms"));
  // Day 2: pipework and its flares read as one line; one system's circuit is singular.
  const day2 = customerWorkDone(stepsForDay(steps, 2), steps);
  assert.deepEqual(day2, ["indoor units hung", "the outdoor unit in place", "pipework run, insulated and connected", "drains fitted and tested", "the new electrical circuit fitted and tested"]);
  // A one-room job says "the".
  const one = runsheetFromDesign(design(1, "single"), "v-std", CATALOGUE);
  assert.deepEqual(customerWorkDone(stepsForDay(one, 1), one).slice(0, 2), ["the unit position marked out", "the hole drilled and sealed"]);
  // Steps outside the template read as their own title; admin-looking ones stay out.
  const extra = [{ id: "x", phase: 6, title: "Trunking painted to match", evidence: [] }, { id: "y", phase: 1, title: "Protection down again", evidence: [] }] as InstallStep[];
  assert.deepEqual(customerWorkDone(extra, steps), ["trunking painted to match"]);
});

test("customerWorkNext: tomorrow in plain words", () => {
  const steps = runsheetFromDesign(design(2, "single"), "v-std", CATALOGUE);
  assert.deepEqual(customerWorkNext(stepsForDay(steps, 2)), ["the indoor and outdoor units", "the pipework", "the drains", "the electrics"]);
  assert.deepEqual(customerWorkNext(stepsForDay(steps, 3)), ["testing the system", "commissioning", "your handover"]);
  assert.equal(listInWords([]), "");
  assert.equal(listInWords(["a"]), "a");
  assert.equal(listInWords(["a", "b", "c"]), "a, b and c");
});

test("photoGroups: finished work first, then the latest work, grouped by step; as-found and check photos last", () => {
  const steps = runsheetFromDesign(design(2, "single"), "v-std", CATALOGUE);
  const ev = (specId: string, mediaId: string): EvidenceRecord => ({ specId, mediaId, at: AT, by: "DEMO", id: `e-${mediaId}` });
  const spec = (title: string, slot: RegExp, roomId?: string) => steps.find((s) => s.title === title && (!roomId || s.roomId === roomId))!.evidence.find((e) => slot.test(e.id))!.id;
  const job = {
    runsheet: steps,
    evidence: [
      ev(spec("Condition photos", /photo$/, "room-1"), "m-asfound"),
      ev(spec("Marking out", /scan$/, "room-1"), "m-scan"),
      ev(spec("Marking out", /marked$/, "room-1"), "m-marked"),
      ev(spec("Core drilling", /sleeve$/, "room-1"), "m-sleeve"),
      ev(spec("Core drilling", /seal$/, "room-1"), "m-seal"),
      ev(spec("Finished photos", /photo$/, "room-2"), "m-done"),
    ],
  };
  const ctx = photoContexts(job);
  assert.equal(ctx.get("m-asfound")?.use, "condition");
  assert.equal(ctx.get("m-scan")?.use, "check");
  assert.equal(ctx.get("m-marked")?.use, "work");
  assert.equal(ctx.get("m-done")?.finished, true);
  assert.equal(ctx.get("m-sleeve")?.label, "Hole drilled with a fall, sleeve fitted");
  const photos = ["m-asfound", "m-scan", "m-marked", "m-sleeve", "m-seal", "m-done", "m-loose"].map((id) => ({ id, caption: id === "m-loose" ? "Extra DEMO photo" : undefined }));
  const groups = photoGroups(photos, ctx);
  assert.deepEqual(
    groups.map((g) => [g.title, g.item ?? "", g.use, g.photos.map((p) => p.id).join(",")]),
    [
      ["Finished photos", "Living room", "work", "m-done"],
      ["Core drilling", "Main bedroom", "work", "m-sleeve,m-seal"],
      ["Marking out", "Main bedroom", "work", "m-marked"],
      ["Other photos from today", "", "work", "m-loose"],
      ["Condition photos", "Main bedroom", "condition", "m-asfound"],
      ["Marking out", "Main bedroom", "check", "m-scan"],
    ].map(([t, i, u, ids]) => [t, i, u, ids]),
  );
  assert.equal(groups[3]!.photos[0]!.label, "Extra DEMO photo");
});

/* ---------------- round 9: the runsheet's refrigeration and electrical checks ---------------- */

test("round 9: a flare whose pipe size isn't in the catalogue still has a target the tech lead must set before sign-off", () => {
  const cat = [...CATALOGUE, item({ id: "in-nosize", kind: "indoor", manufacturer: "Daikin", model: "DEMO-FTX50-NOSIZE", label: "DEMO unit with no pipe sizes", specs: {} })];
  const steps = runsheetFromDesign(design(1, "single", { indoor: "in-nosize" }), "v-std", cat);
  const flares = steps.find((s) => s.title === "Flares and torque")!.evidence;
  assert.ok(flares.every((e) => e.targetKey === "torque.unsized" && e.min === undefined && e.max === undefined));
  assert.ok(unconfirmedTargets(steps).includes("torque.unsized"), "the review's gap: it never reached the tech lead");
  const t = jobTargets(steps).find((x) => x.key === "torque.unsized")!;
  assert.equal(t.def.recordOnly, false, "a number from the manual, never record only");
});

test("round 9: the leak check names the method and records the detector and the pressure; a leak means pump down, re-make, retest", () => {
  const steps = runsheetFromDesign(design(1, "single"), "v-std", CATALOGUE);
  const release = steps.find((s) => s.title === "Release and leak check")!;
  assert.match(release.evidence.find((e) => e.label.startsWith("Every field joint"))!.label, /electronic R32 \(A2L\) detector, sensitive to 5 g a year/);
  assert.ok(release.evidence.some((e) => e.kind === "reference" && /Leak detector used/.test(e.label)));
  const p = release.evidence.find((e) => /Pressure at the joints/.test(e.label))!;
  assert.equal(p.unit, "bar g");
  assert.match(p.window?.note ?? "", /quarter of the outdoor unit's nameplate PS/);
  assert.match(release.guidance ?? "", /don't top up\. Pump the charge down/);
});

test("round 9: a run longer than one coil gets an F-gas brazed joint step with the hot-work checks, and the RAMS names the hot work", () => {
  const d = design(2, "single");
  d.variants[0]!.bom = [{ sku: "pipe-14-12-15m", label: "Pipe pair 1/4 + 1/2, 15 m coil", qty: 2, category: "materials", note: "Living room: 22 m run: longer than one coil, needs a brazed joint" }];
  const steps = runsheetFromDesign(d, "v-std", CATALOGUE);
  const joints = steps.filter((s) => s.title === "Brazed joint in the pipe run");
  assert.deepEqual(joints.map((s) => s.item), ["Living room"]);
  assert.equal(joints[0]!.requires, "fgas");
  assert.equal(joints[0]!.critical, true);
  assert.ok(["Hot work", "Oxygen-free nitrogen", "Permanent brazed joint", "Fire watch"].every((w) => joints[0]!.evidence.some((e) => e.label.startsWith(w))));
  assert.ok(joints[0]!.evidence.some((e) => e.kind === "photo"));
  assert.match(steps.find((s) => s.id === "d1-rams")!.guidance ?? "", /hot work: a brazed joint in the pipe run to Living room/);
  assert.equal(runsheetFromDesign(design(2, "single"), "v-std", CATALOGUE).some((s) => s.title === "Brazed joint in the pipe run"), false, "no joint, no step");
});

test("round 9: the circuit step asks the electrician to size it for the route and checks the interconnect; the EIC's scope is confirmed", () => {
  const steps = runsheetFromDesign(design(1, "single"), "v-std", CATALOGUE);
  const el = steps.find((s) => s.title === "Electrical circuit")!;
  assert.ok(!el.evidence.some((e) => /as designed/.test(e.label)), "the design's cable size is a starting point, not the spec");
  assert.match(el.guidance ?? "", /supply \(main fuse, existing load, earthing\) can take it/);
  assert.ok(el.evidence.some((e) => /RCD type the manual asks for/.test(e.label)));
  assert.ok(el.evidence.some((e) => e.kind === "check" && /^Interconnect between the units/.test(e.label)));
  assert.ok(el.evidence.some((e) => e.kind === "photo" && /Terminal blocks/.test(e.label)));
  assert.ok(steps.find((s) => s.id === "d3-eic")!.evidence.some((e) => /covers the new circuit, the isolator and the indoor-outdoor interconnects/.test(e.label)));
});

test("round 9: suspected asbestos at the survey: the day-1 check says what was found and records what cleared it", () => {
  const sus = runsheetFromDesign(design(1, "single"), "v-std", CATALOGUE, measured({ era: "pre-1930", asbestosRisk: "suspected", asbestosNote: "DEMO Artex ceiling on the pipe route" }));
  const asb = sus.find((s) => s.id === "d1-asbestos")!;
  assert.match(asb.guidance ?? "", /The survey found: asbestos suspected \(DEMO Artex ceiling on the pipe route\)/);
  assert.ok(asb.evidence.some((e) => e.kind === "reference" && /What cleared it/.test(e.label)));
  const older = runsheetFromDesign(design(1, "single"), "v-std", CATALOGUE, measured({ era: "1930-1950" }));
  assert.equal(older.find((s) => s.id === "d1-asbestos")!.evidence.length, 1, "nothing suspected: the plain check");
});

test("round 9: no charge rate in the catalogue reads as unknown, never 'design: 0 g'", () => {
  const cat = CATALOGUE.map((c) => (c.id === "out-1" ? { ...c, specs: {} } : c));
  const steps = runsheetFromDesign(design(1, "single"), "v-std", cat);
  const added = steps.find((s) => s.title === "F-gas label and charge record")!.evidence.find((e) => e.role === "additional-charge")!;
  assert.match(added.label, /no charge rate in the catalogue: work it out from the manual/);
  assert.doesNotMatch(added.label, /design: 0 g/);
});
