import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OPS_CAPACITY,
  bomForJob,
  buildProcurementPlan,
  buildSchedule,
  mondayOf,
  type ScheduledJob,
} from "./operations.ts";

const TODAY = "2026-07-15"; // a Wednesday

function job(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    projectId: "p1",
    customer: "Alex Test",
    postcode: "SW17 2FJ",
    outcode: "SW17",
    stage: "delivery",
    installOn: "2026-07-20",
    installDays: 1,
    deliveryOn: "2026-07-18",
    systems: ["3.5 kW multi-split outdoor unit (serves 3 rooms)"],
    roomUnits: [
      "2.5 kW wall-mounted indoor unit",
      "2.5 kW wall-mounted indoor unit",
      "3.5 kW wall-mounted indoor unit",
    ],
    ...overrides,
  };
}

test("mondayOf snaps any date to its week's Monday", () => {
  assert.equal(mondayOf("2026-07-15"), "2026-07-13");
  assert.equal(mondayOf("2026-07-13"), "2026-07-13");
  assert.equal(mondayOf("2026-07-19"), "2026-07-13");
});

test("schedule lays multi-day installs across consecutive days", () => {
  const twoDay = job({ projectId: "p2", installOn: "2026-07-21", installDays: 2 });
  const schedule = buildSchedule([twoDay], TODAY, 3);
  const d1 = schedule.days.find((d) => d.date === "2026-07-21")!;
  const d2 = schedule.days.find((d) => d.date === "2026-07-22")!;
  assert.equal(d1.installs[0]?.dayN, 1);
  assert.equal(d2.installs[0]?.dayN, 2);
  assert.equal(d2.installs[0]?.ofDays, 2);
});

test("two installs on one day overbook a one-crew operation", () => {
  const a = job({ projectId: "a" });
  const b = job({ projectId: "b", customer: "Sam Other" });
  const schedule = buildSchedule([a, b], TODAY, 2);
  assert.equal(schedule.conflicts.length, 1);
  assert.equal(schedule.conflicts[0]!.date, "2026-07-20");
  assert.equal(schedule.conflicts[0]!.capacity, OPS_CAPACITY.installCrews);
  assert.ok(schedule.days.find((d) => d.date === "2026-07-20")!.overbooked);
});

test("site visits and deliveries land on their days", () => {
  const j = job({ siteVisitAt: "2026-07-16T13:00:00.000Z" });
  const schedule = buildSchedule([j], TODAY, 2);
  assert.equal(schedule.days.find((d) => d.date === "2026-07-16")!.siteVisits.length, 1);
  assert.equal(schedule.days.find((d) => d.date === "2026-07-18")!.deliveries.length, 1);
  assert.equal(schedule.stats.siteVisitsBooked, 1);
});

test("street batching spots repeated outcodes", () => {
  const a = job({ projectId: "a", installOn: "2026-07-20" });
  const b = job({ projectId: "b", installOn: "2026-07-21" });
  const c = job({ projectId: "c", outcode: "SW16", installOn: "2026-07-22" });
  const schedule = buildSchedule([a, b, c], TODAY, 3);
  assert.equal(schedule.batches.length, 1);
  assert.equal(schedule.batches[0]!.outcode, "SW17");
  assert.equal(schedule.batches[0]!.jobs, 2);
});

test("BOM covers every physical item and parses capacities", () => {
  const bom = bomForJob(job());
  const bySku = Object.fromEntries(bom.map((l) => [l.sku, l.qty]));
  assert.equal(bySku["ou-3.5"], 1);
  assert.equal(bySku["iu-2.5"], 2);
  assert.equal(bySku["iu-3.5"], 1);
  assert.equal(bySku["pipe-kit-5m"], 3);
  assert.equal(bySku["elec-kit"], 1);
  assert.equal(bySku["consumables"], 1);
});

test("procurement plan computes order-by dates and flags late orders", () => {
  const comfortable = job({ projectId: "a", deliveryOn: "2026-07-28", installOn: "2026-07-30" });
  const tight = job({ projectId: "b", deliveryOn: "2026-07-17", installOn: "2026-07-19" });
  const plan = buildProcurementPlan([comfortable, tight], TODAY);
  const a = plan.jobs.find((p) => p.job.projectId === "a")!;
  const b = plan.jobs.find((p) => p.job.projectId === "b")!;
  assert.equal(a.orderBy, "2026-07-23"); // 5 supplier lead days before delivery
  assert.equal(a.late, false);
  assert.equal(b.late, true); // order should already have gone in
  assert.equal(plan.lateOrders, 1);
});

test("weekly order book aggregates quantities across jobs", () => {
  const a = job({ projectId: "a", deliveryOn: "2026-07-28", installOn: "2026-07-30" });
  const b = job({
    projectId: "b",
    deliveryOn: "2026-07-29",
    installOn: "2026-07-31",
    roomUnits: ["2.5 kW wall-mounted indoor unit"],
  });
  const plan = buildProcurementPlan([a, b], TODAY);
  assert.equal(plan.weekly.length, 1); // both order in the same week
  const week = plan.weekly[0]!;
  assert.equal(week.jobs, 2);
  const iu = week.lines.find((l) => l.sku === "iu-2.5")!;
  assert.equal(iu.qty, 3); // 2 from job a + 1 from job b
});

test("past installs drop out of the plan", () => {
  const done = job({ projectId: "old", installOn: "2026-06-01", deliveryOn: "2026-05-30" });
  const plan = buildProcurementPlan([done], TODAY);
  assert.equal(plan.jobs.length, 0);
});
