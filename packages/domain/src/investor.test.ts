import assert from "node:assert/strict";
import { test } from "node:test";
import { PLAN_BASE, buildPlan } from "./finance.ts";
import {
  INVESTOR_BASE,
  buildInvestorMemo,
  buildMilestones,
  ltvModel,
  marketModel,
  roundModel,
  sensitivity,
  validationChecklist,
} from "./investor.ts";

test("LTV blends install contribution with the service plan", () => {
  const ltv = ltvModel(PLAN_BASE, INVESTOR_BASE);
  // service: 35% attach × £12 × 12 months × 5 years × 70% margin = £176
  assert.equal(ltv.serviceLtvGbp, 176);
  assert.equal(ltv.installContributionGbp, 1550);
  assert.equal(ltv.blendedLtvGbp, 1726);
  // CAC £170 with 15% referral share → £145 effective
  assert.equal(ltv.effectiveCacGbp, 145);
  assert.ok(ltv.ltvToCac > 10, `LTV:CAC ${ltv.ltvToCac} should be strong for direct mail`);
});

test("market sizing is bottom-up and the beachhead penetration stays credible", () => {
  const plan = buildPlan(PLAN_BASE);
  const market = marketModel(PLAN_BASE, INVESTOR_BASE, plan);
  assert.equal(market.tamGbp, INVESTOR_BASE.tamHouseholds * PLAN_BASE.avgOrderValueGbp);
  assert.ok(market.samGbp < market.tamGbp);
  assert.equal(market.somInstalls, plan.summary.year1.installs + plan.summary.year2.installs);
  assert.ok(
    market.beachheadPenetrationPct < 10,
    `plan should not claim implausible beachhead share (${market.beachheadPenetrationPct}%)`,
  );
});

test("round maths: post-money, investor share, founder share", () => {
  const round = roundModel(100000, { ...INVESTOR_BASE, preMoneyGbp: 900000, optionPoolPct: 10 });
  assert.equal(round.postMoneyGbp, 1000000);
  assert.equal(round.investorPct, 10);
  assert.equal(round.founderPct, 80);
});

test("sensitivity finds response rate as a top driver of the ask", () => {
  const rows = sensitivity(PLAN_BASE);
  assert.equal(rows.length, 5);
  const response = rows.find((r) => r.driver === "Mail response rate")!;
  assert.ok(response.askDeltaLowGbp > 0, "halving response should deepen the ask");
  for (const row of rows) {
    assert.ok(Number.isFinite(row.askDeltaLowGbp) && Number.isFinite(row.revenueDeltaHighGbp));
  }
});

test("milestones derive their months from the plan and stay ordered", () => {
  const plan = buildPlan(PLAN_BASE);
  const milestones = buildMilestones(plan, PLAN_BASE, INVESTOR_BASE);
  assert.ok(milestones.length >= 7);
  const dated = milestones.filter((m) => m.month !== null);
  for (let i = 1; i < dated.length; i++) {
    assert.ok(
      dated[i]!.month! >= dated[i - 1]!.month!,
      `${dated[i]!.title} should not land before ${dated[i - 1]!.title}`,
    );
  }
  const breakeven = milestones.find((m) => m.title === "Monthly breakeven")!;
  assert.equal(breakeven.month, plan.summary.breakevenMonth);
});

test("faster growth pulls the milestone dates in", () => {
  const base = buildMilestones(buildPlan(PLAN_BASE), PLAN_BASE, INVESTOR_BASE);
  const fast = { ...PLAN_BASE, monthlyGrowthPct: 45 };
  const quick = buildMilestones(buildPlan(fast), fast, INVESTOR_BASE);
  const pick = (list: typeof base, title: string) => list.find((m) => m.title === title)!.month;
  const baseRunRate = pick(base, "£1m revenue run-rate");
  const fastRunRate = pick(quick, "£1m revenue run-rate");
  assert.ok(
    fastRunRate !== null && (baseRunRate === null || fastRunRate < baseRunRate),
    `expected faster growth to pull £1m run-rate in (${baseRunRate} → ${fastRunRate})`,
  );
});

test("the validation checklist covers the load-bearing placeholders", () => {
  const items = validationChecklist(PLAN_BASE, INVESTOR_BASE);
  const names = items.map((i) => i.assumption.toLowerCase()).join(" ");
  for (const key of ["kit cost", "response rate", "labour", "pre-money", "service plan"]) {
    assert.ok(names.includes(key), `checklist missing ${key}`);
  }
  for (const item of items) {
    assert.ok(item.current.length > 0 && item.why.length > 0 && item.how.length > 0);
  }
});

test("the investor memo assembles from the live model and stays consistent", () => {
  const plan = buildPlan(PLAN_BASE);
  const memo = buildInvestorMemo(plan, PLAN_BASE, INVESTOR_BASE);
  const ltv = ltvModel(PLAN_BASE, INVESTOR_BASE);
  assert.ok(memo.includes("# Dang, It's Hot: seed memo"));
  assert.ok(memo.includes(`£${plan.summary.fundingNeedGbp / 1000}k`), "memo carries the ask");
  assert.ok(memo.includes(`${ltv.ltvToCac}:1`), "memo carries LTV:CAC");
  assert.ok(memo.includes(`month ${plan.summary.cashTrough.month}`), "memo carries the trough");
  assert.ok(memo.includes("## Milestones"));
  assert.ok(memo.includes("Series A window opens"));
  assert.ok(memo.includes("Gate:"));
  assert.ok(!memo.includes("—"), "no em dashes in the memo");
});

test("a flat plan leaves late milestones undated instead of inventing them", () => {
  const flat = { ...PLAN_BASE, installsMonth1: 1, monthlyGrowthPct: 0 };
  const milestones = buildMilestones(buildPlan(flat), flat, INVESTOR_BASE);
  assert.equal(milestones.find((m) => m.title === "£1m revenue run-rate")!.month, null);
  assert.equal(milestones.find((m) => m.title === "Series A window opens")!.month, null);
});
