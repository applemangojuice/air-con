import assert from "node:assert/strict";
import { test } from "node:test";
import { generateQuote } from "./pricing.ts";
import {
  applyProjectActionV1,
  createProjectV1,
  currentStageV1,
  daysBetween,
  isProjectCompleteV1,
  projectFeesV1,
  projectTimelineV1,
  rescheduleFeeGbpV1,
  stageStateV1,
  type ProjectV1,
  type ProjectActionV1,
} from "./project-v1.ts";
import type { Survey } from "./types.ts";

const NOW = "2026-07-01T10:00:00.000Z";

function survey(overrides: Partial<Survey> = {}): Survey {
  return {
    postcode: "SW1A 1AA",
    addressLine: "1 Test Street",
    archetypeId: "semi-1930-1979",
    property: { type: "semi-detached", era: "1930-1950", bedrooms: 3, ownership: "owner" },
    rooms: [
      {
        id: "r1",
        name: "Main bedroom",
        type: "bedroom",
        size: "medium",
        floor: "first",
        glazing: "medium",
        orientation: "south",
        hasExternalWall: true,
        photos: [{ id: "p1", kind: "room" }],
      },
    ],
    outdoor: { location: "ground-rear", photos: [{ id: "p2", kind: "outdoor-location" }] },
    electrics: { condition: "modern-spare-ways", photos: [{ id: "p3", kind: "fuse-board" }] },
    ...overrides,
  };
}

function project(overrides: Partial<Survey> = {}): ProjectV1 {
  const s = survey(overrides);
  return createProjectV1({
    id: "proj-1",
    quoteId: "quote-1",
    createdAt: NOW,
    customerName: "Alex Test",
    survey: s,
    quote: generateQuote(s),
  });
}

/** Run actions in order, asserting each succeeds. */
function run(p: ProjectV1, actions: ProjectActionV1[], now = NOW): ProjectV1 {
  for (const action of actions) {
    const result = applyProjectActionV1(p, action, now);
    assert.ok(result.ok, `${action.type} failed: ${result.ok ? "" : result.error}`);
    p = result.project;
  }
  return p;
}

const HAPPY_PATH: ProjectActionV1[] = [
  { type: "approve-floor-plan" },
  { type: "accept-final-quote" },
  { type: "book-site-visit", scheduledFor: "2026-07-08T14:00:00.000Z", mode: "video" },
  { type: "pay-site-visit" },
  {
    type: "ops-complete-site-visit",
    summary: "All validated on the call.",
    approvedForInstall: true,
    electricsStatus: "validated",
    electricsSummary: "Dedicated circuit from spare way 7, route agreed.",
  },
  { type: "book-installation", date: "2026-07-20" },
  { type: "ops-mark-dispatched", courier: "DPD", trackingRef: "DPD-123" },
  { type: "ops-mark-delivered" },
  { type: "ops-complete-installation" },
];

test("full happy path runs quote → installation complete", () => {
  let p = project();
  assert.equal(currentStageV1(p), "floor-plan");
  p = run(p, HAPPY_PATH);
  assert.ok(isProjectCompleteV1(p));
  assert.equal(p.delivery.expectedDate, "2026-07-18"); // install minus 2 days
  assert.equal(p.delivery.trackingEvents.length, 2);
});

test("complete survey auto-issues the final quote at the same price", () => {
  const p = project();
  assert.equal(p.quoteSummary.confidenceBand, "high");
  assert.equal(p.finalQuote.status, "issued");
  assert.equal(p.finalQuote.totalGbp, p.quoteSummary.totalGbp);
});

test("incomplete survey leaves the final quote pending until ops issues it", () => {
  let p = project({
    electrics: { condition: "unsure", photos: [] },
    outdoor: { location: "unsure", photos: [] },
  });
  assert.equal(p.finalQuote.status, "pending");
  p = run(p, [{ type: "approve-floor-plan" }]);
  assert.equal(p.finalQuote.status, "pending");

  const early = applyProjectActionV1(p, { type: "accept-final-quote" }, NOW);
  assert.ok(!early.ok);

  p = run(p, [
    { type: "ops-issue-final-quote", totalGbp: 3200, note: "Adjusted after photo review" },
    { type: "accept-final-quote" },
  ]);
  assert.equal(p.finalQuote.status, "accepted");
  assert.equal(p.finalQuote.totalGbp, 3200);
});

test("site visit is a hard prerequisite for booking installation", () => {
  const p = run(project(), [
    { type: "approve-floor-plan" },
    { type: "accept-final-quote" },
    { type: "book-site-visit", scheduledFor: "2026-07-08T14:00:00.000Z", mode: "video" },
  ]);
  const result = applyProjectActionV1(p, { type: "book-installation", date: "2026-07-20" }, NOW);
  assert.ok(!result.ok);
  assert.match((result as { error: string }).error, /site visit/i);
});

test("site visit cannot be booked before the final quote is accepted", () => {
  const result = applyProjectActionV1(
    project(),
    { type: "book-site-visit", scheduledFor: "2026-07-08T14:00:00.000Z", mode: "video" },
    NOW,
  );
  assert.ok(!result.ok);
});

test("installation not approved at site visit blocks booking", () => {
  const p = run(project(), [
    { type: "approve-floor-plan" },
    { type: "accept-final-quote" },
    { type: "book-site-visit", scheduledFor: "2026-07-08T14:00:00.000Z", mode: "video" },
    {
      type: "ops-complete-site-visit",
      summary: "Outdoor unit position needs the freeholder's consent.",
      approvedForInstall: false,
      electricsStatus: "attention",
      electricsSummary: "Board work needed; quote attached.",
    },
  ]);
  const result = applyProjectActionV1(p, { type: "book-installation", date: "2026-07-20" }, NOW);
  assert.ok(!result.ok);
});

test("date changes are free with a week's notice, one flat fee inside it", () => {
  assert.equal(rescheduleFeeGbpV1("installation", 20), 0);
  assert.equal(rescheduleFeeGbpV1("installation", 7), 0);
  assert.equal(rescheduleFeeGbpV1("installation", 6), 150);
  assert.equal(rescheduleFeeGbpV1("installation", 1), 150);
  assert.equal(rescheduleFeeGbpV1("delivery", 8), 0);
  assert.equal(rescheduleFeeGbpV1("delivery", 2), 60);
  assert.equal(rescheduleFeeGbpV1("site-visit", 7), 0);
  assert.equal(rescheduleFeeGbpV1("site-visit", 0), 25);
});

test("rescheduling installation close to the date charges the fee", () => {
  let p = run(project(), HAPPY_PATH.slice(0, 6)); // through book-installation (2026-07-20)
  // 6 days' notice → £150 band
  const result = applyProjectActionV1(
    p,
    { type: "reschedule-installation", date: "2026-07-27" },
    "2026-07-14T09:00:00.000Z",
  );
  assert.ok(result.ok);
  p = result.project;
  assert.equal(p.installation.date, "2026-07-27");
  assert.equal(p.installation.rescheduleFeesGbp, 150);
  assert.equal(p.delivery.expectedDate, "2026-07-25"); // delivery follows the install date
  assert.equal(projectFeesV1(p).changeFeesGbp, 150);
});

test("delivery must respect courier lead time and land before installation", () => {
  const p = run(project(), HAPPY_PATH.slice(0, 6));
  const tooSoon = applyProjectActionV1(p, { type: "set-delivery-date", date: "2026-07-02" }, NOW);
  assert.ok(!tooSoon.ok);
  const afterInstall = applyProjectActionV1(
    p,
    { type: "set-delivery-date", date: "2026-07-20" },
    NOW,
  );
  assert.ok(!afterInstall.ok);
  const fine = applyProjectActionV1(p, { type: "set-delivery-date", date: "2026-07-17" }, NOW);
  assert.ok(fine.ok);
});

test("installation cannot complete before the equipment is delivered", () => {
  const p = run(project(), HAPPY_PATH.slice(0, 6));
  const result = applyProjectActionV1(p, { type: "ops-complete-installation" }, NOW);
  assert.ok(!result.ok);
});

test("timeline projects estimated dates for future stages and confirms booked ones", () => {
  const fresh = projectTimelineV1(project(), NOW);
  assert.equal(fresh.length, 6);
  assert.equal(fresh[0]!.date?.kind, "actual"); // quote happened
  for (const entry of fresh.slice(2)) {
    assert.equal(entry.date?.kind, "estimated"); // everything ahead has a projected date
    assert.equal(entry.state, "upcoming");
  }

  const booked = run(project(), HAPPY_PATH.slice(0, 6));
  const entries = projectTimelineV1(booked, NOW);
  const byStage = Object.fromEntries(entries.map((e) => [e.stage, e]));
  assert.equal(byStage["site-visit"]!.date?.kind, "actual");
  assert.equal(byStage["installation"]!.date?.kind, "confirmed");
  assert.equal(byStage["installation"]!.date?.iso, "2026-07-20");
  assert.equal(byStage["delivery"]!.date?.kind, "confirmed");
  assert.equal(stageStateV1(booked, "delivery"), "current");
});

test("electrics assessment is seeded from the survey and finalised at the site visit", () => {
  const uncertain = project({ electrics: { condition: "older-fuse-box", photos: [] } });
  assert.equal(uncertain.electrics.status, "attention");

  const p = run(project(), HAPPY_PATH.slice(0, 5));
  assert.equal(p.electrics.status, "validated");
  assert.match(p.electrics.summary, /spare way 7/);
});

test("events feed accumulates customer-facing updates", () => {
  const p = run(project(), HAPPY_PATH);
  assert.ok(p.events.length >= 10);
  assert.ok(p.events.every((e) => e.label.length > 0 && e.at.length > 0));
});

test("prep checklist items toggle, informational items don't", () => {
  let p = project();
  p = run(p, [{ type: "toggle-prep", itemId: "parking", done: true }]);
  assert.ok(p.installation.prep.find((i) => i.id === "parking")!.done);
  const info = applyProjectActionV1(p, { type: "toggle-prep", itemId: "power-off", done: true }, NOW);
  assert.ok(!info.ok);
});

test("reducer never mutates its input", () => {
  const p = project();
  const before = JSON.stringify(p);
  applyProjectActionV1(p, { type: "approve-floor-plan" }, NOW);
  assert.equal(JSON.stringify(p), before);
});

test("daysBetween counts calendar days", () => {
  assert.equal(daysBetween("2026-07-01T23:00:00.000Z", "2026-07-08"), 7);
  assert.equal(daysBetween("2026-07-08", "2026-07-01"), -7);
});
