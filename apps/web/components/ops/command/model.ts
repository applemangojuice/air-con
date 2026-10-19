import { TIME_KIND_LABEL, entryMinutes, upcomingWorkingDays as sharedUpcomingWorkingDays, type TimeEntry } from "@aircon/domain";

/**
 * Pure helpers behind the command centre and its forms (tested in
 * tests/ops-command.test.ts).
 */

/** The UTC offset London keeps at a given instant, in minutes (0 in winter, 60 in summer). */
export function londonOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

/**
 * A London wall-clock date and time ("2026-10-19", "09:30") as the real
 * instant (ISO, UTC). Time entries are real instants, unlike appointment
 * slots (which keep the wall clock encoded as UTC, see lib/format.ts).
 */
export function londonToUtcIso(date: string, time: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m || !t) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const [h, mi] = [Number(t[1]), Number(t[2])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  if (new Date(naive).getUTCDate() !== d) return null;
  // The offset at the guess, then at the corrected instant (handles the clocks changing).
  const first = naive - londonOffsetMinutes(new Date(naive)) * 60_000;
  const second = naive - londonOffsetMinutes(new Date(first)) * 60_000;
  return new Date(second).toISOString();
}

/** A survey slot as the house convention stores it: UK wall clock encoded as UTC. */
export function slotIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const iso = `${date}T${time}:00.000Z`;
  return Number.isFinite(Date.parse(iso)) ? iso : null;
}

/** The next `count` working days after `today` (1 = Monday … 7 = Sunday), for date pickers. */
export function upcomingWorkingDays(today: string, workingDays: readonly number[], count: number): string[] {
  // The domain's working days (working-days.ts): bank holidays are skipped.
  return sharedUpcomingWorkingDays(today, workingDays, count);
}

export interface TimeTotals {
  totalMinutes: number;
  byPerson: { name: string; minutes: number }[];
  byKind: { kind: TimeEntry["kind"]; label: string; minutes: number }[];
  running: number;
}

/** Totals by person and by kind, biggest first; running clocks counted separately. */
export function timeTotals(entries: TimeEntry[]): TimeTotals {
  const person = new Map<string, number>();
  const kind = new Map<TimeEntry["kind"], number>();
  let total = 0;
  let running = 0;
  for (const e of entries) {
    if (!e.endedAt && e.minutes === undefined) running++;
    const m = entryMinutes(e);
    if (m <= 0) continue;
    total += m;
    const who = e.staffName?.trim() || "Unnamed";
    person.set(who, (person.get(who) ?? 0) + m);
    kind.set(e.kind, (kind.get(e.kind) ?? 0) + m);
  }
  return {
    totalMinutes: Math.round(total),
    byPerson: [...person].map(([name, minutes]) => ({ name, minutes: Math.round(minutes) })).sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name)),
    byKind: [...kind].map(([k, minutes]) => ({ kind: k, label: TIME_KIND_LABEL[k] ?? k, minutes: Math.round(minutes) })).sort((a, b) => b.minutes - a.minutes),
    running,
  };
}

/** "1 h 45 min", "45 min", "3 h". */
export function hoursLabel(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest} min`;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** A Google Maps search for the address (opens the app on a phone). */
export function mapsUrl(addressLine: string, postcode: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([addressLine, postcode].filter(Boolean).join(", "))}`;
}

/** tel: link with the spaces taken out. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A real instant (an event, a message send) in London time: "Mon 19 Oct, 14:05".
 * Appointment slots are wall clock encoded as UTC and use lib/format's
 * fmtDayTime instead; this is for timestamps that really are UTC.
 */
export function fmtInstant(iso: string, opts: { year?: boolean } = {}): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const local = new Date(ms + londonOffsetMinutes(new Date(ms)) * 60_000);
  const hh = String(local.getUTCHours()).padStart(2, "0");
  const mm = String(local.getUTCMinutes()).padStart(2, "0");
  const year = opts.year ? ` ${local.getUTCFullYear()}` : "";
  return `${SHORT_DAYS[local.getUTCDay()]} ${local.getUTCDate()} ${SHORT_MONTHS[local.getUTCMonth()]}${year}, ${hh}:${mm}`;
}
