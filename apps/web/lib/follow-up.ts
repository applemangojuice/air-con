import { BRAND, appUrl } from "./brand";
import { REMINDER_NOTICE, REMINDER_NOTICE_VERSION } from "./follow-up-notice";

/**
 * THE abandoned-quote follow-up message — one copy, consumed by both the
 * daily cron (as HTML email) and the ops drafts tab (as a mailto). Two
 * hand-maintained versions had already drifted apart while both promising
 * "this is the only nudge"; now an edit here changes every sender.
 *
 * Who gets it is decided here too (pure, so it's tested): only a draft whose
 * owner saw the reminder box at step 1 and left it ticked, never an address
 * that finished a quote or was already reminded, at most a handful a run.
 */

/** At most this many reminders a run; the `follow-up` email budget caps the day too. */
export const FOLLOW_UPS_PER_RUN = 10;

export function followUpSubject(postcode: string): string {
  return `Your air conditioning price for ${postcode} is one tap away`;
}

/**
 * The lines of the message. `replyEmail` is the company address in settings
 * (replies go there), named in the opt-out line.
 */
export function followUpLines(postcode: string, replyEmail?: string): string[] {
  const address = replyEmail?.trim() || BRAND.supportEmail;
  return [
    "Hi,",
    `You started getting a price for air conditioning at ${postcode} and got most of the way there. Picking up where you left off takes about a minute:`,
    `${appUrl()}/quote`,
    "If now isn't the time, no problem: this is the only nudge we'll send. No calls, no follow-up barrage.",
    `You're getting this because you left "${REMINDER_NOTICE.label}" ticked when you gave us your email. We won't email you about it again. To have your unfinished quote deleted, reply to this email or write to ${address}.`,
    `Stay cool,\n${BRAND.name}`,
  ];
}

/** The mailto: version for the ops drafts tab. */
export function followUpMailto(email: string, postcode: string, replyEmail?: string): string {
  const body = followUpLines(postcode, replyEmail).join("\n\n");
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(
    followUpSubject(postcode),
  )}&body=${encodeURIComponent(body)}`;
}

/** What a draft records about the reminder box, in its `attribution` JSON (no migration needed). */
export interface ReminderRecord {
  ok: boolean;
  version: string;
  at: string;
}

/**
 * The record a draft save stores, or null when the form didn't show the
 * current wording (an older page, a script that never saw the box): such a
 * draft is never reminded.
 */
export function reminderRecord(input: { reminder?: boolean; reminderNotice?: string }, at: string): ReminderRecord | null {
  if (input.reminderNotice !== REMINDER_NOTICE_VERSION || typeof input.reminder !== "boolean") return null;
  return { ok: input.reminder, version: REMINDER_NOTICE_VERSION, at };
}

/**
 * What a draft's owner said about a reminder: `allowed` (saw the box and
 * left it ticked), `refused` (unticked it), or `unknown` (never saw this
 * wording: an older draft, or one a script made).
 */
export function reminderState(attribution: unknown): "allowed" | "refused" | "unknown" {
  if (typeof attribution !== "object" || attribution === null) return "unknown";
  const r = (attribution as { reminder?: unknown }).reminder;
  if (typeof r !== "object" || r === null) return "unknown";
  const rec = r as Partial<ReminderRecord>;
  if (rec.version !== REMINDER_NOTICE_VERSION || typeof rec.ok !== "boolean") return "unknown";
  return rec.ok ? "allowed" : "refused";
}

/** Did this draft's owner see the reminder box and leave it ticked? */
export function reminderAllowed(attribution: unknown): boolean {
  return reminderState(attribution) === "allowed";
}

export interface FollowUpDraft {
  id: string;
  email: string;
  postcode: string;
  created_at: string;
  attribution?: unknown;
}

/** Any quote row for one of the candidates' addresses: finished ones and earlier reminders rule an address out. */
export interface FollowUpRelated {
  email: string | null;
  status: string;
  follow_up_sent_at: string | null;
}

const lower = (e: unknown) => String(e ?? "").trim().toLowerCase();

/**
 * The drafts to remind this run, oldest first: only ones that left the box
 * ticked; one per person (their newest draft), never someone who finished a
 * quote (on another device or row) or was already reminded (the message
 * promises it's the only one), and at most `max`.
 */
export function pickFollowUps(drafts: readonly FollowUpDraft[], related: readonly FollowUpRelated[], max = FOLLOW_UPS_PER_RUN): FollowUpDraft[] {
  const ruledOut = new Set(related.filter((r) => r.status !== "draft" || r.follow_up_sent_at).map((r) => lower(r.email)));
  const newest = new Map<string, FollowUpDraft>();
  for (const d of drafts) {
    const key = lower(d.email);
    if (!key || !reminderAllowed(d.attribution) || ruledOut.has(key)) continue;
    const prev = newest.get(key);
    if (!prev || d.created_at > prev.created_at) newest.set(key, d);
  }
  return [...newest.values()].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0)).slice(0, Math.max(0, max));
}
