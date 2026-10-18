/**
 * Statutory cancellation wording for the acceptance confirmation email (the
 * durable copy) and the contract document.
 *
 * NEEDS SOLICITOR REVIEW. This is the model wording from Schedule 3 of the
 * Consumer Contracts (Information, Cancellation and Additional Charges)
 * Regulations 2013 (SI 2013/3134): Part A, the model instructions for
 * cancellation, and Part B, the model cancellation form. The regulations
 * let a trader give the cancellation information by using the model
 * instructions, correctly completed. The completion choices below are ours
 * and are the part to review:
 *
 *   1. Period start. We use the service-contract text ("the day of the
 *      conclusion of the contract"), matching the 14 days from acceptance
 *      that the platform enforces. A supply-and-install contract may count
 *      as a sales contract, where the period instead runs from the day the
 *      customer takes physical possession of the goods. Confirm.
 *   2. Note 6 (services started early on request, proportionate payment)
 *      is included, because installs can start inside the period on an
 *      express request (reg 36). Losing the right once the service is fully
 *      performed is acknowledged at acceptance, not here.
 *   3. Note 5 (collection and cost of returning goods) is left out: whether
 *      we collect installed equipment, and at whose cost, is a business and
 *      legal decision not yet made. Add the chosen sentences here.
 *   4. Note 3 (online cancellation) is left out until a cancel flow exists.
 *
 * Settings carry `legal.cancellationReviewed`; until it's true, team alerts
 * say the wording is unreviewed. Bump CANCELLATION_NOTICE_VERSION whenever
 * the text changes: acceptance records store the version the customer saw.
 *
 * Plain constants and string functions only (no I/O), so the same text
 * renders in email, documents and tests.
 */

export const CANCELLATION_NOTICE_VERSION = "ccr-2013-sch3-v1";

export const LEGAL_REVIEW_NOTE = "Needs solicitor review";

/** Placeholders the fill functions replace: the trader's identity block. */
export interface TraderDetails {
  legalName: string;
  tradingName?: string;
  registeredAddress?: string;
  phone?: string;
  email?: string;
}

/**
 * Schedule 3 Part A, model instructions for cancellation, with note 1(a)
 * chosen and note 6 inserted. `{TRADER}` is replaced by the trader's name,
 * geographical address, telephone number and email (note 2).
 */
export const CANCELLATION_INSTRUCTIONS: readonly { heading?: string; text: string }[] = [
  { heading: "Right to cancel", text: "You have the right to cancel this contract within 14 days without giving any reason." },
  { text: "The cancellation period will expire after 14 days from the day of the conclusion of the contract." },
  {
    text: "To exercise the right to cancel, you must inform us ({TRADER}) of your decision to cancel this contract by a clear statement (e.g. a letter sent by post, fax or e-mail). You may use the attached model cancellation form, but it is not obligatory.",
  },
  {
    text: "To meet the cancellation deadline, it is sufficient for you to send your communication concerning your exercise of the right to cancel before the cancellation period has expired.",
  },
  {
    heading: "Effects of cancellation",
    text: "If you cancel this contract, we will reimburse to you all payments received from you, including the costs of delivery (except for the supplementary costs resulting from your choice of a type of delivery other than the least expensive type of standard delivery offered by us).",
  },
  { text: "We will make the reimbursement without undue delay, and not later than:" },
  { text: "(a) 14 days after the day we receive back from you any goods supplied, or" },
  { text: "(b) (if earlier) 14 days after the day you provide evidence that you have returned the goods, or" },
  { text: "(c) if there were no goods supplied, 14 days after the day on which we are informed about your decision to cancel this contract." },
  {
    text: "We will make the reimbursement using the same means of payment as you used for the initial transaction, unless you have expressly agreed otherwise; in any event, you will not incur any fees as a result of the reimbursement.",
  },
  {
    text: "If you requested to begin the performance of services during the cancellation period, you shall pay us an amount which is in proportion to what has been provided until you have communicated us your cancellation from this contract, in comparison with the full coverage of the contract.",
  },
];

/**
 * Schedule 3 Part B, the model cancellation form, as printed lines. The
 * "[*] Delete as appropriate" options are kept, as the regulation sets
 * them out; `{TRADER}` is our name, address and email.
 */
export const CANCELLATION_FORM: readonly string[] = [
  "(Complete and return this form only if you wish to withdraw from the contract)",
  "To: {TRADER}",
  "I/We [*] hereby give notice that I/We [*] cancel my/our [*] contract of sale of the following goods [*]/for the supply of the following service [*],",
  "Ordered on [*]/received on [*],",
  "Name of consumer(s),",
  "Address of consumer(s),",
  "Signature of consumer(s) (only if this form is notified on paper),",
  "Date",
  "[*] Delete as appropriate.",
];

/** "Dang It's Hot Ltd (trading as Dang, It's Hot), 1 Example Street, London, phone 0800 000 0000, email hello@…" */
export function traderBlock(t: TraderDetails, opts: { phone?: boolean } = {}): string {
  const name =
    t.tradingName && t.tradingName.trim() && t.tradingName.trim() !== t.legalName.trim()
      ? `${t.legalName.trim()} (trading as ${t.tradingName.trim()})`
      : t.legalName.trim();
  const parts = [name];
  if (t.registeredAddress?.trim()) parts.push(t.registeredAddress.trim());
  if (opts.phone !== false && t.phone?.trim()) parts.push(`phone ${t.phone.trim()}`);
  if (t.email?.trim()) parts.push(`email ${t.email.trim()}`);
  return parts.join(", ");
}

/** Part A with our details filled in, one entry per paragraph. */
export function cancellationInstructions(t: TraderDetails): { heading?: string; text: string }[] {
  const trader = traderBlock(t);
  return CANCELLATION_INSTRUCTIONS.map((p) => ({ ...p, text: p.text.replace("{TRADER}", trader) }));
}

/** Part B with our details filled in (the form names no phone number: note to Part B). */
export function cancellationForm(t: TraderDetails): string[] {
  const trader = traderBlock(t, { phone: false });
  return CANCELLATION_FORM.map((line) => line.replace("{TRADER}", trader));
}
