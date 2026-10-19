import {
  DEFAULT_SUPPLIER_LEAD_DAYS,
  cancellationStatus,
  earliestInstallStart,
  earliestStartForKit,
  earlyStartRequestedOf,
  shiftWorkingDays,
  type PilotSettings,
  type Project,
} from "@aircon/domain";

/**
 * What the customer can pick on the portal: survey slots and install
 * blocks. Pure (the clock and other projects' bookings are parameters), so
 * the server computes exactly what the browser shows, the demo runs the
 * same code in the browser, and tests pin the rules.
 *
 * Dates are yyyy-mm-dd. Survey slots use the house convention: UK
 * wall-clock encoded as UTC (`2026-11-03T10:00:00.000Z` is 10:00 in London).
 */

/* ------------------------------------------------------------------ */
/* Date helpers (UTC noon arithmetic: no DST drift)                    */
/* ------------------------------------------------------------------ */

const MON_FRI = [1, 2, 3, 4, 5];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const noon = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`);

export function addDays(iso: string, days: number): string {
  const d = noon(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 1 = Monday … 7 = Sunday, as settings.scheduling.workingDays counts. */
export function isoWeekday(iso: string): number {
  const dow = noon(iso).getUTCDay();
  return dow === 0 ? 7 : dow;
}

const workingDaysOf = (settings: PilotSettings) =>
  settings.scheduling.workingDays.length ? settings.scheduling.workingDays : MON_FRI;

export function isWorkingDay(iso: string, workingDays: number[] = MON_FRI): boolean {
  return (workingDays.length ? workingDays : MON_FRI).includes(isoWeekday(iso));
}

/** The date itself when it's a working day, else the next one. */
export function nextWorkingDay(iso: string, workingDays: number[] = MON_FRI): string {
  let d = iso.slice(0, 10);
  for (let guard = 0; guard < 14 && !isWorkingDay(d, workingDays); guard++) d = addDays(d, 1);
  return d;
}

/** n working days after `iso` (the start day itself doesn't count). */
export function addWorkingDays(iso: string, n: number, workingDays: number[] = MON_FRI): string {
  let d = iso.slice(0, 10);
  for (let left = n; left > 0; ) {
    d = addDays(d, 1);
    if (isWorkingDay(d, workingDays)) left -= 1;
  }
  return d;
}

/** The Monday of the date's week: groups blocks by week. */
function weekOf(iso: string): string {
  return addDays(iso, -(isoWeekday(iso) - 1));
}

/** "Tue 4 Nov" */
export function shortDay(iso: string): string {
  const d = noon(iso);
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}`;
}

/** "Tue 4 – Thu 6 Nov", "Fri 30 Oct – Tue 3 Nov", or "Tue 4 Nov" for one day. */
export function blockLabel(dates: string[]): string {
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (!first || !last) return "";
  if (first === last) return shortDay(first);
  const a = noon(first);
  const b = noon(last);
  const sameMonth = a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear();
  const left = sameMonth ? `${DAY_NAMES[a.getUTCDay()]} ${a.getUTCDate()}` : shortDay(first);
  return `${left} – ${shortDay(last)}`;
}

/**
 * London's wall clock now, encoded the house way (as if it were UTC), so it
 * compares directly with slot datetimes. Intl only on the server or a modern
 * browser; tests pass the value in.
 */
export function londonWallClock(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:00.000Z`;
}

/* ------------------------------------------------------------------ */
/* Survey slots                                                        */
/* ------------------------------------------------------------------ */

export interface SurveySlot {
  /** UK wall clock encoded as UTC: what book-survey takes. */
  iso: string;
  date: string;
  /** "10:00" */
  time: string;
}

export interface SurveySlotDay {
  date: string;
  slots: SurveySlot[];
}

/** How far ahead a slot must start: a surveyor can't be in the van in ten minutes. */
export const SURVEY_MIN_NOTICE_MINUTES = 4 * 60;
/** The picker covers this many working days, today included. */
export const SURVEY_WINDOW_WORKING_DAYS = 10;

const SLOT_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

const minutes = (iso: string) => Date.parse(iso) / 60_000;

/**
 * The survey slots a customer can pick: settings' slot times on each of the
 * next 10 working days (today counts if any of its slots are far enough
 * ahead), minus anything already taken by another project's survey (any
 * overlap within the survey's length: one surveyor). `taken` holds other
 * projects' booked survey datetimes, same encoding. Days with nothing left
 * are left out.
 */
export function surveySlotDays(input: {
  settings: PilotSettings;
  /** londonWallClock(), the same encoding as slots. */
  nowWall: string;
  taken: string[];
  workingDays?: number;
  minNoticeMinutes?: number;
}): SurveySlotDay[] {
  const { settings, nowWall } = input;
  const wd = workingDaysOf(settings);
  const times = [...new Set(settings.scheduling.surveySlotTimes.filter((t) => SLOT_TIME.test(t)))].sort();
  const duration = Math.max(1, settings.scheduling.surveyDurationMinutes || 90);
  const earliest = minutes(nowWall) + (input.minNoticeMinutes ?? SURVEY_MIN_NOTICE_MINUTES);
  const taken = input.taken.filter((t) => Number.isFinite(Date.parse(t))).map(minutes);
  const want = input.workingDays ?? SURVEY_WINDOW_WORKING_DAYS;

  const out: SurveySlotDay[] = [];
  let day = nextWorkingDay(nowWall.slice(0, 10), wd);
  for (let counted = 0; counted < want; counted++) {
    const slots = times
      .map((time) => ({ iso: `${day}T${time}:00.000Z`, date: day, time }))
      .filter((s) => minutes(s.iso) >= earliest)
      .filter((s) => !taken.some((t) => Math.abs(t - minutes(s.iso)) < duration));
    if (slots.length) out.push({ date: day, slots });
    day = addWorkingDays(day, 1, wd);
  }
  return out;
}

/** Is this exact slot one the customer may book right now? (The server re-checks every booking.) */
export function isOfferedSlot(days: SurveySlotDay[], iso: string): boolean {
  return days.some((d) => d.slots.some((s) => s.iso === iso));
}

/* ------------------------------------------------------------------ */
/* Install blocks                                                      */
/* ------------------------------------------------------------------ */

export type EarliestReason = "lead-time" | "cancellation-ends" | "awaiting-delivery" | "early-start";

/**
 * The first start date the portal offers, and why. The reducer's own floor
 * (earliestInstallStart: lead time, plus the cancellation period once its
 * end is known) with one addition for supply-and-install with no early
 * start: until the kit is delivered the period's end isn't known, but it is
 * at least the cancellation days after the earliest the kit can reach the
 * customer's home (`kitArrivesOn`, from the orders: purchasing's
 * earliestKitArrival; without it, today plus the supplier's usual lead
 * time), so nothing earlier could ever pass the ready-to-install gate.
 * Offering it would only set the customer up for a move.
 */
export function earliestOfferedStart(
  project: Project,
  today: string,
  settings: PilotSettings,
  kitArrivesOn?: string,
): { date: string; reason: EarliestReason } {
  const base = earliestInstallStart(project, today, settings);
  if (earlyStartRequestedOf(project)) return { date: base, reason: "early-start" };
  const cs = cancellationStatus(project, today, settings);
  if (cs.endsOn) return { date: base, reason: base > addDays(today.slice(0, 10), 5) ? "cancellation-ends" : "lead-time" };
  if (cs.basis === "goods-delivery") {
    const arrival = kitArrivesOn ?? shiftWorkingDays(today.slice(0, 10), DEFAULT_SUPPLIER_LEAD_DAYS, workingDaysOf(settings));
    const floor = earliestStartForKit(project, today, settings, arrival);
    return floor > base ? { date: floor, reason: "awaiting-delivery" } : { date: base, reason: "lead-time" };
  }
  return { date: base, reason: "lead-time" };
}

export interface InstallBlock {
  startDate: string;
  dates: string[];
  label: string;
}

/** Install blocks of this many cards by default. */
export const INSTALL_BLOCK_OPTIONS = 6;

/** The planned rhythm (pilot plan §9): Monday prep, install from Tuesday. Preferred, never required. */
const PREFERRED_START_WEEKDAY = 2;

function longestRun(workingDays: number[]): number {
  let best = 0;
  for (let start = 1; start <= 7; start++) {
    let run = 0;
    while (run < 7 && workingDays.includes(((start - 1 + run) % 7) + 1)) run++;
    best = Math.max(best, run);
  }
  return best;
}

/**
 * Install blocks to offer: `installDays` consecutive working days from the
 * earliest offered start, none touching another project's booked dates (one
 * crew). One card per week, so the choice spans several weeks: the
 * Tuesday-start block when it's free, else that week's earliest. Blocks
 * that straddle a weekend only appear when the install is longer than a
 * working week allows.
 */
export function installBlockOptions(input: {
  project: Project;
  settings: PilotSettings;
  today: string;
  /** Every date (yyyy-mm-dd) other projects have booked or are installing on. */
  booked: string[];
  count?: number;
  horizonDays?: number;
  /** The earliest the kit can reach the customer's home (earliestOfferedStart). */
  kitArrivesOn?: string;
}): InstallBlock[] {
  const { project, settings } = input;
  const wd = workingDaysOf(settings);
  const n = Math.max(1, project.booking.installDays || settings.scheduling.installBlockDays || 1);
  const busy = new Set(input.booked.map((d) => d.slice(0, 10)));
  const allowStraddle = n > longestRun(wd);
  const start = earliestOfferedStart(project, input.today, settings, input.kitArrivesOn).date;
  const until = addDays(input.today.slice(0, 10), input.horizonDays ?? 180);
  const count = input.count ?? INSTALL_BLOCK_OPTIONS;

  const byWeek = new Map<string, InstallBlock[]>();
  for (let d = nextWorkingDay(start, wd); d <= until; d = addWorkingDays(d, 1, wd)) {
    const dates = [d];
    while (dates.length < n) dates.push(addWorkingDays(dates[dates.length - 1]!, 1, wd));
    if (dates.some((x) => busy.has(x))) continue;
    const straddles = dates.some((x, i) => i > 0 && addDays(dates[i - 1]!, 1) !== x);
    if (straddles && !allowStraddle) continue;
    const week = weekOf(d);
    byWeek.set(week, [...(byWeek.get(week) ?? []), { startDate: d, dates, label: blockLabel(dates) }]);
    if (byWeek.size > count) break;
  }

  return [...byWeek.values()]
    .slice(0, count)
    .map((blocks) => blocks.find((b) => isoWeekday(b.startDate) === PREFERRED_START_WEEKDAY) ?? blocks[0]!);
}

/**
 * Why the portal won't book these dates, or null when it would: the same
 * rules the cards are built from (not just "is it one of the cards", so a
 * page left open across midnight still books a block that's still fine).
 * The reducer checks lead time, working days and the cancellation period
 * again on top.
 */
export function blockProblem(input: {
  project: Project;
  settings: PilotSettings;
  today: string;
  booked: string[];
  dates: string[];
  kitArrivesOn?: string;
}): string | null {
  const { project, settings } = input;
  const wd = workingDaysOf(settings);
  const n = Math.max(1, project.booking.installDays || settings.scheduling.installBlockDays || 1);
  const dates = input.dates.map((d) => d.slice(0, 10));
  if (dates.length !== n) return `Pick ${n} install day${n === 1 ? "" : "s"}.`;
  for (let i = 1; i < dates.length; i++) {
    if (dates[i] !== addWorkingDays(dates[i - 1]!, 1, wd)) return "Install days must be back to back.";
  }
  if (!dates.every((d) => isWorkingDay(d, wd))) return "Install days must be working days.";
  const earliest = earliestOfferedStart(project, input.today, settings, input.kitArrivesOn).date;
  if (dates[0]! < earliest) return `The earliest we can start is ${shortDay(earliest)}.`;
  const busy = new Set(input.booked.map((d) => d.slice(0, 10)));
  if (dates.some((d) => busy.has(d))) return "Those dates have just been taken. Please pick another block.";
  return null;
}
