import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtDate, fmtDayTime, fmtInstantDay, fmtInstantDayTime, londonDateOf, londonWallClock, money, unitWord } from "../lib/format.ts";

test("money: integer pence → £, pence only when non-zero, grouped thousands", () => {
  assert.equal(money(0), "£0");
  assert.equal(money(5), "£0.05");
  assert.equal(money(100), "£1");
  assert.equal(money(123_450), "£1,234.50");
  assert.equal(money(123_400), "£1,234");
  assert.equal(money(100_000_000), "£1,000,000");
  assert.equal(money(-15_000), "-£150");
  assert.equal(money(-1), "-£0.01");
  assert.equal(money(99.6), "£1", "rounds stray fractions of a penny");
  assert.equal(money(Number.NaN), "£-");
});

test("fmtDate: '3 Nov 2026' from a date or datetime, without Intl drift", () => {
  assert.equal(fmtDate("2026-11-03"), "3 Nov 2026");
  assert.equal(fmtDate("2026-11-03T10:00:00.000Z"), "3 Nov 2026");
  assert.equal(fmtDate("2027-01-31T23:59:59.000Z"), "31 Jan 2027", "London in winter is UTC");
  assert.equal(fmtDate("2026-10-18T23:30:00.000Z"), "19 Oct 2026", "00:30 BST is the 19th in London");
  assert.equal(fmtDate("2026-07-03T10:00:00.000Z"), "3 Jul 2026", "a booked slot keeps its date");
  assert.equal(fmtDate("not a date"), "not a date");
});

test("unitWord: plurals for bought units, rates and symbols unchanged", () => {
  assert.equal(unitWord("day", 3), "days");
  assert.equal(unitWord("day", 1), "day");
  assert.equal(unitWord("per m", 12), "per m", "a rate never becomes 'per ms'");
  assert.equal(unitWord("per kg", 2), "per kg");
  assert.equal(unitWord("m", 11), "m");
  assert.equal(unitWord("each", 2), "each");
  assert.equal(unitWord("pack of 100", 2), "packs of 100");
  assert.equal(unitWord("2 m length", 4), "2 m lengths");
  assert.equal(unitWord("50 m drum", 2), "50 m drums");
  assert.equal(unitWord("person-days", 6), "person-days");
});

test("instants print in London time; booked slots stay as stored", () => {
  // 22:04 UTC on 18 Oct is 23:04 BST.
  assert.equal(fmtInstantDayTime("2026-10-18T22:04:00.000Z"), "Sun 18 Oct, 23:04");
  assert.equal(fmtDayTime("2026-10-18T22:04:00.000Z"), "Sun 18 Oct, 22:04", "slots are wall-clock-as-UTC");
  // 23:30 UTC on 18 Oct is already the 19th in London.
  assert.equal(fmtInstantDay("2026-10-18T23:30:00.000Z"), "Mon 19 Oct");
  // GMT in winter: no shift.
  assert.equal(fmtInstantDayTime("2026-12-01T09:15:00.000Z"), "Tue 1 Dec, 09:15");
  assert.equal(londonWallClock("not a date"), "not a date");
  // A photo taken at 00:20 BST belongs to that London day (the end-of-day picker filters by it).
  assert.equal(londonDateOf("2026-10-18T23:20:00.000Z"), "2026-10-19");
  assert.equal(londonDateOf("2026-12-01T23:20:00.000Z"), "2026-12-01");
});
