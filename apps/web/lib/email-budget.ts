import { emailConfigured } from "./email";
import { sharedRateLimits } from "./rate-limit-shared";

/**
 * The emails anyone on the internet can make us send without signing in,
 * on one shared daily budget, well below the email plan's quota (Resend
 * Free: 100 a day, shared with every proposal, booking, invoice and alert
 * the office sends). Without it, a script posting quotes with fresh
 * addresses (two emails each) and starting projects from them (a sign-in
 * link each) used up the day's quota in about a minute, and every email
 * after that failed until the next day.
 *
 * Three pools, so none can starve another:
 *  - `public`: the quote form's emails (the customer's price and the team's
 *    lead alert) and the sign-in link /api/projects sends to a quote's
 *    address;
 *  - `sign-in`: sign-in links a visitor asks for (/api/portal/link), which
 *    only ever go to an address that's already a customer's;
 *  - `follow-up`: the one reminder the daily job sends an unfinished quote
 *    (api/cron/follow-up), whose address nobody has checked.
 * Together they stay well under the plan's 100 a day (65), leaving the rest
 * for the office.
 * Each pool has a cap per London day (the key carries the date, so the
 * count starts again at midnight London time, including on the 25-hour day
 * the clocks go back) and a smaller one per hour, counted across every
 * serverless instance (rate_limits, migration 0012; in memory when the
 * shared count can't answer). Over the budget nothing is sent and nothing
 * different is said: the quote still saves (and shows in ops), and the
 * visitor can ask for a link again later.
 *
 * Only real sends count: with no email provider (development, a demo
 * deployment) nothing goes anyway, so nothing is spent.
 */

export type EmailPool = "public" | "sign-in" | "follow-up";

export const EMAIL_BUDGET: Record<EmailPool, { perDay: number; perHour: number }> = {
  public: { perDay: 30, perHour: 12 },
  "sign-in": { perDay: 25, perHour: 10 },
  "follow-up": { perDay: 10, perHour: 10 },
};

const londonDate = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });

/** The London calendar day (yyyy-mm-dd) of an instant: the budget's day. */
export function londonDayKey(now: Date): string {
  const parts = londonDate.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * The counts one send is checked against. The day's key names the London
 * date and its window outlasts the longest London day (25 hours), so it
 * never resets part-way through one; the hour's key names the UTC hour, so
 * the hour that happens twice when the clocks go back counts as two.
 */
export function emailBudgetChecks(pool: EmailPool, now: Date): { key: string; limit: number; windowMs: number }[] {
  const b = EMAIL_BUDGET[pool];
  return [
    { key: `email-budget:${pool}:day:${londonDayKey(now)}`, limit: b.perDay, windowMs: 26 * 3600_000 },
    { key: `email-budget:${pool}:hour:${now.toISOString().slice(0, 13)}`, limit: b.perHour, windowMs: 2 * 3600_000 },
  ];
}

const POOL_WHAT: Record<EmailPool, string> = {
  public: "quote emails and project links",
  "sign-in": "sign-in links asked for from the website",
  "follow-up": "unfinished-quote reminders",
};

const warned = new Set<string>();

/**
 * Spend one email from `pool`. False when the budget is used up: send
 * nothing. Always true when no email provider is set up (nothing is sent).
 */
export async function spendEmailBudget(pool: EmailPool, now: Date = new Date()): Promise<boolean> {
  if (!emailConfigured()) return true;
  const result = await sharedRateLimits(emailBudgetChecks(pool, now));
  if (!result.ok) {
    const day = `${pool}:${londonDayKey(now)}`;
    if (!warned.has(day)) {
      warned.add(day);
      console.warn(
        `[email] the ${pool} email budget (${EMAIL_BUDGET[pool].perDay} a day, ${EMAIL_BUDGET[pool].perHour} an hour) is used up: further ${POOL_WHAT[pool]} are held back for now`,
      );
    }
  }
  return result.ok;
}
