import { test } from "node:test";
import assert from "node:assert/strict";
import { judgeVacuumDecay } from "@aircon/domain";
import { parseReading, readingProblem } from "../components/field/reading.ts";

test("round 11: a thousands comma is never read as a decimal point: '1,250' is refused with both readings, a decimal comma still works", () => {
  for (const t of ["1,250", "1,050", "1,200", " 12,345,678 ", "-1,250"]) assert.equal(parseReading(t), null, t);
  assert.match(readingProblem("1,250", "micron") ?? "", /could be 1250 micron or 1\.25 micron: type 1250 \(no comma\), or use a point/);
  assert.match(readingProblem("1,200", "pounds") ?? "", /could be 1200 pounds or 1\.2 pounds/);
  // A decimal comma that can't be a thousands one, and plain numbers, as before.
  assert.equal(parseReading("12,5"), 12.5);
  assert.equal(parseReading("0,25"), 0.25);
  assert.equal(parseReading("0,125"), 0.125);
  assert.equal(parseReading("1,2500"), 1.25);
  assert.equal(parseReading(" 1250 "), 1250);
  assert.equal(parseReading("1.25"), 1.25);
  assert.equal(parseReading("-2"), -2);
  assert.equal(parseReading("1,250.5"), null);
  assert.equal(parseReading("abc"), null);
  assert.equal(readingProblem("12,5"), null, "nothing to explain");

  // The review's case: 400 reached, '1,250' after the hold. Read as 1.25 it passed; it's refused now, and 1250 fails as it should.
  const judge = (after: number) => judgeVacuumDecay({ reachedMicron: 400, afterMicron: after, holdMinutes: 60 }, { riseMaxMicron: 200, holdMinMinutes: 30 });
  assert.equal(judge(1.25).fails.length, 0, "what the old parse saved: a pass");
  assert.ok(judge(parseReading("1250")!).fails.some((f) => /Rose 850 micron/.test(f)));
});
