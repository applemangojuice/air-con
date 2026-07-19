import { BRAND, appUrl } from "./brand";

/**
 * THE abandoned-quote follow-up message — one copy, consumed by both the
 * daily cron (as HTML email) and the ops drafts tab (as a mailto). Two
 * hand-maintained versions had already drifted apart while both promising
 * "this is the only nudge"; now an edit here changes every sender.
 */

export function followUpSubject(postcode: string): string {
  return `Your air conditioning price for ${postcode} is one tap away`;
}

export function followUpLines(postcode: string): string[] {
  return [
    "Hi,",
    `You started getting a fixed price for air conditioning at ${postcode} and got most of the way there. Picking up where you left off takes about a minute:`,
    `${appUrl()}/quote`,
    "If now isn't the time, no problem: this is the only nudge we'll send. No calls, no follow-up barrage.",
    `Stay cool,\n${BRAND.name}`,
  ];
}

/** The mailto: version for the ops drafts tab. */
export function followUpMailto(email: string, postcode: string): string {
  const body = followUpLines(postcode).join("\n\n");
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(
    followUpSubject(postcode),
  )}&body=${encodeURIComponent(body)}`;
}
