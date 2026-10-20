import { londonToUtcIso } from "../components/ops/command/model.ts";
import { londonDateOf } from "./format.ts";

/**
 * The website leads' chase list: every quote with a next action due today
 * or earlier (London days), oldest first, so the follow-ups staff schedule
 * on a quote's page (next_action, next_action_at) surface on /ops and in
 * the morning digest, not only on that quote's own page. Declined leads
 * are left out. Pure helpers plus one read.
 */

/** How many the console and the digest list; the count says how many more there are. */
export const DUE_LEADS_SHOWN = 12;

export interface DueLead {
  id: string;
  /** The name, or the email of an unfinished quote. */
  name: string;
  postcode: string;
  action: string;
  /** The London day it's due (yyyy-mm-dd). */
  dueOn: string;
  overdue: boolean;
}

export interface DueLeadRow {
  id: string;
  customer_name: string | null;
  email: string | null;
  postcode: string | null;
  next_action: string | null;
  next_action_at: string | null;
}

/** The day after `date` (yyyy-mm-dd). */
function nextDate(date: string): string {
  const d = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The instant London's next day begins after `today` (yyyy-mm-dd): a next
 * action before it is due today or overdue. On the day the clocks change it
 * still ends at London midnight, not UTC's.
 */
export function dueLeadCutoff(today: string): string {
  return londonToUtcIso(nextDate(today), "00:00") ?? `${nextDate(today)}T00:00:00.000Z`;
}

/** Rows as the list shows them: due today or earlier only, oldest first, `overdue` before today. */
export function toDueLeads(rows: readonly DueLeadRow[], today: string): DueLead[] {
  const cutoff = Date.parse(dueLeadCutoff(today));
  return rows
    .filter((r) => r.next_action_at && Number.isFinite(Date.parse(r.next_action_at)) && Date.parse(r.next_action_at) < cutoff)
    .sort((a, b) => Date.parse(a.next_action_at!) - Date.parse(b.next_action_at!))
    .map((r) => {
      const dueOn = londonDateOf(r.next_action_at!);
      return {
        id: r.id,
        name: r.customer_name?.trim() || r.email?.trim() || "Unnamed lead",
        postcode: r.postcode ?? "",
        action: r.next_action?.trim() || "Follow up",
        dueOn,
        overdue: dueOn < today,
      };
    });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The leads due by the end of `today` (London), the first `shown` of them,
 * and how many there are in all. Null when they can't be read (the caller
 * says so rather than showing an empty list).
 */
export async function loadDueLeads(db: any, today: string, shown = DUE_LEADS_SHOWN): Promise<{ leads: DueLead[]; total: number } | null> {
  const cutoff = dueLeadCutoff(today);
  const due = (q: any) => q.not("next_action_at", "is", null).lt("next_action_at", cutoff).neq("status", "declined");
  const [list, count] = await Promise.all([
    due(db.from("quote_requests").select("id, customer_name, email, postcode, next_action, next_action_at"))
      .order("next_action_at", { ascending: true })
      .limit(shown),
    due(db.from("quote_requests").select("*", { count: "exact", head: true })),
  ]);
  if (list.error || count.error) {
    console.error("[leads] due follow-ups couldn't be read:", list.error?.message ?? count.error?.message);
    return null;
  }
  const leads = toDueLeads((list.data ?? []) as DueLeadRow[], today);
  return { leads, total: Math.max(count.count ?? 0, leads.length) };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
