import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildDemoInstallJob,
  buildRunsheet,
  demoInstallJobs,
  INSTALL_PHASES,
  latestEvidence,
  plausibleValue,
  scoreInstallation,
  slotStatus,
  submitEvidence,
  NUMERIC_KINDS,
} from "./install.ts";
import type { InstallJob } from "./install.ts";

const TODAY = "2026-07-17T09:00:00.000Z";

function freshJob(rooms = ["Bedroom", "Living room"]): InstallJob {
  return {
    id: "job-1",
    customer: "Test Customer",
    postcode: "SW16 2BE",
    engineer: "James Whitfield",
    scheduledOn: "2026-07-17",
    runsheet: buildRunsheet({ rooms, outdoorUnits: 1 }),
    evidence: [],
    qa: { status: "in-progress" },
  };
}

test("runsheet covers all eleven phases and scales with rooms", () => {
  const two = buildRunsheet({ rooms: ["A", "B"], outdoorUnits: 1 });
  const four = buildRunsheet({ rooms: ["A", "B", "C", "D"], outdoorUnits: 1 });
  const phases = new Set(two.map((s) => s.phase));
  for (const p of INSTALL_PHASES) assert.ok(phases.has(p.n), `phase ${p.n} present`);
  assert.ok(four.length > two.length);
  const slots = (steps: typeof two) => steps.flatMap((s) => s.evidence).length;
  assert.ok(slots(four) > slots(two));
  // Every slot id is unique: the evidence log keys on them.
  const ids = two.flatMap((s) => s.evidence.map((e) => e.id));
  assert.equal(new Set(ids).size, ids.length);
});

test("evidence is append-only and the latest capture wins", () => {
  let job = freshJob();
  const spec = job.runsheet[0]!.evidence[0]!;
  job = submitEvidence(job, spec.id, { ref: "photo-1" }, "2026-07-17T09:05:00Z");
  job = submitEvidence(job, spec.id, { ref: "photo-2" }, "2026-07-17T09:06:00Z");
  assert.equal(job.evidence.length, 2);
  assert.equal(latestEvidence(job, spec.id)?.ref, "photo-2");
});

test("numeric evidence outside the window is an exception, not a pass", () => {
  let job = freshJob();
  const vacuum = job.runsheet
    .flatMap((s) => s.evidence)
    .find((e) => e.kind === "vacuum-reading")!;
  job = submitEvidence(job, vacuum.id, { value: 1200 }, TODAY);
  assert.equal(slotStatus(vacuum, latestEvidence(job, vacuum.id)), "exception");
  const score = scoreInstallation(job);
  assert.equal(score.exceptions.length, 1);
  assert.ok(score.exceptions[0]!.reason.includes("1200"));
  assert.equal(score.qaStatus, "exceptions");

  // A re-capture in range clears it. Evidence log keeps both.
  job = submitEvidence(job, vacuum.id, { value: 320 }, TODAY);
  assert.equal(scoreInstallation(job).exceptions.length, 0);
  assert.equal(job.evidence.length, 2);
});

test("a fully evidenced clean job auto-approves with all gates green", () => {
  const job = buildDemoInstallJob(
    { id: "t", customer: "C", postcode: "SW16 1AA", engineer: "E", rooms: ["A", "B"], outdoorUnits: 1, progress: 1, daysFromToday: 0 },
    TODAY,
  );
  const score = scoreInstallation(job);
  assert.equal(score.completenessPct, 100);
  assert.equal(score.qaStatus, "auto-approved");
  assert.deepEqual(score.gates, {
    pressureTest: true,
    vacuum: true,
    commissioning: true,
    walkthrough: true,
    warranty: true,
  });
  assert.equal(score.photos.captured, score.photos.required);
});

test("partial job reports in-progress with honest counts", () => {
  const job = buildDemoInstallJob(
    { id: "t", customer: "C", postcode: "SW16 1AA", engineer: "E", rooms: ["A", "B"], outdoorUnits: 1, progress: 0.5, daysFromToday: 0 },
    TODAY,
  );
  const score = scoreInstallation(job);
  assert.equal(score.qaStatus, "in-progress");
  assert.ok(score.completenessPct > 20 && score.completenessPct < 80);
  assert.ok(score.slots.captured < score.slots.required);
  assert.equal(score.gates.pressureTest, false);
});

test("a broken reading in the demo surfaces exactly one exception", () => {
  const job = buildDemoInstallJob(
    { id: "t", customer: "C", postcode: "SW16 1AA", engineer: "E", rooms: ["A", "B", "C", "D"], outdoorUnits: 1, progress: 1, breakNth: [24], daysFromToday: 0 },
    TODAY,
  );
  const score = scoreInstallation(job);
  assert.equal(score.qaStatus, "exceptions");
  assert.equal(score.exceptions.length, 1);
});

test("plausible values always sit inside the accepted window", () => {
  const sheet = buildRunsheet({ rooms: ["A", "B", "C"], outdoorUnits: 2 });
  for (const spec of sheet.flatMap((s) => s.evidence)) {
    if (!NUMERIC_KINDS.has(spec.kind)) continue;
    const v = plausibleValue(spec)!;
    if (spec.min !== undefined) assert.ok(v >= spec.min, `${spec.label}: ${v} >= ${spec.min}`);
    if (spec.max !== undefined) assert.ok(v <= spec.max, `${spec.label}: ${v} <= ${spec.max}`);
  }
});

test("demo fleet has one clean pass, one exception job, one live, one pending", () => {
  const jobs = demoInstallJobs(TODAY);
  const statuses = jobs.map((j) => scoreInstallation(j).qaStatus);
  assert.deepEqual(statuses, ["auto-approved", "exceptions", "in-progress", "in-progress"]);
});

test("gps and timestamps ride along on every record", () => {
  let job = freshJob();
  const arrival = job.runsheet[0]!.evidence.find((e) => e.kind === "gps")!;
  job = submitEvidence(job, arrival.id, { gps: { lat: 51.43, lng: -0.13 } }, TODAY);
  const record = latestEvidence(job, arrival.id)!;
  assert.equal(record.at, TODAY);
  assert.equal(record.by, "James Whitfield");
  assert.ok(record.gps);
});
