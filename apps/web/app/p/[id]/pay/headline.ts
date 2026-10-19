/**
 * The pay page's greeting and what it says when nothing is due. "All paid
 * up" only once something has actually been paid: a customer who has never
 * been invoiced has nothing to pay *yet*.
 */
export function payHeadline(input: { first: string; cancelled: boolean; payableCount: number; paidSomething: boolean }): { title: string; nothingDue: string } {
  const { first } = input;
  if (input.cancelled) return { title: `Your contract is cancelled, ${first}`, nothingDue: "Nothing is due, and nothing can be paid here." };
  if (input.payableCount > 0) return { title: `Hi ${first}, here's what's due`, nothingDue: "" };
  if (input.paidSomething) {
    return { title: `You're all paid up, ${first}`, nothingDue: "Nothing is waiting to be paid. We only ask for money with an invoice, and you'll get an email when one is ready." };
  }
  return { title: `Nothing to pay yet, ${first}`, nothingDue: "We only ask for money with an invoice, and there isn't one yet. You'll get an email when one is ready." };
}
