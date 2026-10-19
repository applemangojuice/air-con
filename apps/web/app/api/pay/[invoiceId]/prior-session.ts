import type { CheckoutSession, StripeResult } from "../../../../lib/providers/stripe.ts";

/**
 * What to do about an invoice's last Checkout Session before opening another
 * (one payable page per bill):
 *  * "paid": it's complete and not yet recorded: send them to the return
 *    page, which reads it back and records it, instead of charging again;
 *  * its page, to reuse: still open, for what's owed now;
 *  * "new": expired, recorded already (what's owed now is something else),
 *    or open for another amount and closed at Stripe just now;
 *  * "failed": Stripe wouldn't close it, and it isn't paid or expired.
 * Pure apart from the calls it's given, so the rules are tested directly.
 */
export async function priorSession(
  s: Pick<CheckoutSession, "id" | "status" | "amount_total" | "url">,
  owedPence: number,
  deps: {
    expire(id: string): Promise<StripeResult<unknown>>;
    retrieve(id: string): Promise<StripeResult<Pick<CheckoutSession, "status">>>;
    /** Is a payment recorded for this session (its provider reference)? */
    recorded(id: string): Promise<boolean>;
  },
): Promise<"paid" | "new" | "failed" | { url: string }> {
  const paidOrDone = async () => ((await deps.recorded(s.id)) ? "new" : "paid");
  if (s.status === "complete") return paidOrDone();
  if (s.status === "expired") return "new";
  if (s.status === "open" && s.amount_total === owedPence && s.url) return { url: s.url };
  const closed = await deps.expire(s.id);
  if (closed.ok) return "new";
  // Refused: it may have been paid (or expired) a moment ago. Read it again.
  const again = await deps.retrieve(s.id);
  if (!again.ok) return "failed";
  return again.value.status === "complete" ? paidOrDone() : again.value.status === "expired" ? "new" : "failed";
}
