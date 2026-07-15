import { buildPlan, unitEconomics, type Plan, type PlanAssumptions } from "./finance.ts";

/**
 * The seed investment case, built the way funds actually score it:
 *
 *  - Market: bottom-up TAM / SAM / SOM from household counts, never top-down
 *  - Unit economics: LTV with a service-plan attach, referral-adjusted CAC,
 *    LTV:CAC and payback multiples
 *  - The round: raise, pre-money, option pool → who owns what after
 *  - Sensitivity: which assumption actually moves the ask and year-2 revenue
 *  - Milestones: the goal timeline, DERIVED from the plan, so when the
 *    assumptions change the roadmap months move with them. Each milestone is
 *    tagged with the risk it retires, because a seed round is priced on
 *    de-risking, not on revenue.
 */

export interface InvestorAssumptions {
  /* LTV beyond the install */
  servicePlanMonthlyGbp: number;
  servicePlanAttachPct: number;
  servicePlanGrossMarginPct: number;
  servicePlanYears: number;
  /** Share of installs won by referral/word of mouth: they carry no CAC. */
  referralPct: number;

  /* Market sizing (suitable owner-occupied homes, not raw addresses) */
  beachheadHouseholds: number; // SW16 + SW17
  samHouseholds: number; // South London
  tamHouseholds: number; // UK

  /* The round */
  preMoneyGbp: number;
  optionPoolPct: number;
}

export const INVESTOR_BASE: InvestorAssumptions = {
  servicePlanMonthlyGbp: 12,
  servicePlanAttachPct: 35,
  servicePlanGrossMarginPct: 70,
  servicePlanYears: 5,
  referralPct: 15,
  beachheadHouseholds: 28000,
  samHouseholds: 450000,
  tamHouseholds: 6000000,
  preMoneyGbp: 900000,
  optionPoolPct: 10,
};

/* ------------------------------------------------------------------ */
/* LTV & CAC                                                           */
/* ------------------------------------------------------------------ */

export interface LtvModel {
  installContributionGbp: number;
  serviceLtvGbp: number;
  blendedLtvGbp: number;
  /** CAC after the referral share (referrals cost nothing to win). */
  effectiveCacGbp: number;
  ltvToCac: number;
  /** How many times over the first install's contribution repays its CAC. */
  cacCoverage: number;
}

export function ltvModel(a: PlanAssumptions, inv: InvestorAssumptions): LtvModel {
  const unit = unitEconomics(a);
  const serviceLtvGbp = Math.round(
    (inv.servicePlanAttachPct / 100) *
      inv.servicePlanMonthlyGbp *
      12 *
      inv.servicePlanYears *
      (inv.servicePlanGrossMarginPct / 100),
  );
  const blendedLtvGbp = unit.grossProfitGbp + serviceLtvGbp;
  const effectiveCacGbp = Math.round(unit.cacGbp * (1 - inv.referralPct / 100));
  return {
    installContributionGbp: unit.grossProfitGbp,
    serviceLtvGbp,
    blendedLtvGbp,
    effectiveCacGbp,
    ltvToCac: effectiveCacGbp > 0 ? Math.round((blendedLtvGbp / effectiveCacGbp) * 10) / 10 : 0,
    cacCoverage:
      effectiveCacGbp > 0 ? Math.round((unit.grossProfitGbp / effectiveCacGbp) * 10) / 10 : 0,
  };
}

/* ------------------------------------------------------------------ */
/* Market sizing (bottom-up)                                           */
/* ------------------------------------------------------------------ */

export interface MarketModel {
  tamGbp: number;
  samGbp: number;
  /** What the plan actually captures: installs over the horizon. */
  somInstalls: number;
  somGbp: number;
  /** Plan installs as a share of the beachhead: the credibility check. */
  beachheadPenetrationPct: number;
}

export function marketModel(
  a: PlanAssumptions,
  inv: InvestorAssumptions,
  plan: Plan,
): MarketModel {
  const totalInstalls = plan.months.reduce((n, m) => n + m.installs, 0);
  return {
    tamGbp: inv.tamHouseholds * a.avgOrderValueGbp,
    samGbp: inv.samHouseholds * a.avgOrderValueGbp,
    somInstalls: totalInstalls,
    somGbp: totalInstalls * a.avgOrderValueGbp,
    beachheadPenetrationPct:
      inv.beachheadHouseholds > 0
        ? Math.round((totalInstalls / inv.beachheadHouseholds) * 1000) / 10
        : 0,
  };
}

/* ------------------------------------------------------------------ */
/* The round                                                           */
/* ------------------------------------------------------------------ */

export interface RoundModel {
  raiseGbp: number;
  preMoneyGbp: number;
  postMoneyGbp: number;
  investorPct: number;
  optionPoolPct: number;
  founderPct: number;
}

export function roundModel(raiseGbp: number, inv: InvestorAssumptions): RoundModel {
  const postMoneyGbp = inv.preMoneyGbp + raiseGbp;
  const investorPct = postMoneyGbp > 0 ? Math.round((raiseGbp / postMoneyGbp) * 1000) / 10 : 0;
  const founderPct = Math.max(0, Math.round((100 - investorPct - inv.optionPoolPct) * 10) / 10);
  return {
    raiseGbp,
    preMoneyGbp: inv.preMoneyGbp,
    postMoneyGbp,
    investorPct,
    optionPoolPct: inv.optionPoolPct,
    founderPct,
  };
}

/* ------------------------------------------------------------------ */
/* Sensitivity: what actually moves the numbers                        */
/* ------------------------------------------------------------------ */

export interface SensitivityRow {
  driver: string;
  low: string;
  high: string;
  /** Change in the funding ask, £ (negative = smaller raise needed). */
  askDeltaLowGbp: number;
  askDeltaHighGbp: number;
  /** Change in year-2 revenue, £. */
  revenueDeltaLowGbp: number;
  revenueDeltaHighGbp: number;
}

export function sensitivity(a: PlanAssumptions): SensitivityRow[] {
  // The published ask rounds to £5k, which would mask small-but-real moves,
  // so the tornado compares the raw cash requirement (trough + 25% buffer).
  const rawNeed = (p: Plan) =>
    p.summary.cashTrough.amountGbp < 0 ? -p.summary.cashTrough.amountGbp * 1.25 : 0;
  const base = buildPlan(a);
  const run = (patch: Partial<PlanAssumptions>) => buildPlan({ ...a, ...patch });
  const row = (
    driver: string,
    low: string,
    high: string,
    lowPatch: Partial<PlanAssumptions>,
    highPatch: Partial<PlanAssumptions>,
  ): SensitivityRow => {
    const lowPlan = run(lowPatch);
    const highPlan = run(highPatch);
    return {
      driver,
      low,
      high,
      askDeltaLowGbp: Math.round(rawNeed(lowPlan) - rawNeed(base)),
      askDeltaHighGbp: Math.round(rawNeed(highPlan) - rawNeed(base)),
      revenueDeltaLowGbp: lowPlan.summary.year2.revenueGbp - base.summary.year2.revenueGbp,
      revenueDeltaHighGbp: highPlan.summary.year2.revenueGbp - base.summary.year2.revenueGbp,
    };
  };

  const r = a.responseRatePct;
  const g = a.monthlyGrowthPct;
  const aov = a.avgOrderValueGbp;
  const kit = a.kitCostGbp;
  const draw = a.founderDrawGbp;
  return [
    row(
      "Mail response rate",
      `${(r * 0.5).toFixed(1)}%`,
      `${(r * 1.5).toFixed(1)}%`,
      { responseRatePct: r * 0.5 },
      { responseRatePct: r * 1.5 },
    ),
    row(
      "Monthly growth",
      `${Math.round(g * 0.6)}%`,
      `${Math.round(g * 1.4)}%`,
      { monthlyGrowthPct: g * 0.6 },
      { monthlyGrowthPct: g * 1.4 },
    ),
    row(
      "Order value",
      `£${Math.round(aov * 0.9)}`,
      `£${Math.round(aov * 1.1)}`,
      { avgOrderValueGbp: Math.round(aov * 0.9) },
      { avgOrderValueGbp: Math.round(aov * 1.1) },
    ),
    row(
      "Kit cost",
      `£${Math.round(kit * 1.15)}`,
      `£${Math.round(kit * 0.85)}`,
      { kitCostGbp: Math.round(kit * 1.15) },
      { kitCostGbp: Math.round(kit * 0.85) },
    ),
    row(
      "Founder draw",
      `£${Math.round(draw * 1.5)}`,
      `£${Math.round(draw * 0.5)}`,
      { founderDrawGbp: Math.round(draw * 1.5) },
      { founderDrawGbp: Math.round(draw * 0.5) },
    ),
  ];
}

/* ------------------------------------------------------------------ */
/* The goal timeline                                                   */
/* ------------------------------------------------------------------ */

export type MilestoneProof = "product" | "market" | "economics" | "execution" | "scale";

export interface Milestone {
  /** Plan month it lands in; null when it doesn't happen inside the horizon. */
  month: number | null;
  title: string;
  detail: string;
  proves: MilestoneProof;
  kpi: string;
}

/** First month where the cumulative install count reaches `n`. */
function monthOfCumulativeInstalls(plan: Plan, n: number): number | null {
  let total = 0;
  for (const m of plan.months) {
    total += m.installs;
    if (total >= n) return m.month;
  }
  return null;
}

function monthOfRunRate(plan: Plan, annualGbp: number): number | null {
  return plan.months.find((m) => m.revenueGbp * 12 >= annualGbp)?.month ?? null;
}

/**
 * The road from cheque to Series A, derived from the live plan. Fixed
 * strategic gates (platform, first mailing) sit at the start; everything
 * else is computed, so cranking growth visibly pulls the dates in.
 */
export function buildMilestones(
  plan: Plan,
  a: PlanAssumptions,
  inv: InvestorAssumptions,
): Milestone[] {
  const ltv = ltvModel(a, inv);
  const crew2 = plan.months.find((m) => m.crews >= 2)?.month ?? null;
  const runRate1m = monthOfRunRate(plan, 1_000_000);
  const seriesAReady =
    runRate1m !== null && plan.summary.breakevenMonth !== null
      ? Math.max(runRate1m, plan.summary.breakevenMonth)
      : null;

  const milestones: Milestone[] = [
    {
      month: 1,
      title: "Platform live in the beachhead",
      detail:
        "Quote funnel, project timeline, property intelligence and the console running in SW16/SW17. First 5,000-letter mailing out with per-address pages.",
      proves: "product",
      kpi: "5,000 letters · funnel conversion measured",
    },
    {
      month: monthOfCumulativeInstalls(plan, 1),
      title: "First revenue install",
      detail:
        "A stranger (not a friendly) goes quote → site visit → install on the standard price and template.",
      proves: "product",
      kpi: "1 install · 1-day fit · reference customer",
    },
    {
      month: monthOfCumulativeInstalls(plan, 10),
      title: "Template model proven",
      detail:
        "Ten installs across at least three archetypes with no bespoke design work. Install actuals feeding back into templates and pricing.",
      proves: "market",
      kpi: "10 installs · ≥3 archetypes · actuals captured",
    },
    {
      month: monthOfCumulativeInstalls(plan, 25),
      title: "Repeatable acquisition",
      detail: `Mailing CAC holds at ~£${ltv.effectiveCacGbp} across multiple campaigns; referrals appearing. LTV:CAC ${ltv.ltvToCac}:1 with the service plan attached.`,
      proves: "economics",
      kpi: `CAC ≤ £${Math.max(50, Math.round(ltv.effectiveCacGbp * 1.3))} · LTV:CAC ≥ 3`,
    },
    {
      month: plan.summary.breakevenMonth,
      title: "Monthly breakeven",
      detail:
        "EBITDA turns positive. The raise stops funding losses and starts funding growth: every pound after this buys expansion, not survival.",
      proves: "economics",
      kpi: "EBITDA ≥ £0 · gross margin ≥ 45%",
    },
    {
      month: crew2,
      title: "Second crew, founder off the tools",
      detail:
        "Demand passes one crew's capacity. The playbooks and installer app spec have to work without the founder on site: the first real test of the operating system.",
      proves: "execution",
      kpi: `>${a.installsPerCrewPerMonth} installs/month · crew 2 at ≥80% utilisation`,
    },
    {
      month: runRate1m,
      title: "£1m revenue run-rate",
      detail:
        "Monthly revenue passes £83k. Expansion postcodes live across South London, property book past 100k homes.",
      proves: "scale",
      kpi: "£83k+/month · 3+ outcodes active",
    },
    {
      month: seriesAReady,
      title: "Series A window opens",
      detail:
        "Profitable, growing, with proprietary data compounding. Raise A to industrialise: warehouse, crews 3-5, national playbook. Or don't, and keep compounding.",
      proves: "scale",
      kpi: "£1m+ run-rate · LTV:CAC ≥ 3 · breakeven behind you",
    },
  ];

  // Chronological, with undated (beyond-the-plan) milestones at the end.
  return milestones.sort((x, y) => {
    if (x.month === null && y.month === null) return 0;
    if (x.month === null) return 1;
    if (y.month === null) return -1;
    return x.month - y.month;
  });
}
