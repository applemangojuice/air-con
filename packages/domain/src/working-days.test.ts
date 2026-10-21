import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SUPPLIER_LEAD_DAYS, earliestKitArrival, orderByDate, shiftWorkingDays } from "./purchasing.ts";
import {
  addWorkingDays,
  bankHolidayName,
  bankHolidays,
  isWorkingDay,
  nextWorkingDay,
  notWorkingReason,
  prevWorkingDay,
  upcomingWorkingDays,
  workingDatesEnding,
  workingDatesFrom,
} from "./working-days.ts";

const dates = (year: number) => bankHolidays(year).map((h) => h.date);

test("bank holidays match gov.uk's England and Wales list", () => {
  // https://www.gov.uk/bank-holidays (England and Wales).
  assert.deepEqual(dates(2026), ["2026-01-01", "2026-04-03", "2026-04-06", "2026-05-04", "2026-05-25", "2026-08-31", "2026-12-25", "2026-12-28"]);
  assert.deepEqual(dates(2027), ["2027-01-01", "2027-03-26", "2027-03-29", "2027-05-03", "2027-05-31", "2027-08-30", "2027-12-27", "2027-12-28"]);
  assert.deepEqual(dates(2025), ["2025-01-01", "2025-04-18", "2025-04-21", "2025-05-05", "2025-05-26", "2025-08-25", "2025-12-25", "2025-12-26"]);
  // The announced changes: the Jubilee weekend and the State Funeral (2022).
  assert.deepEqual(dates(2022), ["2022-01-03", "2022-04-15", "2022-04-18", "2022-05-02", "2022-06-02", "2022-06-03", "2022-08-29", "2022-09-19", "2022-12-26", "2022-12-27"]);
  // Christmas on a Sunday: Boxing Day keeps its Monday, Christmas takes the Tuesday.
  assert.equal(bankHolidayName("2022-12-26"), "Boxing Day");
  assert.equal(bankHolidayName("2022-12-27"), "Christmas Day");
  assert.equal(bankHolidayName("2026-12-28"), "Boxing Day");
  assert.equal(bankHolidayName("2026-12-25T10:00:00.000Z"), "Christmas Day", "a datetime counts by its date");
  assert.equal(bankHolidayName("2026-12-24"), null);
  assert.deepEqual(bankHolidays(Number.NaN), []);
});

test("a working day is a working weekday that isn't a bank holiday", () => {
  assert.equal(isWorkingDay("2026-12-24"), true, "Christmas Eve is a Thursday at work");
  assert.equal(isWorkingDay("2026-12-25"), false, "Christmas Day");
  assert.equal(isWorkingDay("2026-12-28"), false, "Boxing Day's substitute Monday");
  assert.equal(isWorkingDay("2027-01-01"), false, "New Year's Day");
  assert.equal(isWorkingDay("2026-12-26"), false, "a Saturday");
  assert.equal(isWorkingDay("2026-12-26", [1, 2, 3, 4, 5, 6]), true, "a Saturday when the business works Saturdays");
  assert.equal(isWorkingDay("2026-12-25", [1, 2, 3, 4, 5, 6, 7]), false, "a bank holiday even for a seven-day business");
  assert.equal(isWorkingDay("2026-11-02", []), true, "an empty list means Monday to Friday");
  assert.equal(notWorkingReason("2026-12-25"), "2026-12-25 is a bank holiday (Christmas Day)");
  assert.equal(notWorkingReason("2026-12-26"), "2026-12-26 isn't one of our working days");
  assert.equal(notWorkingReason("2026-12-24"), null);
});

test("moving by working days skips Christmas and New Year", () => {
  assert.equal(nextWorkingDay("2026-12-25"), "2026-12-29");
  assert.equal(prevWorkingDay("2026-12-28"), "2026-12-24");
  assert.equal(addWorkingDays("2026-12-23", 1), "2026-12-24");
  assert.equal(addWorkingDays("2026-12-23", 5), "2027-01-04", "24, 29, 30, 31 Dec, then Mon 4 Jan (1 Jan is a holiday)");
  assert.equal(addWorkingDays("2027-01-04", -5), "2026-12-23");
  assert.equal(addWorkingDays("2026-11-02", 0), "2026-11-02");
  // A three-day install from Wednesday 23 December: Wed, Thu, then Tuesday 29th.
  assert.deepEqual(workingDatesFrom("2026-12-23", 3), ["2026-12-23", "2026-12-24", "2026-12-29"]);
  assert.deepEqual(workingDatesFrom("2026-12-25", 2), ["2026-12-29", "2026-12-30"], "a holiday start rolls on");
  assert.deepEqual(workingDatesEnding("2026-12-29", 3), ["2026-12-23", "2026-12-24", "2026-12-29"]);
  assert.deepEqual(upcomingWorkingDays("2026-12-23", [1, 2, 3, 4, 5], 3), ["2026-12-24", "2026-12-29", "2026-12-30"]);
  // Easter 2027: Thursday 25 March, then Tuesday 30 March.
  assert.deepEqual(workingDatesFrom("2027-03-25", 2), ["2027-03-25", "2027-03-30"]);
});

test("supplier lead times and order-by dates count working days only", () => {
  // Five working days from Wednesday 23 December arrive on Monday 4 January, not Wednesday 30th.
  assert.equal(shiftWorkingDays("2026-12-23", 5), "2027-01-04");
  // Kit needed on site on Monday 4 January with a 5-day lead time: order by Wednesday 23 December.
  assert.equal(orderByDate("2027-01-04", 5), "2026-12-23");
  // Nothing ordered yet, from Monday 21 December: the usual 5-day lead time runs past both
  // Christmas holidays (22, 23, 24, 29, 30), not to Monday 28th.
  assert.equal(DEFAULT_SUPPLIER_LEAD_DAYS, 5);
  assert.equal(earliestKitArrival([], "2026-12-21"), "2026-12-30");
});
