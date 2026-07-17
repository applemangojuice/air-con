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
  | "signature";

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
}

export interface InstallStep {
  id: string;
  phase: number;
  title: string;
  /** What this step instance covers: a room, a system, a penetration. */
  item?: string;
  evidence: EvidenceSpec[];
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
export function latestEvidence(job: InstallJob, specId: string): EvidenceRecord | undefined {
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
