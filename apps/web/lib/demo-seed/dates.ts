import { isWorkingDay as sharedIsWorkingDay } from "@aircon/domain";

/**
 * Calendar helpers for the demo story. Dates are yyyy-mm-dd; times are ISO
 * instants. Appointment slots use the house convention (UK wall-clock
 * encoded as UTC: "…T10:00:00.000Z" is 10:00 in London).
 */

export function addDays(date: string, days: number): string {
  const d = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const dow = new Date(`${date.slice(0, 10)}T12:00:00Z`).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/** The domain's rule (working-days.ts): a working weekday that isn't a bank holiday, so the story never books Christmas Day. */
export function isWorkingDay(date: string, workingDays: number[] = [1, 2, 3, 4, 5]): boolean {
  return sharedIsWorkingDay(date, workingDays);
}

/** The date itself when it's a working day, else the next one. */
export function nextWorkingDay(date: string, workingDays?: number[]): string {
  let d = date.slice(0, 10);
  while (!isWorkingDay(d, workingDays)) d = addDays(d, 1);
  return d;
}

/** The date itself when it's a working day, else the one before. */
export function prevWorkingDay(date: string, workingDays?: number[]): string {
  let d = date.slice(0, 10);
  while (!isWorkingDay(d, workingDays)) d = addDays(d, -1);
  return d;
}

/** `n` consecutive working days starting on (or after) `start`. */
export function workingDaysFrom(start: string, n: number, workingDays?: number[]): string[] {
  const out: string[] = [];
  let d = nextWorkingDay(start, workingDays);
  while (out.length < n) {
    out.push(d);
    d = nextWorkingDay(addDays(d, 1), workingDays);
  }
  return out;
}

/** `n` consecutive working days ending on (or before) `end`. */
export function workingDaysEnding(end: string, n: number, workingDays?: number[]): string[] {
  const out: string[] = [];
  let d = prevWorkingDay(end, workingDays);
  while (out.length < n) {
    out.unshift(d);
    d = prevWorkingDay(addDays(d, -1), workingDays);
  }
  return out;
}

/** An instant on a day: at("2026-10-08", "09:30") → "2026-10-08T09:30:00.000Z". */
export function at(date: string, hhmm: string): string {
  return `${date.slice(0, 10)}T${hhmm}:00.000Z`;
}

/** Today in London (yyyy-mm-dd), the day the reducer's gates count from. */
export function londonDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
