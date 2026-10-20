import type { CatalogueItem } from "./catalogue.ts";
import { A2L_ROOM_CHECK_ABOVE_KG, a2lMaxChargeKg, releaseHeightOf, type DesignRecord, type DesignVariant, type SystemSelection } from "./design-record.ts";
import {
  VACUUM_STANDARD_MICRON,
  judgePressureDecay,
  judgeVacuumDecay,
  type DecayJudgement,
  type PressureDecayFigures,
  type PressureDecayReadings,
  type PressureDecayTargets,
  type VacuumDecayFigures,
  type VacuumDecayReadings,
  type VacuumDecayTargets,
} from "./decay.ts";
import { R32_GWP, fgasRecord, type FgasRecord, type InstalledEquipmentRow } from "./documents.ts";
import type { PhotoTag } from "./media.ts";
import { can, meetsRequirement, qualificationStatus, type StaffMember, type StepRequirement } from "./staff.ts";
import { ACCESS_PHRASE, HEIGHT_ACCESS, SURVEY_LABELS, TWO_PERSON_LIFT_KG, crossesCompartment, higherRiskBuilding, isFlat, type AccessEquipmentKind, type MeasuredSurvey } from "./survey-visit.ts";

/**
 * The Installation Operating System.
 *
 * Airline-checklist thinking, built around required evidence rather than
 * ticks. Nobody remembers anything; every step demands proof (a photo, a
 * reading, a scan, a signature) before the job can move on, and the
 * software decides completeness automatically. Humans review exceptions,
 * not every job.
 *
 * Pure domain rules, same contract as everything else here: the runsheet
 * is generated deterministically from the job, evidence is an append-only
 * log, and scoring is a pure function of (runsheet, evidence).
 */

/* ------------------------------------------------------------------ */
/* Evidence model                                                      */
/* ------------------------------------------------------------------ */

export type EvidenceKind =
  | "photo"
  | "video"
  | "measurement"
  | "qr-scan"
  | "barcode-scan"
  | "torque"
  | "vacuum-reading"
  | "pressure-reading"
  | "gps"
  | "signature"
  // Pilot runsheet kinds: a confirmed tick, and a typed reference (a certificate number).
  | "check"
  | "reference";

export const EVIDENCE_KIND_LABEL: Record<EvidenceKind, string> = {
  photo: "Photo",
  video: "Video",
  measurement: "Measurement",
  "qr-scan": "QR scan",
  "barcode-scan": "Barcode scan",
  torque: "Torque reading",
  "vacuum-reading": "Vacuum reading",
  "pressure-reading": "Pressure reading",
  gps: "GPS fix",
  signature: "Signature",
  check: "Confirmation",
  reference: "Reference",
};

/** Kinds whose submitted value is a number checked against min/max. */
export const NUMERIC_KINDS: ReadonlySet<EvidenceKind> = new Set([
  "measurement",
  "torque",
  "vacuum-reading",
  "pressure-reading",
]);

export interface EvidenceSpec {
  /** Unique within the runsheet; evidence records key on it. */
  id: string;
  kind: EvidenceKind;
  label: string;
  /** For numeric kinds: unit plus the auto-validation window. */
  unit?: string;
  min?: number;
  max?: number;
  // Pilot runsheet (v2) fields; the demo runsheet leaves them unset.
  /** Doesn't hold up completion: an optional QA reading. */
  optional?: boolean;
  /** Media tag for photo, video and signature slots. */
  tag?: PhotoTag;
  /** What the slot proves, so commissioning and the handover pack find it without reading labels. */
  role?: EvidenceRole;
  /** The per-job target this reading is checked against (shared across systems and rooms). */
  targetKey?: TargetKey;
  /** Where the window (min/max) came from, and whether anyone has confirmed it. */
  window?: WindowSource;
}

export interface InstallStep {
  id: string;
  phase: number;
  title: string;
  /** What this step instance covers: a room, a system, a penetration. */
  item?: string;
  evidence: EvidenceSpec[];
  // Pilot runsheet (v2) fields; the demo runsheet leaves them unset.
  /** Which day of the three-day install the step belongs to. */
  day?: 1 | 2 | 3;
  /** Only someone meeting this may record it (refrigerant, electrics, sign-off). */
  requires?: StepRequirement;
  /** A failure here stops the job until the technical lead reviews it. */
  critical?: boolean;
  /** N/A is allowed, with a reason. */
  allowNa?: boolean;
  guidance?: string;
  /** "handover": done with the customer at handover, so it doesn't hold up install complete. */
  stage?: "install" | "handover";
  /** The design room or system this step instance is for. */
  roomId?: string;
  systemId?: string;
  /** Kit check steps: the unit whose serial this step captures (an outdoor unit's weight from the catalogue, for the two-person lift). */
  equipment?: { kind: "indoor" | "outdoor"; room: string; label: string; model: string; weightKg?: number };
  /**
   * The strength/tightness test or the vacuum decay test: the step's
   * readings are judged together (decay.ts), never one by one, and a failed
   * test only clears with a retest (every reading taken again).
   */
  decay?: DecayStep;
  /**
   * The charge step: the weighed added charge is checked against what the
   * as-built length the engineer types needs (max(0, length − pre-charged
   * length) × g/m, from the catalogue). Outside the job's tolerance the
   * weighed figure is an exception the tech lead signs off with a reason.
   */
  charge?: ChargeStep;
}

/** The catalogue figures the charge step works the expected charge out from, and the job's tolerance on it. */
export interface ChargeStep {
  prechargedM: number;
  gPerM: number;
  /** The job's tolerance (± g): blank is the company default (10 % of the expected charge or 50 g, whichever is larger). A per-job target. */
  limit: DecayLimit;
}

/** A step-level decay test: its kind, the job's limit on the fall (or rise), and any retest the tech lead's target change left owing. */
export interface DecayStep {
  kind: "pressure" | "vacuum";
  /** Pressure: the allowed fall (bar, blank = the gauge's resolution). Vacuum: the rise limit (micron). A per-job target. */
  limit: DecayLimit;
  /**
   * Set when a target change would have passed a test that had failed: the
   * readings up to this evidence record stay failed, so only a retest clears it.
   */
  retestAfter?: { evidenceId: string; reasons: string[] };
}

export interface DecayLimit {
  targetKey: TargetKey;
  unit: string;
  min?: number;
  max?: number;
  window?: WindowSource;
}

export interface InstallPhaseDef {
  n: number;
  title: string;
  strap: string;
}

export const INSTALL_PHASES: InstallPhaseDef[] = [
  { n: 1, title: "Arrival", strap: "Protect the home, meet the customer, photograph everything as found." },
  { n: 2, title: "Marking out", strap: "Every unit position proven before a single hole." },
  { n: 3, title: "Core drilling", strap: "Every penetration sleeved, fire-stopped and sealed." },
  { n: 4, title: "Indoor units", strap: "Level, torqued, clearances kept, drains connected." },
  { n: 5, title: "Outdoor unit", strap: "Level, isolated from the wall, kind to the neighbours." },
  { n: 6, title: "Pipework", strap: "Clipped, insulated, protected, labelled. Every run." },
  { n: 7, title: "Electrical", strap: "Right cable, right breaker, torqued and tested." },
  { n: 8, title: "Pressure test", strap: "Nitrogen holds or nothing moves forward." },
  { n: 9, title: "Vacuum", strap: "Deep vacuum, held. Moisture is the enemy." },
  { n: 10, title: "Commissioning", strap: "Running, measured, quiet, online." },
  { n: 11, title: "Handover", strap: "Customer knows everything. Signed, registered, photographed." },
];

/* ------------------------------------------------------------------ */
/* Runsheet generation                                                 */
/* ------------------------------------------------------------------ */

export interface RunsheetInput {
  /** Room names, one indoor unit each. */
  rooms: string[];
  /** Outdoor units on the job. */
  outdoorUnits: number;
  /** Gas-line flare torque window, N·m (from the design, per room). */
  torqueNm?: { min: number; max: number };
}

/** Test targets every job must hit. Tightened as the fleet teaches us. */
export const INSTALL_TARGETS = {
  pressureTestBar: 38,
  pressureHoldMinutes: 15,
  vacuumMicrons: 500,
  vacuumHoldRiseMicrons: 300,
  tempSplitMinC: 8,
  clipSpacingMaxMm: 1000,
  drainFallMinMmPerM: 20,
  coreDrillMaxMm: 80,
} as const;

/**
 * Expand the 11-phase template into a concrete runsheet for one job:
 * per-room steps repeat per room, per-system steps per outdoor unit.
 */
export function buildRunsheet(input: RunsheetInput): InstallStep[] {
  const torque = input.torqueNm ?? { min: 33, max: 42 };
  const steps: InstallStep[] = [];
  let n = 0;
  const step = (phase: number, title: string, item: string | undefined, evidence: Omit<EvidenceSpec, "id">[]) => {
    n += 1;
    const id = `s${String(n).padStart(2, "0")}`;
    steps.push({
      id,
      phase,
      title,
      item,
      evidence: evidence.map((e, i) => ({ ...e, id: `${id}-e${i + 1}` })),
    });
  };
  const rooms = input.rooms;
  const systems = Array.from({ length: input.outdoorUnits }, (_, i) =>
    input.outdoorUnits > 1 ? `System ${i + 1}` : "System",
  );

  // Phase 1: Arrival.
  step(1, "On site & ready", undefined, [
    { kind: "gps", label: "Arrival GPS fix at the property" },
    { kind: "photo", label: "PPE on (selfie counts)" },
    { kind: "photo", label: "Customer greeted, job confirmed against the floor plan" },
  ]);
  step(1, "Protection down", undefined, [
    { kind: "photo", label: "Flooring and stairs protected" },
    { kind: "photo", label: "Furniture covered in work areas" },
  ]);
  for (const room of rooms) {
    step(1, "Condition photos", room, [
      { kind: "photo", label: `${room} as found, all four walls` },
    ]);
  }

  // Phase 2: Marking out, per indoor unit.
  for (const room of rooms) {
    step(2, "Position proven", room, [
      { kind: "measurement", label: "Clearance below ceiling", unit: "mm", min: 150 },
      { kind: "measurement", label: "Drain fall on the marked route", unit: "mm/m", min: INSTALL_TARGETS.drainFallMinMmPerM },
      { kind: "photo", label: "Stud / hidden services scan across the fixing zone" },
      { kind: "photo", label: "Marked position with pipe exit and cable route" },
    ]);
  }
  step(2, "Outdoor position confirmed", undefined, [
    { kind: "photo", label: "Outdoor location agreed with the customer" },
  ]);

  // Phase 3: Core drilling, one penetration per room.
  for (const room of rooms) {
    step(3, "Penetration", room, [
      { kind: "measurement", label: "Core diameter", unit: "mm", min: 50, max: INSTALL_TARGETS.coreDrillMaxMm },
      { kind: "measurement", label: "Fall through the wall", unit: "deg", min: 3, max: 10 },
      { kind: "photo", label: "Sleeve fitted and fire-stopped" },
      { kind: "photo", label: "External seal finished" },
    ]);
  }

  // Phase 4: Indoor units.
  for (const room of rooms) {
    step(4, "Indoor unit hung", room, [
      { kind: "photo", label: "Bracket on the bubble, fixings in" },
      { kind: "torque", label: "Gas flare torque", unit: "N·m", min: torque.min, max: torque.max },
      { kind: "photo", label: "Clearances kept, pipes dressed, drain connected" },
    ]);
  }

  // Phase 5: Outdoor unit(s).
  for (const sys of systems) {
    step(5, "Outdoor unit set", sys, [
      { kind: "photo", label: "Level on anti-vibration mounts" },
      { kind: "measurement", label: "Rear service clearance", unit: "mm", min: 150 },
      { kind: "measurement", label: "Distance to nearest neighbouring window", unit: "m", min: 1 },
      { kind: "photo", label: "Condensate managed and weatherproofing done" },
    ]);
  }

  // Phase 6: Pipework, per run.
  for (const room of rooms) {
    step(6, "Pipe run", room, [
      { kind: "measurement", label: "Widest clip spacing found", unit: "mm", max: INSTALL_TARGETS.clipSpacingMaxMm },
      { kind: "photo", label: "Bends swept, insulation continuous, sleeves used" },
      { kind: "photo", label: "UV protection outside, run labelled at both ends" },
    ]);
  }

  // Phase 7: Electrical, per system.
  for (const sys of systems) {
    step(7, "Circuit built", sys, [
      { kind: "photo", label: "Supply isolated and locked off" },
      { kind: "barcode-scan", label: "Cable drum scanned (size verified)" },
      { kind: "barcode-scan", label: "RCBO scanned (rating verified)" },
      { kind: "torque", label: "Terminal torque", unit: "N·m", min: 1.2, max: 2.8 },
      { kind: "measurement", label: "Earth continuity", unit: "Ω", max: 1 },
      { kind: "photo", label: "Rotary isolator fitted by the outdoor unit" },
    ]);
  }

  // Phase 8: Pressure test, per system.
  for (const sys of systems) {
    step(8, "Nitrogen pressure test", sys, [
      { kind: "pressure-reading", label: "Test pressure applied", unit: "bar", min: INSTALL_TARGETS.pressureTestBar },
      { kind: "pressure-reading", label: `Pressure after ${INSTALL_TARGETS.pressureHoldMinutes} min hold`, unit: "bar", min: INSTALL_TARGETS.pressureTestBar },
      { kind: "photo", label: "Gauge photographed on the manifold" },
    ]);
  }

  // Phase 9: Vacuum, per system.
  for (const sys of systems) {
    step(9, "Deep vacuum", sys, [
      { kind: "vacuum-reading", label: "Vacuum achieved", unit: "microns", max: INSTALL_TARGETS.vacuumMicrons },
      { kind: "vacuum-reading", label: "After 15 min decay hold", unit: "microns", max: INSTALL_TARGETS.vacuumMicrons + INSTALL_TARGETS.vacuumHoldRiseMicrons },
    ]);
  }

  // Phase 10: Commissioning.
  for (const sys of systems) {
    step(10, "System live", sys, [
      { kind: "photo", label: "Refrigerant released, valves capped and torqued" },
      { kind: "measurement", label: "Noise at the boundary, unit running", unit: "dB(A)", max: 42 },
    ]);
  }
  for (const room of rooms) {
    step(10, "Room commissioned", room, [
      { kind: "qr-scan", label: "Indoor unit serial scanned and registered" },
      { kind: "measurement", label: "Temperature split, cooling", unit: "°C", min: INSTALL_TARGETS.tempSplitMinC, max: 16 },
      { kind: "video", label: "Drain test: water in, water out" },
      { kind: "photo", label: "Heating checked, fan speeds cycled, WiFi paired to the app" },
    ]);
  }

  // Phase 11: Handover.
  step(11, "Customer walkthrough", undefined, [
    { kind: "video", label: "Controller and app explained to the customer" },
    { kind: "photo", label: "Filter access shown, maintenance explained" },
  ]);
  step(11, "Paperwork", undefined, [
    { kind: "barcode-scan", label: "Outdoor serial scanned for warranty registration" },
    { kind: "signature", label: "Customer signature" },
  ]);
  for (const room of rooms) {
    step(11, "Finished photos", room, [
      { kind: "photo", label: `${room} finished, unit in place, area clean` },
    ]);
  }

  return steps;
}

/* ------------------------------------------------------------------ */
/* Evidence log + validation                                           */
/* ------------------------------------------------------------------ */

export interface EvidenceRecord {
  specId: string;
  /** Numeric kinds carry the reading; others a reference (file id, scan). */
  value?: number;
  ref?: string;
  note?: string;
  at: string; // ISO timestamp, stamped on capture
  gps?: { lat: number; lng: number };
  by: string;
  /** Client-generated, so an offline retry is idempotent. */
  id?: string;
  byStaffId?: string;
  /** The photo, video or signature in the media library. */
  mediaId?: string;
}

export type QaStatus = "in-progress" | "auto-approved" | "exceptions" | "signed-off";

export interface InstallJob {
  id: string;
  projectId?: string;
  customer: string;
  postcode: string;
  engineer: string;
  scheduledOn: string; // ISO date
  runsheet: InstallStep[];
  evidence: EvidenceRecord[];
  qa: { status: QaStatus; reviewedBy?: string; note?: string };
}

export type SlotStatus = "missing" | "pass" | "exception";

/** Latest record wins: re-captures supersede, the log keeps history. */
export function latestEvidence(job: Pick<InstallJob, "evidence">, specId: string): EvidenceRecord | undefined {
  for (let i = job.evidence.length - 1; i >= 0; i--) {
    if (job.evidence[i]!.specId === specId) return job.evidence[i];
  }
  return undefined;
}

export function slotStatus(spec: EvidenceSpec, record?: EvidenceRecord): SlotStatus {
  if (!record) return "missing";
  if (NUMERIC_KINDS.has(spec.kind)) {
    if (record.value === undefined) return "exception";
    if (spec.min !== undefined && record.value < spec.min) return "exception";
    if (spec.max !== undefined && record.value > spec.max) return "exception";
  }
  return "pass";
}

/** Append one piece of evidence. Pure: returns a new job, log untouched. */
export function submitEvidence(
  job: InstallJob,
  specId: string,
  payload: { value?: number; ref?: string; note?: string; gps?: { lat: number; lng: number } },
  now: string,
): InstallJob {
  const spec = job.runsheet.flatMap((s) => s.evidence).find((e) => e.id === specId);
  if (!spec) return job;
  const next: InstallJob = JSON.parse(JSON.stringify(job));
  next.evidence.push({ specId, at: now, by: job.engineer, ...payload });
  next.qa = { ...next.qa, status: scoreInstallation(next).qaStatus };
  return next;
}

/* ------------------------------------------------------------------ */
/* QC scoring                                                          */
/* ------------------------------------------------------------------ */

export interface InstallException {
  specId: string;
  step: string;
  item?: string;
  label: string;
  reason: string;
}

export interface QcScorecard {
  completenessPct: number;
  slots: { captured: number; required: number };
  photos: { captured: number; required: number };
  readings: { captured: number; required: number };
  gates: {
    pressureTest: boolean;
    vacuum: boolean;
    commissioning: boolean;
    walkthrough: boolean;
    warranty: boolean;
  };
  exceptions: InstallException[];
  /** What the dashboard shows next to QA. */
  qaStatus: QaStatus;
}

function phaseClear(job: InstallJob, phase: number): boolean {
  return job.runsheet
    .filter((s) => s.phase === phase)
    .every((s) => s.evidence.every((e) => slotStatus(e, latestEvidence(job, e.id)) === "pass"));
}

/**
 * The whole point: the software decides whether the installation is
 * complete. All slots pass = auto-approved. Anything out of range =
 * exceptions, and only those exceptions reach a human.
 */
export function scoreInstallation(job: InstallJob): QcScorecard {
  const allSpecs = job.runsheet.flatMap((step) =>
    step.evidence.map((spec) => ({ step, spec })),
  );
  let captured = 0;
  let passed = 0;
  const photos = { captured: 0, required: 0 };
  const readings = { captured: 0, required: 0 };
  const exceptions: InstallException[] = [];

  for (const { step, spec } of allSpecs) {
    const record = latestEvidence(job, spec.id);
    const status = slotStatus(spec, record);
    if (record) captured++;
    if (status === "pass") passed++;
    const isPhoto = spec.kind === "photo" || spec.kind === "video";
    if (isPhoto) {
      photos.required++;
      if (record) photos.captured++;
    }
    if (NUMERIC_KINDS.has(spec.kind)) {
      readings.required++;
      if (record) readings.captured++;
    }
    if (status === "exception") {
      const window =
        spec.min !== undefined && spec.max !== undefined
          ? `${spec.min} to ${spec.max} ${spec.unit ?? ""}`
          : spec.min !== undefined
            ? `at least ${spec.min} ${spec.unit ?? ""}`
            : `at most ${spec.max} ${spec.unit ?? ""}`;
      exceptions.push({
        specId: spec.id,
        step: step.title,
        item: step.item,
        label: spec.label,
        reason: `Reading ${record?.value ?? "missing"} ${spec.unit ?? ""} outside the accepted window (${window.trim()}).`,
      });
    }
  }

  const required = allSpecs.length;
  const warrantySpec = allSpecs.find(({ spec }) => spec.label.includes("warranty"))?.spec;
  const gates = {
    pressureTest: phaseClear(job, 8),
    vacuum: phaseClear(job, 9),
    commissioning: phaseClear(job, 10),
    walkthrough: phaseClear(job, 11),
    warranty: warrantySpec
      ? slotStatus(warrantySpec, latestEvidence(job, warrantySpec.id)) === "pass"
      : false,
  };

  const qaStatus: QaStatus =
    exceptions.length > 0
      ? "exceptions"
      : passed === required
        ? job.qa.status === "signed-off"
          ? "signed-off"
          : "auto-approved"
        : "in-progress";

  return {
    completenessPct: required ? Math.round((passed / required) * 100) : 0,
    slots: { captured, required },
    photos,
    readings,
    gates,
    exceptions,
    qaStatus,
  };
}

/* ------------------------------------------------------------------ */
/* Demo seeding                                                        */
/* ------------------------------------------------------------------ */

/**
 * Deterministic plausible value for a spec: mid-window for numeric kinds.
 * The demo runsheet uses this so "capture" always lands believable data.
 */
export function plausibleValue(spec: EvidenceSpec): number | undefined {
  if (!NUMERIC_KINDS.has(spec.kind)) return undefined;
  if (spec.min !== undefined && spec.max !== undefined) {
    return Math.round(((spec.min + spec.max) / 2) * 10) / 10;
  }
  if (spec.min !== undefined) return Math.round(spec.min * 1.15 * 10) / 10;
  if (spec.max !== undefined) return Math.round(spec.max * 0.6 * 10) / 10;
  return undefined;
}

export interface DemoInstallSpec {
  id: string;
  customer: string;
  postcode: string;
  engineer: string;
  rooms: string[];
  outdoorUnits: number;
  /** How far through: complete steps up to this fraction of the runsheet. */
  progress: number;
  /** Which numeric readings (0-based, in runsheet order) land out of range. */
  breakNth?: number[];
  daysFromToday: number;
}

export function buildDemoInstallJob(spec: DemoInstallSpec, todayIso: string): InstallJob {
  const runsheet = buildRunsheet({ rooms: spec.rooms, outdoorUnits: spec.outdoorUnits });
  const day = todayIso.slice(0, 10);
  const scheduled = new Date(`${day}T09:00:00Z`);
  scheduled.setUTCDate(scheduled.getUTCDate() + spec.daysFromToday);
  // Installs happen on working days; roll future demo dates off weekends.
  while (spec.daysFromToday > 0 && [0, 6].includes(scheduled.getUTCDay())) {
    scheduled.setUTCDate(scheduled.getUTCDate() + 1);
  }

  let job: InstallJob = {
    id: spec.id,
    customer: spec.customer,
    postcode: spec.postcode,
    engineer: spec.engineer,
    scheduledOn: scheduled.toISOString().slice(0, 10),
    runsheet,
    evidence: [],
    qa: { status: "in-progress" },
  };

  const allSpecs = runsheet.flatMap((s) => s.evidence);
  const fillCount = Math.round(allSpecs.length * spec.progress);
  const broken = new Set(spec.breakNth ?? []);
  let minute = 0;
  let numericSeen = -1;
  for (let i = 0; i < fillCount; i++) {
    const e = allSpecs[i]!;
    if (NUMERIC_KINDS.has(e.kind)) numericSeen += 1;
    minute += 4;
    const at = new Date(scheduled.getTime() + minute * 60_000).toISOString();
    let value = plausibleValue(e);
    if (value !== undefined && broken.has(numericSeen)) {
      value = e.max !== undefined ? e.max * 1.6 : (e.min ?? 1) * 0.5;
      value = Math.round(value * 10) / 10;
    }
    job = submitEvidence(
      job,
      e.id,
      NUMERIC_KINDS.has(e.kind)
        ? { value }
        : { ref: `${e.kind}-${e.id}`, gps: e.kind === "gps" ? { lat: 51.43, lng: -0.13 } : undefined },
      at,
    );
  }
  return job;
}

/** The demo fleet: one finished clean, one finished with an exception, one live, one not started. */
export function demoInstallJobs(todayIso: string): InstallJob[] {
  return [
    buildDemoInstallJob(
      { id: "inst-demo-1", customer: "Alex Morgan", postcode: "SW16 2BE", engineer: "James Whitfield", rooms: ["Main bedroom", "Living room", "Home office"], outdoorUnits: 1, progress: 1, daysFromToday: -2 },
      todayIso,
    ),
    buildDemoInstallJob(
      { id: "inst-demo-2", customer: "Priya Shah", postcode: "SW17 2FJ", engineer: "James Whitfield", rooms: ["Main bedroom", "Kids' room", "Living room", "Loft office"], outdoorUnits: 1, progress: 1, breakNth: [24], daysFromToday: -1 },
      todayIso,
    ),
    buildDemoInstallJob(
      { id: "inst-demo-3", customer: "Marcus Webb", postcode: "SW17 2AB", engineer: "Dana Okafor", rooms: ["Bedroom", "Living room"], outdoorUnits: 1, progress: 0.55, daysFromToday: 0 },
      todayIso,
    ),
    buildDemoInstallJob(
      { id: "inst-demo-4", customer: "Leila Ahmed", postcode: "SW16 1AB", engineer: "Dana Okafor", rooms: ["Bedroom"], outdoorUnits: 1, progress: 0, daysFromToday: 2 },
      todayIso,
    ),
  ];
}


/* ------------------------------------------------------------------ */
/* Pilot runsheet (v2): outcomes, reviews, commissioning (F6)          */
/* ------------------------------------------------------------------ */

/**
 * The pilot install builds on everything above: runsheets come from the
 * approved design and map onto three days, steps record an outcome (with a
 * reason for anything but a pass), gated steps check the recorder's
 * qualifications, and exceptions wait for the technical lead.
 *
 * Honest numbers (docs/research/commissioning-standards.md, findings 11-12):
 * almost every manufacturer test value (nitrogen test pressure, vacuum
 * target, decay limit) is unverified, so those readings start with no
 * pass/fail window: "record the reading; the tech lead confirms it against
 * the manufacturer's manual". The tech lead sets the per-job targets on the
 * commissioning screen (stored on the specs in install_jobs.runsheet), and
 * commissioning can't be signed until every target on the job is
 * confirmed. Flare torque defaults to the researched manufacturer tables,
 * marked as candidates. Noise is the design's MCS 020(a) calculation, not a
 * boundary measurement; earth continuity is the electrician's EIC, not a
 * flat 1 Ω.
 */

export type StepOutcome = "pass" | "fail" | "blocked" | "na";

export interface StepStatusRecord {
  stepId: string;
  outcome: StepOutcome;
  reason?: string;
  at: string;
  by: string;
  byStaffId?: string;
  issueId?: string;
  /** Client-generated, so an offline retry is idempotent. */
  id?: string;
}

export interface ExceptionReview {
  specId: string;
  resolution: "accepted" | "recapture-required";
  reason: string;
  by: string;
  at: string;
  /** The evidence record this review was about; a newer capture isn't covered by it. */
  evidenceId?: string;
  byStaffId?: string;
}

export interface CommissioningResult {
  system: string;
  strengthTestBar?: number;
  holdBar?: number;
  vacuumMicrons?: number;
  decayMicrons?: number;
  /** The strength/tightness test as measured: readings, the temperature correction, the allowance and the result. */
  pressureTest?: DecayRecord<PressureDecayFigures>;
  /** The evacuation and decay test as measured: readings, the target, the rise and its limit, and the result. */
  vacuumTest?: DecayRecord<VacuumDecayFigures>;
  additionalChargeG?: number;
  /** What the as-built length needed (max(0, length − pre-charged) × g/m) and the tolerance it was judged with. */
  expectedChargeG?: number;
  chargeToleranceG?: number;
  coolingSplitC: Record<string, number>;
  heatingSplitC: Record<string, number>;
  noiseDb?: number;
  serials: { item: string; serial: string }[];
}

/** A decay test as it stood: the figures exactly as measured and worked out, the result, and how many runs failed before it. */
export interface DecayRecord<F> {
  result: "pass" | "fail" | "incomplete";
  figures: F;
  fails: string[];
  failedRuns: number;
}

export interface CommissioningRecord {
  signedBy: { staffId: string; name: string; qualificationRef: string };
  at: string;
  results: CommissioningResult[];
  notes?: string;
  /** A job with a subcontractor: the technical lead's line for the health and safety file (the pack's). */
  hsFileNote?: string;
}

export interface InstallJobV2 extends InstallJob {
  projectId: string;
  designId?: string;
  templateVersion: string;
  stepStatuses: StepStatusRecord[];
  exceptionReviews: ExceptionReview[];
  commissioning?: CommissioningRecord;
}

/** Bumped when the template changes; a job keeps the version it was built with. */
export const INSTALL_TEMPLATE_VERSION: string = "pilot-runsheet-5";

/** R32 GWP for the F-gas label (tCO2e = kg × 675 / 1000). */
export const RUNSHEET_GWP = R32_GWP;

/* ---------------- slot semantics ---------------- */

export type EvidenceRole =
  | "arrival-gps"
  | "condition-photo"
  | "rams"
  | "serial-indoor"
  | "serial-outdoor"
  | "flare-liquid"
  | "flare-gas"
  | "condensate-fall"
  | "strength-test"
  | "strength-start-temp"
  | "strength-hold"
  | "strength-end-temp"
  | "strength-hold-time"
  | "gauge-resolution"
  | "vacuum"
  | "vacuum-hold-time"
  | "vacuum-decay"
  | "as-built-length"
  | "as-built-run"
  | "additional-charge"
  | "factory-charge"
  | "fgas-label"
  | "cooling-split"
  | "heating-split"
  | "defrost"
  | "noise-calc"
  | "noise-measured"
  | "eic-ref"
  | "scheme-ref"
  | "walkthrough"
  | "finished-photo";

/**
 * Where a reading's window comes from.
 *  * record: no pass/fail; the reading is recorded and judged by a person.
 *  * candidate: an unverified research figure (e.g. a recalled torque
 *    table), checked against but needing the tech lead's confirmation.
 *  * tech-lead: set (or confirmed as record-only) on this job by the tech lead.
 *  * catalogue: the outdoor unit's limits on record in the catalogue (the
 *    manual's minimum and maximum runs): outside them is an exception.
 */
export interface WindowSource {
  basis: "record" | "candidate" | "tech-lead" | "catalogue";
  note?: string;
  setBy?: string;
  setAt?: string;
}

/* ---------------- per-job targets ---------------- */

export type TargetKey =
  | "pressure.test"
  | "pressure.hold"
  | "pressure.decay"
  | "vacuum.target"
  | "vacuum.hold"
  | "vacuum.decay"
  | "vacuum.rise"
  | "torque.6.35"
  | "torque.9.52"
  | "torque.12.7"
  | "torque.15.88"
  | "torque.unsized"
  | "condensate.fall"
  | "charge.tolerance";

export interface TargetDef {
  key: TargetKey;
  label: string;
  unit: string;
  /** Which bounds make sense: a floor, a ceiling, or both. */
  bounds: "min" | "max" | "min-max";
  /** What the research found (or didn't), shown next to the inputs. Never applied silently. */
  hint: string;
  /**
   * Confirming it with no number: the button's words ("Record only", or the
   * default that then applies). False: a number is needed, from the manual.
   */
  recordOnly?: string | false;
  /**
   * A company default applies until the tech lead sets a figure, so the
   * target needn't be confirmed before commissioning is signed (the words
   * say what applies meanwhile).
   */
  defaultApplies?: string;
}

export const JOB_TARGETS: Record<TargetKey, TargetDef> = {
  "pressure.test": {
    key: "pressure.test",
    label: "Nitrogen test pressure",
    unit: "bar g",
    bounds: "min-max",
    hint: "From this model's installation manual: the minimum is the manual's test pressure, the maximum the outdoor unit's nameplate PS (never test above it). Research candidate (Daikin R32 split guides, read through search extracts, unverified): at least 2 bar, 30 bar recommended to find small leaks.",
    recordOnly: false,
  },
  "pressure.hold": {
    key: "pressure.hold",
    label: "Pressure test: hold time",
    unit: "min",
    bounds: "min",
    hint: "How long the manual says to hold the test pressure. No manufacturer figure was found in the research: set it from this model's manual.",
    recordOnly: false,
  },
  "pressure.decay": {
    key: "pressure.decay",
    label: "Pressure test: allowed fall",
    unit: "bar",
    bounds: "max",
    hint: "The most the pressure may fall over the hold once the end reading is corrected to the start temperature. Left at the default, it's no fall beyond the gauge's resolution (the smallest step it reads), which the engineer records. Set a figure only from the manual.",
    recordOnly: "Use the gauge's resolution",
  },
  "vacuum.target": {
    key: "vacuum.target",
    label: "Vacuum target",
    unit: "micron",
    bounds: "max",
    hint: "500 micron (66.7 Pa) is the company standard and always applies; a manual's stricter figure replaces it. Daikin R32 split guides (search extracts, unverified) say −0.1 MPa on the manifold, which is about 9,900 micron absolute: a compound gauge can't prove a deep vacuum, so use the digital micron gauge.",
    recordOnly: "Use 500 micron",
  },
  "vacuum.hold": {
    key: "vacuum.hold",
    label: "Vacuum decay: hold time",
    unit: "min",
    bounds: "min",
    hint: "How long to hold with the pump isolated. Daikin R32 split guides (search extracts, unverified): at least 1 hour with the pump off. Set it from this model's manual.",
    recordOnly: false,
  },
  "vacuum.decay": {
    key: "vacuum.decay",
    label: "Decay test: highest reading after the hold",
    unit: "micron",
    bounds: "max",
    hint: "Where the manual gives the highest reading allowed after the hold, set it here; otherwise record only (the rise limit below still judges the test).",
  },
  "vacuum.rise": {
    key: "vacuum.rise",
    label: "Vacuum decay: rise limit",
    unit: "micron",
    bounds: "max",
    hint: "The most the reading may rise over the hold: more is moisture or a leak. No manufacturer figure was found in the research (Daikin's guides say only that it must hold): set it from this model's manual.",
    recordOnly: false,
  },
  "torque.6.35": {
    key: "torque.6.35",
    label: "Flare torque, 6.35 mm (1/4\")",
    unit: "N·m",
    bounds: "min-max",
    hint: "Recalled tables (unverified): Daikin 15-17, Mitsubishi 13.7-17.7, Panasonic 18.",
  },
  "torque.9.52": {
    key: "torque.9.52",
    label: "Flare torque, 9.52 mm (3/8\")",
    unit: "N·m",
    bounds: "min-max",
    hint: "Recalled tables (unverified): Daikin 33-39, Mitsubishi 34.3-41.2, Panasonic 42.",
  },
  "torque.12.7": {
    key: "torque.12.7",
    label: "Flare torque, 12.7 mm (1/2\")",
    unit: "N·m",
    bounds: "min-max",
    hint: "Recalled tables (unverified): Daikin 50-60, Mitsubishi 49.0-56.4, Panasonic 55.",
  },
  "torque.15.88": {
    key: "torque.15.88",
    label: "Flare torque, 15.88 mm (5/8\")",
    unit: "N·m",
    bounds: "min-max",
    hint: "Recalled tables (unverified): Daikin 62-75, Mitsubishi 73.5-78.4, Panasonic 65.",
  },
  "torque.unsized": {
    key: "torque.unsized",
    label: "Flare torque, pipe size not in the catalogue",
    unit: "N·m",
    bounds: "min-max",
    hint: "An indoor unit on this job has no pipe sizes in the catalogue, so its flares have no torque window. Set it from the manual's torque table for the flare size actually fitted (every unsized flare on this job uses it: if they differ, add the sizes to the catalogue item instead), and add the sizes to the catalogue.",
    recordOnly: false,
  },
  "condensate.fall": {
    key: "condensate.fall",
    label: "Condensate drain fall",
    unit: "mm/m",
    bounds: "min",
    hint: "Often 1/100 (10 mm/m) in ducted and cassette manuals; wall units usually just say \"slope downwards\". Confirm per indoor unit, or confirm as record only.",
  },
  "charge.tolerance": {
    key: "charge.tolerance",
    label: "Charge: allowed difference from the as-built figure",
    unit: "g",
    bounds: "max",
    hint: "How far the weighed added charge may be from the figure the as-built length needs (max(0, length − pre-charged length) × g/m, from the catalogue), either way. Left alone, it's the company's 10% of that figure or 50 g, whichever is larger. Outside it, the weighed figure waits for your sign-off with a reason. A company default, not a manufacturer figure.",
    recordOnly: "Use 10% or 50 g",
    defaultApplies: "10% or 50 g (company default)",
  },
};

export const TARGET_KEYS = Object.keys(JOB_TARGETS) as TargetKey[];

export const FLARE_SIZES_MM = [6.35, 9.52, 12.7, 15.88] as const;
export type FlareSizeMm = (typeof FLARE_SIZES_MM)[number];

/** The standard flare size a catalogue pipe diameter means (within 0.3 mm), or null. */
export function flareSize(mm: number | null | undefined): FlareSizeMm | null {
  if (typeof mm !== "number" || !Number.isFinite(mm)) return null;
  return FLARE_SIZES_MM.find((s) => Math.abs(s - mm) <= 0.3) ?? null;
}

type Brand = "daikin" | "mitsubishi" | "panasonic";

/**
 * Recalled manufacturer flare torque tables (commissioning-standards.md §3):
 * unverified candidates, never facts. Panasonic states single values, so the
 * window is that value (wrench set to it), not an invented tolerance.
 */
export const FLARE_TORQUE_CANDIDATES: Record<FlareSizeMm, Record<Brand, { min: number; max: number }>> = {
  6.35: { daikin: { min: 15, max: 17 }, mitsubishi: { min: 13.7, max: 17.7 }, panasonic: { min: 18, max: 18 } },
  9.52: { daikin: { min: 33, max: 39 }, mitsubishi: { min: 34.3, max: 41.2 }, panasonic: { min: 42, max: 42 } },
  12.7: { daikin: { min: 50, max: 60 }, mitsubishi: { min: 49, max: 56.4 }, panasonic: { min: 55, max: 55 } },
  15.88: { daikin: { min: 62, max: 75 }, mitsubishi: { min: 73.5, max: 78.4 }, panasonic: { min: 65, max: 65 } },
};

const BRAND_LABEL: Record<Brand, string> = { daikin: "Daikin", mitsubishi: "Mitsubishi Electric", panasonic: "Panasonic" };

function brandOf(manufacturer: string | undefined): Brand | null {
  const m = (manufacturer ?? "").toLowerCase();
  if (m.includes("daikin")) return "daikin";
  if (m.includes("mitsubishi")) return "mitsubishi";
  if (m.includes("panasonic")) return "panasonic";
  return null;
}

/** The candidate torque window for a pipe size and manufacturer, or null (unknown brand or size). */
export function torqueCandidate(
  sizeMm: number | null | undefined,
  manufacturer: string | undefined,
): { min: number; max: number; note: string } | null {
  const size = flareSize(sizeMm);
  const brand = brandOf(manufacturer);
  if (!size || !brand) return null;
  const w = FLARE_TORQUE_CANDIDATES[size][brand];
  return {
    ...w,
    note: `Candidate from the ${BRAND_LABEL[brand]} torque table (recalled, unverified): the tech lead confirms it against this model's manual.`,
  };
}

export const torqueTargetKey = (size: FlareSizeMm): TargetKey => `torque.${size}` as TargetKey;

/** Additional refrigerant by weight: max(0, run − pre-charged length) × g/m. */
export function expectedAdditionalChargeG(runM: number, prechargedM: number, gPerM: number): number {
  if (![runM, prechargedM, gPerM].every((n) => Number.isFinite(n))) return 0;
  return Math.round(Math.max(0, runM - prechargedM) * Math.max(0, gPerM));
}

/** The company's default tolerance on the weighed charge: 10 % of the expected figure, never less than 50 g. */
export const CHARGE_TOLERANCE_PERCENT = 10;
export const CHARGE_TOLERANCE_MIN_G = 50;

/** The tolerance (± g) on a weighed charge: the job's figure when the tech lead set one, else the company default. */
export function chargeToleranceG(expectedG: number, jobToleranceG?: number): number {
  if (typeof jobToleranceG === "number" && Number.isFinite(jobToleranceG) && jobToleranceG >= 0) return jobToleranceG;
  return Math.max(CHARGE_TOLERANCE_MIN_G, Math.ceil((Math.max(0, expectedG) * CHARGE_TOLERANCE_PERCENT) / 100));
}

/* ---------------- generation ---------------- */

interface SlotDef {
  key: string;
  kind: EvidenceKind;
  label: string;
  unit?: string;
  min?: number;
  max?: number;
  optional?: boolean;
  tag?: PhotoTag;
  role?: EvidenceRole;
  targetKey?: TargetKey;
  window?: WindowSource;
}

interface StepDef {
  key: string;
  phase: number;
  day: 1 | 2 | 3;
  title: string;
  item?: string;
  roomId?: string;
  systemId?: string;
  requires?: StepRequirement;
  critical?: boolean;
  allowNa?: boolean;
  stage?: "install" | "handover";
  guidance?: string;
  equipment?: InstallStep["equipment"];
  decay?: DecayStep;
  charge?: ChargeStep;
  slots: SlotDef[];
}

/** A safe, stable id fragment from a design id ("Room 1" → "room-1"). */
function idPart(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return s || "x";
}

const RECORD_ONLY = (note: string): WindowSource => ({ basis: "record", note });

const SPLIT_NOTE = "Record only: no pass or fail until we have a baseline per model. Run 10-15 minutes steady at top fan speed, same probe at return and supply.";

interface RoomCtx {
  id: string;
  key: string;
  name: string;
  condensate: "gravity" | "pump";
  pipeRunM: number;
  indoor?: CatalogueItem;
  systemId?: string;
}

interface SystemCtx {
  sel: SystemSelection;
  key: string;
  label: string;
  outdoor?: CatalogueItem;
  rooms: RoomCtx[];
  accessEquipment?: AccessEquipmentKind;
  /** Height to the bracket, m, from the survey. */
  heightM?: number;
}

const ERA_NEEDS_ASBESTOS_CHECK = new Set(["pre-1930", "1930-1950", "1950-2000"]);

/** A catalogue item's weight, kg, when it has one. */
function weightOf(item: CatalogueItem | undefined): number | undefined {
  const w = item?.specs?.weightKg;
  return typeof w === "number" && Number.isFinite(w) && w > 0 ? w : undefined;
}

function specFromSlot(stepKey: string, s: SlotDef): EvidenceSpec {
  const spec: EvidenceSpec = { id: `${stepKey}.${s.key}`, kind: s.kind, label: s.label };
  if (s.unit) spec.unit = s.unit;
  if (s.min !== undefined) spec.min = s.min;
  if (s.max !== undefined) spec.max = s.max;
  if (s.optional) spec.optional = true;
  if (s.tag) spec.tag = s.tag;
  if (s.role) spec.role = s.role;
  if (s.targetKey) spec.targetKey = s.targetKey;
  if (s.window) spec.window = s.window;
  return spec;
}

/**
 * The leak check of the field joints once the refrigerant is released. R32
 * manufacturers' manuals (Daikin, Hitachi and others, read through search
 * extracts only, to be confirmed in each model's manual) ask for field-made
 * joints indoors to be tightness tested by a method sensitive to 5 g a year
 * or better, at a pressure of at least 0.25 x PS: in practice an electronic
 * detector rated for A2L refrigerants. Spray finds bigger leaks only.
 */
export const LEAK_CHECK_GUIDANCE =
  "Check every field joint, indoor and outdoor, with an electronic leak detector rated for R32 (A2L) and sensitive to 5 g a year or better, with the joints at a quarter of the nameplate PS or more (on a cold day, run it in heating). Spray alone isn't enough indoors. A leak: don't top up. Pump the charge down into the outdoor unit (or recover it), re-make the joint, then strength-test, evacuate and decay-test again; mark Fail and the tech lead reviews it.";

/**
 * A joint in a run longer than one coil (the bill of materials says so).
 * Daikin's R32 manuals (search extracts, to confirm in each model's manual):
 * inside an occupied space only permanent joints, except the field joints
 * at the indoor unit; braze with nitrogen flowing (about 0.02 MPa through a
 * reducing valve) so no oxide scale forms. Hot-work precautions and the
 * fire watch's length come from the RAMS and the insurer (secondary sources
 * give 30 to 60 minutes; HSE's own guidance wasn't reachable).
 */
export const BRAZED_JOINT_GUIDANCE =
  "A run longer than one coil needs a joint. Inside the home only a permanent brazed joint (no flare or reusable mechanical joint in the run: those only at the indoor unit, or a mechanical joint the manual allows). Braze with oxygen-free nitrogen flowing through the pipe at low pressure through a regulator (Daikin's manuals say about 0.02 MPa), so no oxide scale forms inside. It's hot work: clear or shield anything that burns, have an extinguisher and fire blanket at hand, mind smoke alarms, and keep a fire watch after the last flame for as long as the RAMS and the insurer say. Photograph each joint before it's insulated or boxed in.";

const PRESSURE_GUIDANCE =
  "Oxygen-free nitrogen through a regulator with a relief valve, at the manual's test pressure and never above the outdoor unit's nameplate PS. Note the ambient temperature as you apply it, hold for the manual's time, then read the gauge and the temperature again, and bubble-test every joint. The app corrects the end reading to the start temperature (absolute pressure × kelvin ratio) and fails the test if it fell by more than the allowance: no more than the gauge's resolution unless the tech lead set the manual's figure. A failed test is found, fixed and tested again: every reading again.";

const VACUUM_GUIDANCE =
  "Digital micron gauge, not the compound gauge. Evacuate to 500 micron (66.7 Pa) or the manual's figure if it's stricter, isolate the pump, hold for the manual's time and read it again. A rise above the job's limit is moisture or a leak: find it, evacuate again and repeat the decay test, every reading again.";

const TECH_LEAD_SETS = "Record the reading. The tech lead confirms it against the manufacturer's manual.";

/** The strength/tightness test's readings, in the order they're taken. Shared by new runsheets and the upgrade of older ones. */
function pressureSlotDefs(): SlotDef[] {
  return [
    { key: "applied", kind: "pressure-reading", label: "Test pressure applied (nitrogen)", unit: "bar g", role: "strength-test", targetKey: "pressure.test", window: RECORD_ONLY(TECH_LEAD_SETS) },
    {
      key: "start-temp",
      kind: "measurement",
      label: "Ambient temperature when it was applied",
      unit: "°C",
      role: "strength-start-temp",
      window: RECORD_ONLY("Air temperature by the pipework, read as the pressure is applied: the end reading is corrected to it."),
    },
    {
      key: "held",
      kind: "pressure-reading",
      label: "Pressure at the end of the hold",
      unit: "bar g",
      role: "strength-hold",
      window: RECORD_ONLY("Judged with the other readings: corrected to the start temperature, it may fall by no more than the allowance."),
    },
    {
      key: "end-temp",
      kind: "measurement",
      label: "Ambient temperature at the end of the hold",
      unit: "°C",
      role: "strength-end-temp",
      window: RECORD_ONLY("Same place and thermometer as at the start."),
    },
    { key: "hold-time", kind: "measurement", label: "How long it held", unit: "min", role: "strength-hold-time", targetKey: "pressure.hold", window: RECORD_ONLY(TECH_LEAD_SETS) },
    {
      key: "resolution",
      kind: "measurement",
      label: "Gauge resolution (the smallest step it reads)",
      unit: "bar",
      role: "gauge-resolution",
      window: RECORD_ONLY("Unless the tech lead set the manual's allowance, the pressure may fall by no more than this."),
    },
    { key: "gauge", kind: "photo", label: "Gauge at the end of the hold", tag: "gauge" },
  ];
}

/** The evacuation and decay test's readings, in the order they're taken. */
function vacuumSlotDefs(): SlotDef[] {
  return [
    {
      key: "reached",
      kind: "vacuum-reading",
      label: "Vacuum reached",
      unit: "micron",
      role: "vacuum",
      targetKey: "vacuum.target",
      window: RECORD_ONLY("Judged against 500 micron (66.7 Pa), or the manual's figure if the tech lead set a stricter one."),
    },
    { key: "hold-time", kind: "measurement", label: "Decay hold with the pump isolated", unit: "min", role: "vacuum-hold-time", targetKey: "vacuum.hold", window: RECORD_ONLY(TECH_LEAD_SETS) },
    {
      key: "decay",
      kind: "vacuum-reading",
      label: "After the decay hold, pump isolated",
      unit: "micron",
      role: "vacuum-decay",
      targetKey: "vacuum.decay",
      window: RECORD_ONLY("The rise over the hold is judged against the job's limit: more is moisture or a leak."),
    },
    { key: "gauge", kind: "photo", label: "Micron gauge at the end of the hold", tag: "gauge" },
  ];
}

const num_ = (n: number | null | undefined): number | undefined => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : undefined);

/** One run's limits from the outdoor unit's catalogue record: a single split's run, or one branch of a multi-split. */
function runLimits(outdoor: CatalogueItem | undefined, branch: boolean): { min?: number; max?: number; window: WindowSource; words: string } {
  const code = outdoor?.model ?? outdoor?.label ?? "the outdoor unit";
  const min = num_(outdoor?.specs?.minPipeM);
  const max = num_(branch ? outdoor?.specs?.maxPipePerBranchM : outdoor?.specs?.maxPipeM);
  return limitWindow(code, min, max, branch ? "to one indoor unit" : "for the run");
}

/** A multi-split's limits on all its runs added up. */
function totalRunLimits(outdoor: CatalogueItem | undefined): { min?: number; max?: number; window: WindowSource; words: string } {
  const code = outdoor?.model ?? outdoor?.label ?? "the outdoor unit";
  return limitWindow(code, num_(outdoor?.specs?.minTotalPipeM), num_(outdoor?.specs?.maxTotalPipeM), "in total");
}

function limitWindow(code: string, min: number | undefined, max: number | undefined, what: string): { min?: number; max?: number; window: WindowSource; words: string } {
  if (min === undefined && max === undefined) {
    return { window: RECORD_ONLY(`No limits on record for ${code}: check the installation manual.`), words: `No pipe-length limits ${what} on record for ${code}: check the installation manual before cutting.` };
  }
  const range = min !== undefined && max !== undefined ? `${min} to ${max} m` : min !== undefined ? `at least ${min} m` : `at most ${max} m`;
  return {
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    window: { basis: "catalogue", note: `${code}'s limits on record ${what}: ${range}. Outside them, stop and tell the tech lead.` },
    words: `${code}'s manual (catalogue): ${range} ${what}.${min !== undefined ? ` Never cut it shorter than ${min} m: the manual says how any extra may be laid.` : ""}`,
  };
}

function decayStepDef(kind: DecayStep["kind"]): DecayStep {
  return kind === "pressure"
    ? { kind, limit: { targetKey: "pressure.decay", unit: "bar", window: RECORD_ONLY("No fall beyond the gauge's resolution, unless the tech lead sets the manual's allowance.") } }
    : { kind, limit: { targetKey: "vacuum.rise", unit: "micron", window: RECORD_ONLY("The tech lead sets the rise limit from the manual.") } };
}

/**
 * A runsheet built before the decay tests (pilot-runsheet-1), brought up to
 * them: the pressure and vacuum steps gain the readings the tests need (the
 * temperatures, the hold times, the gauge's resolution) and their step-level
 * limit. Everything already there is kept as it is: spec ids (so captured
 * evidence still belongs), and every target the tech lead has set.
 * Idempotent; other steps are untouched.
 */
export function withDecayTests(runsheet: InstallStep[]): InstallStep[] {
  let changed = false;
  const out = runsheet.map((step) => {
    if (step.decay) return step;
    const kind: DecayStep["kind"] | null = step.evidence.some((e) => e.role === "strength-test")
      ? "pressure"
      : step.evidence.some((e) => e.role === "vacuum") && step.evidence.some((e) => e.role === "vacuum-decay")
        ? "vacuum"
        : null;
    if (!kind) return step;
    changed = true;
    const defs = kind === "pressure" ? pressureSlotDefs() : vacuumSlotDefs();
    const used = new Set<string>();
    const ids = new Set(step.evidence.map((e) => e.id));
    const evidence: EvidenceSpec[] = [];
    for (const def of defs) {
      const existing = step.evidence.find((e) => !used.has(e.id) && (def.role ? e.role === def.role : e.kind === def.kind && e.tag === def.tag));
      if (existing) {
        used.add(existing.id);
        evidence.push(existing);
        continue;
      }
      let spec = specFromSlot(step.id, def);
      for (let i = 2; ids.has(spec.id); i++) spec = { ...spec, id: `${step.id}.${def.key}-${i}` };
      ids.add(spec.id);
      evidence.push(spec);
    }
    for (const e of step.evidence) if (!used.has(e.id)) evidence.push(e);
    return { ...step, evidence, decay: decayStepDef(kind) };
  });
  return changed ? out : runsheet;
}

/**
 * Every target the tech lead set on one runsheet, set again on another (a
 * runsheet rebuilt from a newer template before anyone started): the same
 * numbers, note, name and time, for each target the new one uses.
 */
export function carryTargets(from: InstallStep[], to: InstallStep[]): InstallStep[] {
  let out = to;
  const keys = new Set(jobTargets(to).map((t) => t.key));
  for (const t of jobTargets(from)) {
    if (t.basis !== "tech-lead" || !keys.has(t.key)) continue;
    out = applyTarget(out, t.key, { ...(t.min !== undefined ? { min: t.min } : {}), ...(t.max !== undefined ? { max: t.max } : {}) }, { basis: "tech-lead", ...(t.setBy ? { setBy: t.setBy } : {}), ...(t.setAt ? { setAt: t.setAt } : {}), ...(t.note ? { note: t.note } : {}) });
  }
  return out;
}

/**
 * The runsheet for one job, from the approved design's variant (the one
 * the customer accepted), the catalogue (models, pipe sizes, charge rates)
 * and the measured survey (risks). Per-room steps repeat per room and
 * per-system steps per outdoor unit; every step carries its suggested day.
 * Deterministic: the same inputs always give the same ids.
 */
export function runsheetFromDesign(
  design: DesignRecord,
  variantId: string,
  catalogue: CatalogueItem[],
  measured?: MeasuredSurvey,
): InstallStep[] {
  const variant: DesignVariant | undefined = design.variants.find((v) => v.id === variantId);
  if (!variant) throw new Error(`The design has no variant "${variantId}".`);
  if (variant.systems.length === 0) throw new Error("The design variant has no systems.");
  const byId = new Map(catalogue.map((c) => [c.id, c]));

  // Rooms in design order, each with its indoor unit and the system serving it.
  const systemOfRoom = new Map<string, string>();
  for (const sys of variant.systems) for (const r of sys.roomIds) systemOfRoom.set(r, sys.id);
  const usedKeys = new Set<string>();
  const uniqueKey = (raw: string) => {
    let k = idPart(raw);
    for (let i = 2; usedKeys.has(k); i++) k = `${idPart(raw)}-${i}`;
    usedKeys.add(k);
    return k;
  };
  const rooms: RoomCtx[] = design.rooms
    .filter((r) => systemOfRoom.has(r.roomId) || variant.roomUnits.some((u) => u.roomId === r.roomId))
    .map((r) => {
      const unit = variant.roomUnits.find((u) => u.roomId === r.roomId);
      return {
        id: r.roomId,
        key: uniqueKey(`r-${r.roomId}`),
        name: r.roomName || "Room",
        condensate: r.condensate,
        pipeRunM: r.pipeRunM,
        indoor: unit ? byId.get(unit.indoorItemId) : undefined,
        systemId: systemOfRoom.get(r.roomId),
      };
    });
  if (rooms.length === 0) throw new Error("The design variant has no rooms.");

  const positions = measured?.outdoor.positions ?? [];
  const systems: SystemCtx[] = variant.systems.map((sel, i) => {
    const pos = positions.find((p) => p.id === sel.outdoorPositionId) ?? (variant.systems.length === 1 ? positions.find((p) => p.chosen) : undefined);
    return {
      sel,
      key: uniqueKey(`s-${sel.id}`),
      label: variant.systems.length > 1 ? `System ${i + 1}` : "System",
      outdoor: byId.get(sel.outdoorItemId),
      rooms: rooms.filter((r) => r.systemId === sel.id),
      accessEquipment: pos?.accessEquipment,
      ...(typeof pos?.heightM === "number" ? { heightM: pos.heightM } : {}),
    };
  });

  const modelOf = (item: CatalogueItem | undefined) => item?.model ?? item?.label ?? "the model in the design";
  const labelOf = (item: CatalogueItem | undefined, fallback: string) => item?.label ?? fallback;
  const sysItem = (s: SystemCtx) => (systems.length > 1 ? `${s.label}: ${labelOf(s.outdoor, "outdoor unit")}` : labelOf(s.outdoor, "Outdoor unit"));
  const sysRoomsNote = (s: SystemCtx) => (s.rooms.length ? ` Serves ${s.rooms.map((r) => r.name).join(", ")}.` : "");

  // Risks from the survey.
  const house = measured?.house;
  const needsAsbestosCheck =
    !house ||
    ERA_NEEDS_ASBESTOS_CHECK.has(house.era) ||
    house.asbestosRisk !== "none-suspected" ||
    measured?.electrics.asbestosFlashGuard === "possible" ||
    measured?.electrics.asbestosFlashGuard === "yes";
  const surveySuspects =
    house?.asbestosRisk === "possible" ||
    house?.asbestosRisk === "suspected" ||
    measured?.electrics.asbestosFlashGuard === "possible" ||
    measured?.electrics.asbestosFlashGuard === "yes";
  const surveyAsbestosWords = [
    house && (house.asbestosRisk === "possible" || house.asbestosRisk === "suspected") ? `asbestos ${house.asbestosRisk}${house.asbestosNote ? ` (${house.asbestosNote})` : ""}` : "",
    measured?.electrics.asbestosFlashGuard === "possible" || measured?.electrics.asbestosFlashGuard === "yes" ? `a flash guard in the fuse board that may be asbestos (${measured.electrics.asbestosFlashGuard})` : "",
  ]
    .filter(Boolean)
    .join("; ");
  // Rooms whose run is longer than one coil: the bill of materials says a brazed joint is needed (hot work).
  const brazedRooms = new Set(
    (variant.bom ?? []).filter((l) => /needs a brazed joint/.test(l.note ?? "")).map((l) => (l.note ?? "").split(":")[0]!.trim()),
  );
  const heightAccess = systems.filter((s) => s.accessEquipment && HEIGHT_ACCESS.includes(s.accessEquipment));
  const heavy = systems.filter((s) => (weightOf(s.outdoor) ?? 0) > TWO_PERSON_LIFT_KG);
  const risks: string[] = [];
  for (const s of heightAccess) {
    risks.push(`working at height: ${ACCESS_PHRASE[s.accessEquipment!]} for the outdoor unit${typeof s.heightM === "number" ? ` (bracket ${s.heightM} m up)` : ""}${systems.length > 1 ? `, ${s.label}` : ""}: checked before use, no work off a ladder there`);
  }
  if (!heightAccess.length && measured?.risks.workingAtHeight) risks.push("working at height (flagged at the survey)");
  for (const s of heavy) risks.push(`two-person lift: ${modelOf(s.outdoor)} weighs ${weightOf(s.outdoor)} kg (two people, or a lifting aid, for every lift)`);
  const crossing = crossesCompartment(measured);
  if (isFlat(measured)) {
    const agent = measured?.house.block?.freeholder?.trim();
    risks.push(`a flat in a block: common parts kept clear and protected, fire doors never wedged open${agent ? ` (freeholder or managing agent: ${agent})` : ""}`);
    if (higherRiskBuilding(measured)) risks.push("a higher-risk building (7 storeys or 18 m and above): only the Building Regulations route on the checklist, nothing beyond it");
    if (crossing) risks.push("the route crosses a compartment wall or floor, or a common part: fire-stop every crossing as you go, and photograph it");
  }
  if (needsAsbestosCheck) risks.push(house ? `possible asbestos (house era ${house.era}, survey says ${house.asbestosRisk})` : "asbestos not assessed in the survey");
  if (measured?.site.petsKids) risks.push(`pets or children: ${measured.site.petsKids}`);
  if (measured?.risks.concealedServicesConcern) risks.push("concealed services flagged at survey");
  if (brazedRooms.size) risks.push(`hot work: a brazed joint in the pipe run to ${[...brazedRooms].join(", ")} (clear what burns, extinguisher and fire blanket, fire watch)`);

  const defs: StepDef[] = [];
  const add = (d: StepDef) => defs.push(d);

  /* Day 1 · prep & building work */
  add({
    key: "d1-arrival",
    phase: 1,
    day: 1,
    title: "On site and introduced",
    guidance: "Introduce the team, confirm today's plan and where the units go, and agree where to park and work.",
    slots: [
      { key: "gps", kind: "gps", label: "Arrival location", optional: true, role: "arrival-gps" },
      { key: "met", kind: "check", label: "Customer met and today's plan agreed" },
    ],
  });
  add({
    key: "d1-protection",
    phase: 1,
    day: 1,
    title: "Protection down",
    allowNa: true,
    slots: [
      { key: "floors", kind: "photo", label: "Floors and stairs protected", tag: "progress" },
      { key: "furniture", kind: "photo", label: "Furniture covered in each work area", tag: "progress" },
    ],
  });
  for (const r of rooms) {
    add({
      key: `d1-condition-${r.key}`,
      phase: 1,
      day: 1,
      title: "Condition photos",
      item: r.name,
      roomId: r.id,
      guidance: "Before anything moves: the unit wall, the floor below it and anything already marked or damaged.",
      slots: [{ key: "photo", kind: "photo", label: `${r.name} as found`, tag: "existing-condition", role: "condition-photo" }],
    });
  }
  add({
    key: "d1-condition-outside",
    phase: 1,
    day: 1,
    title: "Condition photos",
    item: "Outside",
    slots: [{ key: "photo", kind: "photo", label: "Outdoor spot and the pipe-route wall as found", tag: "existing-condition", role: "condition-photo" }],
  });
  add({
    key: "d1-rams",
    phase: 1,
    day: 1,
    title: "RAMS acknowledged",
    guidance: risks.length
      ? `Site risks for this job: ${risks.join("; ")}. Everyone on site reads the RAMS before work starts.`
      : "Everyone on site reads the RAMS before work starts.",
    slots: [{ key: "ack", kind: "check", label: "Everyone on site has read the RAMS and today's risks", role: "rams" }],
  });
  for (const r of rooms) {
    add({
      key: `d1-kit-${r.key}`,
      phase: 1,
      day: 1,
      title: "Kit and serial check",
      item: `${r.name}: ${modelOf(r.indoor)}`,
      roomId: r.id,
      systemId: r.systemId,
      guidance: "Scan or type the serial from the box, and check the model against the design. Damaged or the wrong model: mark Blocked, which raises an issue for the office.",
      equipment: { kind: "indoor", room: r.name, label: labelOf(r.indoor, "Indoor unit"), model: modelOf(r.indoor) },
      slots: [
        { key: "serial", kind: "barcode-scan", label: "Indoor unit serial", tag: "serial", role: "serial-indoor" },
        { key: "model", kind: "check", label: `Box reads ${modelOf(r.indoor)} and is undamaged` },
      ],
    });
  }
  for (const s of systems) {
    add({
      key: `d1-kit-${s.key}`,
      phase: 1,
      day: 1,
      title: "Kit and serial check",
      item: `${s.label}: ${modelOf(s.outdoor)}`,
      systemId: s.sel.id,
      guidance: "Scan or type the serial from the box, and check the model against the design. Damaged or the wrong model: mark Blocked.",
      equipment: {
        kind: "outdoor",
        room: systems.length > 1 ? `Outdoor (${s.label})` : "Outdoor",
        label: labelOf(s.outdoor, "Outdoor unit"),
        model: modelOf(s.outdoor),
        ...(weightOf(s.outdoor) !== undefined ? { weightKg: weightOf(s.outdoor)! } : {}),
      },
      slots: [
        { key: "serial", kind: "barcode-scan", label: "Outdoor unit serial", tag: "serial", role: "serial-outdoor" },
        { key: "model", kind: "check", label: `Box reads ${modelOf(s.outdoor)} and is undamaged` },
      ],
    });
  }
  if (needsAsbestosCheck) {
    add({
      key: "d1-asbestos",
      phase: 2,
      day: 1,
      title: "Asbestos check before drilling",
      critical: true,
      allowNa: true,
      guidance: `Look at every drilling and fixing zone and the fuse board before any hole: textured coatings, old boards, flash guards behind old fuses. Anything suspicious: stop, mark Blocked, and the office arranges a test. Never drill it.${
        surveySuspects ? ` The survey found: ${surveyAsbestosWords}. Drill only once a test result clears it, or the route avoids it.` : ""
      }`,
      slots: [
        { key: "clear", kind: "check", label: surveySuspects ? "Nothing suspected left in any drilling or fixing zone: what the survey found is cleared or avoided" : "Nothing suspected in any drilling or fixing zone" },
        ...(surveySuspects ? [{ key: "cleared", kind: "reference" as const, label: "What cleared it: the test result's reference, or \"avoided: route changed\" and how" }] : []),
      ],
    });
  }
  for (const r of rooms) {
    add({
      key: `d1-mark-${r.key}`,
      phase: 2,
      day: 1,
      title: "Marking out",
      item: r.name,
      roomId: r.id,
      guidance: "Mark the plate, the hole and the pipe route exactly as the approved layout photo shows. Scan for cables and pipes across the whole zone first.",
      slots: [
        { key: "scan", kind: "photo", label: "Cable and pipe detector scan across the zone", tag: "indoor-wall" },
        { key: "marked", kind: "photo", label: "Marked position, hole and route, matching the approved layout", tag: "indoor-wall" },
      ],
    });
  }
  for (const r of rooms) {
    add({
      key: `d1-core-${r.key}`,
      phase: 3,
      day: 1,
      title: "Core drilling",
      item: r.name,
      roomId: r.id,
      guidance: "Drill with a fall to the outside. Sleeve and fire-stop the hole; seal the outside face.",
      slots: [
        { key: "sleeve", kind: "photo", label: "Hole drilled with a fall, sleeve fitted", tag: "progress" },
        { key: "seal", kind: "photo", label: "Outside face sealed and weatherproof", tag: "external-wall" },
      ],
    });
  }
  if (crossing) {
    add({
      key: "d1-firestop",
      phase: 3,
      day: 1,
      title: "Fire-stopping at the compartment crossing",
      item: "Where the route crosses a compartment wall or floor, or a common part",
      critical: true,
      allowNa: true,
      guidance:
        "A flat in a block: where a pipe or cable passes through a compartment wall or floor (to another flat, a corridor, a riser) or through a common part, seal the hole with a fire-stopping product tested for that wall or floor and that service (a collar or wrap on plastic, sealant or batt as its instructions say), so the wall or floor keeps its fire resistance. Photograph it finished, before it's boxed in. Not crossing one after all: the tech lead marks it N/A with a reason.",
      slots: [
        { key: "photo", kind: "photo", label: "The crossing fire-stopped, sleeve and seal visible, before boxing in", tag: "progress" },
        { key: "product", kind: "reference", label: "Fire-stopping product used (make, product and its fire rating)" },
      ],
    });
  }
  for (const r of rooms) {
    add({
      key: `d1-plate-${r.key}`,
      phase: 4,
      day: 1,
      title: "Wall plate",
      item: r.name,
      roomId: r.id,
      allowNa: true,
      slots: [{ key: "plate", kind: "photo", label: "Plate level and fixed into sound masonry", tag: "progress" }],
    });
  }
  for (const s of systems) {
    const access = s.accessEquipment && HEIGHT_ACCESS.includes(s.accessEquipment) ? s.accessEquipment : null;
    add({
      key: `d1-base-${s.key}`,
      phase: 5,
      day: 1,
      title: "Outdoor base or bracket",
      item: sysItem(s),
      systemId: s.sel.id,
      allowNa: true,
      guidance: access
        ? `This position needs ${ACCESS_PHRASE[access]}${typeof s.heightM === "number" ? ` (bracket ${s.heightM} m up)` : ""}: a ladder isn't the access for it. Check it before anyone goes up${access === "mewp" ? ", by a trained operator (IPAF)" : access === "tower" ? " (built by someone trained, PASMA)" : ""}.`
        : undefined,
      slots: [
        { key: "base", kind: "photo", label: "Base or bracket level, fixings and anti-vibration pads in", tag: "outdoor-location" },
        ...(access ? [{ key: "access", kind: "check" as const, label: `${SURVEY_LABELS.accessEquipment[access]} in place and checked (tagged or inspected) before use` }] : []),
      ],
    });
  }

  /* Day 2 · mechanical & electrical */
  for (const r of rooms) {
    add({
      key: `d2-indoor-${r.key}`,
      phase: 4,
      day: 2,
      title: "Indoor unit",
      item: `${r.name}: ${modelOf(r.indoor)}`,
      roomId: r.id,
      systemId: r.systemId,
      slots: [
        { key: "hung", kind: "photo", label: "Unit hung level on the plate", tag: "progress" },
        { key: "dressed", kind: "photo", label: "Clearances kept, pipes and cable dressed neatly", tag: "progress" },
      ],
    });
  }
  for (const s of systems) {
    add({
      key: `d2-outdoor-${s.key}`,
      phase: 5,
      day: 2,
      title: "Outdoor unit",
      item: sysItem(s),
      systemId: s.sel.id,
      ...((weightOf(s.outdoor) ?? 0) > TWO_PERSON_LIFT_KG
        ? { guidance: `${modelOf(s.outdoor)} weighs ${weightOf(s.outdoor)} kg: a two-person lift (or a lifting aid), never one person, and never carried up a ladder.` }
        : {}),
      slots: [
        { key: "set", kind: "photo", label: "Unit level on its mounts, clear of standing water", tag: "progress" },
        { key: "clearance", kind: "check", label: "Service clearances kept, as the manual says" },
        ...((weightOf(s.outdoor) ?? 0) > TWO_PERSON_LIFT_KG ? [{ key: "lift", kind: "check" as const, label: `Lifted by two people (or a lifting aid): ${weightOf(s.outdoor)} kg` }] : []),
      ],
    });
  }
  for (const r of rooms) {
    const sys = systems.find((x) => x.sel.id === r.systemId);
    const run = runLimits(sys?.outdoor, (sys?.rooms.length ?? 1) > 1);
    add({
      key: `d2-pipework-${r.key}`,
      phase: 6,
      day: 2,
      title: "Pipework",
      item: r.name,
      roomId: r.id,
      systemId: r.systemId,
      guidance: `Swept bends, continuous insulation, clipped and protected. UV protection outside; label the run at both ends. Design run ${r.pipeRunM} m. ${run.words}`,
      slots: [
        { key: "bends", kind: "photo", label: "Bends swept, insulation continuous, no kinks", tag: "pipe-route" },
        { key: "labels", kind: "photo", label: "UV protection outside, run labelled at both ends", tag: "pipe-route" },
        {
          key: "run",
          kind: "measurement",
          label: "As-built pipe run to this room (one way)",
          unit: "m",
          role: "as-built-run",
          ...(run.min !== undefined ? { min: run.min } : {}),
          ...(run.max !== undefined ? { max: run.max } : {}),
          window: run.window,
        },
      ],
    });
  }
  for (const r of rooms) {
    if (!brazedRooms.has(r.name)) continue;
    add({
      key: `d2-joint-${r.key}`,
      phase: 6,
      day: 2,
      title: "Brazed joint in the pipe run",
      item: r.name,
      roomId: r.id,
      systemId: r.systemId,
      requires: "fgas",
      critical: true,
      guidance: BRAZED_JOINT_GUIDANCE,
      slots: [
        { key: "hotwork", kind: "check", label: "Hot work: anything that burns cleared or shielded, extinguisher and fire blanket at hand" },
        { key: "nitrogen", kind: "check", label: "Oxygen-free nitrogen flowing through the pipe while brazing, at low pressure through a regulator" },
        { key: "permanent", kind: "check", label: "Permanent brazed joint: no flare or reusable mechanical joint in the run inside the home" },
        { key: "joint", kind: "photo", label: "Each joint, and where it is, before it's insulated or boxed in", tag: "pipe-route" },
        { key: "watch", kind: "check", label: "Fire watch kept after the last flame, for as long as the RAMS says: nothing smouldering" },
      ],
    });
  }
  for (const r of rooms) {
    const liquid = flareSize(r.indoor?.specs?.liquidPipeMm);
    const gas = flareSize(r.indoor?.specs?.gasPipeMm);
    const flareSlot = (key: string, line: "Liquid" | "Gas", size: FlareSizeMm | null, role: EvidenceRole): SlotDef => {
      const cand = size ? torqueCandidate(size, r.indoor?.manufacturer) : null;
      return {
        key,
        kind: "torque",
        label: `${line} line flares${size ? ` (${size} mm)` : ""}, both ends`,
        unit: "N·m",
        role,
        // An unknown size still has a target the tech lead must set, so sign-off waits for it (never a silent pass).
        targetKey: size ? torqueTargetKey(size) : "torque.unsized",
        ...(cand
          ? { min: cand.min, max: cand.max, window: { basis: "candidate" as const, note: cand.note } }
          : {
              window: RECORD_ONLY(
                size
                  ? "No verified torque for this make: record the wrench setting. The tech lead sets the window from the manual."
                  : "Pipe size isn't in the catalogue: check the manual and record the wrench setting. The tech lead sets the window from the manual before sign-off.",
              ),
            }),
      };
    };
    add({
      key: `d2-flares-${r.key}`,
      phase: 6,
      day: 2,
      title: "Flares and torque",
      item: r.name,
      roomId: r.id,
      systemId: r.systemId,
      requires: "fgas",
      guidance: `Calibrated torque wrench on every flare, indoor and outdoor ends. Record the setting you used for each line.${
        (systems.find((x) => x.sel.id === r.systemId)?.rooms.length ?? 1) > 1
          ? " Multi-split: where the outdoor unit's port is a different size from this pipe, fit the reducer the manual names and tighten its nuts as the manual says (often less than the normal torque), not to this line's window, which is for the field flares."
          : ""
      }`,
      slots: [flareSlot("liquid", "Liquid", liquid, "flare-liquid"), flareSlot("gas", "Gas", gas, "flare-gas")],
    });
  }
  for (const r of rooms) {
    const pump = r.condensate === "pump";
    add({
      key: `d2-condensate-${r.key}`,
      phase: 6,
      day: 2,
      title: "Condensate",
      item: `${r.name}${pump ? " (pump)" : ""}`,
      roomId: r.id,
      guidance: pump
        ? "Continuous fall to the pump, no traps or sags. Test the pump by overfilling: it must discharge, and the high-level switch must stop the unit or raise the alarm."
        : "Continuous fall, no traps, sags or uphill sections, with an air break at the end. Pour water into the tray, not the hose end.",
      slots: [
        {
          key: "fall",
          kind: "measurement",
          label: "Fall on the drain run",
          unit: "mm/m",
          role: "condensate-fall",
          targetKey: "condensate.fall",
          window: RECORD_ONLY("Record the fall you measured. The tech lead confirms the figure from the indoor unit's manual."),
        },
        { key: "test", kind: "video", label: "Drain test: water into the tray, out at the end", tag: "drainage" },
        ...(pump ? [{ key: "pump", kind: "check" as const, label: "Pump test: it discharges, and the high-level switch stops the unit" }] : []),
      ],
    });
  }
  for (const s of systems) {
    const e = s.sel.electrical;
    add({
      key: `d2-electrical-${s.key}`,
      phase: 7,
      day: 2,
      title: "Electrical circuit",
      item: sysItem(s),
      systemId: s.sel.id,
      requires: "electrical",
      critical: true,
      guidance: `New circuit, notifiable under Part P: designed, done and tested by the registered electrician, who confirms the supply (main fuse, existing load, earthing) can take it, and sizes the protective device, its RCD type and the cable for this route (how it's run, insulation, the outside section, length). The design's figures are a starting point: ${e.breaker || "a protective device"}, ${e.cableMm2 || "?"} mm² cable.${e.routeNote ? ` Route: ${e.routeNote}` : ""} The indoor-outdoor interconnect is mains voltage: the cable the manual specifies, terminated as the manual shows, earth first. Tell the customer before the power goes off (up to 30 minutes).`,
      slots: [
        { key: "lockoff", kind: "photo", label: "Supply isolated and locked off before work", tag: "electrical-supply" },
        { key: "spec", kind: "check", label: "Protective device (with the RCD type the manual asks for) and cable fitted as the electrician sized them for this route" },
        { key: "board", kind: "photo", label: "New device in the board, labelled", tag: "fuse-board" },
        { key: "isolator", kind: "photo", label: `${e.isolator || "Isolator"} fitted by the outdoor unit`, tag: "electrical-supply" },
        { key: "interconnect", kind: "check", label: "Interconnect between the units: the cable the manual specifies, terminals tight, strain relief on, earth connected" },
        { key: "terminals", kind: "photo", label: "Terminal blocks at the outdoor unit and each indoor unit, before the covers go on", tag: "electrical-supply" },
      ],
    });
  }

  /* Day 3 · test, commission, hand over */
  for (const s of systems) {
    add({
      key: `d3-pressure-${s.key}`,
      phase: 8,
      day: 3,
      title: "Strength and tightness test",
      item: sysItem(s),
      systemId: s.sel.id,
      requires: "fgas",
      critical: true,
      guidance: PRESSURE_GUIDANCE,
      decay: decayStepDef("pressure"),
      slots: pressureSlotDefs(),
    });
  }
  for (const s of systems) {
    add({
      key: `d3-vacuum-${s.key}`,
      phase: 9,
      day: 3,
      title: "Vacuum and decay test",
      item: sysItem(s),
      systemId: s.sel.id,
      requires: "fgas",
      critical: true,
      guidance: VACUUM_GUIDANCE,
      decay: decayStepDef("vacuum"),
      slots: vacuumSlotDefs(),
    });
  }
  for (const s of systems) {
    add({
      key: `d3-release-${s.key}`,
      phase: 10,
      day: 3,
      title: "Release and leak check",
      item: sysItem(s),
      systemId: s.sel.id,
      requires: "fgas",
      critical: true,
      guidance: LEAK_CHECK_GUIDANCE,
      slots: [
        { key: "valves", kind: "check", label: "Service valves fully open, caps back on and tight" },
        { key: "leaks", kind: "check", label: "Every field joint leak-checked with an electronic R32 (A2L) detector, sensitive to 5 g a year or better: no leaks found" },
        { key: "detector", kind: "reference", label: "Leak detector used (make and model)" },
        {
          key: "pressure",
          kind: "measurement",
          label: "Pressure at the joints while leak-checking",
          unit: "bar g",
          window: RECORD_ONLY("At least a quarter of the outdoor unit's nameplate PS (the manuals' wording, read through search extracts: confirm in this model's manual). A cold day's standing pressure can be lower: run it in heating and check the high side."),
        },
      ],
    });
  }
  for (const s of systems) {
    const runM = s.sel.refrigerant.totalPipeM;
    const pre = s.outdoor?.specs?.prechargedPipeM ?? s.sel.refrigerant.prechargedPipeM;
    const gpm = s.outdoor?.specs?.additionalChargeGPerM;
    const expected = typeof gpm === "number" && typeof pre === "number" ? expectedAdditionalChargeG(runM, pre, gpm) : s.sel.refrigerant.additionalChargeG;
    const formula =
      typeof gpm === "number" && typeof pre === "number"
        ? `Design: max(0, ${runM} m − ${pre} m pre-charged) × ${gpm} g/m = ${expected} g.`
        : `Design figure: ${expected} g (the catalogue has no charge rate for this model: check the manual).`;
    // R32 room size, again as built: the most the smallest room on this system may hold (1.84 kg when a room isn't measured).
    const limits = s.rooms.map((r) => {
      const dr = design.rooms.find((x) => x.roomId === r.id);
      const h = releaseHeightOf(r.indoor);
      const area = dr?.areaM2 && !dr.estimated?.includes("area") ? dr.areaM2 : undefined;
      return { name: r.name, area, maxKg: area && h ? Math.max(A2L_ROOM_CHECK_ABOVE_KG, a2lMaxChargeKg(area, h.h0)) : A2L_ROOM_CHECK_ABOVE_KG };
    });
    const tightest = limits.sort((a, b) => a.maxKg - b.maxKg)[0];
    const factoryKg = s.outdoor?.specs?.factoryChargeKg;
    const maxAddedG = tightest && typeof factoryKg === "number" && factoryKg > 0 ? Math.max(0, Math.floor((tightest.maxKg - factoryKg) * 1000 + 1e-6)) : undefined;
    const roomNote = tightest
      ? ` R32 room size: keep the total (nameplate factory charge plus what you add) at or under ${tightest.maxKg} kg, ${tightest.area ? `the most ${tightest.name} (${tightest.area} m²) may hold` : "the level above which every room needs measuring"}; over it, stop and tell the tech lead.`
      : "";
    const totalLimits = s.rooms.length > 1 ? totalRunLimits(s.outdoor) : runLimits(s.outdoor, false);
    add({
      key: `d3-charge-${s.key}`,
      phase: 10,
      day: 3,
      title: "F-gas label and charge record",
      item: sysItem(s),
      systemId: s.sel.id,
      requires: "fgas",
      guidance: `Charge by weight from the outdoor unit's formula, using the as-built length. ${formula}${totalLimits.min !== undefined || totalLimits.max !== undefined ? ` ${totalLimits.words}` : ""}${typeof gpm === "number" && typeof pre === "number" ? " Type the as-built length first: the app works out the charge it needs and shows it next to what you weigh; a weighed figure outside the job's tolerance waits for the tech lead's sign-off." : ""} Fill in the F-gas label in the unit: factory, added and total charge in kg and tCO2e (R32, GWP ${R32_GWP}).${roomNote}`,
      ...(typeof gpm === "number" && typeof pre === "number"
        ? { charge: { prechargedM: pre, gPerM: gpm, limit: { targetKey: "charge.tolerance" as const, unit: "g", window: RECORD_ONLY(`Company default: ${CHARGE_TOLERANCE_PERCENT}% of the expected figure or ${CHARGE_TOLERANCE_MIN_G} g, whichever is larger.`) } } }
        : {}),
      slots: [
        {
          key: "length",
          kind: "measurement",
          label: s.rooms.length > 1 ? "As-built pipe length, all runs added up (one way)" : "As-built one-way pipe length",
          unit: "m",
          role: "as-built-length",
          ...(totalLimits.min !== undefined ? { min: totalLimits.min } : {}),
          ...(totalLimits.max !== undefined ? { max: totalLimits.max } : {}),
          window: totalLimits.min !== undefined || totalLimits.max !== undefined ? totalLimits.window : RECORD_ONLY("Measured as built, not the design length."),
        },
        {
          key: "added",
          kind: "measurement",
          // With no charge rate in the catalogue, "design: 0 g" would be a figure nobody worked out: say so instead.
          label: typeof gpm === "number" && typeof pre === "number" ? `Refrigerant added, weighed (design: ${expected} g)` : "Refrigerant added, weighed (no charge rate in the catalogue: work it out from the manual)",
          unit: "g",
          role: "additional-charge",
          ...(maxAddedG !== undefined ? { max: maxAddedG } : {}),
          window: RECORD_ONLY(maxAddedG !== undefined ? `${formula} At most ${maxAddedG} g for the R32 room size (${factoryKg} kg factory charge in the catalogue).` : formula),
        },
        { key: "factory", kind: "measurement", label: "Factory charge from the nameplate", unit: "kg", role: "factory-charge", window: RECORD_ONLY("As printed on the outdoor unit's nameplate.") },
        { key: "label", kind: "photo", label: "Completed F-gas label in the outdoor unit", tag: "kit", role: "fgas-label" },
      ],
    });
  }
  for (const r of rooms) {
    add({
      key: `d3-commission-${r.key}`,
      phase: 10,
      day: 3,
      title: "Commissioning: cooling and heating",
      item: r.name,
      roomId: r.id,
      systemId: r.systemId,
      guidance: SPLIT_NOTE,
      slots: [
        { key: "cooling", kind: "measurement", label: "Cooling: return minus supply air", unit: "°C", role: "cooling-split", window: RECORD_ONLY(SPLIT_NOTE) },
        { key: "heating", kind: "measurement", label: "Heating: supply minus return air", unit: "°C", role: "heating-split", window: RECORD_ONLY(SPLIT_NOTE) },
        { key: "modes", kind: "check", label: "Modes, fan speeds, remote and app checked, no error codes" },
      ],
    });
  }
  const noiseRule = variant.rules.find((x) => x.id === "noise" || /noise/i.test(x.title));
  for (const s of systems) {
    add({
      key: `d3-defrost-${s.key}`,
      phase: 10,
      day: 3,
      title: "Defrost water route",
      item: sysItem(s),
      systemId: s.sel.id,
      guidance: "In heating the outdoor unit defrosts and sheds water. It must reach a gully, gravel or soakaway: never a path, step, drive or a neighbour's side, where it freezes.",
      slots: [{ key: "route", kind: "photo", label: "Where defrost water goes, and the unit clear of standing water", tag: "drainage", role: "defrost" }],
    });
    add({
      key: `d3-noise-${s.key}`,
      phase: 10,
      day: 3,
      title: "Noise check (MCS 020(a))",
      item: sysItem(s),
      systemId: s.sel.id,
      guidance: `Permitted development rests on the design's MCS 020(a) calculation at the neighbour's assessment position, not a measurement at the boundary. Design: ${
        noiseRule ? noiseRule.detail : "no noise result found on the design: ask the tech lead before signing this off."
      } If the unit moved or the surroundings differ, the calculation is redone.`,
      slots: [
        { key: "calc", kind: "check", label: "As built matches the design's noise calculation (position, distance, reflecting walls, barrier)", role: "noise-calc" },
        {
          key: "measured",
          kind: "measurement",
          label: "Optional QA reading: LAeq at 1 m, unit at full speed",
          unit: "dB(A)",
          optional: true,
          role: "noise-measured",
          window: RECORD_ONLY("A quality check for faults, never planning compliance."),
        },
      ],
    });
  }
  add({
    key: "d3-eic",
    phase: 10,
    day: 3,
    title: "Electrical certificate",
    requires: "electrical",
    guidance:
      "The BS 7671 Electrical Installation Certificate with its schedule of test results (R1+R2, insulation resistance, Zs, RCD). The scheme's Building Regulations certificate can follow: it's due within 30 days of completion.",
    slots: [
      { key: "eic", kind: "reference", label: "EIC number", role: "eic-ref" },
      { key: "scheme", kind: "reference", label: "Scheme notification reference, or \"pending from scheme\"", role: "scheme-ref" },
      { key: "scope", kind: "check", label: "The certificate covers the new circuit, the isolator and the indoor-outdoor interconnects" },
    ],
  });
  add({
    key: "d3-walkthrough",
    phase: 11,
    day: 3,
    title: "Customer walkthrough",
    stage: "handover",
    guidance: "With the customer, at handover. Show, don't tell: let them press the buttons.",
    slots: [
      { key: "modes", kind: "check", label: "Modes and the remote, including heating", role: "walkthrough" },
      { key: "app", kind: "check", label: "App paired on their phone", role: "walkthrough" },
      { key: "filters", kind: "check", label: "How to clean the filters", role: "walkthrough" },
      { key: "condensate", kind: "check", label: "Where the condensate goes", role: "walkthrough" },
      { key: "normal", kind: "check", label: "Normal sounds, drips and defrost steam", role: "walkthrough" },
      { key: "isolator", kind: "check", label: "Where the isolator is", role: "walkthrough" },
      // Building Regulations reg 40: operating and maintenance information. The care guide is in the pack; the manuals are the rest.
      { key: "manuals", kind: "check", label: "Manufacturer's user and maintenance manuals handed over", role: "walkthrough" },
    ],
  });
  for (const r of rooms) {
    add({
      key: `d3-finished-${r.key}`,
      phase: 11,
      day: 3,
      title: "Finished photos",
      item: r.name,
      roomId: r.id,
      slots: [{ key: "photo", kind: "photo", label: `${r.name}: unit in place, area clean`, tag: "completed", role: "finished-photo" }],
    });
  }
  for (const s of systems) {
    add({
      key: `d3-finished-${s.key}`,
      phase: 11,
      day: 3,
      title: "Finished photos",
      item: sysItem(s),
      systemId: s.sel.id,
      slots: [{ key: "photo", kind: "photo", label: "Outdoor unit, pipe route and isolator", tag: "completed", role: "finished-photo" }],
    });
  }
  add({
    key: "d3-cleanup",
    phase: 11,
    day: 3,
    title: "Clean-up",
    slots: [{ key: "clean", kind: "check", label: "Protection lifted, dust and offcuts gone, packaging taken away" }],
  });

  // Phase order is the runsheet's order; within a phase, the day, then the order written.
  const ordered = defs
    .map((d, i) => ({ d, i }))
    .sort((a, b) => a.d.phase - b.d.phase || a.d.day - b.d.day || a.i - b.i)
    .map(({ d }) => d);
  return ordered.map((d) => {
    const step: InstallStep = {
      id: d.key,
      phase: d.phase,
      title: d.title,
      ...(d.item ? { item: d.item } : {}),
      day: d.day,
      ...(d.requires ? { requires: d.requires } : {}),
      ...(d.critical ? { critical: true } : {}),
      ...(d.allowNa ? { allowNa: true } : {}),
      ...(d.guidance ? { guidance: d.guidance } : {}),
      ...(d.stage ? { stage: d.stage } : {}),
      ...(d.roomId ? { roomId: d.roomId } : {}),
      ...(d.systemId ? { systemId: d.systemId } : {}),
      ...(d.equipment ? { equipment: d.equipment } : {}),
      ...(d.decay ? { decay: d.decay } : {}),
      ...(d.charge ? { charge: d.charge } : {}),
      evidence: d.slots.map((s) => specFromSlot(d.key, s)),
    };
    return step;
  });
}

/* ---------------- the customer's end-of-day words ---------------- */

interface WorkWords {
  /** Steps that read as one line (pipework and its flares). */
  group: string;
  one: string;
  many: string;
  /** What's counted: rooms ("in 2 of 3 rooms"), systems (singular or plural), or the job (once). */
  per: "room" | "system" | "job";
}

/**
 * The pilot runsheet's steps in the customer's words. `null`: our own
 * admin and checks (arriving, protection, as-found photos, RAMS, the kit
 * check, paperwork), which a customer update leaves out.
 */
const CUSTOMER_WORK: Record<string, WorkWords | null> = {
  "On site and introduced": null,
  "Protection down": null,
  "Condition photos": null,
  "RAMS acknowledged": null,
  "Kit and serial check": null,
  "Asbestos check before drilling": null,
  "Marking out": { group: "mark", one: "the unit position marked out", many: "unit positions marked out", per: "room" },
  "Core drilling": { group: "core", one: "the hole drilled and sealed", many: "holes drilled and sealed", per: "room" },
  "Fire-stopping at the compartment crossing": { group: "firestop", one: "the fire-stopping sealed where the pipework passes through the block's walls or floors", many: "the fire-stopping sealed where the pipework passes through the block's walls or floors", per: "job" },
  "Wall plate": { group: "plate", one: "the wall plate up", many: "wall plates up", per: "room" },
  "Outdoor base or bracket": { group: "base", one: "the outdoor base in", many: "the outdoor bases in", per: "system" },
  "Indoor unit": { group: "indoor", one: "the indoor unit hung", many: "indoor units hung", per: "room" },
  "Outdoor unit": { group: "outdoor", one: "the outdoor unit in place", many: "the outdoor units in place", per: "system" },
  Pipework: { group: "pipes", one: "the pipework run, insulated and connected", many: "pipework run, insulated and connected", per: "room" },
  "Flares and torque": { group: "pipes", one: "the pipework run, insulated and connected", many: "pipework run, insulated and connected", per: "room" },
  Condensate: { group: "drain", one: "the drain fitted and tested", many: "drains fitted and tested", per: "room" },
  "Electrical circuit": { group: "circuit", one: "the new electrical circuit fitted and tested", many: "the new electrical circuits fitted and tested", per: "system" },
  "Strength and tightness test": { group: "pressure", one: "the pipework pressure-tested", many: "the pipework pressure-tested", per: "system" },
  "Vacuum and decay test": { group: "vacuum", one: "the system vacuumed and checked for moisture", many: "the systems vacuumed and checked for moisture", per: "system" },
  "Release and leak check": { group: "release", one: "the refrigerant released and every joint leak-checked", many: "the refrigerant released and every joint leak-checked", per: "system" },
  "F-gas label and charge record": null,
  "Commissioning: cooling and heating": { group: "commission", one: "heating and cooling tested", many: "heating and cooling tested", per: "room" },
  "Defrost water route": { group: "defrost", one: "the defrost water route checked", many: "the defrost water routes checked", per: "system" },
  "Noise check (MCS 020(a))": { group: "noise", one: "the noise checked against the design", many: "the noise checked against the design", per: "job" },
  "Electrical certificate": { group: "eic", one: "the electrical certificate completed", many: "the electrical certificate completed", per: "job" },
  "Customer walkthrough": null,
  "Finished photos": null,
  "Clean-up": null,
};

/** What the next day holds, as a customer reads it ("Tomorrow: the indoor and outdoor units, the pipework…"). */
const CUSTOMER_NEXT: Record<string, string | null> = {
  "Marking out": "marking out",
  "Core drilling": "drilling the holes",
  "Fire-stopping at the compartment crossing": null,
  "Wall plate": "the wall plates",
  "Outdoor base or bracket": "the outdoor base",
  "Indoor unit": "the indoor and outdoor units",
  "Outdoor unit": "the indoor and outdoor units",
  Pipework: "the pipework",
  "Flares and torque": "the pipework",
  Condensate: "the drains",
  "Electrical circuit": "the electrics",
  "Strength and tightness test": "testing the system",
  "Vacuum and decay test": "testing the system",
  "Release and leak check": "testing the system",
  "F-gas label and charge record": null,
  "Commissioning: cooling and heating": "commissioning",
  "Defrost water route": null,
  "Noise check (MCS 020(a))": null,
  "Electrical certificate": null,
  "Customer walkthrough": "your handover",
};

const ADMIN_TITLE = /^(on site|protection|condition photos|rams|kit and serial|asbestos|finished photos|clean-?up|arrival)/i;

/** "RAMS acknowledged" stays as it is; "Core drilling" becomes "core drilling". */
function lowerFirstWord(t: string): string {
  const first = t.split(/\s+/)[0] ?? "";
  return first.length > 1 && first === first.toUpperCase() ? t : t.charAt(0).toLowerCase() + t.slice(1);
}

/** "a, b and c". */
export function listInWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const unitOf = (s: InstallStep, per: WorkWords["per"]): string => (per === "room" ? (s.roomId ?? s.item ?? s.id) : per === "system" ? (s.systemId ?? s.item ?? s.id) : "job");

/**
 * What got done, in the customer's words, for the end-of-day update: the
 * real work only (never arrival, protection, as-found photos, RAMS or the
 * kit check), by phase in runsheet order, one line per kind of work
 * ("holes drilled and sealed", "wall plates up", "the outdoor base in"),
 * saying how many rooms when it wasn't all of them. Nothing is capped:
 * everything that matters is in. `all` is the whole runsheet (to know how
 * many rooms there are). Steps outside the pilot template read as their
 * own title.
 */
export function customerWorkDone(done: InstallStep[], all: InstallStep[]): string[] {
  const totalRooms = new Set(all.filter((s) => s.roomId).map((s) => s.roomId)).size;
  const ordered = done
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.phase - b.s.phase || a.i - b.i)
    .map(({ s }) => s);
  const groups = new Map<string, { words: WorkWords; units: Set<string> }>();
  const out: { key: string; text?: string }[] = [];
  for (const s of ordered) {
    const words = CUSTOMER_WORK[s.title];
    if (words === null) continue;
    if (words === undefined) {
      if (ADMIN_TITLE.test(s.title)) continue;
      const text = lowerFirstWord(s.title);
      if (!out.some((o) => o.text === text)) out.push({ key: `title:${text}`, text });
      continue;
    }
    let g = groups.get(words.group);
    if (!g) {
      g = { words, units: new Set() };
      groups.set(words.group, g);
      out.push({ key: words.group });
    }
    g.units.add(unitOf(s, words.per));
  }
  return out.map((o) => {
    if (o.text) return o.text;
    const { words, units } = groups.get(o.key)!;
    const n = units.size;
    if (words.per !== "room") return n > 1 ? words.many : words.one;
    if (totalRooms <= 1) return words.one;
    if (n >= totalRooms) return words.many;
    return `${n === 1 ? words.one : words.many} in ${n === 1 ? "one" : n} of ${totalRooms} rooms`;
  });
}

/** What a day's steps hold, in the customer's words, for "Tomorrow: …" (at most `max`). */
export function customerWorkNext(steps: InstallStep[], max = 4): string[] {
  const out: string[] = [];
  for (const s of steps) {
    const known = s.title in CUSTOMER_NEXT;
    const text = known ? CUSTOMER_NEXT[s.title] : ADMIN_TITLE.test(s.title) || s.stage === "handover" ? null : lowerFirstWord(s.title);
    if (text && !out.includes(text)) out.push(text);
  }
  return out.slice(0, max);
}

/* ---------------- the end-of-day photo picker ---------------- */

/**
 * What a runsheet photo is for, so the picker can lead with the finished
 * work: "work" (what we built, shown first, finished photos ahead of the
 * rest), "condition" (the home as found) and "check" (detector scans,
 * serials, gauges, labels, lock-offs: our records, not the customer's
 * update). The last two are hidden until asked for.
 */
export type PhotoUse = "work" | "condition" | "check";

export interface PhotoContext {
  stepId: string;
  stepTitle: string;
  item?: string;
  /** The slot's label: what the photo shows ("Hole drilled with a fall, sleeve fitted"). */
  label: string;
  use: PhotoUse;
  finished: boolean;
  /** The step's place in the runsheet. */
  order: number;
}

const CHECK_TAGS: ReadonlySet<string> = new Set(["serial", "gauge", "kit", "signature", "fuse-board"]);
const CHECK_SLOTS = /\.(scan|lockoff)$/;

function photoUse(spec: EvidenceSpec): PhotoUse {
  if (spec.role === "condition-photo" || spec.tag === "existing-condition") return "condition";
  if (CHECK_SLOTS.test(spec.id) || (spec.tag && CHECK_TAGS.has(spec.tag))) return "check";
  return "work";
}

/** Each runsheet photo's step, slot and use, by media id (every capture, not only the latest). */
export function photoContexts(job: Pick<InstallJob, "runsheet" | "evidence">): Map<string, PhotoContext> {
  const bySpec = new Map<string, { step: InstallStep; spec: EvidenceSpec; order: number }>();
  job.runsheet.forEach((step, order) => {
    for (const spec of step.evidence) if (spec.kind === "photo" || spec.kind === "video") bySpec.set(spec.id, { step, spec, order });
  });
  const out = new Map<string, PhotoContext>();
  for (const e of job.evidence) {
    const hit = e.mediaId ? bySpec.get(e.specId) : undefined;
    if (!hit || !e.mediaId) continue;
    out.set(e.mediaId, {
      stepId: hit.step.id,
      stepTitle: hit.step.title,
      ...(hit.step.item ? { item: hit.step.item } : {}),
      label: hit.spec.label,
      use: photoUse(hit.spec),
      finished: hit.spec.role === "finished-photo" || hit.spec.tag === "completed",
      order: hit.order,
    });
  }
  return out;
}

export interface PhotoGroup<T> {
  key: string;
  title: string;
  item?: string;
  use: PhotoUse;
  photos: (T & { label?: string })[];
}

/**
 * The day's photos for the picker, grouped by step: finished photos first,
 * then the rest of the work, latest step first, then photos with no step
 * (taken outside the runsheet), then as-found and check photos (which the
 * picker hides until asked).
 */
export function photoGroups<T extends { id: string; caption?: string }>(photos: T[], contexts: Map<string, PhotoContext>): PhotoGroup<T>[] {
  const groups = new Map<string, PhotoGroup<T> & { rank: number }>();
  for (const p of photos) {
    const c = contexts.get(p.id);
    // A step's work photos and its check photos (the marking out and its detector scan) sit apart.
    const key = c ? `${c.stepId}:${c.use}` : "other";
    let g = groups.get(key);
    if (!g) {
      // Finished photos, then the rest of the work newest step first (the wall plates before the protection sheets).
      const rank = !c ? 2_000_000 : c.use !== "work" ? 3_000_000 + (c.use === "condition" ? 0 : 500_000) + c.order : c.finished ? c.order : 1_999_999 - c.order;
      g = c
        ? { key, title: c.stepTitle, ...(c.item ? { item: c.item } : {}), use: c.use, photos: [], rank }
        : { key, title: "Other photos from today", use: "work", photos: [], rank };
      groups.set(key, g);
    }
    g.photos.push({ ...p, ...(c ? { label: c.label } : p.caption ? { label: p.caption } : {}) });
  }
  return [...groups.values()].sort((a, b) => a.rank - b.rank).map(({ rank: _rank, ...g }) => g);
}

/* ---------------- days ---------------- */

/** The suggested day for a step: its own, or by phase for the demo runsheet (1-3 → 1, 4-6 → 2, 7-11 → 3). */
export function dayOf(step: InstallStep): number {
  if (step.day) return step.day;
  return step.phase <= 3 ? 1 : step.phase <= 6 ? 2 : 3;
}

/** One day's steps, phase-ordered (stable within a phase). */
export function stepsForDay(steps: InstallStep[], day: number): InstallStep[] {
  return steps
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => dayOf(s) === day)
    .sort((a, b) => a.s.phase - b.s.phase || a.i - b.i)
    .map(({ s }) => s);
}

/** The days a runsheet covers: at least 1..3, more if a step says so. */
export function runsheetDays(steps: InstallStep[]): number[] {
  const max = Math.max(3, ...steps.map(dayOf));
  return Array.from({ length: max }, (_, i) => i + 1);
}

/* ---------------- slot and step states ---------------- */

export type SlotState =
  | "missing" //    nothing captured yet
  | "pass" //       captured, inside its window (or no window)
  | "exception" //  outside its window, waiting for the tech lead
  | "accepted" //   outside its window, accepted by the tech lead with a reason
  | "recapture"; // the tech lead asked for it to be captured again

export interface SlotView {
  spec: EvidenceSpec;
  state: SlotState;
  record?: EvidenceRecord;
  review?: ExceptionReview;
  /** Why a reading is an exception when its own window doesn't say (the charge against the as-built length). */
  why?: string;
}

const timeOf = (iso: string | undefined) => {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? t : 0;
};

/** Has this record actually captured something? A photo needs its media, a check is the tick itself. */
function captured(spec: EvidenceSpec, record: EvidenceRecord | undefined): boolean {
  if (!record) return false;
  switch (spec.kind) {
    case "photo":
    case "video":
    case "signature":
      return Boolean(record.mediaId || record.ref);
    case "qr-scan":
    case "barcode-scan":
    case "reference":
      return Boolean(record.ref && record.ref.trim());
    case "gps":
      return Boolean(record.gps || record.ref);
    case "check":
      return true;
    default:
      return NUMERIC_KINDS.has(spec.kind) ? typeof record.value === "number" && Number.isFinite(record.value) : true;
  }
}

/** The tech lead's latest review that covers this record (same evidence id, or made after it was captured). */
function reviewFor(job: Pick<InstallJobV2, "exceptionReviews">, spec: EvidenceSpec, record: EvidenceRecord): ExceptionReview | undefined {
  const reviews = (job.exceptionReviews ?? []).filter((r) => r.specId === spec.id);
  for (let i = reviews.length - 1; i >= 0; i--) {
    const r = reviews[i]!;
    if (r.evidenceId && record.id) {
      if (r.evidenceId === record.id) return r;
      continue;
    }
    if (timeOf(r.at) >= timeOf(record.at)) return r;
  }
  return undefined;
}

export function slotView(job: Pick<InstallJobV2, "evidence" | "exceptionReviews">, spec: EvidenceSpec): SlotView {
  const record = latestEvidence(job, spec.id);
  if (!record || !captured(spec, record)) return { spec, state: "missing", ...(record ? { record } : {}) };
  const review = reviewFor(job, spec, record);
  if (review?.resolution === "recapture-required") return { spec, state: "recapture", record, review };
  if (slotStatus(spec, record) === "exception") {
    return review?.resolution === "accepted" ? { spec, state: "accepted", record, review } : { spec, state: "exception", record };
  }
  return { spec, state: "pass", record, ...(review ? { review } : {}) };
}

const SLOT_OK: ReadonlySet<SlotState> = new Set<SlotState>(["pass", "accepted"]);

export type StepState =
  | "todo" //         nothing captured
  | "in-progress" //  some evidence, not all
  | "done" //         every required slot passes (or is accepted)
  | "na" //           not applicable, with a reason
  | "blocked" //      can't go on: a blocking issue holds it
  | "failed" //       a test or check failed
  | "exception" //    a reading outside its window waits for the tech lead
  | "recapture"; //   the tech lead asked for a slot again

export interface StepView {
  step: InstallStep;
  state: StepState;
  slots: SlotView[];
  latest?: StepStatusRecord;
  /** Required slots still to capture (missing or recapture). */
  missing: number;
  /** A strength/tightness or vacuum decay step: the readings judged together. */
  test?: DecayTestView;
  /** The charge step: the weighed figure against what the as-built length needs. */
  charge?: ChargeCheckView;
}

/** The latest outcome recorded for a step (by time; ties go to the later record). */
export function latestStepStatus(job: Pick<InstallJobV2, "stepStatuses">, stepId: string): StepStatusRecord | undefined {
  let best: StepStatusRecord | undefined;
  for (const s of job.stepStatuses ?? []) {
    if (s.stepId !== stepId) continue;
    if (!best || timeOf(s.at) >= timeOf(best.at)) best = s;
  }
  return best;
}

export function stepView(job: Pick<InstallJobV2, "evidence" | "exceptionReviews" | "stepStatuses">, step: InstallStep): StepView {
  const test = decayTest(job, step) ?? undefined;
  const charge = chargeCheck(job, step) ?? undefined;
  let slots = step.evidence.map((spec) => slotView(job, spec));
  if (charge?.result === "outside") {
    // Outside the job's tolerance, the weighed figure waits for the tech lead; an acceptance counts only if made after the length it was judged against.
    slots = slots.map((v) => {
      if (v.spec.id !== charge.addedSpecId || v.state === "missing" || v.state === "recapture") return v;
      const signed = v.review?.resolution === "accepted" && timeOf(v.review.at) >= timeOf(charge.lengthAt);
      return signed
        ? { spec: v.spec, state: "accepted" as const, ...(v.record ? { record: v.record } : {}), review: v.review!, why: charge.words }
        : { spec: v.spec, state: "exception" as const, ...(v.record ? { record: v.record } : {}), why: charge.words };
    });
  }
  if (test) {
    // The test judges its readings together: no reading is an exception on its own, and a failed run's readings are taken again.
    const retake = new Set(test.retestNeeded ? test.toTake : []);
    slots = slots.map((v) => {
      if (!v.spec.role || !DECAY_ROLES.has(v.spec.role) || v.state === "missing") return v;
      if (retake.has(v.spec.id)) return { spec: v.spec, state: "recapture" as const, ...(v.record ? { record: v.record } : {}) };
      return v.state === "exception" || v.state === "accepted" ? { spec: v.spec, state: "pass" as const, ...(v.record ? { record: v.record } : {}) } : v;
    });
  }
  const required = slots.filter((s) => !s.spec.optional);
  const missing = required.filter((s) => s.state === "missing" || s.state === "recapture").length;
  const latest = latestStepStatus(job, step.id);
  const base = { step, slots, missing, ...(latest ? { latest } : {}), ...(test ? { test } : {}), ...(charge ? { charge } : {}) };
  if (latest?.outcome === "na" && latest.reason?.trim()) return { ...base, state: "na" };
  if (latest?.outcome === "blocked") return { ...base, state: "blocked" };
  if (latest?.outcome === "fail") return { ...base, state: "failed" };
  if (test?.result === "fail") return { ...base, state: "failed" };
  if (required.every((s) => SLOT_OK.has(s.state)) && (!test || test.result === "pass")) return { ...base, state: "done" };
  if (slots.some((s) => s.state === "exception")) return { ...base, state: "exception" };
  if (slots.some((s) => s.state === "recapture")) return { ...base, state: "recapture" };
  if (slots.some((s) => s.state !== "missing")) return { ...base, state: "in-progress" };
  return { ...base, state: "todo" };
}

const STEP_FINISHED: ReadonlySet<StepState> = new Set<StepState>(["done", "na"]);

/** Done or N/A. */
export function isStepFinished(view: Pick<StepView, "state">): boolean {
  return STEP_FINISHED.has(view.state);
}

/** Steps done with the customer at handover (the walkthrough). The demo runsheet marks none, so its walkthrough is found by title. */
export function handoverSteps(steps: InstallStep[]): InstallStep[] {
  const flagged = steps.filter((s) => s.stage === "handover");
  if (flagged.length) return flagged;
  return steps.filter((s) => s.stage === undefined && s.phase === 11 && /walkthrough/i.test(s.title));
}

export interface RunsheetProgress {
  /** Every install step done or N/A, and nothing blocked or failed. Handover steps don't count here. */
  complete: boolean;
  /** Readings outside their window that the tech lead hasn't reviewed. */
  openExceptions: number;
  /**
   * Install steps not finished, not blocked and not waiting on a reading
   * review (failed ones count as missing). A step held only by an
   * out-of-range reading is counted once, in `openExceptions`.
   */
  missing: number;
  blocked: number;
  walkthroughDone: boolean;
  byDay: { day: number; done: number; total: number }[];
}

export function runsheetProgress(job: InstallJobV2): RunsheetProgress {
  const views = job.runsheet.map((s) => stepView(job, s));
  // Only flagged handover steps sit outside install complete; the demo runsheet's walkthrough counts towards it.
  const handoverIds = new Set(job.runsheet.filter((s) => s.stage === "handover").map((s) => s.id));
  const install = views.filter((v) => !handoverIds.has(v.step.id));
  const walk = handoverSteps(job.runsheet).map((s) => views.find((v) => v.step.id === s.id)!);
  const blocked = install.filter((v) => v.state === "blocked").length;
  const awaitingReview = install.filter((v) => v.state === "exception").length;
  const missing = install.filter((v) => !isStepFinished(v) && v.state !== "blocked" && v.state !== "exception").length;
  const openExceptions = views.reduce((n, v) => n + v.slots.filter((s) => s.state === "exception").length, 0);
  const byDay = runsheetDays(job.runsheet).map((day) => {
    const dayViews = views.filter((v) => dayOf(v.step) === day);
    return { day, done: dayViews.filter(isStepFinished).length, total: dayViews.length };
  });
  return {
    complete: install.length > 0 && missing === 0 && blocked === 0 && awaitingReview === 0,
    openExceptions,
    missing,
    blocked,
    walkthroughDone: walk.length > 0 && walk.every(isStepFinished),
    byDay,
  };
}

/* ---------------- who may record what ---------------- */

const REQUIREMENT_LOCK: Record<StepRequirement, string> = {
  fgas: "Needs an F-gas engineer",
  electrical: "Needs an electrician",
  "tech-lead": "Needs the tech lead",
};

/**
 * May this person capture evidence on this step today? Install work
 * permission, plus the step's qualification (F-gas, Part P, tech lead),
 * current on the day.
 */
export function canRecord(step: InstallStep, staff: StaffMember, onIso: string): { ok: boolean; reason?: string } {
  if (!staff.active) return { ok: false, reason: "Your account isn't active." };
  if (!can(staff, "install.work")) return { ok: false, reason: "You don't have install permissions." };
  if (step.requires && !meetsRequirement(staff, step.requires, onIso)) return { ok: false, reason: REQUIREMENT_LOCK[step.requires] };
  return { ok: true };
}

/** The shortest reason we accept for Fail, Blocked or N/A: a word or two, not a shrug. */
export const MIN_REASON_LENGTH = 3;

/**
 * May this person record this outcome on this step?
 *  * pass and fail: whoever may record the step (a fail is a test result).
 *  * blocked: anyone on the job: saying "I can't" isn't doing the work.
 *  * na: only where the step allows it; on a critical step only the tech
 *    lead, and on a step that doesn't allow it, nobody but the tech lead.
 * Fail, Blocked and N/A need a reason.
 */
export function canSetOutcome(
  step: InstallStep,
  outcome: StepOutcome,
  staff: StaffMember,
  onIso: string,
  reason?: string,
): { ok: boolean; reason?: string } {
  if (outcome !== "pass" && (reason ?? "").trim().length < MIN_REASON_LENGTH) {
    return { ok: false, reason: "Say why: a reason is needed for Fail, Blocked and N/A." };
  }
  if (outcome === "blocked") {
    if (!staff.active || !can(staff, "install.work")) return { ok: false, reason: "You don't have install permissions." };
    return { ok: true };
  }
  const recorder = canRecord(step, staff, onIso);
  if (!recorder.ok) return recorder;
  if (outcome === "na") {
    const lead = meetsRequirement(staff, "tech-lead", onIso);
    if (step.critical && !lead) return { ok: false, reason: "A critical step can only be marked N/A by the tech lead." };
    if (!step.allowNa && !lead) return { ok: false, reason: "Only the tech lead can mark this step N/A." };
    if (step.critical && !step.allowNa) return { ok: false, reason: "This step can't be N/A: it has to be done." };
  }
  return { ok: true };
}

/** May this person review exceptions (accept a reading or ask for it again)? Tech lead only. */
export function canReviewExceptions(staff: StaffMember, onIso: string): { ok: boolean; reason?: string } {
  if (!can(staff, "install.review")) return { ok: false, reason: "Only the tech lead reviews exceptions." };
  if (!meetsRequirement(staff, "tech-lead", onIso)) return { ok: false, reason: "Needs the tech lead with a current F-gas certificate." };
  return { ok: true };
}

/* ---------------- recording (pure updates) ---------------- */

/** Append a step outcome. Idempotent on the record's id. */
export function withStepStatus(job: InstallJobV2, record: StepStatusRecord): InstallJobV2 {
  if (record.id && job.stepStatuses.some((s) => s.id === record.id)) return job;
  return { ...job, stepStatuses: [...job.stepStatuses, record] };
}

/** Append a tech-lead review. */
export function withExceptionReview(job: InstallJobV2, review: ExceptionReview): InstallJobV2 {
  return { ...job, exceptionReviews: [...job.exceptionReviews, review] };
}

/** Every slot that's out of its window and not yet reviewed, with its step (a decay test's readings are judged by the test instead). */
export function openExceptions(job: InstallJobV2): { step: InstallStep; slot: SlotView }[] {
  const out: { step: InstallStep; slot: SlotView }[] = [];
  for (const step of job.runsheet) {
    for (const slot of stepView(job, step).slots) if (slot.state === "exception") out.push({ step, slot });
  }
  return out;
}

/** The window as people say it: "33 to 39 N·m", "at most 500 micron", or null when there's none. */
export function windowText(spec: Pick<EvidenceSpec, "min" | "max" | "unit">): string | null {
  const u = spec.unit ? ` ${spec.unit}` : "";
  if (spec.min !== undefined && spec.max !== undefined) return spec.min === spec.max ? `${spec.min}${u}` : `${spec.min} to ${spec.max}${u}`;
  if (spec.min !== undefined) return `at least ${spec.min}${u}`;
  if (spec.max !== undefined) return `at most ${spec.max}${u}`;
  return null;
}

/* ---------------- targets ---------------- */

export interface JobTarget {
  key: TargetKey;
  def: TargetDef;
  min?: number;
  max?: number;
  basis: WindowSource["basis"];
  note?: string;
  setBy?: string;
  setAt?: string;
  /** How many readings on this job are checked against it. */
  specCount: number;
}

/** Everything on a step that carries a per-job target: its slots, and a decay test's limit. */
function targetHolders(step: InstallStep): Pick<EvidenceSpec, "targetKey" | "min" | "max" | "window">[] {
  return [...step.evidence, ...(step.decay ? [step.decay.limit] : []), ...(step.charge ? [step.charge.limit] : [])];
}

/** The per-job targets this runsheet uses, as they stand. */
export function jobTargets(runsheet: InstallStep[]): JobTarget[] {
  const out = new Map<TargetKey, JobTarget>();
  for (const step of runsheet) {
    for (const spec of targetHolders(step)) {
      const key = spec.targetKey;
      if (!key || !JOB_TARGETS[key]) continue;
      const existing = out.get(key);
      if (existing) {
        existing.specCount += 1;
        continue;
      }
      out.set(key, {
        key,
        def: JOB_TARGETS[key],
        ...(spec.min !== undefined ? { min: spec.min } : {}),
        ...(spec.max !== undefined ? { max: spec.max } : {}),
        basis: spec.window?.basis ?? (spec.min !== undefined || spec.max !== undefined ? "candidate" : "record"),
        ...(spec.window?.note ? { note: spec.window.note } : {}),
        ...(spec.window?.setBy ? { setBy: spec.window.setBy } : {}),
        ...(spec.window?.setAt ? { setAt: spec.window.setAt } : {}),
        specCount: 1,
      });
    }
  }
  return TARGET_KEYS.filter((k) => out.has(k)).map((k) => out.get(k)!);
}

/** Targets the tech lead hasn't set or confirmed yet (a company default that applies meanwhile doesn't count). Commissioning can't be signed while any remain. */
export function unconfirmedTargets(runsheet: InstallStep[]): TargetKey[] {
  return jobTargets(runsheet)
    .filter((t) => t.basis !== "tech-lead" && !t.def.defaultApplies)
    .map((t) => t.key);
}

/** Why these numbers can't be a window, or null. Both empty is fine ("record only", confirmed) where the target allows it. */
export function targetError(key: TargetKey, min: number | undefined, max: number | undefined): string | null {
  const def = JOB_TARGETS[key];
  if (!def) return "Unknown target.";
  for (const n of [min, max]) {
    if (n !== undefined && (!Number.isFinite(n) || n < 0)) return "Use positive numbers.";
  }
  if (min !== undefined && max !== undefined && min > max) return "The minimum is above the maximum.";
  if (def.bounds === "min" && max !== undefined) return `${def.label} takes a minimum only.`;
  if (def.bounds === "max" && min !== undefined) return `${def.label} takes a maximum only.`;
  if (key === "pressure.test" && min !== undefined && max === undefined) {
    return "Set the maximum too: the outdoor unit's nameplate PS.";
  }
  if (key === "pressure.test" && min === undefined && max !== undefined) return "Set the minimum too: the manual's test pressure.";
  if (def.recordOnly === false && min === undefined && max === undefined) {
    return key === "pressure.test" ? "Set the manual's test pressure and the nameplate PS." : `Set ${def.label.toLowerCase()} from the manual: it can't be record only.`;
  }
  if ((key === "pressure.hold" || key === "vacuum.hold") && min !== undefined && min <= 0) return "A hold time is more than 0 minutes.";
  if (key === "vacuum.target" && max !== undefined && max > VACUUM_STANDARD_MICRON) {
    return `500 micron always applies: a figure above it would change nothing. Use 500 micron, or the manual's if it's stricter.`;
  }
  return null;
}

/** One target's numbers and source onto every slot (and decay limit) that uses it. */
function applyTarget(runsheet: InstallStep[], key: TargetKey, bounds: { min?: number; max?: number }, window: WindowSource): InstallStep[] {
  const set = <T extends { targetKey?: TargetKey; min?: number; max?: number; window?: WindowSource }>(spec: T): T => {
    if (spec.targetKey !== key) return spec;
    const { min: _min, max: _max, ...rest } = spec;
    return {
      ...rest,
      ...(bounds.min !== undefined ? { min: bounds.min } : {}),
      ...(bounds.max !== undefined ? { max: bounds.max } : {}),
      window,
    } as T;
  };
  return runsheet.map((step) => ({
    ...step,
    evidence: step.evidence.map(set),
    ...(step.decay ? { decay: { ...step.decay, limit: set(step.decay.limit) } } : {}),
    ...(step.charge ? { charge: { ...step.charge, limit: set(step.charge.limit) } } : {}),
  }));
}

/**
 * Set (or confirm as record-only) one per-job target: every reading that
 * uses it gets the window and the tech lead's name. Existing readings are
 * re-judged against it, so a reading may become an exception, and a decay
 * test may fail (a change that would pass a failed one leaves it owing a
 * retest: decayRetestMarkers).
 */
export function setJobTarget(
  runsheet: InstallStep[],
  input: { key: TargetKey; min?: number; max?: number; note?: string },
  by: string,
  at: string,
): InstallStep[] {
  const error = targetError(input.key, input.min, input.max);
  if (error) throw new Error(error);
  const note = input.note?.trim();
  return applyTarget(
    runsheet,
    input.key,
    { ...(input.min !== undefined ? { min: input.min } : {}), ...(input.max !== undefined ? { max: input.max } : {}) },
    { basis: "tech-lead" as const, setBy: by, setAt: at, ...(note ? { note } : {}) },
  );
}

/* ---------------- decay tests ---------------- */

const PRESSURE_ROLES: Record<keyof PressureDecayReadings, EvidenceRole> = {
  appliedBarG: "strength-test",
  startC: "strength-start-temp",
  endBarG: "strength-hold",
  endC: "strength-end-temp",
  holdMinutes: "strength-hold-time",
  gaugeResolutionBar: "gauge-resolution",
};

const VACUUM_ROLES: Record<keyof VacuumDecayReadings, EvidenceRole> = {
  reachedMicron: "vacuum",
  holdMinutes: "vacuum-hold-time",
  afterMicron: "vacuum-decay",
};

/** The roles a decay test reads: their slots are judged by the test, never one by one. */
export const DECAY_ROLES: ReadonlySet<EvidenceRole> = new Set<EvidenceRole>([...Object.values(PRESSURE_ROLES), ...Object.values(VACUUM_ROLES)]);

export interface DecayTestView {
  kind: DecayStep["kind"];
  /** incomplete: readings still to take (or a reading that can't be right); fail stands until every reading is taken again. */
  result: "incomplete" | "pass" | "fail";
  /** A test failed and not every reading has been taken again since. */
  retestNeeded: boolean;
  /** How many complete runs of this test failed, this one included when it's failing. */
  failedRuns: number;
  /** Why it fails (or, while incomplete, what already can't pass). */
  fails: string[];
  /** Readings that can't be right, in plain words: they don't count until taken again. */
  invalid: string[];
  /** Slot ids still to capture, or to capture again for the retest. */
  toTake: string[];
  /** The job's targets for this test the tech lead hasn't set or confirmed yet: judged so far without them. */
  pending: TargetKey[];
  pressure?: PressureDecayFigures;
  vacuum?: VacuumDecayFigures;
}

type AnyJudgement = DecayJudgement<PressureDecayFigures> | DecayJudgement<VacuumDecayFigures>;

/** The test's slots by reading, its targets as the job has them, and its judge. */
function decayParts(step: InstallStep) {
  const kind = step.decay!.kind;
  const roles: Record<string, EvidenceRole> = kind === "pressure" ? PRESSURE_ROLES : VACUUM_ROLES;
  const slots = Object.entries(roles).map(([field, role]) => ({ field, role, spec: step.evidence.find((e) => e.role === role) }));
  const by = (role: EvidenceRole) => step.evidence.find((e) => e.role === role);
  const limit = step.decay!.limit;
  const pTargets: PressureDecayTargets = {
    ...(by("strength-test")?.min !== undefined ? { testMinBarG: by("strength-test")!.min } : {}),
    ...(by("strength-test")?.max !== undefined ? { testMaxBarG: by("strength-test")!.max } : {}),
    ...(by("strength-hold-time")?.min !== undefined ? { holdMinMinutes: by("strength-hold-time")!.min } : {}),
    ...(limit.max !== undefined ? { allowanceBar: limit.max } : {}),
  };
  const vTargets: VacuumDecayTargets = {
    ...(by("vacuum")?.max !== undefined ? { targetMaxMicron: by("vacuum")!.max } : {}),
    ...(by("vacuum-hold-time")?.min !== undefined ? { holdMinMinutes: by("vacuum-hold-time")!.min } : {}),
    ...(limit.max !== undefined ? { riseMaxMicron: limit.max } : {}),
    ...(by("vacuum-decay")?.max !== undefined ? { afterMaxMicron: by("vacuum-decay")!.max } : {}),
  };
  const judge = (values: Record<string, number>): AnyJudgement => (kind === "pressure" ? judgePressureDecay(values, pTargets) : judgeVacuumDecay(values, vTargets));
  const pending = [...new Set(targetHolders(step).filter((h) => h.targetKey && h.window?.basis !== "tech-lead").map((h) => h.targetKey!))];
  return { kind, slots, judge, pending };
}

/**
 * The step's decay test, from the evidence log in the order it arrived (the
 * order latestEvidence uses), as a series of runs. A run is one reading of
 * every slot taken after the previous run closed; it closes, and is judged
 * with the job's targets as they stand now, once every reading is in and
 * believable. Readings are never mixed across runs, so re-typing one reading
 * after a run starts a new run: a failed test stays failed until every
 * reading has been taken again and that run passes. Null for a step that
 * isn't a decay test.
 */
export function decayTest(job: Pick<InstallJob, "evidence">, step: InstallStep): DecayTestView | null {
  if (!step.decay) return null;
  const { kind, slots, judge, pending } = decayParts(step);
  const fieldOf = new Map(slots.filter((x) => x.spec).map((x) => [x.spec!.id, x.field]));
  const markerIndex = step.decay.retestAfter ? job.evidence.findIndex((e) => e.id === step.decay!.retestAfter!.evidenceId) : -1;
  // Readings of the run under way: those taken since the last run closed.
  let open = new Map<string, number>();
  const runs: { index: number; fails: string[]; figures: AnyJudgement["figures"] }[] = [];
  for (let i = 0; i < job.evidence.length; i++) {
    const e = job.evidence[i]!;
    const field = fieldOf.get(e.specId);
    if (!field) continue;
    if (typeof e.value === "number" && Number.isFinite(e.value)) open.set(field, e.value);
    else open.delete(field);
    if (open.size < slots.length) continue;
    const j = judge(Object.fromEntries(open));
    if (!j.complete) continue; // a reading that can't be right: the run waits for it to be taken again
    runs.push({ index: i, fails: j.fails, figures: j.figures });
    open = new Map();
  }
  // A target change that would have passed a failed run: that run stays failed.
  const marked = markerIndex >= 0 ? runs.filter((r) => r.index <= markerIndex).at(-1) : undefined;
  if (marked && !marked.fails.length) marked.fails = step.decay.retestAfter!.reasons;
  const failedRuns = runs.filter((r) => r.fails.length).length;
  const lastRun = runs.at(-1);
  const last = lastRun ? { ...lastRun, failed: lastRun.fails.length > 0 } : undefined;
  const current = judge(Object.fromEntries(open));
  const figuresOf = (f: AnyJudgement["figures"]) => (kind === "pressure" ? { pressure: f as PressureDecayFigures } : { vacuum: f as VacuumDecayFigures });
  const toTake = slots.filter((x) => !x.spec || current.missing.includes(x.field)).map((x) => x.spec?.id ?? x.role);
  const runUnderWay = open.size > 0;
  if (last && !runUnderWay) {
    return {
      kind,
      result: last.failed ? "fail" : "pass",
      retestNeeded: last.failed,
      failedRuns,
      fails: last.fails,
      invalid: [],
      toTake: last.failed ? slots.filter((x) => x.spec).map((x) => x.spec!.id) : [],
      pending,
      ...figuresOf(last.figures),
    };
  }
  if (last?.failed) {
    // The retest is under way: the failure stands until it's complete and passes.
    return { kind, result: "fail", retestNeeded: true, failedRuns, fails: last.fails, invalid: current.invalid, toTake, pending, ...figuresOf(last.figures) };
  }
  return { kind, result: "incomplete", retestNeeded: false, failedRuns, fails: current.fails, invalid: current.invalid, toTake, pending, ...figuresOf(current.figures) };
}

/**
 * The retests a target change leaves owing: each decay test on the job that
 * fails now and wouldn't with the new runsheet's targets keeps its failed
 * run (marked at its last reading), so the change can't pass it without a
 * retest. Empty when nothing would be cleared.
 */
export function decayRetestMarkers(job: Pick<InstallJob, "evidence" | "runsheet">, next: InstallStep[]): { stepId: string; evidenceId: string; reasons: string[] }[] {
  const out: { stepId: string; evidenceId: string; reasons: string[] }[] = [];
  for (const step of job.runsheet) {
    if (!step.decay) continue;
    const before = decayTest(job, step);
    const after = next.find((s) => s.id === step.id);
    if (before?.result !== "fail" || !after?.decay) continue;
    const now = decayTest(job, after);
    if (now?.result === "fail") continue;
    const ids = new Set(step.evidence.filter((e) => e.role && DECAY_ROLES.has(e.role)).map((e) => e.id));
    const last = [...job.evidence].reverse().find((e) => ids.has(e.specId) && e.id);
    if (!last?.id) continue;
    out.push({ stepId: step.id, evidenceId: last.id, reasons: before.fails.length ? before.fails : ["The test failed against the targets when it was taken."] });
  }
  return out;
}

/** Lay retest markers onto a runsheet (the server's answer to a target change, applied the same way on the phone). */
export function withRetestMarkers(runsheet: InstallStep[], markers: { stepId: string; evidenceId: string; reasons: string[] }[]): InstallStep[] {
  if (!markers.length) return runsheet;
  return runsheet.map((step) => {
    const m = markers.find((x) => x.stepId === step.id);
    return m && step.decay ? { ...step, decay: { ...step.decay, retestAfter: { evidenceId: m.evidenceId, reasons: m.reasons } } } : step;
  });
}

/* ---------------- the charge against the as-built length ---------------- */

export interface ChargeCheckView {
  /** incomplete: the length or the weighed figure isn't in yet. */
  result: "incomplete" | "within" | "outside";
  lengthM?: number;
  expectedG?: number;
  weighedG?: number;
  toleranceG?: number;
  /** Weighed minus expected, g. */
  differenceG?: number;
  /** The job's tolerance set by the tech lead, or the company default. */
  toleranceBasis: "job" | "default";
  /** The weighed-charge slot this check judges. */
  addedSpecId?: string;
  /** When the as-built length it was judged against was captured. */
  lengthAt?: string;
  /** The check in words, the same on every surface. */
  words: string;
}

/** A captured number on a slot (latest wins), with when it was taken. */
function capturedNumber(job: Pick<InstallJob, "evidence">, spec: EvidenceSpec | undefined): { value: number; at: string } | undefined {
  if (!spec) return undefined;
  const r = latestEvidence(job, spec.id);
  return r && typeof r.value === "number" && Number.isFinite(r.value) ? { value: r.value, at: r.at } : undefined;
}

/**
 * The charge step's weighed figure against what the as-built length needs:
 * max(0, length − pre-charged length) × g/m (the catalogue's figures on the
 * step), with the job's tolerance (the tech lead's ± g, else 10 % or 50 g,
 * whichever is larger). Null for a step without the check (no charge rate
 * in the catalogue, or a runsheet from before it).
 */
export function chargeCheck(job: Pick<InstallJob, "evidence">, step: InstallStep): ChargeCheckView | null {
  const c = step.charge;
  if (!c) return null;
  const lengthSpec = step.evidence.find((e) => e.role === "as-built-length");
  const addedSpec = step.evidence.find((e) => e.role === "additional-charge");
  const length = capturedNumber(job, lengthSpec);
  const weighed = capturedNumber(job, addedSpec);
  const basis: ChargeCheckView["toleranceBasis"] = c.limit.window?.basis === "tech-lead" && c.limit.max !== undefined ? "job" : "default";
  const base = { toleranceBasis: basis, ...(addedSpec ? { addedSpecId: addedSpec.id } : {}) };
  if (!length || length.value < 0) {
    return { ...base, result: "incomplete", ...(weighed ? { weighedG: weighed.value } : {}), words: "Type the as-built length: the charge it needs is worked out from it." };
  }
  const expectedG = expectedAdditionalChargeG(length.value, c.prechargedM, c.gPerM);
  const toleranceG = chargeToleranceG(expectedG, basis === "job" ? c.limit.max : undefined);
  const tol = `± ${toleranceG} g${basis === "job" ? ", the job's tolerance" : ""}`;
  const working = `max(0, ${length.value} m − ${c.prechargedM} m pre-charged) × ${c.gPerM} g/m = ${expectedG} g`;
  const known = { ...base, lengthM: length.value, lengthAt: length.at, expectedG, toleranceG };
  if (!weighed) {
    return { ...known, result: "incomplete", words: `Expected from the as-built length: ${expectedG} g (${working}). Weigh in ${expectedG} g (${tol}).` };
  }
  const differenceG = Math.round((weighed.value - expectedG) * 10) / 10;
  const outside = Math.abs(differenceG) > toleranceG;
  const off = differenceG === 0 ? "exactly that" : `${Math.abs(differenceG)} g ${differenceG > 0 ? "more" : "less"}`;
  return {
    ...known,
    weighedG: weighed.value,
    differenceG,
    result: outside ? "outside" : "within",
    words: outside
      ? `Weighed ${weighed.value} g, ${off} than the ${expectedG} g the as-built length needs (${working}): outside ${tol}. The tech lead signs it off with a reason, or asks for it again.`
      : `Weighed ${weighed.value} g against ${expectedG} g expected from the as-built length (${working}): ${differenceG === 0 ? "exactly that" : off}, within ${tol}.`,
  };
}

/* ---------------- commissioning ---------------- */

/** A step's latest captured value for a role, if any. */
function valueFor(job: InstallJobV2, step: InstallStep, role: EvidenceRole): EvidenceRecord | undefined {
  const spec = step.evidence.find((e) => e.role === role);
  if (!spec) return undefined;
  const view = slotView(job, spec);
  return view.state === "missing" ? undefined : view.record;
}

const num = (r: EvidenceRecord | undefined) => (typeof r?.value === "number" && Number.isFinite(r.value) ? r.value : undefined);

/** System id → its label ("System", "System 2: Duo 50 outdoor unit"), in runsheet order. */
function systemsOf(runsheet: InstallStep[]): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  for (const s of runsheet) {
    if (!s.systemId || s.roomId || out.some((x) => x.id === s.systemId)) continue;
    const label = (s.item ?? "System").replace(/:.*$/, "");
    out.push({ id: s.systemId, label });
  }
  return out;
}

/** The demo runsheet (no roles): results by label, grouped by step item. */
function legacyCommissioning(job: InstallJobV2): CommissioningResult[] {
  const bySystem = new Map<string, CommissioningResult>();
  const result = (system: string) => {
    let r = bySystem.get(system);
    if (!r) {
      r = { system, coolingSplitC: {}, heatingSplitC: {}, serials: [] };
      bySystem.set(system, r);
    }
    return r;
  };
  const first = () => [...bySystem.keys()][0] ?? "System";
  for (const step of job.runsheet) {
    for (const spec of step.evidence) {
      const record = latestEvidence(job, spec.id);
      if (!record) continue;
      const v = num(record);
      if (step.phase === 8) {
        const r = result(step.item ?? "System");
        if (/applied/i.test(spec.label) && v !== undefined) r.strengthTestBar = v;
        else if (/after/i.test(spec.label) && v !== undefined) r.holdBar = v;
      } else if (step.phase === 9) {
        const r = result(step.item ?? "System");
        if (/decay/i.test(spec.label) && v !== undefined) r.decayMicrons = v;
        else if (v !== undefined) r.vacuumMicrons = v;
      } else if (step.phase === 10) {
        if (/noise/i.test(spec.label) && v !== undefined) result(step.item ?? first()).noiseDb = v;
        if (/split, cooling/i.test(spec.label) && v !== undefined) result(first()).coolingSplitC[step.item ?? "Room"] = v;
        if (spec.kind === "qr-scan" && record.ref) result(first()).serials.push({ item: step.item ?? "Indoor unit", serial: record.ref });
      } else if (step.phase === 11 && /outdoor serial/i.test(spec.label) && record.ref) {
        result(first()).serials.unshift({ item: "Outdoor unit", serial: record.ref });
      }
    }
  }
  return [...bySystem.values()];
}

/**
 * Commissioning results per system, derived from the evidence (latest
 * capture per slot): pressures, vacuum, the charge added, temperature
 * splits in cooling and heating per room, the optional noise reading, and
 * the serials from the kit check.
 */
export function commissioningFromJob(job: InstallJobV2): CommissioningResult[] {
  const systems = systemsOf(job.runsheet);
  if (systems.length === 0) return legacyCommissioning(job);
  return systems.map(({ id, label }) => {
    const steps = job.runsheet.filter((s) => s.systemId === id);
    const pick = (role: EvidenceRole) => {
      for (const s of steps) {
        const r = valueFor(job, s, role);
        if (r) return r;
      }
      return undefined;
    };
    const res: CommissioningResult = { system: label, coolingSplitC: {}, heatingSplitC: {}, serials: [] };
    const set = (key: "strengthTestBar" | "holdBar" | "vacuumMicrons" | "decayMicrons" | "additionalChargeG" | "noiseDb", role: EvidenceRole) => {
      const v = num(pick(role));
      if (v !== undefined) res[key] = v;
    };
    set("strengthTestBar", "strength-test");
    set("holdBar", "strength-hold");
    set("vacuumMicrons", "vacuum");
    set("decayMicrons", "vacuum-decay");
    set("additionalChargeG", "additional-charge");
    set("noiseDb", "noise-measured");
    for (const s of steps) {
      const c = chargeCheck(job, s);
      if (c?.expectedG !== undefined) res.expectedChargeG = c.expectedG;
      if (c?.toleranceG !== undefined) res.chargeToleranceG = c.toleranceG;
    }
    for (const s of steps) {
      const t = decayTest(job, s);
      if (!t) continue;
      const rec = { result: t.result, fails: t.fails, failedRuns: t.failedRuns };
      // The headline readings are the judged run's, never a mix of two runs.
      if (t.kind === "pressure" && t.pressure) {
        res.pressureTest = { ...rec, figures: t.pressure };
        if (t.pressure.appliedBarG !== undefined) res.strengthTestBar = t.pressure.appliedBarG;
        if (t.pressure.endBarG !== undefined) res.holdBar = t.pressure.endBarG;
      }
      if (t.kind === "vacuum" && t.vacuum) {
        res.vacuumTest = { ...rec, figures: t.vacuum };
        if (t.vacuum.reachedMicron !== undefined) res.vacuumMicrons = t.vacuum.reachedMicron;
        if (t.vacuum.afterMicron !== undefined) res.decayMicrons = t.vacuum.afterMicron;
      }
    }
    for (const s of steps) {
      const room = s.item ?? "Room";
      const cool = num(valueFor(job, s, "cooling-split"));
      const heat = num(valueFor(job, s, "heating-split"));
      if (cool !== undefined) res.coolingSplitC[room] = cool;
      if (heat !== undefined) res.heatingSplitC[room] = heat;
    }
    // Outdoor unit first, then the rooms it serves.
    const kit = steps.filter((s) => s.equipment).sort((a, b) => (a.equipment!.kind === "outdoor" ? -1 : 0) - (b.equipment!.kind === "outdoor" ? -1 : 0));
    for (const s of kit) {
      const serial = valueFor(job, s, s.equipment!.kind === "outdoor" ? "serial-outdoor" : "serial-indoor")?.ref?.trim();
      if (serial) res.serials.push({ item: `${s.equipment!.room}: ${s.equipment!.label}`, serial });
    }
    return res;
  });
}

/** The units on the job with the serials captured at the kit check ("" while not captured). */
export function equipmentFromJob(job: InstallJobV2): InstalledEquipmentRow[] {
  return job.runsheet
    .filter((s) => s.equipment)
    .sort((a, b) => (a.equipment!.kind === b.equipment!.kind ? 0 : a.equipment!.kind === "indoor" ? -1 : 1))
    .map((s) => {
      const role: EvidenceRole = s.equipment!.kind === "outdoor" ? "serial-outdoor" : "serial-indoor";
      return {
        room: s.equipment!.room,
        label: s.equipment!.label,
        model: s.equipment!.model,
        serial: valueFor(job, s, role)?.ref?.trim() ?? "",
      };
    });
}

/** The F-gas label per system from the charge step: factory + added, total kg and tCO2e. Null fields while not captured. */
export function fgasFromJob(job: InstallJobV2): { system: string; record: FgasRecord | null; asBuiltLengthM?: number }[] {
  return systemsOf(job.runsheet).map(({ id, label }) => {
    const step = job.runsheet.find((s) => s.systemId === id && s.evidence.some((e) => e.role === "factory-charge"));
    const factory = step ? num(valueFor(job, step, "factory-charge")) : undefined;
    const added = step ? num(valueFor(job, step, "additional-charge")) : undefined;
    const length = step ? num(valueFor(job, step, "as-built-length")) : undefined;
    return {
      system: label,
      record: factory !== undefined && added !== undefined ? fgasRecord({ system: label, factoryChargeKg: factory, additionalChargeG: added }) : null,
      ...(length !== undefined ? { asBuiltLengthM: length } : {}),
    };
  });
}

/** The electrician's references from the certificate step, if captured. */
export function electricalRefsFromJob(job: InstallJobV2): { eic?: string; scheme?: string } {
  const out: { eic?: string; scheme?: string } = {};
  for (const step of job.runsheet) {
    const eic = valueFor(job, step, "eic-ref")?.ref?.trim();
    const scheme = valueFor(job, step, "scheme-ref")?.ref?.trim();
    if (eic) out.eic = eic;
    if (scheme) out.scheme = scheme;
  }
  return out;
}

/** What stops this person signing commissioning now. Empty: they may sign. */
export function commissioningSignErrors(job: InstallJobV2, signer: StaffMember, onIso: string): string[] {
  const errors: string[] = [];
  if (job.commissioning) errors.push("Commissioning is already signed.");
  if (!can(signer, "commissioning.sign")) errors.push("You don't have permission to sign commissioning.");
  if (!meetsRequirement(signer, "tech-lead", onIso)) errors.push("Commissioning is signed by the tech lead with a current F-gas certificate.");
  const progress = runsheetProgress(job);
  if (progress.openExceptions > 0) {
    errors.push(`${progress.openExceptions} reading${progress.openExceptions === 1 ? "" : "s"} outside the window still to review.`);
  }
  if (progress.blocked > 0) errors.push(`${progress.blocked} step${progress.blocked === 1 ? " is" : "s are"} blocked.`);
  if (progress.missing > 0) errors.push(`${progress.missing} step${progress.missing === 1 ? "" : "s"} still to finish on the runsheet.`);
  for (const step of job.runsheet) {
    const t = decayTest(job, step);
    if (t?.result !== "fail") continue;
    const what = t.kind === "pressure" ? "strength and tightness test" : "vacuum decay test";
    errors.push(`${step.item ? `${step.item}: the` : "The"} ${what} failed and hasn't been done again (${t.fails[0] ?? "see the runsheet"}). Find and fix the cause, then the crew retests with every reading taken again.`);
  }
  const pending = unconfirmedTargets(job.runsheet);
  if (pending.length) errors.push(`Set or confirm ${pending.length} of the job's targets: ${pending.map((k) => JOB_TARGETS[k].label.toLowerCase()).join("; ")}.`);
  return errors;
}

/** The record the tech lead signs: who, when, their F-gas reference, and the derived results. */
export function buildCommissioningRecord(job: InstallJobV2, signer: StaffMember, now: string, notes?: string, hsFileNote?: string): CommissioningRecord {
  const on = now.slice(0, 10);
  const cert = signer.qualifications.find((q) => q.kind === "fgas-cat1" && qualificationStatus(q, on) === "current");
  const clean = notes?.trim();
  const hs = hsFileNote?.trim();
  return {
    signedBy: { staffId: signer.id, name: signer.name, qualificationRef: cert?.reference.trim() ?? "" },
    at: now,
    results: commissioningFromJob(job),
    ...(clean ? { notes: clean } : {}),
    ...(hs ? { hsFileNote: hs } : {}),
  };
}

/** The circuit step's isolator, as the runsheet names it, per system ("System: 20 A rotary isolator fitted by the outdoor unit"). */
export function isolatorsFromJob(job: Pick<InstallJob, "runsheet">): string[] {
  const out: string[] = [];
  for (const s of job.runsheet) {
    const spec = s.evidence.find((e) => e.id.endsWith(".isolator") && e.kind === "photo" && e.role !== "walkthrough" && /isolator/i.test(e.label));
    if (spec) out.push(`${(s.item ?? "System").replace(/:.*$/, "")}: ${spec.label.replace(/^(.)/, (c) => c.toUpperCase())}.`);
  }
  return out;
}

/** Each room's as-built run (one way, m) from its Pipework step, by room id. */
export function asBuiltRunsFromJob(job: Pick<InstallJobV2, "runsheet" | "evidence" | "exceptionReviews">): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of job.runsheet) {
    const spec = s.evidence.find((e) => e.role === "as-built-run");
    if (!spec || !s.roomId) continue;
    const r = latestEvidence(job, spec.id);
    if (typeof r?.value === "number" && Number.isFinite(r.value)) out.set(s.roomId, r.value);
  }
  return out;
}

/* ---------------- a short summary for cards ---------------- */

/** Finished steps over all steps, as a whole percentage. */
export function runsheetPercent(job: InstallJobV2): number {
  const p = runsheetProgress(job);
  const done = p.byDay.reduce((n, d) => n + d.done, 0);
  const total = p.byDay.reduce((n, d) => n + d.total, 0);
  return total ? Math.round((done / total) * 100) : 0;
}

/** The RAMS acknowledgements: everyone who ticked the RAMS slot, once each, earliest first. */
export function ramsAcknowledgements(job: InstallJobV2): { by: string; byStaffId?: string; at: string }[] {
  const specIds = new Set(job.runsheet.flatMap((s) => s.evidence.filter((e) => e.role === "rams").map((e) => e.id)));
  const seen = new Set<string>();
  const out: { by: string; byStaffId?: string; at: string }[] = [];
  for (const e of [...job.evidence].sort((a, b) => timeOf(a.at) - timeOf(b.at))) {
    if (!specIds.has(e.specId)) continue;
    const who = e.byStaffId ?? e.by;
    if (seen.has(who)) continue;
    seen.add(who);
    out.push({ by: e.by, ...(e.byStaffId ? { byStaffId: e.byStaffId } : {}), at: e.at });
  }
  return out;
}

/** GWP used on the label, exported for screens that show the sum. */
export const FGAS_GWP = RUNSHEET_GWP;
