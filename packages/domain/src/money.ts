import type { Issue } from "./issues.ts";
import { TAX_CODES, type PilotSettings, type TaxCodeId } from "./settings.ts";

/**
 * Invoices and payments, in integer pence.
 *
 * A payment exists only when something verifiable says so: a Stripe webhook
 * with a valid signature, or a person recording a bank transfer they've
 * seen. Each provider reference is unique, so a replayed webhook can't pay
 * twice. Invoices are numbered from settings and never renumbered.
 *
 * Amounts on lines are what the customer pays (VAT included where VAT is
 * charged): the net and tax are split out of the total by the line's tax
 * code, so a pound quoted is a pound invoiced. An issued invoice is never
 * edited or deleted: a mistake is put right with a credit note.
 */

export type InvoiceKind = "deposit" | "balance" | "variation" | "survey-fee" | "change-fee" | "credit-note";

export const INVOICE_KINDS: readonly InvoiceKind[] = ["deposit", "balance", "variation", "survey-fee", "change-fee", "credit-note"];

export const INVOICE_KIND_LABEL: Record<InvoiceKind, string> = {
  deposit: "Deposit",
  balance: "Balance",
  variation: "Variation",
  "survey-fee": "Survey fee",
  "change-fee": "Date change fee",
  "credit-note": "Credit note",
};

/**
 * What a credit note is for, which decides whether the balance bills it again:
 *  * "correction" cancels an amount invoiced in error, so the balance still
 *    bills the right figure (a wrong deposit, a duplicate invoice);
 *  * "reduction" takes money off the price (goodwill, a snag, a refund the
 *    customer keeps), so it's never billed back.
 */
export type CreditPurpose = "correction" | "reduction";

export const CREDIT_PURPOSE_LABEL: Record<CreditPurpose, string> = {
  correction: "Cancels an amount invoiced in error (the balance still bills the right figure)",
  reduction: "Money off the price: goodwill, a snag, a refund they keep (never billed again)",
};

export interface InvoiceLine {
  label: string;
  netPence: number;
  taxCode: TaxCodeId;
  taxPence: number;
  totalPence: number;
}

export interface Invoice {
  id: string;
  projectId: string;
  number: string;
  kind: InvoiceKind;
  status: "draft" | "issued" | "part-paid" | "paid" | "void";
  lines: InvoiceLine[];
  netPence: number;
  taxPence: number;
  totalPence: number;
  paidPence: number;
  dueOn?: string;
  issuedAt?: string;
  documentId?: string;
  notes?: string;
  /**
   * Variation invoices: the variation issue it bills. Also on a credit note
   * that bills a variation taking money off the price (never a negative
   * invoice): it counts towards the price and as account credit.
   */
  issueId?: string;
  /** Credit notes: the invoice this one credits, when it's against one. */
  creditsInvoiceId?: string;
  /** Credit notes: why. */
  reason?: string;
  /** Credit notes: what it's for (creditPurposeOf reads older ones without it). */
  creditPurpose?: CreditPurpose;
  createdAt?: string;
  createdBy?: string;
  /** Who issued it. */
  issuedBy?: string;
  /** Drafts only: voided, and why. */
  voidedAt?: string;
  voidReason?: string;
  /** The form submission that created it, so a double click can't issue it twice (unique: migration 0013). */
  requestId?: string;
  /**
   * How many invoices the project had when this one's figure was worked out.
   * Unique per project (migration 0013), so two issued at the same moment,
   * both planned on the same invoices, can't both stand.
   */
  issueKey?: string;
  /** When the project's own totals (money.invoicedPence) took this invoice in. */
  recordedOnProjectAt?: string;
  /**
   * The latest Stripe Checkout Session opened to pay it: reused while it's
   * open for the same amount, closed before a new one is opened, so one bill
   * never has two payable Checkout pages.
   */
  checkoutSessionId?: string;
  /**
   * True from the moment it's numbered until its document, the project's
   * totals and the email are all done; a retry finishes the rest. Absent on
   * invoices made any other way, which are treated as complete.
   */
  issuing?: boolean;
}

export interface Payment {
  id: string;
  projectId: string;
  invoiceId?: string;
  method: "card" | "bank-transfer" | "cash" | "other";
  provider: "stripe" | "manual" | "demo";
  providerRef: string;
  /** Negative for a refund we made. */
  amountPence: number;
  /** A refund we made is recorded as a negative amount with status "refunded". */
  status: "succeeded" | "pending" | "failed" | "refunded";
  receivedAt: string;
  recordedBy?: string;
  /** What the customer quoted on a bank transfer, or the card provider's payment id. */
  reference?: string;
  /** Anything worth saying: the refund reason, who handed over cash. */
  note?: string;
  /** Stripe: the webhook event that recorded it. */
  eventId?: string;
  /** When we stored the record (receivedAt is when the money arrived). */
  recordedAt?: string;
  /** When the payment was applied to its invoice and the project (a retry finishes what a failure left). */
  appliedAt?: string;
  /**
   * When it was added to the project's totals (payment-recorded). Set straight
   * after, so a retry of a part-applied payment never adds it twice; the
   * reducer refuses a payment id it has already counted as well.
   */
  recordedOnProjectAt?: string;
  /**
   * True while it still has to be applied (to its invoice, the project's
   * totals, the receipt). Absent on payments recorded any other way, which
   * are treated as applied.
   */
  pendingApply?: boolean;
}

/** "DIH", 1 → "DIH-0001". Pads to four digits and never truncates past them. */
export function invoiceNumber(prefix: string, n: number): string {
  const clean = prefix.trim().toUpperCase();
  const digits = String(Math.max(0, Math.floor(n))).padStart(4, "0");
  return clean ? `${clean}-${digits}` : digits;
}

const whole = (n: number, what: string) => {
  if (!Number.isInteger(n)) throw new Error(`${what} must be whole pence`);
  return n;
};

/**
 * One line from what the customer pays: the VAT (if the code charges any)
 * is the part of the total above the net, so net + tax always equals the
 * total exactly.
 */
export function invoiceLineFromTotal(label: string, totalPence: number, taxCode: TaxCodeId): InvoiceLine {
  whole(totalPence, "A line total");
  const rate = TAX_CODES[taxCode]?.ratePct ?? 0;
  const netPence = rate > 0 ? Math.round((totalPence * 100) / (100 + rate)) : totalPence;
  return { label, netPence, taxCode, taxPence: totalPence - netPence, totalPence };
}

/** The sums of a set of lines. */
export function invoiceTotals(lines: InvoiceLine[]): { netPence: number; taxPence: number; totalPence: number } {
  return lines.reduce(
    (t, l) => ({ netPence: t.netPence + l.netPence, taxPence: t.taxPence + l.taxPence, totalPence: t.totalPence + l.totalPence }),
    { netPence: 0, taxPence: 0, totalPence: 0 },
  );
}

/**
 * The deposit settings ask for, on a contract total: a whole-pence share,
 * never more than the contract. 0 when no deposit is set.
 */
export function depositPence(contractTotalPence: number, settings: PilotSettings): number {
  const pct = settings.payments.depositPct;
  if (!Number.isFinite(pct) || pct <= 0 || !Number.isFinite(contractTotalPence) || contractTotalPence <= 0) return 0;
  return Math.min(Math.round(contractTotalPence), Math.round((contractTotalPence * Math.min(pct, 100)) / 100));
}

/**
 * The balance invoice: the contract, plus accepted variations and date
 * change fees, less everything already invoiced towards the price
 * (deposits, earlier invoices, correcting credit notes: see
 * invoicedTowardsPricePence). Each part is its own line, so the customer
 * sees how the number was reached. Nothing to bill: [].
 */
export function buildBalanceInvoiceLines(input: {
  contractTotalPence: number;
  acceptedVariationsPence: number;
  changeFeesPence: number;
  alreadyInvoicedPence: number;
  taxCode: TaxCodeId;
  /** Anything promised off the balance (e.g. a survey fee paid earlier), as positive amounts. */
  credits?: { label: string; pence: number }[];
}): InvoiceLine[] {
  const { taxCode } = input;
  const parts: [string, number][] = [
    ["Contract price, as accepted", whole(input.contractTotalPence, "The contract total")],
    ["Accepted variations", whole(input.acceptedVariationsPence, "Variations")],
    ["Date change fees", whole(input.changeFeesPence, "Change fees")],
    ...(input.credits ?? []).map((c): [string, number] => [c.label, -Math.abs(whole(c.pence, "A credit"))]),
    ["Less: already invoiced", -whole(input.alreadyInvoicedPence, "Already invoiced")],
  ];
  const balance = parts.reduce((sum, [, p]) => sum + p, 0);
  if (balance <= 0) return [];
  return parts.filter(([, p]) => p !== 0).map(([label, p]) => invoiceLineFromTotal(label, p, taxCode));
}

/** The deposit invoice's single line. */
export function depositInvoiceLines(contractTotalPence: number, settings: PilotSettings, taxCode: TaxCodeId): InvoiceLine[] {
  const amount = depositPence(contractTotalPence, settings);
  if (amount <= 0) return [];
  return [invoiceLineFromTotal(`Deposit (${settings.payments.depositPct}% of the contract price)`, amount, taxCode)];
}

/** A credit note's line: always a negative amount. */
export function creditNoteLines(label: string, amountPence: number, taxCode: TaxCodeId): InvoiceLine[] {
  const amount = Math.abs(whole(amountPence, "A credit"));
  if (amount === 0) return [];
  return [invoiceLineFromTotal(label, -amount, taxCode)];
}

function statusFor(invoice: Invoice, paid: number): Invoice["status"] {
  if (invoice.status === "void") return "void";
  if (invoice.status === "draft" && paid === 0) return "draft";
  const total = invoice.totalPence;
  if (total > 0) return paid >= total ? "paid" : paid > 0 ? "part-paid" : "issued";
  if (total < 0) return paid <= total ? "paid" : paid < 0 ? "part-paid" : "issued";
  return "paid";
}

/**
 * Apply a verified payment (negative: a refund) to an invoice. Part paid
 * until it's covered, then paid; a refund can take it back. Money that
 * reached us still counts on a void invoice: the status just stays void, so
 * the office sees it and sorts it out.
 */
export function applyPayment(invoice: Invoice, amountPence: number): Invoice {
  whole(amountPence, "A payment");
  const paidPence = invoice.paidPence + amountPence;
  return { ...invoice, paidPence, status: statusFor(invoice, paidPence) };
}

/**
 * The invoice's paid amount recomputed from its payments (succeeded ones and
 * refunds), so applying the same payment twice can't count it twice.
 */
export function settleInvoice(invoice: Invoice, payments: Pick<Payment, "invoiceId" | "amountPence" | "status">[]): Invoice {
  const paid = payments
    .filter((p) => p.invoiceId === invoice.id && (p.status === "succeeded" || p.status === "refunded"))
    .reduce((sum, p) => sum + p.amountPence, 0);
  return applyPayment({ ...invoice, paidPence: 0 }, paid);
}

const counts = (i: Pick<Invoice, "status">) => i.status !== "draft" && i.status !== "void";

/** A credit note's purpose: as recorded, else (older ones) a credit against an invoice corrects it and one on its own reduces the price. */
export function creditPurposeOf(inv: Pick<Invoice, "kind" | "creditPurpose" | "creditsInvoiceId">): CreditPurpose | null {
  if (inv.kind !== "credit-note") return null;
  return inv.creditPurpose ?? (inv.creditsInvoiceId ? "correction" : "reduction");
}

/**
 * What's been invoiced towards the agreed price, for working out what's
 * still to bill: every live invoice except survey fees (the balance credits
 * a paid one separately) and price-reduction credit notes (money off the
 * price is never billed back). A correcting credit note does count: what
 * it cancelled is billed again, at the right figure.
 */
export function invoicedTowardsPricePence(invoices: Invoice[]): number {
  return invoices
    .filter((i) => counts(i) && i.kind !== "survey-fee" && creditPurposeOf(i) !== "reduction")
    .reduce((sum, i) => sum + i.totalPence, 0);
}

/** Accepted variations' total (VAT included), from the issues list. */
export function acceptedVariationsPence(issues: Pick<Issue, "kind" | "variation">[]): number {
  return issues
    .filter((i) => i.kind === "variation" && i.variation?.status === "accepted")
    .reduce((sum, i) => sum + (i.variation?.totalDeltaPence ?? 0), 0);
}

/**
 * The balance invoice's lines as things stand: the contract, accepted
 * variations and change fees, less what's been invoiced towards the price,
 * with a paid survey fee taken off as promised (contract §K19).
 */
export function balanceLinesFor(input: {
  contractTotalPence: number;
  acceptedVariationsPence: number;
  changeFeesPence: number;
  surveyFeePaidPence: number;
  invoices: Invoice[];
  taxCode: TaxCodeId;
}): InvoiceLine[] {
  return buildBalanceInvoiceLines({
    contractTotalPence: input.contractTotalPence,
    acceptedVariationsPence: input.acceptedVariationsPence,
    changeFeesPence: input.changeFeesPence,
    alreadyInvoicedPence: invoicedTowardsPricePence(input.invoices),
    taxCode: input.taxCode,
    ...(input.surveyFeePaidPence > 0 ? { credits: [{ label: "Home survey fee, already paid", pence: input.surveyFeePaidPence }] } : {}),
  });
}

/**
 * What's agreed but not yet on any invoice (the balance, accepted
 * variations, change fees): 0 when everything is billed, or there's no
 * contract. The closed gate holds on it.
 */
export function stillToBillPence(input: Omit<Parameters<typeof balanceLinesFor>[0], "taxCode" | "contractTotalPence"> & { contractTotalPence?: number }): number {
  if (!input.contractTotalPence || input.contractTotalPence <= 0) return 0;
  return Math.max(0, invoiceTotals(balanceLinesFor({ ...input, contractTotalPence: input.contractTotalPence, taxCode: "outside-scope" })).totalPence);
}

/**
 * What's left to pay across a project's invoices: issued totals less what's
 * been paid, credit notes included. Negative means the customer is in credit.
 */
export function outstandingPence(invoices: Invoice[]): number {
  return invoices.filter(counts).reduce((sum, i) => sum + (i.totalPence - i.paidPence), 0);
}

/** An invoice that asks for money (not a credit note, a draft or void). */
const asksForMoney = (i: Invoice) => counts(i) && i.kind !== "credit-note" && i.totalPence > 0;

/** One invoice on its own: its total less its payments and the credit notes against it (negative: overpaid). */
function ownBalance(invoice: Invoice, all: Invoice[]): number {
  const credited = all
    .filter((c) => c.kind === "credit-note" && counts(c) && c.creditsInvoiceId === invoice.id)
    .reduce((sum, c) => sum + (c.totalPence - c.paidPence), 0);
  return invoice.totalPence - invoice.paidPence + credited;
}

/**
 * Credit on the customer's account: credit notes not set against an
 * invoice (less anything refunded on them), and anything paid over an
 * invoice. It's used against what they owe, oldest invoice first.
 */
export function accountCreditPence(all: Invoice[]): number {
  let credit = 0;
  for (const i of all) {
    if (!counts(i)) continue;
    if (i.kind === "credit-note") {
      const target = i.creditsInvoiceId ? all.find((t) => t.id === i.creditsInvoiceId) : undefined;
      if (!target || !asksForMoney(target)) credit -= i.totalPence - i.paidPence;
    } else if (i.totalPence > 0) {
      const own = ownBalance(i, all);
      if (own < 0) credit -= own;
    }
  }
  return Math.max(0, credit);
}

const byAge = (a: Invoice, b: Invoice) =>
  (a.issuedAt ?? a.createdAt ?? "").localeCompare(b.issuedAt ?? b.createdAt ?? "") || a.number.localeCompare(b.number);

/**
 * What's still due on one invoice: its total, after its payments, any
 * credit notes raised against it, and the account's credit (credit notes on
 * their own, overpayments), used against the oldest invoices first. So the
 * per-invoice figures add up to what the customer really owes, and a credit
 * never leaves an invoice asking to be paid twice. Never below zero; drafts,
 * void invoices and credit notes owe nothing.
 */
export function invoiceOutstanding(invoice: Invoice, all: Invoice[]): number {
  if (!asksForMoney(invoice)) return 0;
  const own = Math.max(0, ownBalance(invoice, all));
  if (own === 0) return 0;
  let credit = accountCreditPence(all);
  if (credit === 0 || !all.some((i) => i.id === invoice.id)) return own;
  for (const i of all.filter(asksForMoney).sort(byAge)) {
    const owed = Math.max(0, ownBalance(i, all));
    const used = Math.min(owed, credit);
    if (i.id === invoice.id) return owed - used;
    credit -= used;
  }
  return own;
}

/**
 * Every invoice that still asks for money, across projects, with what's due
 * on it: invoiceOutstanding within its own project, so credit notes (against
 * it or on the account) and overpayments come off. For the console's "owed
 * to us" and the morning digest; a credited or cancelled invoice drops out.
 */
export function owedInvoices(invoices: Invoice[]): { invoice: Invoice; duePence: number }[] {
  const byProject = new Map<string, Invoice[]>();
  for (const i of invoices) byProject.set(i.projectId, [...(byProject.get(i.projectId) ?? []), i]);
  const out: { invoice: Invoice; duePence: number }[] = [];
  for (const list of byProject.values()) {
    for (const invoice of list) {
      const duePence = invoiceOutstanding(invoice, list);
      if (duePence > 0) out.push({ invoice, duePence });
    }
  }
  return out;
}

/** How much of the account's credit is being used against this invoice (0 when none). */
export function accountCreditUsedOn(invoice: Invoice, all: Invoice[]): number {
  if (!asksForMoney(invoice)) return 0;
  return Math.max(0, Math.max(0, ownBalance(invoice, all)) - invoiceOutstanding(invoice, all));
}

/**
 * The credit notes making up the account's credit: live ones not set against
 * an invoice that asks for money, with credit still left on them. An
 * invoice's "Less: credit on your account" line names them.
 */
export function accountCreditNotes(all: Invoice[]): Invoice[] {
  return all.filter((i) => {
    if (!counts(i) || i.kind !== "credit-note" || i.totalPence - i.paidPence >= 0) return false;
    const target = i.creditsInvoiceId ? all.find((t) => t.id === i.creditsInvoiceId) : undefined;
    return !target || !asksForMoney(target);
  });
}

/**
 * How much of an account credit note can be refunded: what's left on it,
 * and never more than the customer is in credit overall (credit that's
 * covering an unpaid invoice isn't theirs to take back as money).
 */
export function refundableCreditPence(creditNote: Invoice, all: Invoice[]): number {
  if (creditNote.kind !== "credit-note" || !counts(creditNote)) return 0;
  const target = creditNote.creditsInvoiceId ? all.find((t) => t.id === creditNote.creditsInvoiceId) : undefined;
  if (target && asksForMoney(target)) return 0; // set against its invoice: refund that invoice instead
  const left = -(creditNote.totalPence - creditNote.paidPence);
  return Math.max(0, Math.min(left, -outstandingPence(all)));
}

/**
 * Accepted variations that can still go on an invoice of their own: not
 * already billed on one, and not covered by a balance invoice (a live balance
 * invoice issued after the variation was accepted includes it). Without the
 * second rule, issuing the balance would leave the same variation on offer
 * to bill again.
 */
export function variationsBillableAlone<V extends { id: string; variation?: { decidedAt?: string } }>(
  acceptedVariations: V[],
  invoices: Pick<Invoice, "kind" | "status" | "issueId" | "issuedAt">[],
): V[] {
  const live = invoices.filter((i) => i.status !== "void" && i.status !== "draft");
  const balanceIssued = live.filter((i) => i.kind === "balance" && i.issuedAt).map((i) => i.issuedAt!);
  return acceptedVariations.filter((v) => {
    if (live.some((i) => i.issueId === v.id)) return false;
    const decided = v.variation?.decidedAt;
    // An acceptance with no time on record predates any balance we can compare it with: treat it as included.
    return !balanceIssued.some((at) => !decided || decided <= at);
  });
}

/** Every number the money page and the portal lead with. */
export function moneySummary(
  invoices: Invoice[],
  payments: Pick<Payment, "amountPence" | "status">[],
  contractTotalPence?: number,
): {
  contractTotalPence: number | null;
  invoicedPence: number;
  receivedPence: number;
  refundedPence: number;
  outstandingPence: number;
  /** Contract value not yet on an invoice (never negative). */
  toInvoicePence: number | null;
} {
  const live = invoices.filter(counts);
  const invoicedPence = live.reduce((sum, i) => sum + i.totalPence, 0);
  const receivedPence = payments.filter((p) => p.status === "succeeded").reduce((sum, p) => sum + p.amountPence, 0);
  const refundedPence = -payments.filter((p) => p.status === "refunded").reduce((sum, p) => sum + p.amountPence, 0);
  const contract = contractTotalPence !== undefined && contractTotalPence > 0 ? contractTotalPence : null;
  const contractKinds = new Set(live.filter((i) => i.kind === "deposit" || i.kind === "balance").map((i) => i.id));
  // Correcting credit notes cancel contract invoicing (to bill again); money off the price doesn't,
  // and nor does a variation's credit note (issueId: it bills the variation, as a variation invoice would).
  const contractInvoiced = live
    .filter(
      (i) =>
        contractKinds.has(i.id) ||
        (creditPurposeOf(i) === "correction" && !i.issueId && (!i.creditsInvoiceId || contractKinds.has(i.creditsInvoiceId))),
    )
    .reduce((sum, i) => sum + i.totalPence, 0);
  return {
    contractTotalPence: contract,
    invoicedPence,
    receivedPence,
    refundedPence,
    outstandingPence: outstandingPence(invoices),
    toInvoicePence: contract === null ? null : Math.max(0, contract - contractInvoiced),
  };
}

/** yyyy-mm-dd plus days. */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** When an invoice issued today falls due: deposits on issue, the rest after the agreed terms. */
export function invoiceDueOn(issuedOnIso: string, kind: InvoiceKind, settings: PilotSettings): string | undefined {
  if (kind === "credit-note") return undefined;
  if (kind === "deposit") return issuedOnIso.slice(0, 10);
  return addDays(issuedOnIso, Math.max(0, Math.round(settings.payments.balanceDueDays)));
}

/**
 * The payment terms every proposal and contract print bill the balance "once
 * the installation is finished", so the balance invoice waits for that. Null
 * when it may be raised; otherwise why not, in the office's words. An admin
 * can still bill it early, with a reason (money-server's `earlyReason`).
 */
export function balanceTimingProblem(install: { status: "not-started" | "in-progress" | "complete" }): string | null {
  if (install.status === "complete") return null;
  return install.status === "in-progress"
    ? "The contract bills the balance once the installation is finished, and it's still under way."
    : "The contract bills the balance once the installation is finished, and it hasn't started yet.";
}

/** Overdue on `todayIso`: something still owed past its due date. */
export function isInvoiceOverdue(invoice: Invoice, all: Invoice[], todayIso: string): boolean {
  return Boolean(invoice.dueOn && invoice.dueOn.slice(0, 10) < todayIso.slice(0, 10) && invoiceOutstanding(invoice, all) > 0);
}
