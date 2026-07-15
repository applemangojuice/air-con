/**
 * Operations: scheduling & logistics + procurement & warehouse.
 *
 * Both modules derive everything from projects. A ScheduledJob is the thin
 * slice of a Project the ops planners need; the functions here are pure and
 * deterministic (dates in, plans out), same rules as the rest of the domain.
 */

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

export interface ScheduledJob {
  projectId: string;
  customer: string;
  postcode: string;
  outcode: string;
  stage: string;
  /** ISO date the install starts (booked). */
  installOn?: string;
  installDays: number;
  /** ISO datetime of the booked site visit. */
  siteVisitAt?: string;
  /** ISO date the kit is expected. */
  deliveryOn?: string;
  /** Outdoor unit labels from the quote, e.g. "3.5 kW outdoor unit". */
  systems: string[];
  /** Indoor units per room, e.g. "2.5 kW wall-mounted indoor unit". */
  roomUnits: string[];
}

/** Capacity assumptions for the current phase: one crew, founder does visits. */
export const OPS_CAPACITY = {
  installCrews: 1,
  siteVisitSlotsPerDay: 3,
  /** Courier days needed between placing the order and kit arriving. */
  supplierLeadDays: 5,
} as const;

/* ------------------------------------------------------------------ */
/* Date helpers                                                        */
/* ------------------------------------------------------------------ */

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isWeekend(iso: string): boolean {
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

/** Monday of the week containing the date. */
export function mondayOf(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  const shift = (d.getUTCDay() + 6) % 7;
  return addDays(iso, -shift);
}

/* ------------------------------------------------------------------ */
/* The schedule                                                        */
/* ------------------------------------------------------------------ */

export interface DayInstall {
  job: ScheduledJob;
  /** 1-based day of the install, e.g. day 2 of 3. */
  dayN: number;
  ofDays: number;
}

export interface ScheduleDay {
  date: string; // ISO date
  weekend: boolean;
  installs: DayInstall[];
  siteVisits: ScheduledJob[];
  deliveries: ScheduledJob[];
  /** More install crews needed than we have. */
  overbooked: boolean;
}

export interface StreetBatch {
  outcode: string;
  dates: string[];
  jobs: number;
}

export interface Schedule {
  days: ScheduleDay[];
  conflicts: { date: string; installs: number; capacity: number }[];
  /** Same outcode with multiple installs inside the window: batching wins. */
  batches: StreetBatch[];
  stats: {
    installsBooked: number;
    installDaysBooked: number;
    workingDays: number;
    utilisationPct: number;
    siteVisitsBooked: number;
  };
}

/**
 * Lay every booked job onto a day grid starting from `fromIso`, spanning
 * `weeks`. Multi-day installs occupy consecutive days from their start date.
 */
export function buildSchedule(jobs: ScheduledJob[], fromIso: string, weeks = 6): Schedule {
  const start = mondayOf(fromIso);
  const totalDays = weeks * 7;
  const byDate = new Map<string, ScheduleDay>();
  for (let i = 0; i < totalDays; i++) {
    const date = addDays(start, i);
    byDate.set(date, {
      date,
      weekend: isWeekend(date),
      installs: [],
      siteVisits: [],
      deliveries: [],
      overbooked: false,
    });
  }

  for (const job of jobs) {
    if (job.installOn) {
      const span = Math.max(1, Math.ceil(job.installDays));
      for (let n = 0; n < span; n++) {
        const day = byDate.get(addDays(job.installOn, n));
        if (day) day.installs.push({ job, dayN: n + 1, ofDays: span });
      }
    }
    if (job.siteVisitAt) {
      const day = byDate.get(job.siteVisitAt.slice(0, 10));
      if (day) day.siteVisits.push(job);
    }
    if (job.deliveryOn) {
      const day = byDate.get(job.deliveryOn.slice(0, 10));
      if (day) day.deliveries.push(job);
    }
  }

  const conflicts: Schedule["conflicts"] = [];
  let installDaysBooked = 0;
  for (const day of byDate.values()) {
    installDaysBooked += day.installs.length;
    if (day.installs.length > OPS_CAPACITY.installCrews) {
      day.overbooked = true;
      conflicts.push({
        date: day.date,
        installs: day.installs.length,
        capacity: OPS_CAPACITY.installCrews,
      });
    }
  }

  // Street batching: multiple installs sharing an outcode inside the window.
  const byOutcode = new Map<string, { dates: Set<string>; jobs: Set<string> }>();
  for (const job of jobs) {
    if (!job.installOn || !byDate.has(job.installOn)) continue;
    const entry = byOutcode.get(job.outcode) ?? { dates: new Set(), jobs: new Set() };
    entry.dates.add(job.installOn);
    entry.jobs.add(job.projectId);
    byOutcode.set(job.outcode, entry);
  }
  const batches: StreetBatch[] = [...byOutcode.entries()]
    .filter(([, e]) => e.jobs.size >= 2)
    .map(([outcode, e]) => ({ outcode, dates: [...e.dates].sort(), jobs: e.jobs.size }))
    .sort((a, b) => b.jobs - a.jobs);

  const workingDays = [...byDate.values()].filter((d) => !d.weekend).length;
  const installsBooked = jobs.filter((j) => j.installOn && byDate.has(j.installOn)).length;
  const siteVisitsBooked = jobs.filter(
    (j) => j.siteVisitAt && byDate.has(j.siteVisitAt.slice(0, 10)),
  ).length;

  return {
    days: [...byDate.values()],
    conflicts,
    batches,
    stats: {
      installsBooked,
      installDaysBooked,
      workingDays,
      utilisationPct: workingDays
        ? Math.round((installDaysBooked / (workingDays * OPS_CAPACITY.installCrews)) * 100)
        : 0,
      siteVisitsBooked,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Procurement                                                         */
/* ------------------------------------------------------------------ */

export interface BomLine {
  sku: string;
  label: string;
  qty: number;
}

/**
 * The standard bill of materials for one install, from the quote's unit
 * labels. Deliberately simple and template-shaped: one line per physical
 * thing the courier ships. Refined per-template as install actuals land.
 */
export function bomForJob(job: ScheduledJob): BomLine[] {
  const lines = new Map<string, BomLine>();
  const add = (sku: string, label: string, qty = 1) => {
    const existing = lines.get(sku);
    if (existing) existing.qty += qty;
    else lines.set(sku, { sku, label, qty });
  };

  for (const outdoor of job.systems) {
    const kw = outdoor.match(/(\d+(?:\.\d+)?)\s*kW/i)?.[1] ?? "3.5";
    add(`ou-${kw}`, `${kw} kW outdoor unit`);
    add("ou-mounting", "Outdoor mounting kit (feet, pads, brackets)");
    add("elec-kit", "Electrical kit (cable run, isolator, breaker)");
  }
  for (const unit of job.roomUnits) {
    const kw = unit.match(/(\d+(?:\.\d+)?)\s*kW/i)?.[1] ?? "2.5";
    add(`iu-${kw}`, `${kw} kW wall-mounted indoor unit`);
    add("pipe-kit-5m", "5 m pre-insulated pipe kit", 1);
    add("condensate-kit", "Condensate drain kit", 1);
    add("trunking-3m", "3 m trunking pack", 1);
  }
  add("consumables", "Consumables box (fixings, sealant, sleeves)");
  return [...lines.values()];
}

export interface ProcurementJob {
  job: ScheduledJob;
  /** Kit must be at the customer's on this date. */
  needOnSite: string;
  /** Last day to place the supplier order. */
  orderBy: string;
  /** Whether orderBy is already behind `today`. */
  late: boolean;
  bom: BomLine[];
}

export interface WeeklyOrder {
  weekOf: string; // Monday
  lines: BomLine[];
  jobs: number;
}

export interface ProcurementPlan {
  jobs: ProcurementJob[];
  /** Aggregated order book, grouped by the week the order must go in. */
  weekly: WeeklyOrder[];
  lateOrders: number;
}

/**
 * Turn booked installs into an order book: every job's BOM, when the kit
 * has to be on site (its delivery date), when the supplier order must go
 * in, and the aggregated weekly totals a warehouse would order against.
 */
export function buildProcurementPlan(jobs: ScheduledJob[], todayIso: string): ProcurementPlan {
  const today = todayIso.slice(0, 10);
  const relevant = jobs
    .filter((j) => j.installOn && (j.deliveryOn ?? j.installOn) >= today)
    .sort((a, b) => (a.deliveryOn ?? a.installOn!).localeCompare(b.deliveryOn ?? b.installOn!));

  const plan: ProcurementJob[] = relevant.map((job) => {
    const needOnSite = job.deliveryOn ?? addDays(job.installOn!, -2);
    const orderBy = addDays(needOnSite, -OPS_CAPACITY.supplierLeadDays);
    return { job, needOnSite, orderBy, late: orderBy < today, bom: bomForJob(job) };
  });

  const weeks = new Map<string, { lines: Map<string, BomLine>; jobs: number }>();
  for (const p of plan) {
    const weekOf = mondayOf(p.orderBy < today ? today : p.orderBy);
    const week = weeks.get(weekOf) ?? { lines: new Map(), jobs: 0 };
    week.jobs++;
    for (const line of p.bom) {
      const existing = week.lines.get(line.sku);
      if (existing) existing.qty += line.qty;
      else week.lines.set(line.sku, { ...line });
    }
    weeks.set(weekOf, week);
  }

  const weekly: WeeklyOrder[] = [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekOf, w]) => ({
      weekOf,
      jobs: w.jobs,
      lines: [...w.lines.values()].sort((a, b) => a.label.localeCompare(b.label)),
    }));

  return { jobs: plan, weekly, lateOrders: plan.filter((p) => p.late).length };
}
