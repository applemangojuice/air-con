/**
 * Working days: the one rule every date calculation shares (install
 * blocks, survey slots, supplier lead times and order-by dates, proposal
 * turnaround, the customer's schedule). A working day is one of the
 * business's working weekdays (settings.scheduling.workingDays, Monday to
 * Friday by default) that isn't a bank holiday in England and Wales: no
 * install is booked on Christmas Day, and a supplier's "5 working days" from
 * 23 December doesn't count 25 and 28 December.
 *
 * Dates are yyyy-mm-dd (anything longer is cut to its date). Pure and
 * deterministic: the holidays are worked out from the rules gov.uk uses,
 * checked against its published list (working-days.test.ts), with the
 * one-off changes it has announced kept in BANK_HOLIDAY_CHANGES.
 */

/** 1 = Monday … 7 = Sunday, matching settings.scheduling.workingDays. */
export const MON_FRI: readonly number[] = [1, 2, 3, 4, 5];

const dateOf = (iso: string) => iso.slice(0, 10);

function noon(iso: string): Date {
  return new Date(`${dateOf(iso)}T12:00:00Z`);
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function plusDays(iso: string, days: number): string {
  const d = noon(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return ymd(d);
}

/** 1 = Monday … 7 = Sunday. */
export function isoWeekday(iso: string): number {
  const dow = noon(iso).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/** Easter Sunday (Gregorian, the anonymous algorithm). */
function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The first Monday of a month. */
function firstMonday(year: number, month: number): string {
  let d = `${year}-${pad(month)}-01`;
  while (isoWeekday(d) !== 1) d = plusDays(d, 1);
  return d;
}

/** The last Monday of a month. */
function lastMonday(year: number, month: number): string {
  const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month + 1)}-01`;
  let d = plusDays(nextMonth, -1);
  while (isoWeekday(d) !== 1) d = plusDays(d, -1);
  return d;
}

/**
 * Changes gov.uk has announced to the usual pattern, by year: a holiday
 * moved (`from` → `to`) or one added (`add`). None for 2026 or 2027; add a
 * line here when one is announced (a jubilee, a state occasion).
 */
export const BANK_HOLIDAY_CHANGES: Record<number, { from?: string; to?: string; add?: string; name: string }[]> = {
  2020: [{ from: "2020-05-04", to: "2020-05-08", name: "Early May bank holiday (VE day)" }],
  2022: [
    { from: "2022-05-30", to: "2022-06-02", name: "Spring bank holiday" },
    { add: "2022-06-03", name: "Platinum Jubilee bank holiday" },
    { add: "2022-09-19", name: "Bank Holiday for the State Funeral of Queen Elizabeth II" },
  ],
  2023: [{ add: "2023-05-08", name: "Bank holiday for the coronation of King Charles III" }],
};

/** England and Wales bank holidays in a year, in date order, with their names. */
export function bankHolidays(year: number): { date: string; name: string }[] {
  if (!Number.isInteger(year)) return [];
  const out: { date: string; name: string }[] = [];
  // New Year's Day: a weekend one moves to the Monday.
  let ny = `${year}-01-01`;
  while (isoWeekday(ny) > 5) ny = plusDays(ny, 1);
  out.push({ date: ny, name: "New Year’s Day" });
  const easter = easterSunday(year);
  out.push({ date: plusDays(easter, -2), name: "Good Friday" });
  out.push({ date: plusDays(easter, 1), name: "Easter Monday" });
  out.push({ date: firstMonday(year, 5), name: "Early May bank holiday" });
  out.push({ date: lastMonday(year, 5), name: "Spring bank holiday" });
  out.push({ date: lastMonday(year, 8), name: "Summer bank holiday" });
  // Christmas and Boxing Day: one on a weekday stays put; one at a weekend moves to the next
  // weekday the other hasn't taken (Christmas on a Sunday: Boxing Day Monday, Christmas Tuesday).
  const christmas = [
    { day: `${year}-12-25`, name: "Christmas Day" },
    { day: `${year}-12-26`, name: "Boxing Day" },
  ];
  const taken = new Set(christmas.filter((c) => isoWeekday(c.day) <= 5).map((c) => c.day));
  for (const c of christmas) {
    let d = c.day;
    if (isoWeekday(d) > 5) {
      while (isoWeekday(d) > 5 || taken.has(d)) d = plusDays(d, 1);
      taken.add(d);
    }
    out.push({ date: d, name: c.name });
  }
  for (const change of BANK_HOLIDAY_CHANGES[year] ?? []) {
    if (change.from && change.to) {
      const at = out.findIndex((h) => h.date === change.from);
      if (at >= 0) out[at] = { date: change.to, name: change.name };
    } else if (change.add) {
      out.push({ date: change.add, name: change.name });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

const byYear = new Map<number, Map<string, string>>();

function holidaysIn(year: number): Map<string, string> {
  let map = byYear.get(year);
  if (!map) {
    map = new Map(bankHolidays(year).map((h) => [h.date, h.name]));
    byYear.set(year, map);
  }
  return map;
}

/** The bank holiday on this date ("Christmas Day"), or null. */
export function bankHolidayName(iso: string): string | null {
  const d = dateOf(iso);
  const year = Number(d.slice(0, 4));
  if (!Number.isInteger(year)) return null;
  return holidaysIn(year).get(d) ?? null;
}

export function isBankHoliday(iso: string): boolean {
  return bankHolidayName(iso) !== null;
}

/** The working weekdays to use: the business's own, or Monday to Friday when that list is empty. */
const daysOf = (workingDays: readonly number[] | undefined): readonly number[] => (workingDays && workingDays.length ? workingDays : MON_FRI);

/** One of the business's working weekdays, and not a bank holiday. */
export function isWorkingDay(iso: string, workingDays: readonly number[] = MON_FRI): boolean {
  return daysOf(workingDays).includes(isoWeekday(iso)) && !isBankHoliday(iso);
}

/** The date itself when it's a working day, else the next one. */
export function nextWorkingDay(iso: string, workingDays: readonly number[] = MON_FRI): string {
  let d = dateOf(iso);
  for (let guard = 0; guard < 60 && !isWorkingDay(d, workingDays); guard++) d = plusDays(d, 1);
  return d;
}

/** The date itself when it's a working day, else the one before. */
export function prevWorkingDay(iso: string, workingDays: readonly number[] = MON_FRI): string {
  let d = dateOf(iso);
  for (let guard = 0; guard < 60 && !isWorkingDay(d, workingDays); guard++) d = plusDays(d, -1);
  return d;
}

/** Move n working days (negative goes back). The start day itself doesn't count. */
export function addWorkingDays(iso: string, n: number, workingDays: readonly number[] = MON_FRI): string {
  let d = dateOf(iso);
  const step = n < 0 ? -1 : 1;
  for (let left = Math.abs(Math.trunc(n)); left > 0; ) {
    d = plusDays(d, step);
    if (isWorkingDay(d, workingDays)) left -= 1;
  }
  return d;
}

/** `n` working days starting on `start` (or the next working day), in order. */
export function workingDatesFrom(start: string, n: number, workingDays: readonly number[] = MON_FRI): string[] {
  const out: string[] = [];
  let d = dateOf(start);
  for (let guard = 0; out.length < Math.max(0, n) && guard < 400; guard++) {
    if (isWorkingDay(d, workingDays)) out.push(d);
    d = plusDays(d, 1);
  }
  return out;
}

/** `n` working days ending on `end` (or the working day before it), in order. */
export function workingDatesEnding(end: string, n: number, workingDays: readonly number[] = MON_FRI): string[] {
  const out: string[] = [];
  let d = dateOf(end);
  for (let guard = 0; out.length < Math.max(0, n) && guard < 400; guard++) {
    if (isWorkingDay(d, workingDays)) out.unshift(d);
    d = plusDays(d, -1);
  }
  return out;
}

/** The next `count` working days after `today` (today itself isn't one of them). */
export function upcomingWorkingDays(today: string, workingDays: readonly number[], count: number): string[] {
  const out: string[] = [];
  let d = dateOf(today);
  for (let guard = 0; out.length < count && guard < 370; guard++) {
    d = plusDays(d, 1);
    if (isWorkingDay(d, workingDays)) out.push(d);
  }
  return out;
}

/**
 * Why a date isn't a working day, in plain words ("Fri 25 Dec is a bank
 * holiday (Christmas Day)"), or null when it is one. `fmt` writes the date.
 */
export function notWorkingReason(iso: string, workingDays: readonly number[] = MON_FRI, fmt: (iso: string) => string = dateOf): string | null {
  const holiday = bankHolidayName(iso);
  if (holiday) return `${fmt(iso)} is a bank holiday (${holiday})`;
  if (!daysOf(workingDays).includes(isoWeekday(iso))) return `${fmt(iso)} isn't one of our working days`;
  return null;
}
