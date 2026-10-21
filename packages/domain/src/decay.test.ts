import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ATMOSPHERE_BAR, KELVIN, VACUUM_STANDARD_MICRON, correctedEndBarG, judgePressureDecay, judgeVacuumDecay, vacuumTargetMicron } from "./decay.ts";

/*
 * Real-shaped readings: an R32 split's nitrogen test at 30 bar g on a
 * digital manifold reading to 0.1 bar, an hour's hold across a London
 * afternoon, and a micron gauge on the evacuation. The arithmetic is done
 * by hand in each comment.
 */

const close = (a: number | undefined, b: number, tol = 0.001) => assert.ok(a !== undefined && Math.abs(a - b) <= tol, `${a} ≈ ${b}`);

test("the correction: absolute pressure scaled by the kelvin ratio, back to gauge", () => {
  // (29.4 + 1.01325) × 293.15 / 288.15 − 1.01325 = 29.928
  close(correctedEndBarG(29.4, 20, 15), 29.928);
  // No temperature change: no correction.
  assert.equal(correctedEndBarG(29.4, 15, 15), 29.4);
  assert.equal(ATMOSPHERE_BAR, 1.01325);
  assert.equal(KELVIN, 273.15);
});

test("a cooling afternoon explains a fall: 30.0 bar g at 20 °C, 29.4 at 15 °C an hour later, passes on a 0.1 bar gauge", () => {
  const j = judgePressureDecay(
    { appliedBarG: 30, startC: 20, endBarG: 29.4, endC: 15, holdMinutes: 60, gaugeResolutionBar: 0.1 },
    { testMinBarG: 30, testMaxBarG: 41.5, holdMinMinutes: 60 },
  );
  assert.ok(j.complete);
  assert.deepEqual(j.fails, []);
  close(j.figures.endCorrectedBarG, 29.928);
  close(j.figures.fallBar, 0.072);
  assert.equal(j.figures.allowanceBar, 0.1);
  assert.equal(j.figures.allowanceFrom, "gauge-resolution");
});

test("the same fall with no temperature change is a leak: 0.6 bar against a 0.1 bar gauge fails", () => {
  const j = judgePressureDecay({ appliedBarG: 30, startC: 15, endBarG: 29.4, endC: 15, holdMinutes: 60, gaugeResolutionBar: 0.1 }, {});
  assert.ok(j.complete);
  close(j.figures.fallBar, 0.6);
  assert.equal(j.fails.length, 1);
  assert.match(j.fails[0]!, /^Fell 0\.6 bar once corrected to the start temperature .* more than the 0\.1 bar allowed \(the gauge's resolution\): find and fix the leak, then test again\.$/);
});

test("warming hides a leak until it's corrected: the gauge didn't move but the system lost about 1 bar", () => {
  // (30 + 1.01325) × 288.15 / 298.15 − 1.01325 = 28.960, so it fell 1.04 bar.
  const j = judgePressureDecay({ appliedBarG: 30, startC: 15, endBarG: 30, endC: 25, holdMinutes: 60, gaugeResolutionBar: 0.1 }, {});
  close(j.figures.endCorrectedBarG, 28.96, 0.002);
  close(j.figures.fallBar, 1.04, 0.002);
  assert.equal(j.fails.length, 1);
});

test("exactly the gauge's resolution passes; a hair more fails; the manual's allowance replaces it", () => {
  const r = { appliedBarG: 30, startC: 15, endBarG: 29.9, endC: 15, holdMinutes: 60, gaugeResolutionBar: 0.1 };
  assert.deepEqual(judgePressureDecay(r, {}).fails, [], "0.1 bar fall on a 0.1 bar gauge: within its resolution");
  assert.equal(judgePressureDecay({ ...r, endBarG: 29.85 }, {}).fails.length, 1);
  const lead = judgePressureDecay({ ...r, endBarG: 29.85 }, { allowanceBar: 0.2 });
  assert.deepEqual(lead.fails, []);
  assert.deepEqual([lead.figures.allowanceBar, lead.figures.allowanceFrom], [0.2, "tech-lead"]);
  assert.match(judgePressureDecay({ ...r, endBarG: 29.7 }, { allowanceBar: 0.2 }).fails[0]!, /\(the manual's allowance\)/);
});

test("the test pressure: never above the nameplate PS, never below the manual's; the manual's hold time", () => {
  const ok = { appliedBarG: 30, startC: 15, endBarG: 30, endC: 15, holdMinutes: 60, gaugeResolutionBar: 0.1 };
  assert.match(judgePressureDecay({ ...ok, appliedBarG: 42, endBarG: 42 }, { testMinBarG: 30, testMaxBarG: 41.5 }).fails[0]!, /above the 41\.5 bar g maximum \(the nameplate PS\)/);
  assert.match(judgePressureDecay({ ...ok, appliedBarG: 10, endBarG: 10 }, { testMinBarG: 30, testMaxBarG: 41.5 }).fails[0]!, /below the manual's 30 bar g/);
  assert.match(judgePressureDecay({ ...ok, holdMinutes: 20 }, { holdMinMinutes: 60 }).fails[0]!, /Held 20 min; the manual says at least 60 min/);
  // Above PS is said as soon as it's typed, before the hold is over.
  const early = judgePressureDecay({ appliedBarG: 45 }, { testMaxBarG: 41.5 });
  assert.equal(early.complete, false);
  assert.equal(early.fails.length, 1);
});

test("readings that can't be right don't count: a 150 °C ambient, a zero gauge step, a gauge as coarse as the test", () => {
  const ok = { appliedBarG: 30, startC: 15, endBarG: 30, endC: 15, holdMinutes: 60, gaugeResolutionBar: 0.1 };
  const hot = judgePressureDecay({ ...ok, endC: 150 }, {});
  assert.equal(hot.complete, false);
  assert.deepEqual(hot.missing, ["endC"]);
  assert.match(hot.invalid[0]!, /150 °C isn't an ambient temperature/);
  assert.equal(judgePressureDecay({ ...ok, gaugeResolutionBar: 0 }, {}).complete, false);
  assert.equal(judgePressureDecay({ ...ok, gaugeResolutionBar: 30 }, {}).complete, false);
  assert.deepEqual(judgePressureDecay({ appliedBarG: 30 }, {}).missing, ["startC", "endBarG", "endC", "holdMinutes", "gaugeResolutionBar"]);
});

test("vacuum: 500 micron (66.7 Pa) unless the manual is stricter; the rise over the hold against the limit", () => {
  assert.equal(VACUUM_STANDARD_MICRON, 500);
  assert.deepEqual(vacuumTargetMicron(undefined), { micron: 500, from: "company-standard" });
  assert.deepEqual(vacuumTargetMicron(1000), { micron: 500, from: "company-standard" }, "a looser figure never replaces 500");
  assert.deepEqual(vacuumTargetMicron(250), { micron: 250, from: "tech-lead" });

  // 350 micron, isolated for an hour, 420 at the end: a 70 micron rise against a 200 limit.
  const dry = judgeVacuumDecay({ reachedMicron: 350, holdMinutes: 60, afterMicron: 420 }, { riseMaxMicron: 200, holdMinMinutes: 60 });
  assert.ok(dry.complete);
  assert.deepEqual(dry.fails, []);
  assert.equal(dry.figures.riseMicron, 70);
  assert.deepEqual([dry.figures.targetMicron, dry.figures.targetFrom], [500, "company-standard"]);

  // Climbing to 1,900: moisture or a leak.
  const wet = judgeVacuumDecay({ reachedMicron: 350, holdMinutes: 60, afterMicron: 1900 }, { riseMaxMicron: 200 });
  assert.match(wet.fails[0]!, /^Rose 1550 micron over the hold, more than the 200 micron allowed: moisture or a leak\./);
  assert.match(judgeVacuumDecay({ reachedMicron: 600, holdMinutes: 60, afterMicron: 650 }, {}).fails[0]!, /Reached 600 micron, above the 500 micron target \(the company standard, 66\.7 Pa\)/);
  assert.match(judgeVacuumDecay({ reachedMicron: 350, holdMinutes: 60, afterMicron: 400 }, { targetMaxMicron: 300 }).fails[0]!, /above the 300 micron target \(the manual's\)/);
  assert.match(judgeVacuumDecay({ reachedMicron: 350, holdMinutes: 5, afterMicron: 360 }, { holdMinMinutes: 60 }).fails[0]!, /Held 5 min with the pump isolated; the manual says 60 min/);
  assert.match(judgeVacuumDecay({ reachedMicron: 350, holdMinutes: 60, afterMicron: 800 }, { afterMaxMicron: 700, riseMaxMicron: 500 }).fails[0]!, /above the 700 micron maximum/);
  // Without a rise limit the rise is shown, not judged (the tech lead must set one before signing).
  assert.deepEqual(judgeVacuumDecay({ reachedMicron: 350, holdMinutes: 60, afterMicron: 1900 }, {}).fails, []);
  assert.equal(judgeVacuumDecay({ reachedMicron: -1, holdMinutes: 60, afterMicron: 10 }, {}).complete, false);
});
