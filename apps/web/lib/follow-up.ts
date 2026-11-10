import { BRAND, appUrl } from "./brand";
import { QUOTE_EMAIL_OPT_OUT, REMINDER_NOTICE_VERSION, REMINDER_NOTICE_VERSIONS } from "./follow-up-notice";

/**
 * THE abandoned-quote follow-up message — one copy, consumed by both the
 * follow-up cron (as HTML email) and the ops drafts tab (as a mailto). Two
 * hand-maintained versions had already drifted apart while both promising
 * "this is the only nudge"; now an edit here changes every sender.
 *
 * Who gets it is decided here too (pure, so it's tested): only a draft whose
 * owner saw the email notice at the refine gate and didn't opt out, idle
 * for at least IDLE_MINUTES, never an address that finished a quote or was
 * already reminded, at most a handful a run.
 */

/** A draft untouched this long has been left: the reminder may go. */
export const IDLE_MINUTES = 10;

/** The link that puts them back where they were, on any device. */
export function resumeLink(draftId?: string): string {
  return draftId ? `${appUrl()}/quote?resume=${encodeURIComponent(draftId)}` : `${appUrl()}/quote`;
}

/** At most this many reminders a run; the `follow-up` email budget caps the day too. */
export const FOLLOW_UPS_PER_RUN = 10;

export function followUpSubject(postcode: string): string {
  return `Your air conditioning price for ${postcode} is one tap away`;
}

/**
 * The lines of the message. `replyEmail` is the company address in settings
 * (replies go there), named in the opt-out line.
 */
export function followUpLines(postcode: string, replyEmail?: string, draftId?: string): string[] {
  const address = replyEmail?.trim() || BRAND.supportEmail;
  return [
    "Hi,",
    `You started getting a price for air conditioning at ${postcode} and got most of the way there. Your answers are saved, so picking up where you left off takes about a minute:`,
    resumeLink(draftId),
    "If now isn't the time, no problem: this is the only nudge we'll send. No calls, no follow-up barrage.",
    `You're getting this because you gave us your email for this quote and didn't tick "${QUOTE_EMAIL_OPT_OUT.label}". We won't email you about it again. To have your unfinished quote deleted, reply to this email or write to ${address}.`,
    `Stay cool,\n${BRAND.name}`,
  ];
}

/** The mailto: version for the ops drafts tab. */
export function followUpMailto(email: string, postcode: string, replyEmail?: string, draftId?: string): string {
  const body = followUpLines(postcode, replyEmail, draftId).join("\n\n");
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
  if (!REMINDER_NOTICE_VERSIONS.includes(String(rec.version)) || typeof rec.ok !== "boolean") return "unknown";
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

/** When the draft was last touched: the funnel's lastActiveAt, else when it was made. */
export function lastActiveAt(d: Pick<FollowUpDraft, "created_at" | "attribution">): string {
  const funnel = typeof d.attribution === "object" && d.attribution !== null ? (d.attribution as { funnel?: { lastActiveAt?: unknown } }).funnel : undefined;
  const at = funnel?.lastActiveAt;
  return typeof at === "string" && !Number.isNaN(Date.parse(at)) ? at : d.created_at;
}

/** Left alone for at least `minutes`: they've stopped, so the one reminder may go. */
export function isIdle(d: Pick<FollowUpDraft, "created_at" | "attribution">, nowMs: number, minutes = IDLE_MINUTES): boolean {
  return Date.parse(lastActiveAt(d)) <= nowMs - minutes * 60_000;
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

/* ------------------------------------------------------------------ */
/* Coming back with the same email and postcode                        */
/* ------------------------------------------------------------------ */

/** An unfinished quote younger than this is the one we offer to pick up. */
export const RESUME_DAYS = 30;

/** Not more than one "pick up where you left off" email per draft in this long. */
export const RESUME_EMAIL_GAP_MINUTES = 10;

export function resumeSubject(postcode: string): string {
  return `Pick up your quote for ${postcode}`;
}

/**
 * The "you've been here before" email: someone gave the email and postcode
 * of an unfinished quote, so we send its link to that inbox rather than
 * showing the answers on the screen (whoever typed it may not be them).
 */
export function resumeLines(postcode: string, draftId: string): string[] {
  return [
    "Hi,",
    `Someone, hopefully you, just started a new price for air conditioning at ${postcode} with this email address. You already have one on the go, with your answers saved. Here it is:`,
    resumeLink(draftId),
    "Didn't ask for this? Ignore it: nothing happens and nobody can see your quote without this link.",
    `Stay cool,\n${BRAND.name}`,
  ];
}

/** The funnel state a draft keeps in its attribution JSON beside the reminder answer (no migration needed). */
export interface FunnelState {
  layout?: string;
  prefillSource?: string;
  lastActiveAt?: string;
  resumeSentAt?: string;
}

export function funnelState(attribution: unknown): FunnelState {
  if (typeof attribution !== "object" || attribution === null) return {};
  const f = (attribution as { funnel?: unknown }).funnel;
  return typeof f === "object" && f !== null ? (f as FunnelState) : {};
}
