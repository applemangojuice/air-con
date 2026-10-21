import type { ContractType } from "@aircon/domain";

/**
 * Statutory cancellation wording for the proposal issue email (the
 * pre-contract information), the acceptance confirmation email (the
 * contract copy) and the contract document: all durable media.
 *
 * NEEDS SOLICITOR REVIEW. This is the model wording from Schedule 3 of the
 * Consumer Contracts (Information, Cancellation and Additional Charges)
 * Regulations 2013 (SI 2013/3134): Part A, the model instructions for
 * cancellation, and Part B, the model cancellation form. The regulations
 * let a trader give the cancellation information by using the model
 * instructions, correctly completed. The completion choices below are ours
 * and are the part to review (docs/research/uk-consumer-legal.md §1.10):
 *
 *   1. Period start, by contract type (project.ts cancellationStatus).
 *      supply-and-install is a sales contract: note 1(c), the day the
 *      customer takes physical possession of the last of the goods (indoor
 *      and outdoor units can arrive on different days). install-only is a
 *      service contract: note 1(a), the day of the conclusion of the contract.
 *   2. Note 6 (services started early on request, proportionate payment)
 *      is included, because installs can start inside the period on an
 *      express request (reg 36). Losing the right once the service is fully
 *      performed applies to install-only only, and is said in the
 *      pre-contract information, not here.
 *   3. Note 5, supply-and-install only: we collect the goods and bear the
 *      cost of returning them (units fixed to a wall can't go back by post),
 *      plus the diminished-value sentence. The research's recommended
 *      default; a business decision for the solicitor to confirm.
 *   4. Note 3 (online cancellation) is left out until a cancel flow exists.
 *   5. The period length follows settings (14 days unless we give longer).
 *
 * Settings carry `legal.cancellationReviewed`; until it's true, team alerts
 * say the wording is unreviewed. Bump CANCELLATION_NOTICE_VERSION whenever
 * the text changes: acceptance records store the version the customer saw.
 *
 * Plain constants and string functions only (no I/O), so the same text
 * renders in email, documents and tests.
 */

export const CANCELLATION_NOTICE_VERSION = "ccr-2013-sch3-v2";

export const LEGAL_REVIEW_NOTE = "Needs solicitor review";

/** Placeholders the fill functions replace: the trader's identity block. */
export interface TraderDetails {
  legalName: string;
  tradingName?: string;
  /** Where we're established (settings.company.geographicAddress): the address note 2 asks for. */
  geographicAddress?: string;
  /** Used only when there's no geographic address. */
  registeredAddress?: string;
  phone?: string;
  email?: string;
}

export interface CancellationOptions {
  /** Picks note 1(c) or 1(a), and whether note 5 applies. supply-and-install when left out. */
  contractType?: ContractType;
  /** The period length (settings.scheduling.cancellationDays); 14 when left out. Never shorter than 14. */
  days?: number;
}

const periodDays = (o: CancellationOptions) => Math.max(14, Math.round(o.days ?? 14));

/** Note 1: (c) for a sales contract whose goods may arrive on different days, (a) for a service contract. */
const PERIOD_END: Record<ContractType, string> = {
  "supply-and-install":
    "The cancellation period will expire after {DAYS} days from the day on which you acquire, or a third party, other than the carrier and indicated by you, acquires physical possession of the last good.",
  "install-only": "The cancellation period will expire after {DAYS} days from the day of the conclusion of the contract.",
};

/** Note 5 (a), (b) and (c): we collect, we pay, and the customer's diminished-value liability. Goods only. */
const RETURN_OF_GOODS =
  "We will collect the goods. We will bear the cost of returning the goods. You are only liable for any diminished value of the goods resulting from the handling other than what is necessary to establish the nature, characteristics and functioning of the goods.";

/**
 * Schedule 3 Part A, model instructions for cancellation, with note 6
 * inserted. `{PERIOD}` is note 1's sentence and `{GOODS}` note 5's, chosen
 * per contract type; `{TRADER}` is the trader's name, geographical address,
 * telephone number and email (note 2).
 */
export const CANCELLATION_INSTRUCTIONS: readonly { heading?: string; text: string }[] = [
  { heading: "Right to cancel", text: "You have the right to cancel this contract within {DAYS} days without giving any reason." },
  { text: "{PERIOD}" },
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
  { text: "{GOODS}" },
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
  const address = t.geographicAddress?.trim() || t.registeredAddress?.trim();
  if (address) parts.push(address);
  if (opts.phone !== false && t.phone?.trim()) parts.push(`phone ${t.phone.trim()}`);
  if (t.email?.trim()) parts.push(`email ${t.email.trim()}`);
  return parts.join(", ");
}

/** Part A with our details and the contract type's choices filled in, one entry per paragraph. */
export function cancellationInstructions(t: TraderDetails, opts: CancellationOptions = {}): { heading?: string; text: string }[] {
  const trader = traderBlock(t);
  const type = opts.contractType ?? "supply-and-install";
  const days = String(periodDays(opts));
  const goods = type === "supply-and-install" ? RETURN_OF_GOODS : "";
  return CANCELLATION_INSTRUCTIONS.map((p) => ({
    ...p,
    text: p.text.replace("{PERIOD}", PERIOD_END[type]).replace("{GOODS}", goods).replace("{TRADER}", trader).split("{DAYS}").join(days),
  })).filter((p) => p.text.trim().length > 0);
}

/** Part B with our details filled in (the form names no phone number: note to Part B). */
export function cancellationForm(t: TraderDetails): string[] {
  const trader = traderBlock(t, { phone: false });
  return CANCELLATION_FORM.map((line) => line.replace("{TRADER}", trader));
}

/**
 * The cancellation information for a priced change agreed while we're
 * working in the home, which above £42 we treat as an off-premises contract
 * of its own (issues.ts variationHasOwnRight) until a solicitor says
 * otherwise. Part A's wording, completed for a change: the period runs from
 * the day the change is agreed (note 1(a)), or for any equipment or parts in
 * it from the day the customer has the last of them, if later (note 1(c));
 * note 5 as for the contract; note 6 because the extra work usually starts
 * inside the period on request. NEEDS SOLICITOR REVIEW with the rest.
 */
export const VARIATION_CANCELLATION_INSTRUCTIONS: readonly { heading?: string; text: string }[] = [
  { heading: "Right to cancel this change", text: "You have the right to cancel this change within {DAYS} days without giving any reason." },
  {
    text: "The cancellation period will expire after {DAYS} days from the day on which you agreed to the change or, for any equipment or parts it includes, from the day on which you acquire physical possession of the last of them, if that is later.",
  },
  {
    text: "To exercise the right to cancel, you must inform us ({TRADER}) of your decision to cancel this change by a clear statement (e.g. a letter sent by post, fax or e-mail). You may use the attached model cancellation form, but it is not obligatory.",
  },
  {
    text: "To meet the cancellation deadline, it is sufficient for you to send your communication concerning your exercise of the right to cancel before the cancellation period has expired.",
  },
  { heading: "Effects of cancellation", text: "If you cancel this change, we will reimburse to you all payments received from you for it." },
  { text: "We will make the reimbursement without undue delay, and not later than:" },
  { text: "(a) 14 days after the day we receive back from you any goods supplied, or" },
  { text: "(b) (if earlier) 14 days after the day you provide evidence that you have returned the goods, or" },
  { text: "(c) if there were no goods supplied, 14 days after the day on which we are informed about your decision to cancel this change." },
  {
    text: "We will make the reimbursement using the same means of payment as you used for the initial transaction, unless you have expressly agreed otherwise; in any event, you will not incur any fees as a result of the reimbursement.",
  },
  { text: `If the change includes equipment or parts: ${RETURN_OF_GOODS}` },
  {
    text: "If you requested to begin the performance of services during the cancellation period, you shall pay us an amount which is in proportion to what has been provided until you have communicated us your cancellation from this change, in comparison with the full coverage of the change.",
  },
];

/** The change's instructions with our details filled in, one entry per paragraph. */
export function variationCancellationInstructions(t: TraderDetails, opts: { days?: number } = {}): { heading?: string; text: string }[] {
  const trader = traderBlock(t);
  const days = String(periodDays(opts));
  return VARIATION_CANCELLATION_INSTRUCTIONS.map((p) => ({ ...p, text: p.text.replace("{TRADER}", trader).split("{DAYS}").join(days) }));
}
