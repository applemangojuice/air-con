import { test } from "node:test";
import assert from "node:assert/strict";
import type { TimeEntry } from "@aircon/domain";
import {
  fmtInstant,
  hoursLabel,
  londonOffsetMinutes,
  londonToUtcIso,
  mapsUrl,
  slotIso,
  telHref,
  timeTotals,
  upcomingWorkingDays,
} from "../components/ops/command/model.ts";
import { expiryState } from "../app/ops/staff/expiry.ts";
import { formatBreakdown, formatMetric } from "../app/ops/pilots/format.ts";

test("London offset: GMT in winter, BST in summer", () => {
  assert.equal(londonOffsetMinutes(new Date("2026-01-15T12:00:00Z")), 0);
  assert.equal(londonOffsetMinutes(new Date("2026-07-15T12:00:00Z")), 60);
});

test("London wall clock to the real instant, across the clock change", () => {
  assert.equal(londonToUtcIso("2026-07-15", "09:30"), "2026-07-15T08:30:00.000Z", "BST");
  assert.equal(londonToUtcIso("2026-12-01", "09:30"), "2026-12-01T09:30:00.000Z", "GMT");
  // The clocks go back at 02:00 on Sunday 25 Oct 2026: noon that day is GMT, the day before BST.
  assert.equal(londonToUtcIso("2026-10-25", "12:00"), "2026-10-25T12:00:00.000Z");
  assert.equal(londonToUtcIso("2026-10-24", "12:00"), "2026-10-24T11:00:00.000Z");
  assert.equal(londonToUtcIso("2026-02-30", "09:00"), null, "no 30 February");
  assert.equal(londonToUtcIso("2026-02-10", "25:00"), null);
  assert.equal(londonToUtcIso("10/02/2026", "09:00"), null);
});

test("a survey slot keeps the wall clock encoded as UTC (the house convention)", () => {
  assert.equal(slotIso("2026-11-03", "10:00"), "2026-11-03T10:00:00.000Z");
  assert.equal(slotIso("2026-11-03", "9:00"), null);
  assert.equal(slotIso("", "10:00"), null);
});

test("real instants print in London time", () => {
  assert.equal(fmtInstant("2026-07-15T08:30:00.000Z"), "Wed 15 Jul, 09:30");
  assert.equal(fmtInstant("2026-12-01T09:30:00.000Z", { year: true }), "Tue 1 Dec 2026, 09:30");
  assert.equal(fmtInstant("not a date"), "not a date");
});

test("the next working days skip weekends (and honour the settings' days)", () => {
  assert.deepEqual(upcomingWorkingDays("2026-10-16", [1, 2, 3, 4, 5], 3), ["2026-10-19", "2026-10-20", "2026-10-21"]);
  assert.deepEqual(upcomingWorkingDays("2026-10-16", [6], 2), ["2026-10-17", "2026-10-24"]);
  assert.equal(upcomingWorkingDays("2026-10-16", [], 5).length, 5, "an empty list falls back to Mon–Fri");
});

test("time totals by person and kind; a running clock is counted, not summed", () => {
  const e = (over: Partial<TimeEntry>): TimeEntry => ({ id: "x", projectId: "p", staffName: "DEMO Ivo", kind: "install", startedAt: "2026-10-01T08:00:00Z", ...over });
  const t = timeTotals([
    e({ minutes: 90 }),
    e({ staffName: "DEMO Tess", kind: "commissioning", minutes: 60 }),
    e({ kind: "travel", startedAt: "2026-10-01T07:00:00Z", endedAt: "2026-10-01T07:45:00Z" }),
    e({}),
  ]);
  assert.equal(t.totalMinutes, 195);
  assert.deepEqual(t.byPerson, [
    { name: "DEMO Ivo", minutes: 135 },
    { name: "DEMO Tess", minutes: 60 },
  ]);
  assert.deepEqual(t.byKind.map((k) => k.kind), ["install", "commissioning", "travel"]);
  assert.equal(t.running, 1);
});

test("small formatters", () => {
  assert.equal(hoursLabel(45), "45 min");
  assert.equal(hoursLabel(180), "3 h");
  assert.equal(hoursLabel(105), "1 h 45 min");
  assert.equal(telHref("07700 900 123"), "tel:07700900123");
  assert.ok(mapsUrl("1 Demo Street", "SW16 9ZZ").endsWith("query=1%20Demo%20Street%2C%20SW16%209ZZ"));
});

test("certificate expiry: expired, within 60 days, current, or undated", () => {
  assert.equal(expiryState("2026-10-17", "2026-10-18"), "expired");
  assert.equal(expiryState("2026-10-18", "2026-10-18"), "soon", "good through its expiry date");
  assert.equal(expiryState("2026-12-17", "2026-10-18"), "soon");
  assert.equal(expiryState("2026-12-18", "2026-10-18"), "current");
  assert.equal(expiryState(undefined, "2026-10-18"), "no-expiry");
  assert.equal(expiryState("soon", "2026-10-18"), "no-expiry");
});

test("pilot metric cells: a dash for unknown, never a made-up zero", () => {
  assert.equal(formatMetric(null, "money"), "–");
  assert.equal(formatMetric(0, "money"), "£0");
  assert.equal(formatMetric(123450, "money"), "£1,234.50");
  assert.equal(formatMetric(28.04, "pct"), "28.0%");
  assert.equal(formatMetric(30, "pct"), "30%");
  assert.equal(formatMetric(1, "days"), "1 day");
  assert.equal(formatMetric(5.5, "hours"), "5.5 h");
  assert.equal(formatMetric(9, "score"), "9/10");
  assert.equal(formatBreakdown({}), "–");
  assert.equal(formatBreakdown({ b: 1, a: 3 }, " h"), "a: 3 h · b: 1 h");
});
