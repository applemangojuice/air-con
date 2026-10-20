import type { CommsEventId, MessageRecord, Project } from "@aircon/domain";
import { londonToUtcIso } from "../../components/ops/command/model.ts";
import type { CommsData } from "./templates.ts";

/**
 * Messages about an appointment are worth sending only before it: "your
 * surveyor is on the way, about 20 minutes" an hour after they knocked, or
 * "your survey is tomorrow" once it's under way, is worse than nothing. And
 * none of them is for a project that's closed or cancelled. The outbox
 * gives each such message an expiry when it's written (`expiresAt` on the
 * record), and no send after it (first send, cron retry or Retry / Send
 * again) goes: the message is marked skipped with the reason. Pure.
 */

/** An on-my-way text is stale this long after it's written, unless the arrival time it gives is later. */
export const ON_MY_WAY_TTL_MINUTES = 45;

/** The survey's length when the booking doesn't say (settings default). */
const SURVEY_MINUTES_DEFAULT = 90;

/** Messages tied to an appointment: they expire, and never go for a closed or cancelled project. */
export const TIME_SENSITIVE_EVENTS: ReadonlySet<CommsEventId> = new Set<CommsEventId>([
  "surveyor-on-my-way",
  "installer-on-my-way",
  "survey-reminder",
  "install-prep",
  "install-day-before",
  "survey-booked",
  "install-booked",
]);

const MINUTE = 60_000;

/** A survey slot ("UK wall clock encoded as UTC", see slotIso) as the real instant. */
function slotInstant(slot: string | undefined): number | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(slot ?? "");
  const iso = m ? londonToUtcIso(m[1]!, m[2]!) : null;
  return iso ? Date.parse(iso) : null;
}

/** The instant London's calendar day `date` (yyyy-mm-dd) begins. */
function londonDayStart(date: string | undefined): number | null {
  const iso = date ? londonToUtcIso(date.slice(0, 10), "00:00") : null;
  return iso ? Date.parse(iso) : null;
}

/** The day after `date` (yyyy-mm-dd). */
function nextDate(date: string): string {
  const d = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const iso = (ms: number | null): string | undefined => (ms !== null && Number.isFinite(ms) ? new Date(ms).toISOString() : undefined);

/**
 * When a message about this event stops being worth sending, or undefined
 * for one that never goes stale:
 *   on my way          45 minutes after it's written, or the arrival time it gives if later
 *   survey reminder    when the survey starts
 *   install prep, day before   when the first install day begins (London midnight)
 *   survey booked      when the survey is over
 *   install booked     when the last install day is over
 */
export function messageExpiry<E extends CommsEventId>(event: E, data: CommsData[E], createdAt: string): string | undefined {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return undefined;
  switch (event) {
    case "surveyor-on-my-way":
    case "installer-on-my-way": {
      const d = data as CommsData["installer-on-my-way"];
      const from = Number.isFinite(Date.parse(d.at)) ? Date.parse(d.at) : created;
      const eta = Number.isFinite(d.etaMinutes) ? Math.max(0, d.etaMinutes) : 0;
      return iso(Math.max(created + ON_MY_WAY_TTL_MINUTES * MINUTE, from + eta * MINUTE));
    }
    case "survey-reminder":
      return iso(slotInstant((data as CommsData["survey-reminder"]).scheduledFor));
    case "survey-booked": {
      const d = data as CommsData["survey-booked"];
      const start = slotInstant(d.scheduledFor);
      return start === null ? undefined : iso(start + (d.durationMinutes || SURVEY_MINUTES_DEFAULT) * MINUTE);
    }
    case "install-prep":
    case "install-day-before":
      return iso(londonDayStart((data as CommsData["install-prep"]).startDate));
    case "install-booked": {
      const dates = [...((data as CommsData["install-booked"]).dates ?? [])].filter((x) => /^\d{4}-\d{2}-\d{2}/.test(x)).sort();
      const last = dates[dates.length - 1];
      return last ? iso(londonDayStart(nextDate(last))) : undefined;
    }
    default:
      return undefined;
  }
}

/** The expiry a stored message carries, or (for one written before expiries existed) the on-my-way rule from its creation. */
export function expiryOf(m: Pick<MessageRecord, "event" | "expiresAt" | "createdAt">): string | undefined {
  if (m.expiresAt) return m.expiresAt;
  if (m.event !== "surveyor-on-my-way" && m.event !== "installer-on-my-way") return undefined;
  const created = Date.parse(m.createdAt);
  return Number.isFinite(created) ? new Date(created + ON_MY_WAY_TTL_MINUTES * MINUTE).toISOString() : undefined;
}

const LATE_REASON: Partial<Record<CommsEventId, string>> = {
  "surveyor-on-my-way": "it would arrive after the surveyor did",
  "installer-on-my-way": "it would arrive after the installer did",
  "survey-reminder": "the survey it's about has already started",
  "install-prep": "the install it's preparing for has already started",
  "install-day-before": "the install it's about has already started",
  "survey-booked": "the survey it confirms is already over",
  "install-booked": "the install days it confirms are already over",
};

/**
 * Why this message must not go now, or null when it may: a time-sensitive
 * message on a closed or cancelled project, or any message past its expiry.
 */
export function staleReason(
  m: Pick<MessageRecord, "event" | "expiresAt" | "createdAt">,
  now: string,
  project: Pick<Project, "closure" | "cancellation"> | null | undefined,
): string | null {
  if (TIME_SENSITIVE_EVENTS.has(m.event) && project) {
    if (project.cancellation || project.closure?.reason === "cancelled") return "Not sent: the project was cancelled, so the appointment it's about won't happen.";
    if (project.closure?.closed) return "Not sent: the project is closed.";
  }
  const expires = expiryOf(m);
  if (expires && Date.parse(now) >= Date.parse(expires)) {
    return `Not sent: too late to be useful (${LATE_REASON[m.event] ?? "its moment has passed"}).`;
  }
  return null;
}
