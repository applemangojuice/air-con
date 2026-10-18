import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtDate, money } from "../lib/format.ts";

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
  assert.equal(fmtDate("2027-01-31T23:59:59.000Z"), "31 Jan 2027", "the stored date part, not the local one");
  assert.equal(fmtDate("not a date"), "not a date");
});
