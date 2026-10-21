/**
 * Strength/tightness and vacuum decay tests, judged from the readings.
 *
 * The nitrogen test: oxygen-free nitrogen at the test pressure from the
 * unit's installation manual (never above the outdoor unit's nameplate
 * maximum allowable pressure PS), held for the manual's time, with the
 * pressure and the ambient temperature read at the start and at the end.
 * Nitrogen in a closed system follows Gay-Lussac's law in absolute units, so
 * the end reading is corrected to the start temperature:
 *
 *   P_end,corrected (abs) = P_end (abs) × T_start (K) / T_end (K)
 *
 * and the test fails if the pressure fell by more than the allowance: by
 * default nothing beyond the gauge's resolution (the smallest step it reads),
 * or the manual's figure where the technical lead has set one.
 *
 * The vacuum: evacuate to the target (500 micron, 66.7 Pa, or the manual's
 * figure if that's stricter), isolate the pump, hold for the stated time, and
 * read again. A rise above the stated limit is a fail: moisture or a leak.
 *
 * Sources (docs/research/commissioning-standards.md and §K47): Daikin R32
 * split installer guides, read through search-engine extracts only (at least
 * 2 bar, 30 bar recommended to find small leaks; evacuate to −0.1 MPa, hold
 * at least an hour with the pump off, and redo it if it doesn't hold);
 * REFCOM's OFN pressure-testing bulletin (temperature changes during the
 * hold, absolute pressure and kelvin), seen only through secondary
 * summaries. None of the manufacturers' test pressures, hold times or rise
 * limits was verified, so the technical lead sets them per job; the only
 * numbers applied without them are the 500 micron company standard and the
 * gauge-resolution allowance, both stricter than anything they replace.
 *
 * Pure numbers in, plain words out; install.ts maps a runsheet step's
 * readings onto these.
 */

/** Standard atmosphere, bar: gauge + this = absolute. The day's barometric pressure moves it by about ±0.03 bar. */
export const ATMOSPHERE_BAR = 1.01325;
/** °C + this = kelvin. */
export const KELVIN = 273.15;
/** The company's vacuum standard, micron (1 micron = 1 mTorr = 0.1333 Pa, so 500 micron = 66.7 Pa). A manual's stricter figure wins. */
export const VACUUM_STANDARD_MICRON = 500;
export const PA_PER_MICRON = 0.133322;

/** Readings the app takes as typed slips, not measurements: they don't count until they're taken again. */
export const AMBIENT_RANGE_C = { min: -30, max: 60 } as const;

const EPS = 1e-6;
const round = (n: number, dp = 3) => Math.round(n * 10 ** dp) / 10 ** dp;
const fmt = (n: number, dp = 2) => String(round(n, dp));

/** The end reading corrected to the start temperature, bar g (absolute pressure scaled by the kelvin ratio). */
export function correctedEndBarG(endBarG: number, startC: number, endC: number, atmosphereBar = ATMOSPHERE_BAR): number {
  return (endBarG + atmosphereBar) * ((startC + KELVIN) / (endC + KELVIN)) - atmosphereBar;
}

export interface PressureDecayReadings {
  appliedBarG?: number;
  startC?: number;
  endBarG?: number;
  endC?: number;
  holdMinutes?: number;
  gaugeResolutionBar?: number;
}

export interface PressureDecayTargets {
  /** The manual's test pressure (floor) and the nameplate PS (ceiling), as the technical lead set them. */
  testMinBarG?: number;
  testMaxBarG?: number;
  /** The manual's hold time. */
  holdMinMinutes?: number;
  /** The manual's allowed fall, when the technical lead has set one; otherwise the gauge's resolution. */
  allowanceBar?: number;
}

export interface PressureDecayFigures extends PressureDecayReadings {
  atmosphereBar: number;
  endCorrectedBarG?: number;
  /** Start minus corrected end: positive is a fall, negative a rise. */
  fallBar?: number;
  allowanceBar?: number;
  allowanceFrom?: "gauge-resolution" | "tech-lead";
  testMinBarG?: number;
  testMaxBarG?: number;
  holdMinMinutes?: number;
}

export interface DecayJudgement<F> {
  figures: F;
  /** Every reading is in and believable. */
  complete: boolean;
  /** Which readings are missing, or need taking again because they can't be right (keys of the readings). */
  missing: string[];
  /** Why a reading can't be right, in plain words. */
  invalid: string[];
  /** Why the test fails, in plain words. Empty: it passes (or, while incomplete, nothing has failed yet). */
  fails: string[];
}

const PRESSURE_KEYS: (keyof PressureDecayReadings)[] = ["appliedBarG", "startC", "endBarG", "endC", "holdMinutes", "gaugeResolutionBar"];

const finite = (n: number | undefined): n is number => typeof n === "number" && Number.isFinite(n);

/** Judge a strength/tightness test from its readings and the job's targets. */
export function judgePressureDecay(r: PressureDecayReadings, t: PressureDecayTargets): DecayJudgement<PressureDecayFigures> {
  const missing: string[] = [];
  const invalid: string[] = [];
  const fails: string[] = [];
  for (const k of PRESSURE_KEYS) if (!finite(r[k])) missing.push(k);
  const bad = (key: keyof PressureDecayReadings, why: string) => {
    if (!missing.includes(key)) missing.push(key);
    invalid.push(why);
  };
  if (finite(r.appliedBarG) && r.appliedBarG <= 0) bad("appliedBarG", "The test pressure must be above 0 bar g.");
  if (finite(r.endBarG) && r.endBarG < 0) bad("endBarG", "The end pressure can't be below 0 bar g on a nitrogen test.");
  for (const key of ["startC", "endC"] as const) {
    const c = r[key];
    if (finite(c) && (c < AMBIENT_RANGE_C.min || c > AMBIENT_RANGE_C.max)) {
      bad(key, `${fmt(c, 1)} °C isn't an ambient temperature: check the thermometer and type it again.`);
    }
  }
  if (finite(r.holdMinutes) && r.holdMinutes <= 0) bad("holdMinutes", "The hold time must be more than 0 minutes.");
  if (finite(r.gaugeResolutionBar) && r.gaugeResolutionBar <= 0) bad("gaugeResolutionBar", "The gauge's resolution is the smallest step it reads: more than 0 bar.");
  if (finite(r.gaugeResolutionBar) && finite(r.appliedBarG) && r.gaugeResolutionBar >= r.appliedBarG) {
    bad("gaugeResolutionBar", "The gauge's resolution can't be as big as the test pressure: check it.");
  }

  const allowanceFrom: PressureDecayFigures["allowanceFrom"] = finite(t.allowanceBar) ? "tech-lead" : finite(r.gaugeResolutionBar) && r.gaugeResolutionBar > 0 ? "gauge-resolution" : undefined;
  const allowanceBar = allowanceFrom === "tech-lead" ? t.allowanceBar : allowanceFrom === "gauge-resolution" ? r.gaugeResolutionBar : undefined;
  const figures: PressureDecayFigures = {
    ...r,
    atmosphereBar: ATMOSPHERE_BAR,
    ...(finite(t.testMinBarG) ? { testMinBarG: t.testMinBarG } : {}),
    ...(finite(t.testMaxBarG) ? { testMaxBarG: t.testMaxBarG } : {}),
    ...(finite(t.holdMinMinutes) ? { holdMinMinutes: t.holdMinMinutes } : {}),
    ...(allowanceBar !== undefined ? { allowanceBar, allowanceFrom } : {}),
  };

  // What can be said with what's in.
  if (finite(r.appliedBarG) && r.appliedBarG > 0) {
    if (finite(t.testMaxBarG) && r.appliedBarG > t.testMaxBarG + EPS) {
      fails.push(`Tested at ${fmt(r.appliedBarG)} bar g, above the ${fmt(t.testMaxBarG)} bar g maximum (the nameplate PS): let it down, tell the tech lead, and test again at the manual's pressure.`);
    }
    if (finite(t.testMinBarG) && r.appliedBarG < t.testMinBarG - EPS) {
      fails.push(`Tested at ${fmt(r.appliedBarG)} bar g, below the manual's ${fmt(t.testMinBarG)} bar g: test again at the manual's pressure.`);
    }
  }
  if (finite(r.holdMinutes) && r.holdMinutes > 0 && finite(t.holdMinMinutes) && r.holdMinutes < t.holdMinMinutes - EPS) {
    fails.push(`Held ${fmt(r.holdMinutes, 1)} min; the manual says at least ${fmt(t.holdMinMinutes, 1)} min: test again and hold it for the full time.`);
  }
  const usable = (k: keyof PressureDecayReadings) => finite(r[k]) && !missing.includes(k);
  if (usable("appliedBarG") && usable("endBarG") && usable("startC") && usable("endC")) {
    const corrected = correctedEndBarG(r.endBarG!, r.startC!, r.endC!);
    const fall = r.appliedBarG! - corrected;
    figures.endCorrectedBarG = round(corrected, 3);
    figures.fallBar = round(fall, 3);
    if (allowanceBar !== undefined && (usable("gaugeResolutionBar") || allowanceFrom === "tech-lead") && fall > allowanceBar + EPS) {
      const basis = allowanceFrom === "tech-lead" ? "the manual's allowance" : "the gauge's resolution";
      fails.push(
        `Fell ${fmt(fall)} bar once corrected to the start temperature (${fmt(r.endBarG!)} bar g at ${fmt(r.endC!, 1)} °C is ${fmt(corrected)} bar g at ${fmt(r.startC!, 1)} °C), more than the ${fmt(allowanceBar)} bar allowed (${basis}): find and fix the leak, then test again.`,
      );
    }
  }
  return { figures, complete: missing.length === 0, missing, invalid, fails };
}

export interface VacuumDecayReadings {
  reachedMicron?: number;
  holdMinutes?: number;
  afterMicron?: number;
}

export interface VacuumDecayTargets {
  /** The manual's target, as the technical lead set it. The stricter of it and the 500 micron standard applies. */
  targetMaxMicron?: number;
  holdMinMinutes?: number;
  /** The most it may rise over the hold. */
  riseMaxMicron?: number;
  /** The highest reading allowed after the hold, where the manual gives one. */
  afterMaxMicron?: number;
}

export interface VacuumDecayFigures extends VacuumDecayReadings {
  targetMicron: number;
  targetFrom: "company-standard" | "tech-lead";
  riseMicron?: number;
  riseMaxMicron?: number;
  holdMinMinutes?: number;
  afterMaxMicron?: number;
}

const VACUUM_KEYS: (keyof VacuumDecayReadings)[] = ["reachedMicron", "holdMinutes", "afterMicron"];

/** The vacuum target that applies: the 500 micron standard, or the manual's if that's stricter. */
export function vacuumTargetMicron(techLeadMax: number | undefined): { micron: number; from: VacuumDecayFigures["targetFrom"] } {
  return finite(techLeadMax) && techLeadMax < VACUUM_STANDARD_MICRON ? { micron: techLeadMax, from: "tech-lead" } : { micron: VACUUM_STANDARD_MICRON, from: "company-standard" };
}

/** Judge an evacuation and its decay test from the readings and the job's targets. */
export function judgeVacuumDecay(r: VacuumDecayReadings, t: VacuumDecayTargets): DecayJudgement<VacuumDecayFigures> {
  const missing: string[] = [];
  const invalid: string[] = [];
  const fails: string[] = [];
  for (const k of VACUUM_KEYS) if (!finite(r[k])) missing.push(k);
  const bad = (key: keyof VacuumDecayReadings, why: string) => {
    if (!missing.includes(key)) missing.push(key);
    invalid.push(why);
  };
  for (const key of ["reachedMicron", "afterMicron"] as const) {
    const v = r[key];
    if (finite(v) && v < 0) bad(key, "A micron reading can't be below 0.");
  }
  if (finite(r.holdMinutes) && r.holdMinutes <= 0) bad("holdMinutes", "The decay hold must be more than 0 minutes.");
  const target = vacuumTargetMicron(t.targetMaxMicron);
  const figures: VacuumDecayFigures = {
    ...r,
    targetMicron: target.micron,
    targetFrom: target.from,
    ...(finite(t.riseMaxMicron) ? { riseMaxMicron: t.riseMaxMicron } : {}),
    ...(finite(t.holdMinMinutes) ? { holdMinMinutes: t.holdMinMinutes } : {}),
    ...(finite(t.afterMaxMicron) ? { afterMaxMicron: t.afterMaxMicron } : {}),
  };
  const usable = (k: keyof VacuumDecayReadings) => finite(r[k]) && !missing.includes(k);
  if (usable("reachedMicron") && r.reachedMicron! > target.micron + EPS) {
    fails.push(
      `Reached ${fmt(r.reachedMicron!, 0)} micron, above the ${fmt(target.micron, 0)} micron target (${target.from === "tech-lead" ? "the manual's" : "the company standard, 66.7 Pa"}): keep evacuating, then do the decay test again.`,
    );
  }
  if (usable("holdMinutes") && finite(t.holdMinMinutes) && r.holdMinutes! < t.holdMinMinutes - EPS) {
    fails.push(`Held ${fmt(r.holdMinutes!, 1)} min with the pump isolated; the manual says ${fmt(t.holdMinMinutes, 1)} min: do the decay test again for the full time.`);
  }
  if (usable("reachedMicron") && usable("afterMicron")) {
    const rise = r.afterMicron! - r.reachedMicron!;
    figures.riseMicron = round(rise, 1);
    if (finite(t.riseMaxMicron) && rise > t.riseMaxMicron + EPS) {
      fails.push(
        `Rose ${fmt(rise, 0)} micron over the hold, more than the ${fmt(t.riseMaxMicron, 0)} micron allowed: moisture or a leak. Find it, evacuate again and repeat the decay test.`,
      );
    }
    if (finite(t.afterMaxMicron) && r.afterMicron! > t.afterMaxMicron + EPS) {
      fails.push(`Read ${fmt(r.afterMicron!, 0)} micron after the hold, above the ${fmt(t.afterMaxMicron, 0)} micron maximum: moisture or a leak. Find it, evacuate again and repeat the decay test.`);
    }
  }
  return { figures, complete: missing.length === 0, missing, invalid, fails };
}

/* ---------------- the words on the record ---------------- */

const n2 = (v: number) => fmt(v, 2);
const unset = "not set yet";

/** The pressure test as rows for the commissioning screen, the certificate and the handover pack: readings exactly as taken, then the working. */
export function pressureDecayRows(f: PressureDecayFigures): [string, string][] {
  const rows: [string, string][] = [];
  const at = (bar: number | undefined, c: number | undefined) => (bar === undefined ? "not recorded" : `${n2(bar)} bar g${c !== undefined ? ` at ${fmt(c, 1)} °C` : ""}`);
  rows.push(["Test pressure applied (nitrogen)", at(f.appliedBarG, f.startC)]);
  rows.push(["At the end of the hold", `${at(f.endBarG, f.endC)}${f.holdMinutes !== undefined ? `, after ${fmt(f.holdMinutes, 1)} min` : ""}`]);
  if (f.endCorrectedBarG !== undefined && f.startC !== undefined && f.endC !== undefined) {
    rows.push([
      "Corrected to the start temperature",
      `${n2(f.endCorrectedBarG)} bar g ((end + ${f.atmosphereBar} bar) × ${fmt(f.startC + KELVIN, 2)} K ÷ ${fmt(f.endC + KELVIN, 2)} K − ${f.atmosphereBar} bar)`,
    ]);
  }
  if (f.fallBar !== undefined) rows.push([f.fallBar >= 0 ? "Fall over the hold" : "Rise over the hold", `${n2(Math.abs(f.fallBar))} bar`]);
  rows.push([
    "Allowed fall",
    f.allowanceBar === undefined
      ? "the gauge's resolution, not recorded yet"
      : `${n2(f.allowanceBar)} bar (${f.allowanceFrom === "tech-lead" ? "the manual's, set by the tech lead" : "no fall beyond the gauge's resolution"})`,
  ]);
  rows.push(["Gauge resolution", f.gaugeResolutionBar === undefined ? "not recorded" : `${n2(f.gaugeResolutionBar)} bar`]);
  rows.push([
    "Test pressure (manual) and nameplate PS",
    f.testMinBarG === undefined && f.testMaxBarG === undefined ? unset : `${f.testMinBarG !== undefined ? `at least ${n2(f.testMinBarG)}` : "no minimum"}, at most ${f.testMaxBarG !== undefined ? n2(f.testMaxBarG) : "?"} bar g`,
  ]);
  rows.push(["Hold time (manual)", f.holdMinMinutes === undefined ? unset : `at least ${fmt(f.holdMinMinutes, 1)} min`]);
  return rows;
}

/** The evacuation and decay test as rows: readings exactly as taken, the target that applied, the rise and its limit. */
export function vacuumDecayRows(f: VacuumDecayFigures): [string, string][] {
  const rows: [string, string][] = [];
  rows.push(["Vacuum reached", f.reachedMicron === undefined ? "not recorded" : `${fmt(f.reachedMicron, 0)} micron (${fmt(f.reachedMicron * PA_PER_MICRON, 1)} Pa)`]);
  rows.push(["Vacuum target", `${fmt(f.targetMicron, 0)} micron (${f.targetFrom === "tech-lead" ? "the manual's, stricter than the 500 micron standard" : "the company standard, 66.7 Pa"})`]);
  rows.push(["Decay hold, pump isolated", f.holdMinutes === undefined ? "not recorded" : `${fmt(f.holdMinutes, 1)} min${f.holdMinMinutes !== undefined ? ` (manual: ${fmt(f.holdMinMinutes, 1)} min)` : ""}`]);
  rows.push(["After the hold", f.afterMicron === undefined ? "not recorded" : `${fmt(f.afterMicron, 0)} micron`]);
  if (f.riseMicron !== undefined) rows.push([f.riseMicron >= 0 ? "Rise over the hold" : "Fall over the hold", `${fmt(Math.abs(f.riseMicron), 0)} micron`]);
  rows.push(["Rise limit (manual)", f.riseMaxMicron === undefined ? unset : `${fmt(f.riseMaxMicron, 0)} micron`]);
  if (f.afterMaxMicron !== undefined) rows.push(["Highest allowed after the hold (manual)", `${fmt(f.afterMaxMicron, 0)} micron`]);
  return rows;
}

/** The result in a few words. */
export function decayResultText(r: { result: "pass" | "fail" | "incomplete"; failedRuns: number }): string {
  const before = r.result === "pass" && r.failedRuns > 0 ? ` (retested: ${r.failedRuns} earlier run${r.failedRuns === 1 ? "" : "s"} failed)` : "";
  return r.result === "pass" ? `Pass${before}` : r.result === "fail" ? "Fail: retest needed" : "Not complete";
}
