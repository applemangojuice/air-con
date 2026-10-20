import { test } from "node:test";
import assert from "node:assert/strict";
import { migrateProject, type CrewMember, type Project, type PurchaseOrder } from "@aircon/domain";
import {
  addDaysIso,
  bookingClashes,
  calendarRange,
  crewConflicts,
  crewDay,
  daysBetweenIso,
  eventsForProject,
  inRange,
  isoWeekday,
  monthGrid,
  mondayOf,
  shiftMonth,
  sortEvents,
  stepDate,
  unassignedOn,
  weekDates,
  whoLine,
  workingDatesFrom,
  type CalEvent,
} from "../app/ops/calendar/calendar-model.ts";
import { isoToLondonLocal, londonLocalToIso, poundsToPence, fmtLondon } from "../app/ops/projects/[id]/booking/_f5/action-state.ts";

// F5: the ops calendar's date maths and conflict rules, and the form helpers
// for money and London wall-clock times. Pure; DEMO data only.

/* ------------------------------------------------------------------ */
/* Date maths                                                          */
/* ------------------------------------------------------------------ */

test("addDaysIso / isoWeekday / mondayOf cross months, years and the clock change", () => {
  assert.equal(addDaysIso("2026-10-31", 1), "2026-11-01");
  assert.equal(addDaysIso("2026-12-31", 1), "2027-01-01");
  assert.equal(addDaysIso("2026-03-01", -1), "2026-02-28");
  assert.equal(addDaysIso("2028-03-01", -1), "2028-02-29");
  // BST ends 25 Oct 2026: still one calendar day per step.
  assert.equal(addDaysIso("2026-10-24", 2), "2026-10-26");
  assert.equal(addDaysIso("2026-10-18T23:30:00.000Z", 1), "2026-10-19");
  assert.equal(isoWeekday("2026-10-18"), 7, "a Sunday");
  assert.equal(isoWeekday("2026-10-19"), 1, "a Monday");
  assert.equal(mondayOf("2026-10-18"), "2026-10-12");
  assert.equal(mondayOf("2026-10-19"), "2026-10-19");
  assert.equal(mondayOf("2027-01-01"), "2026-12-28");
  assert.equal(daysBetweenIso("2026-10-18", "2026-11-01"), 14);
  assert.equal(daysBetweenIso("2026-11-01", "2026-10-18"), -14);
});

test("workingDatesFrom skips the weekend (or the configured days off) and starts on the next working day", () => {
  assert.deepEqual(workingDatesFrom("2026-10-22", 3), ["2026-10-22", "2026-10-23", "2026-10-26"]);
  assert.deepEqual(workingDatesFrom("2026-10-24", 2), ["2026-10-26", "2026-10-27"], "a Saturday start moves to Monday");
  assert.deepEqual(workingDatesFrom("2026-10-23", 2, [1, 2, 3, 4, 5, 6]), ["2026-10-23", "2026-10-24"], "Saturdays on");
  assert.deepEqual(workingDatesFrom("2026-10-22", 0), []);
  assert.deepEqual(workingDatesFrom("2026-10-22", 1, []), ["2026-10-22"], "no working days set falls back to Mon–Fri");
});

test("monthGrid: whole Monday-first weeks covering the month", () => {
  const oct = monthGrid("2026-10");
  assert.equal(oct[0]![0], "2026-09-28");
  assert.equal(oct.at(-1)![6], "2026-11-01");
  assert.equal(oct.length, 5);
  assert.ok(oct.every((w) => w.length === 7 && isoWeekday(w[0]!) === 1));
  // February 2027 starts on a Monday and ends on a Sunday: exactly four weeks.
  const feb = monthGrid("2027-02");
  assert.equal(feb.length, 4);
  assert.deepEqual([feb[0]![0], feb[3]![6]], ["2027-02-01", "2027-02-28"]);
  // A month that needs six rows.
  assert.equal(monthGrid("2026-08").length, 6);
});

test("weekDates, shiftMonth, calendarRange and stepDate", () => {
  assert.deepEqual(weekDates("2026-10-18"), ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-10", 0), "2026-10");

  const today = "2026-10-18";
  assert.deepEqual(calendarRange({}, today), { view: "month", date: today, from: "2026-09-28", to: "2026-11-01" });
  assert.deepEqual(calendarRange({ view: "week", date: "2026-10-21" }, today), { view: "week", date: "2026-10-21", from: "2026-10-19", to: "2026-10-25" });
  assert.deepEqual(calendarRange({ view: "day", date: "2026-10-21" }, today), { view: "day", date: "2026-10-21", from: "2026-10-21", to: "2026-10-21" });
  // Junk in the URL falls back safely.
  assert.equal(calendarRange({ view: "year", date: "2026-13-45" }, today).view, "month");
  assert.equal(calendarRange({ view: "day", date: "<script>" }, today).date, today);

  assert.equal(stepDate("day", "2026-10-31", 1), "2026-11-01");
  assert.equal(stepDate("week", "2026-10-18", -1), "2026-10-11");
  assert.equal(stepDate("month", "2026-10-18", 1), "2026-11-01");
  assert.equal(stepDate("month", "2026-01-31", -1), "2025-12-01");
});

/* ------------------------------------------------------------------ */
/* Events and conflicts                                                */
/* ------------------------------------------------------------------ */

const ALEX: CrewMember = { staffId: "s-alex", name: "Alex (DEMO)", role: "installer", external: false };
const JO: CrewMember = { staffId: "s-jo", name: "Jo (DEMO)", role: "electrician", external: true };

function project(id: string, name: string, over: (p: Project) => void = () => {}): Project {
  const p = migrateProject({ schemaVersion: 2, id, quoteId: `q-${id}`, createdAt: "2026-10-01T09:00:00.000Z", customer: { name, addressLine: "1 Demo Street", postcode: "SW16 9ZZ" } });
  over(p);
  return p;
}

const booked = (id: string, name: string, dates: string[], crew = [ALEX]) =>
  project(id, name, (p) => {
    p.booking.dates = dates;
    p.booking.status = "booked";
    p.booking.crew = crew;
  });

test("eventsForProject: install days numbered, confirmed only once booked, a planned handover, deliveries by state", () => {
  const p = project("p1", "Sam (DEMO)", (x) => {
    x.booking.dates = ["2026-10-22", "2026-10-23"];
    x.booking.status = "not-booked";
    x.booking.crew = [ALEX];
    x.survey.scheduledFor = "2026-10-12T10:00:00.000Z";
  });
  const po = (over: Partial<PurchaseOrder>): PurchaseOrder => ({ id: "po1", projectId: "p1", supplier: "DEMO Supplies", status: "ordered", lines: [], ...over }) as PurchaseOrder;
  const events = eventsForProject(p, [po({ eta: "2026-10-20" }), po({ id: "po2", status: "cancelled", eta: "2026-10-20" }), po({ id: "po3", status: "delivered", deliveredAt: "2026-10-19T08:00:00.000Z" })]);
  const byKind = (k: CalEvent["kind"]) => events.filter((e) => e.kind === k);
  assert.deepEqual(byKind("survey").map((e) => [e.date, e.time]), [["2026-10-12", "10:00"]]);
  assert.deepEqual(byKind("install").map((e) => [e.date, e.title, e.state]), [
    ["2026-10-22", "Install day 1 of 2", "tentative"],
    ["2026-10-23", "Install day 2 of 2", "tentative"],
  ]);
  assert.deepEqual(byKind("delivery").map((e) => [e.date, e.state]), [["2026-10-20", "expected"], ["2026-10-19", "done"]], "a cancelled order isn't on the calendar");
  assert.equal(byKind("delivery")[0]!.title, "ETA, not confirmed: DEMO Supplies");
  assert.deepEqual(byKind("handover").map((e) => [e.date, e.state]), [["2026-10-23", "planned"]]);

  const confirmed = eventsForProject(booked("p2", "Ash (DEMO)", ["2026-10-22"]), []);
  assert.equal(confirmed.find((e) => e.kind === "install")?.state, "confirmed");

  const cancelled = project("p3", "Cancelled (DEMO)", (x) => {
    x.booking.dates = ["2026-10-22"];
    x.closure.closed = true;
    x.closure.reason = "cancelled";
  });
  assert.deepEqual(eventsForProject(cancelled, []), []);
});

test("crewConflicts: one person on two jobs' installs the same day; two survey slots are fine, the same slot isn't", () => {
  const a = eventsForProject(booked("pa", "A (DEMO)", ["2026-10-22", "2026-10-23"]), []);
  const b = eventsForProject(booked("pb", "B (DEMO)", ["2026-10-23"], [ALEX, JO]), []);
  const conflicts = crewConflicts([...a, ...b]);
  assert.equal(conflicts.length, 1);
  assert.deepEqual([conflicts[0]!.date, conflicts[0]!.staffId, conflicts[0]!.events.length], ["2026-10-23", "s-alex", 2]);

  const survey = (id: string, time: string): CalEvent => ({
    id: `${id}:survey`, kind: "survey", date: "2026-10-21", time, projectId: id, customer: id, address: "", postcode: "", title: "Home survey", state: "confirmed", crew: [{ ...ALEX, role: "surveyor" }], href: "",
  });
  assert.equal(crewConflicts([survey("s1", "09:00"), survey("s2", "13:00")]).length, 0);
  assert.equal(crewConflicts([survey("s1", "09:00"), survey("s2", "09:00")]).length, 1);
  // The same person twice on one project isn't a clash.
  assert.equal(crewConflicts(a).length, 0);
});

test("bookingClashes: checks other open jobs' dates and crew, not this job, closed or finished ones", () => {
  const other = booked("o1", "Other (DEMO)", ["2026-10-22", "2026-10-23"], [ALEX]);
  const closed = booked("o2", "Closed (DEMO)", ["2026-10-22"], [ALEX]);
  closed.closure.closed = true;
  const finished = booked("o3", "Done (DEMO)", ["2026-10-22"], [ALEX]);
  finished.install.status = "complete";
  const self = booked("me", "Me (DEMO)", ["2026-10-22"], [ALEX]);

  const clashes = bookingClashes({ projectId: "me", dates: ["2026-10-22", "2026-10-26"], crew: [ALEX, JO] }, [other, closed, finished, self]);
  assert.deepEqual(clashes, [{ date: "2026-10-22", staffId: "s-alex", name: "Alex (DEMO)", projectId: "o1", customer: "Other (DEMO)", confirmed: true }]);
  assert.deepEqual(bookingClashes({ projectId: "me", dates: ["2026-10-26"], crew: [ALEX] }, [other]), []);
  assert.deepEqual(bookingClashes({ projectId: "me", dates: ["2026-10-22"], crew: [JO] }, [other]), []);
});

test("crewDay lists people with jobs first, flags a double-booking, and keeps crew missing from the staff list", () => {
  const events = [...eventsForProject(booked("pa", "A (DEMO)", ["2026-10-22"]), []), ...eventsForProject(booked("pb", "B (DEMO)", ["2026-10-22"], [ALEX, JO]), [])];
  const rows = crewDay(events, "2026-10-22", [
    { id: "s-alex", name: "Alex (DEMO)", roles: ["installer"] },
    { id: "s-free", name: "Bea (DEMO)", roles: ["surveyor"] },
  ]);
  assert.deepEqual(rows.map((r) => [r.name, r.clash, r.jobs.filter((j) => j.kind === "install").length]), [
    ["Alex (DEMO)", true, 2],
    ["Jo (DEMO)", false, 1],
    ["Bea (DEMO)", false, 0],
  ]);
});

test("sortEvents and inRange", () => {
  const e = (date: string, kind: CalEvent["kind"], time?: string): CalEvent => ({
    id: `${date}${kind}${time}`, kind, date, ...(time ? { time } : {}), projectId: "p", customer: "c", address: "", postcode: "", title: "", state: "confirmed", crew: [], href: "",
  });
  const sorted = sortEvents([e("2026-10-23", "install"), e("2026-10-22", "delivery"), e("2026-10-22", "survey", "13:00"), e("2026-10-22", "survey", "09:00"), e("2026-10-22", "install")]);
  assert.deepEqual(sorted.map((x) => `${x.date} ${x.kind} ${x.time ?? ""}`.trim()), [
    "2026-10-22 survey 09:00",
    "2026-10-22 survey 13:00",
    "2026-10-22 install",
    "2026-10-22 delivery",
    "2026-10-23 install",
  ]);
  assert.equal(inRange(sorted, "2026-10-23", "2026-10-23").length, 1);
});

/* ------------------------------------------------------------------ */
/* Form helpers                                                        */
/* ------------------------------------------------------------------ */

test("poundsToPence reads what people type, and refuses what isn't money", () => {
  assert.equal(poundsToPence("£1,234.50"), 123_450);
  assert.equal(poundsToPence("1234.5"), 123_450);
  assert.equal(poundsToPence(" 1 000 "), 100_000);
  assert.equal(poundsToPence("0.07"), 7);
  assert.equal(poundsToPence("12"), 1_200);
  for (const bad of ["", "-5", "1.234", "abc", "1e3", "£", null, undefined]) assert.equal(poundsToPence(bad as string | null | undefined), null, String(bad));
});

test("London wall-clock times convert both ways across BST and GMT", () => {
  assert.equal(londonLocalToIso("2026-10-18T14:30"), "2026-10-18T13:30:00.000Z", "BST is UTC+1");
  assert.equal(londonLocalToIso("2026-12-01T09:00"), "2026-12-01T09:00:00.000Z", "GMT is UTC");
  assert.equal(londonLocalToIso("2026-10-26T08:00"), "2026-10-26T08:00:00.000Z", "the day after the clocks go back");
  assert.equal(londonLocalToIso("18/10/2026 14:30"), null);
  assert.equal(londonLocalToIso(""), null);
  assert.equal(isoToLondonLocal("2026-10-18T13:30:00.000Z"), "2026-10-18T14:30");
  assert.equal(isoToLondonLocal("2026-12-01T09:00:00.000Z"), "2026-12-01T09:00");
  assert.equal(isoToLondonLocal("2026-06-30T23:30:00.000Z"), "2026-07-01T00:30", "after midnight in London");
  assert.equal(fmtLondon("2026-10-18T13:30:00.000Z"), "18 Oct 2026, 14:30");
  assert.equal(fmtLondon("not a date"), "not a date");
});

test("every survey and install day says who's on it, or 'No surveyor' / 'No crew', and the day view lists the ones nobody's down for", () => {
  const selfBooked = project("p1", "Sam (DEMO)", (x) => {
    x.survey.status = "booked";
    x.survey.scheduledFor = "2026-10-26T10:00:00.000Z";
  });
  const assigned = project("p2", "Ash (DEMO)", (x) => {
    x.survey.status = "booked";
    x.survey.scheduledFor = "2026-10-26T14:00:00.000Z";
    x.survey.surveyor = { staffId: "s1", name: "DEMO Sam" };
  });
  const events = [...eventsForProject(selfBooked, []), ...eventsForProject(assigned, []), ...eventsForProject(booked("p3", "Kit (DEMO)", ["2026-10-26"]), [])];
  const survey = (id: string) => events.find((e) => e.projectId === id && e.kind === "survey")!;
  assert.deepEqual(whoLine(survey("p1")), { text: "No surveyor", missing: true });
  assert.deepEqual(whoLine(survey("p2")), { text: "DEMO Sam", missing: false });
  assert.equal(whoLine(events.find((e) => e.kind === "install")!)?.missing, false, "an install day names its crew");
  assert.deepEqual(unassignedOn(events, "2026-10-26").map((e) => e.projectId), ["p1"]);
  // The crew-day view's rows only hold people: the unassigned visit is listed separately, not "Nobody's booked".
  assert.ok(crewDay(events, "2026-10-26", []).every((r) => r.jobs.every((j) => j.projectId !== "p1")));
  // Done is done: a submitted survey doesn't nag.
  const done = { ...survey("p1"), state: "done" as const };
  assert.equal(whoLine(done), null);
});

