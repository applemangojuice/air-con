import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PLAN_BASE,
  PLAN_SCENARIOS,
  buildPlan,
  unitEconomics,
  type PlanAssumptions,
} from "./finance.ts";

test("unit economics add up and CAC follows the letter maths", () => {
  const unit = unitEconomics(PLAN_BASE);
  assert.equal(unit.cogsGbp, 1250 + 450 + 60 + 90);
  assert.equal(unit.grossProfitGbp, 3400 - 1850);
  assert.equal(unit.grossMarginPct, 46);
  // win rate = 2% × 25% = 0.5% → 200 letters per install × £0.85 = £170
  assert.equal(unit.cacGbp, 170);
  assert.equal(unit.contributionGbp, 1550 - 170);
});

test("plan months compound demand and cap crews by capacity", () => {
  const plan = buildPlan({ ...PLAN_BASE, months: 12, installsMonth1: 10, monthlyGrowthPct: 30 });
  assert.equal(plan.months.length, 12);
  assert.equal(plan.months[0]!.installs, 10);
  assert.ok(plan.months[11]!.installs > plan.months[0]!.installs);
  const late = plan.months[11]!;
  assert.equal(late.crews, Math.ceil(late.installs / PLAN_BASE.installsPerCrewPerMonth));
  assert.ok(late.crews > 1, "growth should demand a second crew");
});

test("every month's P&L lines reconcile", () => {
  const plan = buildPlan(PLAN_BASE);
  for (const m of plan.months) {
    assert.equal(m.grossProfitGbp, m.revenueGbp - m.cogsGbp);
    assert.equal(m.ebitdaGbp, m.grossProfitGbp - m.marketingGbp - m.opexGbp);
  }
  // cash is the running sum of EBITDA, less the one-off setup costs
  const total = plan.months.reduce((n, m) => n + m.ebitdaGbp, 0);
  assert.equal(
    plan.months[plan.months.length - 1]!.cashGbp,
    Math.round(total - PLAN_BASE.setupCostsGbp),
  );
});

test("base scenario finds breakeven and a sane funding ask", () => {
  const plan = buildPlan(PLAN_BASE);
  assert.ok(plan.summary.breakevenMonth !== null, "base case should break even inside 24 months");
  assert.ok(plan.summary.cashTrough.amountGbp < 0, "early months burn cash");
  assert.ok(plan.summary.fundingNeedGbp >= PLAN_BASE.setupCostsGbp, "ask covers setup costs");
  assert.equal(plan.summary.fundingNeedGbp % 5000, 0, "ask rounds to £5k");
  assert.ok(
    plan.summary.fundingNeedGbp >= -plan.summary.cashTrough.amountGbp,
    "ask covers the trough plus buffer",
  );
});

test("setup costs deepen the trough pound for pound", () => {
  const lean = buildPlan({ ...PLAN_BASE, setupCostsGbp: 0 });
  const kitted = buildPlan({ ...PLAN_BASE, setupCostsGbp: 30000 });
  assert.equal(
    lean.summary.cashTrough.amountGbp - kitted.summary.cashTrough.amountGbp,
    30000,
  );
});

test("a plan that never breaks even reports null and a deep ask", () => {
  const bleak: PlanAssumptions = {
    ...PLAN_BASE,
    months: 12,
    installsMonth1: 0,
    monthlyGrowthPct: 0,
  };
  const plan = buildPlan(bleak);
  assert.equal(plan.summary.breakevenMonth, null);
  assert.ok(plan.summary.fundingNeedGbp > 0);
});

test("starting cash shifts the trough but not the P&L", () => {
  const broke = buildPlan(PLAN_BASE);
  const funded = buildPlan({ ...PLAN_BASE, startingCashGbp: 100000 });
  assert.equal(broke.months[3]!.ebitdaGbp, funded.months[3]!.ebitdaGbp);
  assert.equal(
    funded.summary.cashTrough.amountGbp - broke.summary.cashTrough.amountGbp,
    100000,
  );
});

test("scenarios order sensibly: ambitious out-earns base out-earns conservative", () => {
  const c = buildPlan(PLAN_SCENARIOS.conservative).summary.year2.revenueGbp;
  const b = buildPlan(PLAN_SCENARIOS.base).summary.year2.revenueGbp;
  const a = buildPlan(PLAN_SCENARIOS.ambitious).summary.year2.revenueGbp;
  assert.ok(c < b && b < a, `expected ${c} < ${b} < ${a}`);
});
