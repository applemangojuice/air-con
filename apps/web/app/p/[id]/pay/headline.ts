import type { Project, cancellationSettlement } from "@aircon/domain";
import { fmtDate, money } from "@/lib/format";

/**
 * The pay page's greeting and what it says when nothing is due. "All paid
 * up" only once something has actually been paid: a customer who has never
 * been invoiced has nothing to pay *yet*.
 *
 * A cancelled contract follows the hub's rule (`cancelledCopy`) and the
 * acknowledgement email: inside the period, the refund and its date; after
 * it (`withinPeriod` false), only that it reached us and that we'll be in
 * touch in writing. Nothing is promised before anyone has checked.
 */
export function payHeadline(input: {
  first: string;
  cancelled: boolean;
  payableCount: number;
  paidSomething: boolean;
  cancellation?: Pick<NonNullable<Project["cancellation"]>, "receivedAt" | "refundDueBy" | "withinPeriod">;
  /** Work began at their request before the period ended (cancelledAfterEarlyWork): an amount may be due for it. */
  workedEarly?: boolean;
  /** The charge for that work, once recorded (cancellationSettlement): the hub's and the email's numbers. */
  settlement?: ReturnType<typeof cancellationSettlement>;
}): { title: string; nothingDue: string; note?: string } {
  const { first } = input;
  if (input.cancelled) {
    const c = input.cancellation;
    const s = input.settlement;
    if (s && c?.withinPeriod) {
      const charge = `The charge for the work done before you cancelled is ${money(s.chargePence)}, and you've paid ${money(s.paidPence)}.`;
      return {
        title: `Your contract is cancelled, ${first}`,
        nothingDue:
          s.refundDuePence > 0
            ? `Nothing can be paid here. ${charge} We'll refund the other ${money(s.refundDuePence)} by ${fmtDate(s.refundDueBy)}, the same way you paid.`
            : `Nothing more is due. ${charge} That covers it, so there's nothing to pay or refund.`,
        ...(s.owedPence > 0 ? { note: `${charge} ${money(s.owedPence)} is left to pay, on the invoice below.` } : {}),
      };
    }
    if (c && !c.withinPeriod) {
      return {
        title: `We've received your cancellation, ${first}`,
        nothingDue: `Nothing can be paid here. Your cancellation reached us on ${fmtDate(c.receivedAt)}, after your cancellation period had ended. We'll be in touch in writing about what happens next, including anything you've paid.`,
      };
    }
    return {
      title: `Your contract is cancelled, ${first}`,
      nothingDue: `${input.workedEarly ? "Nothing can be paid here." : "Nothing is due, and nothing can be paid here."}${
        c
          ? ` We received your cancellation on ${fmtDate(c.receivedAt)}. ${
              input.paidSomething
                ? `Anything you've paid is refunded by ${fmtDate(c.refundDueBy)}, the same way you paid. If you'd asked us to start early and work was done, we'll explain any deduction for that work in writing first.`
                : input.workedEarly
                  ? "You asked us to start before your cancellation period ended and work was done, so we'll write to you about any amount for that work."
                  : "You haven't paid us anything, so there's nothing to refund."
            }`
          : ""
      }`,
    };
  }
  if (input.payableCount > 0) return { title: `Hi ${first}, here's what's due`, nothingDue: "" };
  if (input.paidSomething) {
    return { title: `You're all paid up, ${first}`, nothingDue: "Nothing is waiting to be paid. We only ask for money with an invoice, and you'll get an email when one is ready." };
  }
  return { title: `Nothing to pay yet, ${first}`, nothingDue: "We only ask for money with an invoice, and there isn't one yet. You'll get an email when one is ready." };
}
