import type { Project, PurchaseOrder, StaffRole } from "@aircon/domain";

/**
 * The ops calendar as data: pure, no I/O, no clock (today is passed in), so
 * the date maths and the conflict rules are tested directly
 * (tests/calendar.test.ts). Dates are yyyy-mm-dd; survey times are UK
 * wall-clock encoded as UTC, so the time is read in UTC.
 *
 * Honest states, as everywhere: an install is "confirmed" only once the
 * booking is, a delivery is "expected" on an ETA and "delivered" only once a
 * person recorded it, commissioning and handover are "planned" until they
 * happen.
 */

export type CalEventKind = "survey" | "install" | "delivery" | "handover";
export type CalEventState = "confirmed" | "tentative" | "expected" | "done" | "planned";

export interface CalCrew {
  staffId: string;
  name: string;
  role: StaffRole;
}

export interface CalEvent {
  id: string;
  kind: CalEventKind;
  date: string;
  /** "10:00" for surveys. */
  time?: string;
  projectId: string;
  customer: string;
  address: string;
  postcode: string;
  /** One line: what it is. */
  title: string;
  state: CalEventState;
  /** Install day n of N. */
  dayN?: number;
  ofDays?: number;
  crew: CalCrew[];
  /** Where clicking goes. */
  href: string;
}

const DAY_MS = 86_400_000;
const dateOf = (iso: string) => iso.slice(0, 10);
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) && Number.isFinite(Date.parse(s.slice(0, 10)));

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${dateOf(iso)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 1 = Monday … 7 = Sunday (settings.scheduling.workingDays). */
export function isoWeekday(iso: string): number {
  const dow = new Date(`${dateOf(iso)}T12:00:00Z`).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/** Monday of the week the date is in. */
export function mondayOf(iso: string): string {
  return addDaysIso(iso, 1 - isoWeekday(iso));
}

/** `n` working days starting on `start` (or the next working day), in order. */
export function workingDatesFrom(start: string, n: number, workingDays: number[] = [1, 2, 3, 4, 5]): string[] {
  const days = workingDays.length ? workingDays : [1, 2, 3, 4, 5];
  const out: string[] = [];
  let d = dateOf(start);
  for (let guard = 0; out.length < Math.max(0, n) && guard < 400; guard++) {
    if (days.includes(isoWeekday(d))) out.push(d);
    d = addDaysIso(d, 1);
  }
  return out;
}

/** "2026-11" → its weeks, Monday first, each seven dates (spilling into the months either side). */
export function monthGrid(month: string): string[][] {
  const first = `${month.slice(0, 7)}-01`;
  const start = mondayOf(first);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0, 12)).toISOString().slice(0, 10);
  const weeks: string[][] = [];
  for (let wk = start; wk <= last; wk = addDaysIso(wk, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDaysIso(wk, i)));
  }
  return weeks;
}

/** The seven dates of the week containing `date`, Monday first. */
export function weekDates(date: string): string[] {
  const mon = mondayOf(date);
  return Array.from({ length: 7 }, (_, i) => addDaysIso(mon, i));
}

/** "2026-11" ± months. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1, 12));
  return d.toISOString().slice(0, 7);
}

export type CalView = "month" | "week" | "day";

/** The view, anchor date and range a URL asks for, with safe defaults. */
export function calendarRange(input: { view?: string; date?: string }, today: string): { view: CalView; date: string; from: string; to: string } {
  const view: CalView = input.view === "week" || input.view === "day" ? input.view : "month";
  const date = isDate(input.date) ? dateOf(input.date) : today;
  if (view === "day") return { view, date, from: date, to: date };
  if (view === "week") {
    const days = weekDates(date);
    return { view, date, from: days[0]!, to: days[6]! };
  }
  const weeks = monthGrid(date.slice(0, 7));
  return { view, date, from: weeks[0]![0]!, to: weeks.at(-1)![6]! };
}

/** Where the arrows go. */
export function stepDate(view: CalView, date: string, delta: number): string {
  if (view === "day") return addDaysIso(date, delta);
  if (view === "week") return addDaysIso(date, delta * 7);
  return `${shiftMonth(date.slice(0, 7), delta)}-01`;
}

function timeOf(iso: string): string | undefined {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return undefined;
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** Every calendar event one project contributes: survey, install days, deliveries, commissioning and handover. */
export function eventsForProject(project: Project, pos: PurchaseOrder[]): CalEvent[] {
  const p = project;
  const base = {
    projectId: p.id,
    customer: p.customer.name || "Customer",
    address: p.customer.addressLine,
    postcode: p.customer.postcode,
  };
  const out: CalEvent[] = [];
  const cancelled = p.closure.closed && p.closure.reason === "cancelled";
  if (cancelled) return out;

  if (p.survey.scheduledFor && isDate(p.survey.scheduledFor)) {
    const done = p.survey.status === "submitted";
    out.push({
      ...base,
      id: `${p.id}:survey`,
      kind: "survey",
      date: dateOf(p.survey.scheduledFor),
      ...(timeOf(p.survey.scheduledFor) ? { time: timeOf(p.survey.scheduledFor) } : {}),
      title: p.survey.mode === "video" ? "Video survey" : "Home survey",
      state: done ? "done" : "confirmed",
      crew: p.survey.surveyor ? [{ staffId: p.survey.surveyor.staffId, name: p.survey.surveyor.name, role: "surveyor" }] : [],
      href: `/ops/projects/${p.id}`,
    });
  }

  const crew: CalCrew[] = p.booking.crew.map((c) => ({ staffId: c.staffId, name: c.name, role: c.role }));
  const planned = p.booking.dates.filter(isDate).map(dateOf);
  const ofDays = planned.length;
  // Days that actually happened replace the plan (an overrun day is real too).
  const actual = new Map(p.install.days.filter((d) => d.startedAt).map((d) => [d.n, d]));
  const dayCount = Math.max(ofDays, ...[...actual.keys(), 0]);
  for (let n = 1; n <= dayCount; n++) {
    const a = actual.get(n);
    const date = a ? dateOf(a.date) : planned[n - 1];
    if (!date) continue;
    const state: CalEventState = a ? "done" : p.booking.status === "booked" ? "confirmed" : "tentative";
    out.push({
      ...base,
      id: `${p.id}:install:${n}`,
      kind: "install",
      date,
      title: `Install day ${n}${ofDays && n <= ofDays ? ` of ${ofDays}` : ""}`,
      state: a && a.status === "in-progress" ? "confirmed" : state,
      dayN: n,
      ...(ofDays ? { ofDays } : {}),
      crew,
      href: `/ops/projects/${p.id}/booking`,
    });
  }

  for (const po of pos) {
    if (po.status === "cancelled") continue;
    const delivered = po.deliveredAt && isDate(po.deliveredAt);
    const date = delivered ? dateOf(po.deliveredAt!) : po.eta && isDate(po.eta) ? dateOf(po.eta) : undefined;
    if (!date) continue;
    const confirmed = po.status === "confirmed" || po.status === "dispatched";
    out.push({
      ...base,
      id: `${p.id}:po:${po.id}`,
      kind: "delivery",
      date,
      title: delivered
        ? `Delivered: ${po.supplier}`
        : `${confirmed ? "Due (supplier confirmed)" : "ETA, not confirmed"}: ${po.supplier}`,
      state: delivered ? "done" : "expected",
      crew: [],
      href: `/ops/projects/${p.id}/kit`,
    });
  }

  const commissioned = p.handover.commissionedAt;
  const handed = p.handover.handedOverAt;
  if (handed && isDate(handed)) {
    out.push({ ...base, id: `${p.id}:handover`, kind: "handover", date: dateOf(handed), title: "Handed over", state: "done", crew, href: `/ops/projects/${p.id}` });
  } else if (commissioned && isDate(commissioned)) {
    out.push({ ...base, id: `${p.id}:commissioned`, kind: "handover", date: dateOf(commissioned), title: "Commissioned", state: "done", crew, href: `/ops/projects/${p.id}` });
  } else if (planned.length && p.install.status !== "complete") {
    out.push({
      ...base,
      id: `${p.id}:handover-plan`,
      kind: "handover",
      date: planned.at(-1)!,
      title: "Commissioning and handover (planned)",
      state: "planned",
      crew,
      href: `/ops/projects/${p.id}`,
    });
  }
  return out;
}

/** Sorted for display: by date, then time, surveys before installs before deliveries. */
const KIND_ORDER: Record<CalEventKind, number> = { survey: 0, install: 1, handover: 2, delivery: 3 };
export function sortEvents(events: CalEvent[]): CalEvent[] {
  return [...events].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.time ?? "99").localeCompare(b.time ?? "99") ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.customer.localeCompare(b.customer),
  );
}

export interface CrewConflict {
  date: string;
  staffId: string;
  name: string;
  /** The jobs that person is down for that day. */
  events: CalEvent[];
}

/**
 * A person in two places at once: on more than one project's install or
 * survey on the same day (two surveys at different times for one surveyor
 * are normal, so surveys only clash with installs or with the same slot).
 */
export function crewConflicts(events: CalEvent[]): CrewConflict[] {
  const byKey = new Map<string, CalEvent[]>();
  for (const e of events) {
    if (e.kind !== "install" && e.kind !== "survey") continue;
    for (const c of e.crew) {
      if (!c.staffId) continue;
      const key = `${e.date}|${c.staffId}`;
      byKey.set(key, [...(byKey.get(key) ?? []), e]);
    }
  }
  const out: CrewConflict[] = [];
  for (const [key, list] of byKey) {
    const projects = new Set(list.map((e) => e.projectId));
    if (projects.size < 2) continue;
    const installs = list.filter((e) => e.kind === "install");
    const surveys = list.filter((e) => e.kind === "survey");
    const sameSlot = new Set(surveys.map((s) => s.time ?? "")).size < surveys.length;
    if (installs.length === 0 && !sameSlot) continue;
    const [date, staffId] = key.split("|") as [string, string];
    const name = list[0]!.crew.find((c) => c.staffId === staffId)?.name ?? "Someone";
    out.push({ date, staffId, name, events: sortEvents(list) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

export interface BookingClash {
  date: string;
  staffId: string;
  name: string;
  projectId: string;
  customer: string;
  confirmed: boolean;
}

/**
 * Would these dates and this crew double-book anyone? Checked against every
 * other project's planned install days (confirmed or not).
 */
export function bookingClashes(
  candidate: { projectId: string; dates: string[]; crew: { staffId: string; name: string }[] },
  others: Pick<Project, "id" | "customer" | "booking" | "install" | "closure">[],
): BookingClash[] {
  const wanted = new Set(candidate.dates.map(dateOf));
  const out: BookingClash[] = [];
  for (const o of others) {
    if (o.id === candidate.projectId || o.closure.closed || o.install.status === "complete") continue;
    const theirDates = o.booking.dates.map(dateOf).filter((d) => wanted.has(d));
    if (theirDates.length === 0) continue;
    for (const c of candidate.crew) {
      if (!o.booking.crew.some((m) => m.staffId === c.staffId)) continue;
      for (const date of theirDates) {
        out.push({ date, staffId: c.staffId, name: c.name, projectId: o.id, customer: o.customer.name || "another job", confirmed: o.booking.status === "booked" });
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

export interface CrewDayRow {
  staffId: string;
  name: string;
  role: StaffRole | null;
  jobs: CalEvent[];
  clash: boolean;
}

/** Who is where on one day: every person with a job, then everyone free. */
export function crewDay(events: CalEvent[], date: string, team: { id: string; name: string; roles: StaffRole[] }[]): CrewDayRow[] {
  const today = events.filter((e) => e.date === date && (e.kind === "install" || e.kind === "survey" || e.kind === "handover"));
  const rows: CrewDayRow[] = team.map((s) => {
    const jobs = sortEvents(today.filter((e) => e.crew.some((c) => c.staffId === s.id)));
    const role = today.flatMap((e) => e.crew).find((c) => c.staffId === s.id)?.role ?? s.roles[0] ?? null;
    const projects = new Set(jobs.filter((j) => j.kind !== "handover").map((j) => j.projectId));
    return { staffId: s.id, name: s.name, role, jobs, clash: projects.size > 1 && jobs.some((j) => j.kind === "install") };
  });
  // Crew named on a job but not on the staff list (legacy names) still show.
  for (const e of today) {
    for (const c of e.crew) {
      if (rows.some((r) => r.staffId === c.staffId)) continue;
      rows.push({ staffId: c.staffId, name: c.name, role: c.role, jobs: sortEvents(today.filter((x) => x.crew.some((y) => y.staffId === c.staffId))), clash: false });
    }
  }
  return rows.sort((a, b) => Number(b.jobs.length > 0) - Number(a.jobs.length > 0) || a.name.localeCompare(b.name));
}

/** Events inside [from, to], inclusive. */
export function inRange(events: CalEvent[], from: string, to: string): CalEvent[] {
  return events.filter((e) => e.date >= from && e.date <= to);
}

/** Whole days between two dates (b − a). */
export function daysBetweenIso(a: string, b: string): number {
  return Math.round((Date.parse(`${dateOf(b)}T12:00:00Z`) - Date.parse(`${dateOf(a)}T12:00:00Z`)) / DAY_MS);
}
