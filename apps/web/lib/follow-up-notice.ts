/**
 * What the quote form tells people about emails, in one place: the line and
 * the single opt-out under the email at the refine gate
 * (components/quote/steps.tsx), the version a draft records
 * (api/quotes/draft), the one reminder the follow-up job may send because
 * of it (api/cron/follow-up, lib/follow-up.ts), and the consent record a
 * finished quote stores (components/site/claims.ts quoteConsentRecord).
 *
 * The footing is the minimum the law asks for, said plainly at collection:
 *  - emails about the quote they asked for need no tick (it's what they
 *    asked for);
 *  - one reminder and occasional news rest on the soft opt-in (PECR reg 22:
 *    details given while asking us to price this service, our own similar
 *    service, a simple way to refuse here and in every email), so the only
 *    box is an unticked opt-out.
 * A draft carries the wording version it was shown; only a draft that saw a
 * known wording and didn't opt out is ever reminded. Client-safe: no
 * server imports.
 */

/** Bump when the wording below changes. */
export const REMINDER_NOTICE_VERSION = "draft-reminder-2";

/** Versions whose answer still stands: v1 was an opt-in box ("Email me one reminder"), ticked meant yes. */
export const REMINDER_NOTICE_VERSIONS: readonly string[] = ["draft-reminder-1", REMINDER_NOTICE_VERSION];

/** The line under the email. */
export const QUOTE_EMAIL_NOTICE =
  "We'll email you a link to your quote, one reminder if you stop part-way, and now and then news about heating and cooling your home. Unsubscribe from any email in one tap.";

/** The one box: unticked, ticking it refuses the reminder and the news. */
export const QUOTE_EMAIL_OPT_OUT = { label: "Don't send me the reminder or any news" } as const;
