/**
 * The reminder choice the quote form offers next to the step-1 email, in one
 * place: the box the visitor sees (components/quote/steps.tsx), the version
 * the draft records (api/quotes/draft), and the one reminder the daily job
 * may send because of it (api/cron/follow-up, lib/follow-up.ts).
 *
 * The visitor is told at collection that we may email them once, and can
 * refuse there (untick the box) and in the email itself. A draft carries the
 * wording version it was shown; only a draft that saw this wording and left
 * it ticked is ever reminded. Client-safe: no server imports.
 */

/** Bump when the wording below changes; older versions are never reminded under the new rules. */
export const REMINDER_NOTICE_VERSION = "draft-reminder-1";

export const REMINDER_NOTICE = {
  label: "Email me one reminder if I don't finish",
  hint: "Only one, and only if you stop part-way. Untick and we won't.",
} as const;
