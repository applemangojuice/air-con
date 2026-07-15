/**
 * Finance: the business case and P&L planning model.
 *
 * One pure function turns a set of assumptions into a monthly P&L,
 * cumulative cash, breakeven month and the funding ask. Two jobs:
 * managing costs (every cost line is explicit and tweakable) and raising
 * investment (the cash trough plus a buffer IS the raise).
 *
 * Deterministic and dependency-free like the rest of the domain, so the
 * planner UI recomputes live and tests pin the maths down.
 */

export interface PlanAssumptions {
  /** Planning horizon in months (24-36 is typical for a raise). */
  months: number;
  /** Cash in the bank at month 1, before any raise. */
  startingCashGbp: number;
  /** One-off startup costs hitting month 1: van, tools, stock buffer, brand. */
  setupCostsGbp: number;

  /* Demand */
  installsMonth1: number;
  monthlyGrowthPct: number;
  /** Hard ceiling per crew per month; crews scale up as demand passes it. */
  installsPerCrewPerMonth: number;

  /* Unit economics, per install */
  avgOrderValueGbp: number;
  kitCostGbp: number;
  labourCostGbp: number;
  courierCostGbp: number;
  /** Consumables, warranty reserve, snags. */
  otherDirectGbp: number;

  /* Customer acquisition via addressed mail (the intel engine's channel) */
  mailCostGbp: number;
  responseRatePct: number;
  quoteToInstallPct: number;

  /* Overheads, per month */
  founderDrawGbp: number;
  /** Van, insurance, warehouse space, software, accounting. */
  opexMonthlyGbp: number;
  /** Fixed cost per crew beyond the first (vehicle, tools, training). */
  extraCrewMonthlyGbp: number;
}

export interface PlanMonth {
  month: number; // 1-based
  installs: number;
  crews: number;
  lettersMailed: number;
  revenueGbp: number;
  cogsGbp: number;
  grossProfitGbp: number;
  grossMarginPct: number;
  marketingGbp: number;
  opexGbp: number;
  ebitdaGbp: number;
  cashGbp: number; // cumulative, end of month
}

export interface UnitEconomics {
  revenueGbp: number;
  kitGbp: number;
  labourGbp: number;
  courierGbp: number;
  otherGbp: number;
  cogsGbp: number;
  grossProfitGbp: number;
  grossMarginPct: number;
  /** Mailing spend per won install: letters needed × letter cost. */
  cacGbp: number;
  contributionGbp: number; // gross profit minus CAC
}

export interface PlanSummary {
  /** First month where EBITDA turns positive; null if never inside horizon. */
  breakevenMonth: number | null;
  /** Deepest cumulative cash position. */
  cashTrough: { month: number; amountGbp: number };
  /** The raise: the trough (if negative) plus a 25% buffer, rounded up. */
  fundingNeedGbp: number;
  year1: { revenueGbp: number; grossProfitGbp: number; ebitdaGbp: number; installs: number };
  year2: { revenueGbp: number; grossProfitGbp: number; ebitdaGbp: number; installs: number };
  endCashGbp: number;
  maxCrews: number;
  totalLetters: number;
}

export interface Plan {
  months: PlanMonth[];
  unit: UnitEconomics;
  summary: PlanSummary;
}

export function unitEconomics(a: PlanAssumptions): UnitEconomics {
  const cogsGbp = a.kitCostGbp + a.labourCostGbp + a.courierCostGbp + a.otherDirectGbp;
  const grossProfitGbp = a.avgOrderValueGbp - cogsGbp;
  const winRate = (a.responseRatePct / 100) * (a.quoteToInstallPct / 100);
  const cacGbp = winRate > 0 ? Math.round(a.mailCostGbp / winRate) : 0;
  return {
    revenueGbp: a.avgOrderValueGbp,
    kitGbp: a.kitCostGbp,
    labourGbp: a.labourCostGbp,
    courierGbp: a.courierCostGbp,
    otherGbp: a.otherDirectGbp,
    cogsGbp,
    grossProfitGbp,
    grossMarginPct: a.avgOrderValueGbp
      ? Math.round((grossProfitGbp / a.avgOrderValueGbp) * 100)
      : 0,
    cacGbp,
    contributionGbp: grossProfitGbp - cacGbp,
  };
}

export function buildPlan(a: PlanAssumptions): Plan {
  const unit = unitEconomics(a);
  const winRate = (a.responseRatePct / 100) * (a.quoteToInstallPct / 100);

  const months: PlanMonth[] = [];
  let cash = a.startingCashGbp - a.setupCostsGbp;
  let demand = a.installsMonth1;

  for (let m = 1; m <= a.months; m++) {
    const installs = Math.max(0, Math.round(demand));
    const crews = Math.max(1, Math.ceil(installs / Math.max(1, a.installsPerCrewPerMonth)));
    const lettersMailed = winRate > 0 ? Math.ceil(installs / winRate) : 0;

    const revenueGbp = installs * a.avgOrderValueGbp;
    const cogsGbp = installs * unit.cogsGbp;
    const grossProfitGbp = revenueGbp - cogsGbp;
    const marketingGbp = Math.round(lettersMailed * a.mailCostGbp);
    const opexGbp =
      a.founderDrawGbp + a.opexMonthlyGbp + (crews - 1) * a.extraCrewMonthlyGbp;
    const ebitdaGbp = grossProfitGbp - marketingGbp - opexGbp;
    cash += ebitdaGbp;

    months.push({
      month: m,
      installs,
      crews,
      lettersMailed,
      revenueGbp,
      cogsGbp,
      grossProfitGbp,
      grossMarginPct: revenueGbp ? Math.round((grossProfitGbp / revenueGbp) * 100) : 0,
      marketingGbp,
      opexGbp,
      ebitdaGbp,
      cashGbp: Math.round(cash),
    });

    demand *= 1 + a.monthlyGrowthPct / 100;
  }

  const breakevenMonth = months.find((m) => m.ebitdaGbp >= 0)?.month ?? null;
  let trough = { month: 1, amountGbp: months[0]?.cashGbp ?? a.startingCashGbp };
  for (const m of months) {
    if (m.cashGbp < trough.amountGbp) trough = { month: m.month, amountGbp: m.cashGbp };
  }
  const fundingNeedGbp =
    trough.amountGbp < 0 ? Math.ceil((-trough.amountGbp * 1.25) / 5000) * 5000 : 0;

  const sum = (slice: PlanMonth[]) => ({
    revenueGbp: slice.reduce((n, m) => n + m.revenueGbp, 0),
    grossProfitGbp: slice.reduce((n, m) => n + m.grossProfitGbp, 0),
    ebitdaGbp: slice.reduce((n, m) => n + m.ebitdaGbp, 0),
    installs: slice.reduce((n, m) => n + m.installs, 0),
  });

  return {
    months,
    unit,
    summary: {
      breakevenMonth,
      cashTrough: trough,
      fundingNeedGbp,
      year1: sum(months.slice(0, 12)),
      year2: sum(months.slice(12, 24)),
      endCashGbp: months[months.length - 1]?.cashGbp ?? a.startingCashGbp,
      maxCrews: Math.max(1, ...months.map((m) => m.crews)),
      totalLetters: months.reduce((n, m) => n + m.lettersMailed, 0),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Scenarios                                                           */
/* ------------------------------------------------------------------ */

export const PLAN_BASE: PlanAssumptions = {
  months: 24,
  startingCashGbp: 0,
  setupCostsGbp: 25000,
  installsMonth1: 2,
  monthlyGrowthPct: 25,
  installsPerCrewPerMonth: 16,
  avgOrderValueGbp: 3400,
  kitCostGbp: 1250,
  labourCostGbp: 450,
  courierCostGbp: 60,
  otherDirectGbp: 90,
  mailCostGbp: 0.85,
  responseRatePct: 2,
  quoteToInstallPct: 25,
  founderDrawGbp: 3000,
  opexMonthlyGbp: 1800,
  extraCrewMonthlyGbp: 2200,
};

export const PLAN_SCENARIOS: Record<"conservative" | "base" | "ambitious", PlanAssumptions> = {
  conservative: {
    ...PLAN_BASE,
    installsMonth1: 1,
    monthlyGrowthPct: 15,
    responseRatePct: 1.2,
    avgOrderValueGbp: 3100,
  },
  base: PLAN_BASE,
  ambitious: {
    ...PLAN_BASE,
    installsMonth1: 3,
    monthlyGrowthPct: 35,
    responseRatePct: 3,
    avgOrderValueGbp: 3600,
  },
};
