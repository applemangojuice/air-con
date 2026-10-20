import {
  INVOICE_KIND_LABEL,
  accountCreditNotes,
  accountCreditUsedOn,
  acceptedVariationsPence,
  balanceLinesFor,
  balanceTimingProblem,
  cancellationSettlement,
  creditNoteLines,
  creditPurposeOf,
  depositPence,
  documentCompany,
  contractTaxCode,
  documentCustomer,
  invoiceDueOn,
  invoiceLineFromTotal,
  invoiceOutstanding,
  invoiceTotals,
  moneySummary,
  outstandingPence,
  projectFees,
  refundableCreditPence,
  settingsForProposal,
  settleInvoice,
  type ContractSnapshot,
  type CreditPurpose,
  type DocumentRecord,
  type Invoice,
  type InvoiceKind,
  type InvoiceLine,
  type Issue,
  type Payment,
  type PilotSettings,
  type Project,
  type ProposalRecord,
  type StaffMember,
  type TaxCodeId,
  PAYMENT_ALREADY_COUNTED,
  variationsBillableAlone,
} from "@aircon/domain";
import { audit, type AuditActorInput } from "./audit";
import { demoModeAllowed } from "./auth/demo-guard";
import { notify } from "./comms/outbox";
import { createDocument, listDocuments } from "./documents-server";
import { money } from "./format";
import { dispatch, londonToday, loadProject, type ActorInput } from "./project-service";
import { stripeConfigured, stripeMode } from "./providers/stripe";
import { fail, mutateRow, type Outcome } from "./purchasing-server";
import * as invoicesRepo from "./repo/invoices";
import * as issuesRepo from "./repo/issues";
import * as paymentsRepo from "./repo/payments";
import * as proposalsRepo from "./repo/proposals";
import { SETTINGS_UNAVAILABLE, getSettings, getSettingsStrict, settingsForWrite } from "./settings-server";

/**
 * Money on the server (F5): invoices, verified payments and receipts.
 *
 * The rules that keep it honest:
 *  * An invoice is issued in one step from a figure the office has just
 *    seen (the server recomputes it and refuses if it moved), numbered from
 *    the settings counter, never edited after: a mistake is put right with
 *    a credit note.
 *  * A payment exists only as a row in `payments` (unique provider ref), from
 *    a verified Stripe event, a person recording money they've seen, or the
 *    clearly labelled demo simulator. The row is written first; applying it
 *    to the invoice, the project, the receipt and the email follows, and is
 *    finished by a retry if anything in between fails (`pendingApply`).
 *  * The project's totals move only through the reducer (invoice-issued,
 *    payment-recorded, deposit-paid), so the customer's timeline says what
 *    happened.
 *
 * Permissions are the caller's job (payments.record for staff; the pay
 * routes check the customer).
 */

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

export interface InvoicePlan {
  kind: InvoiceKind;
  available: boolean;
  /** Why it can't be raised now, when it can't. */
  reason?: string;
  lines: InvoiceLine[];
  totalPence: number;
  /** For variation invoices: the variations still to bill, each on the tax code it was priced on. */
  variations?: { id: string; number: number; title: string; totalPence: number; taxCode: TaxCodeId }[];
  /**
   * Balance only: it's ready to bill but the contract says not yet (the
   * install isn't finished). An admin may still issue it with a reason.
   */
  early?: boolean;
}

export interface MoneyView {
  project: Project;
  settings: PilotSettings;
  invoices: Invoice[];
  payments: Payment[];
  documents: DocumentRecord[];
  summary: ReturnType<typeof moneySummary>;
  /** A cancellation charge is never planned: it's recorded (cancellation-server recordCancellationCharge). */
  plans: Record<Exclude<InvoiceKind, "credit-note" | "cancellation-charge">, InvoicePlan>;
  taxCode: TaxCodeId;
  card: { available: boolean; mode: "live" | "test" | "demo"; simulate: boolean };
  today: string;
}

/** Card payments: live/test Stripe, or (where demo sign-in is allowed and Stripe isn't set up) the labelled simulator. */
export async function cardAvailability(): Promise<MoneyView["card"]> {
  const configured = stripeConfigured();
  return {
    available: configured,
    mode: stripeMode(),
    // Never on a database holding anything real, whatever the flags say (lib/auth/demo-guard).
    simulate: !configured && (await demoModeAllowed()),
  };
}

/** The tax code invoices use: the accepted option's, else the settings default as it must be charged. */
const taxCodeFor = (proposal: ProposalRecord | null, settings: PilotSettings): TaxCodeId => contractTaxCode(proposal, settings);

/**
 * The payment terms the customer agreed, as settings: the contract
 * document's frozen payment schedule (its deposit percentage, deposit and
 * balance due days), else the accepted proposal's frozen terms, else today's
 * settings (a contract from before terms were frozen). Invoices are planned
 * and dated on these, never on a settings change made after acceptance.
 */
export function agreedTerms(settings: PilotSettings, proposal: ProposalRecord | null, contract: DocumentRecord | undefined): PilotSettings {
  const frozen = (contract?.snapshot as Partial<ContractSnapshot> | undefined)?.payments;
  const base = settingsForProposal(settings, proposal);
  if (!frozen || !Number.isFinite(frozen.depositPct)) return base;
  return {
    ...base,
    payments: {
      ...base.payments,
      depositPct: frozen.depositPct,
      depositTiming: frozen.depositTiming ?? base.payments.depositTiming,
      balanceDueDays: Number.isFinite(frozen.balanceDueDays) ? frozen.balanceDueDays : base.payments.balanceDueDays,
    },
  };
}

/** The contract document in force (the newest final one). */
const contractOf = (docs: DocumentRecord[]) => docs.filter((d) => d.kind === "contract" && d.status === "final").sort((a, b) => b.version - a.version)[0];

/** The deposit the contract states, in pence, when its snapshot records one. */
const contractDepositPence = (contract: DocumentRecord | undefined): number | undefined => {
  const d = (contract?.snapshot as Partial<ContractSnapshot> | undefined)?.payments?.depositPence;
  return typeof d === "number" && Number.isInteger(d) && d >= 0 ? d : undefined;
};

const live = (i: Invoice) => i.status !== "void" && i.status !== "draft";

/**
 * Cancelled by correcting credit notes raised against it for its whole
 * amount, with nothing paid on it: as good as never issued (a deposit raised
 * at the wrong figure, then credited). A refund's credit note doesn't count
 * (money off the price, `creditPurposeOf` "reduction"): a deposit that was
 * paid and then refunded was a real deposit, so it never makes way for a
 * fresh one.
 */
export function creditedInFull(inv: Invoice, all: Invoice[]): boolean {
  if (inv.kind === "credit-note" || inv.paidPence > 0) return false;
  const against = all.filter((c) => live(c) && c.kind === "credit-note" && c.creditsInvoiceId === inv.id);
  if (against.some((c) => creditPurposeOf(c) !== "correction")) return false;
  const credited = -against.reduce((sum, c) => sum + c.totalPence, 0);
  return credited >= inv.totalPence;
}

/**
 * The contract was cancelled (or the project closed as cancelled): nothing
 * more is ever billed. Only refunds and credit notes are left (CCR reg 34;
 * recordCancellation's "no more money is asked for").
 */
export function billingStopped(p: Pick<Project, "cancellation" | "closure">): boolean {
  return Boolean(p.cancellation) || (p.closure.closed && p.closure.reason === "cancelled");
}

export const CANCELLED_NOTHING_TO_BILL = "The contract was cancelled, so nothing more is billed: only refunds and credit notes.";

/** Accepted variations, from the issues list. */
function acceptedVariations(issues: Issue[]): Issue[] {
  return issues.filter((i) => i.kind === "variation" && i.variation?.status === "accepted");
}

/** What each kind of invoice would bill right now, with the reason when it can't be raised. */
export function planInvoices(input: {
  project: Project;
  invoices: Invoice[];
  issues: Issue[];
  /** The agreed terms (agreedTerms), not today's settings. */
  settings: PilotSettings;
  taxCode: TaxCodeId;
  /** The deposit the contract document states, when it records one: charged exactly. */
  contractDepositPence?: number;
}): MoneyView["plans"] {
  const { project: p, invoices, issues, settings, taxCode } = input;
  if (billingStopped(p)) {
    const none = (kind: InvoicePlan["kind"]): InvoicePlan => ({ kind, available: false, reason: CANCELLED_NOTHING_TO_BILL, lines: [], totalPence: 0 });
    return { deposit: none("deposit"), balance: none("balance"), variation: { ...none("variation"), variations: [] }, "survey-fee": none("survey-fee"), "change-fee": none("change-fee") };
  }
  const issued = invoices.filter(live);
  const contract = p.money.contractTotalPence ?? (p.proposal.status === "accepted" ? p.proposal.contractTotalPence : undefined);
  const plan = (kind: InvoicePlan["kind"], lines: InvoiceLine[], reason?: string, extra: Partial<InvoicePlan> = {}): InvoicePlan => {
    const total = invoiceTotals(lines).totalPence;
    const available = !reason && lines.length > 0 && total !== 0;
    return { kind, available, ...(available ? {} : { reason: reason ?? "Nothing to bill." }), lines, totalPence: total, ...extra };
  };

  // Deposit. One cancelled by a credit note for all of it, with nothing paid, doesn't count:
  // the office can raise the right one (otherwise the booking would wait on it for ever).
  let deposit: InvoicePlan;
  if (!contract) deposit = plan("deposit", [], "There's no accepted contract to take a deposit on.");
  else if (issued.some((i) => i.kind === "deposit" && !creditedInFull(i, issued))) deposit = plan("deposit", [], "A deposit invoice has already been issued.");
  else if (settings.payments.depositPct <= 0) deposit = plan("deposit", [], "The contract's payment terms have no deposit (0%), so there's none to ask for.");
  else {
    const amount = input.contractDepositPence && input.contractDepositPence > 0 ? input.contractDepositPence : depositPence(contract, settings);
    deposit = plan("deposit", [invoiceLineFromTotal(`Deposit (${settings.payments.depositPct}% of the contract price)`, amount, taxCode)]);
  }

  // Balance: price-reduction credit notes (goodwill) are never billed back;
  // they stay on the account and come off what the customer pays.
  const variations = acceptedVariations(issues);
  const balance = !contract
    ? plan("balance", [], "There's no accepted contract to bill.")
    : plan(
        "balance",
        balanceLinesFor({
          contractTotalPence: contract,
          acceptedVariationsPence: acceptedVariationsPence(issues),
          changeFeesPence: p.money.changeFeesPence,
          // A paid survey fee counts off the price, as promised (contract §K19).
          surveyFeePaidPence: Math.round(projectFees(p).surveyPaidGbp * 100),
          invoices: issued,
          taxCode,
        }),
        undefined,
      );
  if (contract && !balance.available) balance.reason = "Everything on the contract is already invoiced.";
  // The terms the customer agreed bill it once the installation is finished.
  const notYet = balanceTimingProblem(p.install);
  if (balance.available && notYet) {
    balance.available = false;
    balance.reason = notYet;
    balance.early = true;
  }

  // Variations not yet billed on their own (the balance picks them up otherwise).
  const unbilled = variationsBillableAlone(variations, issued);
  const variation = plan(
    "variation",
    [],
    unbilled.length
      ? "Pick the variation to bill."
      : variations.length
        ? issued.some((i) => i.kind === "balance")
          ? "Every accepted variation is billed (the balance invoice includes them)."
          : "Every accepted variation is billed."
        : "No accepted variations.",
    {
      variations: unbilled.map((v) => ({
        id: v.id,
        number: v.number,
        title: v.title,
        totalPence: v.variation?.totalDeltaPence ?? 0,
        // Billed at the rate it was priced at (stored since batch 8; older ones were priced on the contract's code).
        taxCode: v.variation?.taxCode ?? taxCode,
      })),
    },
  );
  if (unbilled.length) variation.available = true;

  // Survey fee
  const feePence = Math.round(p.survey.feeGbp * 100);
  const surveyFee =
    feePence <= 0
      ? plan("survey-fee", [], "There's no survey fee on this project.")
      : p.survey.paymentStatus === "paid"
        ? plan("survey-fee", [], "The survey fee is already paid.")
        : issued.some((i) => i.kind === "survey-fee")
          ? plan("survey-fee", [], "The survey fee is already invoiced.")
          : plan("survey-fee", [invoiceLineFromTotal("Home survey fee", feePence, taxCode)]);

  // Date change fees, until the balance invoice (which includes them) goes out.
  const feesBilled = issued.filter((i) => i.kind === "change-fee").reduce((s, i) => s + i.totalPence, 0);
  const feesDue = p.money.changeFeesPence - feesBilled;
  const changeFee = issued.some((i) => i.kind === "balance")
    ? plan("change-fee", [], "The balance invoice already includes the date change fees.")
    : feesDue <= 0
      ? plan("change-fee", [], "No date change fees to bill.")
      : plan("change-fee", [invoiceLineFromTotal("Date change fees", feesDue, taxCode)]);

  return { deposit, balance, variation, "survey-fee": surveyFee, "change-fee": changeFee };
}

export async function loadMoney(projectId: string): Promise<MoneyView | null> {
  const project = await loadProject(projectId);
  if (!project) return null;
  const [settings, invoices, payments, issues, proposal, documents] = await Promise.all([
    getSettings(),
    invoicesRepo.listForProject(projectId),
    paymentsRepo.listForProject(projectId),
    issuesRepo.listForProject(projectId),
    proposalsRepo.acceptedForProject(projectId),
    listDocuments(projectId),
  ]);
  const taxCode = taxCodeFor(proposal, settings);
  const contractDoc = contractOf(documents);
  const agreed = agreedTerms(settings, proposal, contractDoc);
  const deposit = contractDepositPence(contractDoc);
  return {
    project,
    settings,
    invoices,
    payments,
    documents: documents.filter((d) => d.kind === "invoice" || d.kind === "receipt"),
    summary: moneySummary(invoices, payments, project.money.contractTotalPence),
    plans: planInvoices({ project, invoices, issues, settings: agreed, taxCode, ...(deposit !== undefined ? { contractDepositPence: deposit } : {}) }),
    taxCode,
    card: await cardAvailability(),
    today: londonToday(),
  };
}

/* ------------------------------------------------------------------ */
/* Issuing                                                             */
/* ------------------------------------------------------------------ */

export interface IssueInput {
  kind: InvoiceKind;
  /** The total the office saw: refused if the recomputed one differs. */
  expectedTotalPence?: number;
  /** Variation invoices: which variation. */
  issueId?: string;
  /** Credit notes: how much, why, what it's for, and (optionally) the invoice it credits. */
  amountPence?: number;
  reason?: string;
  creditsInvoiceId?: string;
  /** Default: a correction when it's against an invoice, money off the price when it isn't. */
  creditPurpose?: CreditPurpose;
  /**
   * Server only (never from a form): after a cancellation with a charge for
   * the work done, credit what was *paid* on a contract invoice too, so the
   * money they paid is credit on their account, held against the charge and
   * refunded beyond it (recordCancellationCharge). Never more than the part
   * of the invoice not already credited.
   */
  releasePaid?: boolean;
  /** The form's one-off id: a double click returns the first invoice. */
  requestId?: string;
  notes?: string;
  /**
   * Balance only: an admin billing it before the installation is finished
   * (the contract says after), and why. Audited and kept in the invoice's (internal) notes.
   */
  earlyReason?: string;
}

const KIND_TITLE: Record<InvoiceKind, string> = {
  deposit: "deposit",
  balance: "balance",
  variation: "variation",
  "survey-fee": "survey fee",
  "change-fee": "date change fees",
  "cancellation-charge": "work done before cancelling",
  "credit-note": "credit note",
};

/**
 * Who issues an invoice: a staff member, or the system for the one thing it
 * issues by itself (the credit note that goes with a refund made in Stripe).
 */
export type Issuer = StaffMember | { kind: "system"; name: string };

/** What's been credited against an invoice so far (zero or negative): its live credit notes' totals. */
function creditedAgainst(target: Invoice, all: Invoice[]): number {
  return all.filter((c) => live(c) && c.kind === "credit-note" && c.creditsInvoiceId === target.id).reduce((sum, c) => sum + c.totalPence, 0);
}

/** Raise and issue an invoice (or a credit note) in one step. */
export async function issueInvoice(projectId: string, input: IssueInput, staff: Issuer): Promise<Outcome<Invoice>> {
  const project = await loadProject(projectId);
  if (!project) return fail("Project not found.", 404);
  // An invoice freezes the terms and the company's details: never on the fallback defaults.
  const settings = await settingsForWrite();
  if (!settings) return fail(SETTINGS_UNAVAILABLE, 503);
  const [invoices, issues, proposal, contractDoc] = await Promise.all([
    invoicesRepo.listForProject(projectId),
    issuesRepo.listForProject(projectId),
    proposalsRepo.acceptedForProject(projectId),
    listDocuments(projectId, { kind: "contract" }).then(contractOf),
  ]);
  // Planned and dated on the terms the customer agreed.
  const agreed = agreedTerms(settings, proposal, contractDoc);
  const agreedDeposit = contractDepositPence(contractDoc);
  const planned = () => planInvoices({ project, invoices, issues, settings: agreed, taxCode, ...(agreedDeposit !== undefined ? { contractDepositPence: agreedDeposit } : {}) });
  if (input.requestId) {
    const again = invoices.find((i) => i.requestId === input.requestId);
    if (again) return { ok: true, value: again, message: `Invoice ${again.number} is issued.` };
  }
  const taxCode = taxCodeFor(proposal, settings);
  // After a cancellation only money going back (never an invoice, nor a variation's credit), and the
  // one charge the cancellation rules allow for work done after an evidenced early start (reg 36(4)).
  if (billingStopped(project) && input.kind !== "credit-note" && input.kind !== "cancellation-charge") return fail(CANCELLED_NOTHING_TO_BILL);
  if (input.releasePaid && (input.kind !== "credit-note" || !billingStopped(project) || !project.cancellation?.charge)) {
    return fail("Only a cancelled contract with a charge for the work done releases what was paid as credit.");
  }
  let lines: InvoiceLine[];
  let extra: Partial<Invoice> = {};
  // What it's issued as: a variation that takes money off becomes a credit note (never a negative invoice).
  let kind: InvoiceKind = input.kind;

  if (input.kind === "credit-note") {
    const amount = Math.round(input.amountPence ?? 0);
    const reason = input.reason?.trim();
    if (!(amount > 0)) return fail("Enter the amount to credit.");
    if (!reason) return fail("Say why you're crediting it: it's printed on the credit note.");
    if (input.creditsInvoiceId) {
      const target = invoices.find((i) => i.id === input.creditsInvoiceId);
      if (!target || !live(target) || target.kind === "credit-note") return fail("That invoice can't be credited.");
      // Normally only what's unpaid; releasing a cancelled contract's paid money, the part not yet credited.
      const left = input.releasePaid ? target.totalPence + creditedAgainst(target, invoices) : invoiceOutstanding(target, invoices);
      if (amount > left) {
        return fail(`${left > 0 ? `Only ${money(left)} is` : "Nothing is"} left unpaid on ${target.number}. For money already paid, record a refund instead.`);
      }
      extra = { creditsInvoiceId: target.id };
    } else {
      // On its own: never more than was ever charged or agreed, less earlier credits (a £20,000 typo for £200 is refused).
      const agreedPence =
        (project.money.contractTotalPence ?? 0) + acceptedVariationsPence(issues) + project.money.changeFeesPence;
      const chargedPence = invoices.filter((i) => live(i) && i.kind !== "credit-note").reduce((s, i) => s + i.totalPence, 0);
      const creditedPence = -invoices.filter((i) => live(i) && i.kind === "credit-note").reduce((s, i) => s + i.totalPence, 0);
      const ceiling = Math.max(0, Math.max(agreedPence, chargedPence) - creditedPence);
      if (amount > ceiling) {
        return fail(
          ceiling > 0
            ? `That's more than this project's price less earlier credits (${money(ceiling)} at most). Check the amount.`
            : "There's nothing on this project to credit yet.",
        );
      }
    }
    const purpose: CreditPurpose = input.creditPurpose ?? (input.creditsInvoiceId ? "correction" : "reduction");
    lines = creditNoteLines(input.creditsInvoiceId ? `Credit against invoice ${invoices.find((i) => i.id === input.creditsInvoiceId)!.number}: ${reason}` : reason, amount, taxCode);
    extra = { ...extra, reason, creditPurpose: purpose };
  } else if (input.kind === "cancellation-charge") {
    // Only the charge the project records (the reducer checked the law's conditions:
    // cancellationChargeProblem), and only once.
    const c = project.cancellation?.charge;
    if (!c) return fail("Record the charge for the work done first: there's none on this project.");
    if (invoices.some((i) => live(i) && i.kind === "cancellation-charge")) return fail("The charge for the work done is already invoiced.");
    lines = [invoiceLineFromTotal(`Work done before you cancelled: ${c.basis}`, c.amountPence, taxCode)];
    extra = { reason: c.basis };
  } else if (input.kind === "variation") {
    const plans = planned();
    const v = plans.variation.variations?.find((x) => x.id === input.issueId);
    if (!v) return fail("Pick an accepted variation that isn't billed yet.");
    if (v.totalPence < 0) {
      // Money off the price: a credit note on the customer's account, tied to
      // the variation (so it counts as billed, and towards the price, as a
      // variation invoice would). The balance then bills the full figure and
      // the credit comes off what they pay: never a negative "invoice" that
      // nothing treats as credit.
      kind = "credit-note";
      const reason = `Variation ${v.number}: ${v.title}`;
      lines = creditNoteLines(reason, -v.totalPence, v.taxCode);
      extra = { issueId: v.id, reason, creditPurpose: "correction" };
    } else {
      lines = [invoiceLineFromTotal(`Variation ${v.number}: ${v.title}`, v.totalPence, v.taxCode)];
      extra = { issueId: v.id };
    }
  } else {
    const plan = planned()[input.kind];
    const early = input.earlyReason?.trim();
    if (plan.early && early) {
      if (!("roles" in staff) || !staff.roles.includes("admin")) return fail("Only an admin can bill the balance before the installation is finished.", 403);
      extra = { notes: [`Billed before the installation finished: ${early}`, input.notes?.trim()].filter(Boolean).join(" · ") };
    } else if (!plan.available) {
      return fail(plan.early ? `${plan.reason} An admin can bill it early, with a reason.` : (plan.reason ?? "Nothing to bill."));
    }
    lines = plan.lines;
  }

  const totals = invoiceTotals(lines);
  if (totals.totalPence === 0 || lines.length === 0) return fail("Nothing to bill.");
  // An invoice asks for money and a credit note gives it back: never the other way round.
  if (kind === "credit-note" ? totals.totalPence > 0 : totals.totalPence < 0) return fail("Nothing to bill.");
  if (input.expectedTotalPence !== undefined && input.expectedTotalPence !== totals.totalPence) {
    return fail(`The amount changed since this page loaded (it's now ${money(totals.totalPence)}). Check it and issue again.`);
  }

  const now = new Date().toISOString();
  const today = londonToday();
  const dueOn = invoiceDueOn(today, kind, agreed);
  let invoice: Invoice;
  try {
    invoice = await invoicesRepo.insertNumbered({
      id: crypto.randomUUID(),
      projectId,
      kind,
      status: "issued",
      lines,
      ...totals,
      paidPence: 0,
      ...(dueOn ? { dueOn } : {}),
      issuedAt: now,
      issuedBy: staff.name,
      createdAt: now,
      createdBy: staff.name,
      ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
      ...(input.requestId ? { requestId: input.requestId } : {}),
      // Planned on these invoices: one issued at the same moment on the same ones is refused (0013).
      issueKey: String(invoices.length),
      ...extra,
      issuing: true,
    });
  } catch (err) {
    if (!(err instanceof invoicesRepo.InvoiceClashError)) throw err;
    // The number it was given goes unused: say so where the books can see it.
    await audit({ actor: staff, action: "invoice.number-unused", entity: "invoice", entityId: err.number, detail: { projectId, kind, why: err.clash } });
    if (err.clash === "request") {
      const again = (await invoicesRepo.listForProject(projectId)).find((i) => i.requestId === input.requestId);
      if (again) return { ok: true, value: again, message: `Invoice ${again.number} is issued.` };
    }
    return fail("Another invoice was issued on this project at the same moment. Reload to see it, then check what's left to bill.", 409);
  }
  await audit({
    actor: staff,
    action: "invoice.issue",
    entity: "invoice",
    entityId: invoice.id,
    detail: { projectId, number: invoice.number, kind: invoice.kind, totalPence: invoice.totalPence, ...(input.earlyReason?.trim() && input.kind === "balance" ? { earlyReason: input.earlyReason.trim() } : {}) },
  });
  const finished = await finishIssue(invoice, staff);
  return {
    ok: true,
    value: finished.invoice,
    message:
      kind === "credit-note" && input.kind === "variation"
        ? `Credit note ${invoice.number} issued: the variation takes money off, so it's credit on their account and comes off what they pay.`
        : `${kind === "credit-note" ? "Credit note" : "Invoice"} ${invoice.number} issued.`,
    ...(finished.warning ? { warning: finished.warning } : {}),
  };
}

/**
 * Everything that follows an issued invoice, each step skipped when it's
 * already done, so running it again (the "finish issuing" button, after a
 * failure part-way) never doubles anything: the printable document, the
 * project's invoiced total, the deposit request, the customer's email.
 */
export async function finishIssue(invoice: Invoice, actor: Issuer): Promise<{ invoice: Invoice; warning?: string }> {
  let inv = invoice;
  // Only invoices this module numbered carry the flag; anything else is complete as it stands.
  if (!inv.issuing) return { invoice: inv };
  const warnings: string[] = [];
  const project = await loadProject(inv.projectId);
  if (!project) return { invoice: inv, warning: "The project couldn't be read." };
  const card = await cardAvailability();
  // What it asks for once credit already on the account comes off (a goodwill credit note, a
  // variation that took money off, an overpayment): the figure the pay page and Checkout take,
  // so the document and the email ask for exactly that, never the gross total.
  const asIssued = async () => {
    const all = await invoicesRepo.listForProject(inv.projectId);
    const listed = all.some((i) => i.id === inv.id) ? all : [...all, inv];
    return { toPayPence: invoiceOutstanding(inv, listed), creditPence: accountCreditUsedOn(inv, listed), creditNotes: accountCreditNotes(listed).map((c) => c.number) };
  };

  if (!inv.documentId) {
    try {
      // The printable copy freezes the company's details and how to pay: never the fallback defaults
      // (unreadable settings leave it to "finish issuing").
      const settings = await getSettingsStrict();
      const payments = await paymentsRepo.listForInvoice(inv.id);
      const owing = inv.kind === "credit-note" ? null : await asIssued();
      const doc = await createDocument(
        inv.projectId,
        "invoice",
        {
          company: documentCompany(settings),
          customer: documentCustomer(project),
          issuedAt: inv.issuedAt ?? new Date().toISOString(),
          invoice: customerInvoice(inv),
          payments: payments.map(customerPayment),
          payTo: {
            methods: settings.payments.methods.filter((m) => m !== "card" || card.available),
            ...(settings.company.bank ? { bank: settings.company.bank } : {}),
            reference: inv.number,
          },
          ...(owing
            ? {
                toPayPence: owing.toPayPence,
                ...(owing.creditPence > 0 ? { accountCredit: { pence: owing.creditPence, creditNotes: owing.creditNotes } } : {}),
              }
            : {}),
        },
        {
          title: `${inv.kind === "credit-note" ? "Credit note" : "Invoice"} ${inv.number} (${KIND_TITLE[inv.kind]})`,
          customerVisible: true,
          createdBy: actor.name,
        },
      );
      const saved = await mutateRow<Invoice>("invoices", inv.id, invoicesRepo, (cur) => ({ ok: true, value: { ...cur, documentId: doc.id } }));
      if (saved.ok) inv = saved.value;
    } catch (err) {
      console.error(`[money] invoice document for ${inv.number} failed:`, err);
      warnings.push("the printable invoice wasn't created");
    }
  }

  if (!inv.recordedOnProjectAt) {
    const r = await dispatch(inv.projectId, { type: "invoice-issued", amountPence: inv.totalPence }, actor);
    if ("error" in r) {
      warnings.push(`the project's totals didn't update (${r.error})`);
    } else {
      const saved = await mutateRow<Invoice>("invoices", inv.id, invoicesRepo, (cur) => ({
        ok: true,
        value: { ...cur, recordedOnProjectAt: new Date().toISOString() },
      }));
      if (saved.ok) inv = saved.value;
      if (inv.kind === "deposit" && r.project.booking.depositStatus === "not-required") {
        const d = await dispatch(inv.projectId, { type: "deposit-requested", amountPence: inv.totalPence }, actor);
        if ("error" in d) warnings.push(`the deposit request wasn't recorded (${d.error})`);
      }
    }
  }

  if (inv.kind === "cancellation-charge") {
    // Its own email: the charge, how it was worked out, and the refund or what's left (the hub's numbers).
    const latest = (await loadProject(inv.projectId)) ?? project;
    const settlement = cancellationSettlement(latest);
    const c = latest.cancellation;
    if (settlement && c) {
      const sent = await notify("cancellation-confirmed", {
        projectId: inv.projectId,
        data: {
          receivedAt: c.receivedAt,
          channel: c.channel,
          refundDueBy: c.refundDueBy,
          paidPence: settlement.paidPence,
          withinPeriod: c.withinPeriod,
          workStartedEarly: true,
          collectEquipment: equipmentToCollect(latest),
          charge: {
            chargePence: settlement.chargePence,
            basis: settlement.basis,
            refundDuePence: settlement.refundDuePence,
            owedPence: settlement.owedPence,
            invoiceNumber: inv.number,
            supplied: latest.proposal.contractType !== "install-only",
          },
        },
        discriminator: `charge:${inv.id}`,
      });
      if (sent.status === "error" || sent.status === "no-recipient" || sent.status === "failed") {
        warnings.push(sent.status === "no-recipient" ? "there's no email address to send it to" : "the email didn't go (see Messages)");
      }
    }
  } else if (inv.kind !== "credit-note" && inv.totalPence > 0) {
    const owing = await asIssued();
    const sent = await notify("invoice-issued", {
      projectId: inv.projectId,
      data: {
        invoiceNumber: inv.number,
        kind: inv.kind,
        totalPence: inv.totalPence,
        // Left to pay after account credit: the subject and "Left to pay" say it (templates).
        outstandingPence: owing.toPayPence,
        ...(inv.dueOn ? { dueOn: inv.dueOn } : {}),
        cardPayments: card.available || card.simulate,
      },
      discriminator: inv.id,
    });
    if (sent.status === "error" || sent.status === "no-recipient" || sent.status === "failed") {
      warnings.push(sent.status === "no-recipient" ? "there's no email address to send it to" : "the email didn't go (see Messages)");
    }
  }
  if (warnings.length === 0) {
    const saved = await mutateRow<Invoice>("invoices", inv.id, invoicesRepo, (cur) => {
      const { issuing: _done, ...rest } = cur;
      void _done;
      return { ok: true, value: rest };
    });
    if (saved.ok) inv = saved.value;
  }
  return { invoice: inv, ...(warnings.length ? { warning: `Issued, but ${warnings.join("; ")}.` } : {}) };
}

/** Supplied kit with the family (or the install begun): we collect it after a cancellation (cancellation-server's rule). */
export function equipmentToCollect(p: Pick<Project, "proposal" | "kit" | "install">): boolean {
  return p.proposal.contractType !== "install-only" && (["dispatched", "delivered", "inspected"].includes(p.kit.status) || p.install.status !== "not-started");
}

/** An invoice as the customer's document shows it: no internal bookkeeping. */
export function customerInvoice(inv: Invoice): Invoice {
  const { requestId: _r, issueKey: _k, issuing: _i, recordedOnProjectAt: _p, notes: _n, createdBy: _c, checkoutSessionId: _s, ...rest } = inv;
  void [_r, _k, _i, _p, _n, _c, _s];
  return rest;
}

/** A payment as a receipt shows it: no internal bookkeeping. */
export function customerPayment(pay: Payment): Payment {
  const { pendingApply: _p, appliedAt: _a, recordedAt: _r, eventId: _e, recordedOnProjectAt: _o, ...rest } = pay;
  void [_p, _a, _r, _e, _o];
  return rest;
}

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

/** Who to name in the audit log for a payment. */
function auditActor(actor: ActorInput, fallback: string): AuditActorInput {
  if (!actor) return { kind: "system", name: fallback };
  if ("roles" in actor) return actor;
  if (actor.kind === "staff") return actor.staff;
  if (actor.kind === "customer") return { kind: "customer", id: actor.customerId, ...(actor.name ? { name: actor.name } : {}) };
  return { kind: "system", name: actor.name ?? fallback };
}

/** The name to print as a document's creator. */
function actorName(actor: ActorInput): string | undefined {
  if (!actor) return undefined;
  if ("roles" in actor) return actor.name;
  if (actor.kind === "staff") return actor.staff.name;
  return actor.name;
}

const inFlight = new Map<string, Promise<{ warning?: string }>>();

/** A payment older than this with nothing applied was left by a failure: a retry finishes it. */
const STALE_APPLY_MS = 2 * 60_000;

/**
 * Store a verified payment once (the provider reference is unique) and
 * apply it. A duplicate (a replayed webhook, a double click) changes
 * nothing, unless the first attempt stopped part-way long enough ago.
 */
export async function recordPayment(
  payment: Omit<Payment, "id" | "recordedAt"> & { id?: string },
  actor: ActorInput,
  opts: { refuseVoid?: boolean } = {},
): Promise<Outcome<{ payment: Payment; duplicate: boolean }>> {
  if (!Number.isInteger(payment.amountPence) || payment.amountPence === 0) return fail("The amount must be whole pence, and not zero.");
  if (payment.invoiceId) {
    const invoice = await invoicesRepo.get(payment.invoiceId);
    if (!invoice || invoice.projectId !== payment.projectId) return fail("That invoice isn't on this project.", 404);
    if (opts.refuseVoid && invoice.status === "void") return fail("That invoice is void.");
  }
  const row: Payment = { ...payment, id: payment.id ?? crypto.randomUUID(), recordedAt: new Date().toISOString(), pendingApply: true };
  const { payment: stored, duplicate } = await paymentsRepo.insertIdempotent(row);
  if (duplicate) {
    const stale = stored.pendingApply === true && Date.now() - Date.parse(stored.recordedAt ?? stored.receivedAt) > STALE_APPLY_MS;
    if (!stale) return { ok: true, value: { payment: stored, duplicate: true }, message: "Already recorded." };
  }
  await audit({
    actor: auditActor(actor, stored.provider),
    action: duplicate ? "payment.retry-apply" : "payment.record",
    entity: "payment",
    entityId: stored.id,
    detail: { projectId: stored.projectId, invoiceId: stored.invoiceId, amountPence: stored.amountPence, provider: stored.provider },
  });
  const applied = await applyRecordedPayment(stored.id, actor);
  const fresh = (await paymentsRepo.get(stored.id)) ?? stored;
  return { ok: true, value: { payment: fresh, duplicate }, ...(applied.warning ? { warning: applied.warning } : {}) };
}

/** The "finish applying" button: a payment left part-way (pendingApply) gets the rest done. */
export async function finishPayment(projectId: string, paymentId: string, staff: StaffMember): Promise<Outcome<Payment>> {
  const payment = await paymentsRepo.get(paymentId);
  if (!payment || payment.projectId !== projectId) return fail("That payment isn't on this project.", 404);
  if (!payment.pendingApply) return { ok: true, value: payment, message: "Already fully applied." };
  const applied = await applyRecordedPayment(paymentId, staff);
  const fresh = (await paymentsRepo.get(paymentId)) ?? payment;
  return { ok: true, value: fresh, message: fresh.pendingApply ? "Still not finished." : "Done: invoice, totals and receipt.", ...(applied.warning ? { warning: applied.warning } : {}) };
}

/** Apply a stored payment (once per process at a time). */
export function applyRecordedPayment(paymentId: string, actor: ActorInput): Promise<{ warning?: string }> {
  const running = inFlight.get(paymentId);
  if (running) return running;
  const job = applyNow(paymentId, actor).finally(() => inFlight.delete(paymentId));
  inFlight.set(paymentId, job);
  return job;
}

async function applyNow(paymentId: string, actor: ActorInput): Promise<{ warning?: string }> {
  const payment = await paymentsRepo.get(paymentId);
  if (!payment || !payment.pendingApply) return {};
  const warnings: string[] = [];
  let invoice: Invoice | null = null;
  // The receipt freezes the company's details. With settings unreadable, stop before anything
  // changes: the payment stays pending, so a retry (Stripe's, or "finish applying") does it all.
  const receipt = payment.status === "succeeded" && payment.amountPence > 0;
  let settings: PilotSettings | null = null;
  if (receipt) {
    try {
      settings = await getSettingsStrict();
    } catch {
      return { warning: "Recorded, but not applied yet: the business settings couldn't be read for the receipt. Try again in a minute: it finishes where it stopped." };
    }
  }

  if (payment.invoiceId) {
    const all = await paymentsRepo.listForInvoice(payment.invoiceId);
    const res = await mutateRow<Invoice>("invoices", payment.invoiceId, invoicesRepo, (cur) => ({ ok: true, value: settleInvoice(cur, all) }));
    if (res.ok) invoice = res.value;
    else warnings.push(`the invoice didn't update (${res.error})`);
  }

  const counted = payment.status === "succeeded" || payment.status === "refunded";
  let recordedOnProjectAt = payment.recordedOnProjectAt;
  if (counted) {
    // Add it to the project's totals exactly once. A retry of a payment that
    // stopped part-way skips this step when it already happened (recorded
    // here, or refused by the reducer for a payment id it already counts).
    let project: Project | null;
    if (recordedOnProjectAt) {
      project = await loadProject(payment.projectId);
    } else {
      const r = await dispatch(payment.projectId, { type: "payment-recorded", amountPence: payment.amountPence, paymentId: payment.id }, actor);
      if ("error" in r) {
        const current = r.error === PAYMENT_ALREADY_COUNTED ? await loadProject(payment.projectId) : null;
        if (!current?.money.paymentIds?.includes(payment.id)) {
          // Leave appliedAt unset: a retry finishes the job.
          return { warning: `Recorded, but the project's totals didn't update (${r.error}). Try again in a minute: it finishes where it stopped.` };
        }
        project = current;
      } else {
        project = r.project;
      }
      recordedOnProjectAt = new Date().toISOString();
      try {
        // (payments has no updated_at, so a plain update of the fresh row, not mutateRow.)
        const fresh = (await paymentsRepo.get(payment.id)) ?? payment;
        await paymentsRepo.update({ ...fresh, recordedOnProjectAt });
      } catch (err) {
        console.error(`[money] marking payment ${payment.id} counted failed (the reducer still refuses a second count):`, err);
      }
    }
    // Paid: by this payment, or with account credit covering the rest (invoiceOutstanding).
    const cleared =
      invoice !== null &&
      payment.amountPence > 0 &&
      (invoice.status === "paid" || (live(invoice) && invoiceOutstanding(invoice, await invoicesRepo.listForProject(payment.projectId)) === 0));
    if (invoice && cleared && project) {
      if (invoice.kind === "deposit" && project.booking.depositStatus !== "paid") {
        const d = await dispatch(payment.projectId, { type: "deposit-paid", amountPence: invoice.totalPence }, actor);
        if ("error" in d) warnings.push(`the deposit wasn't marked paid (${d.error})`);
      }
      if (invoice.kind === "survey-fee" && project.survey.paymentStatus === "unpaid") {
        const d = await dispatch(payment.projectId, { type: "survey-fee-paid", amountPence: invoice.totalPence }, actor);
        if ("error" in d) warnings.push(`the survey fee wasn't marked paid (${d.error})`);
      }
    }
  }

  try {
    const { pendingApply: _pending, ...applied } = (await paymentsRepo.get(payment.id)) ?? payment;
    void _pending;
    await paymentsRepo.update({ ...applied, ...(recordedOnProjectAt ? { recordedOnProjectAt } : {}), appliedAt: new Date().toISOString() });
  } catch (err) {
    console.error(`[money] marking payment ${payment.id} applied failed:`, err);
  }

  if (receipt && settings) {
    const project = await loadProject(payment.projectId);
    const invoices = await invoicesRepo.listForProject(payment.projectId);
    try {
      const existing = await listDocuments(payment.projectId, { kind: "receipt", includeSuperseded: true });
      const already = existing.some((d) => (d.snapshot as { payment?: { id?: string } } | null)?.payment?.id === payment.id);
      if (!already && project) {
        await createDocument(
          payment.projectId,
          "receipt",
          {
            company: documentCompany(settings),
            customer: documentCustomer(project),
            issuedAt: new Date().toISOString(),
            payment: customerPayment(payment),
            ...(invoice
              ? {
                  invoice: customerInvoice(invoice),
                  // After credit notes and account credit, as the pay page counts it.
                  stillToPayPence: invoiceOutstanding(invoices.find((i) => i.id === invoice!.id) ?? invoice, invoices),
                }
              : {}),
          },
          {
            title: `Receipt${invoice ? ` for ${invoice.number}` : ""}`,
            customerVisible: true,
            ...(actorName(actor) ? { createdBy: actorName(actor) } : {}),
          },
        );
      }
    } catch (err) {
      console.error(`[money] receipt for payment ${payment.id} failed:`, err);
      warnings.push("the receipt document wasn't created");
    }
    const owed = invoices.filter(live).reduce((s, i) => s + invoiceOutstanding(i, invoices), 0);
    const sent = await notify("payment-received", {
      projectId: payment.projectId,
      data: {
        amountPence: payment.amountPence,
        receivedAt: payment.receivedAt,
        ...(invoice ? { invoiceNumber: invoice.number } : {}),
        method: payment.method,
        outstandingPence: owed,
      },
      discriminator: payment.id,
    });
    if (sent.status === "error" || sent.status === "failed") warnings.push("the receipt email didn't go (see Messages)");
    if (payment.provider === "stripe") {
      await notify("team-alert", {
        projectId: payment.projectId,
        data: {
          title: `Card payment received: ${money(payment.amountPence)}${invoice ? ` for ${invoice.number}` : ""}`,
          lines: [`Stripe reference ${payment.reference ?? payment.providerRef}`, "Recorded from Stripe's signed confirmation; the receipt has gone to the customer."],
        },
        discriminator: `payment:${payment.id}`,
      });
    }
  }
  return warnings.length ? { warning: `Recorded, but ${warnings.join("; ")}.` } : {};
}

/**
 * A bank transfer, cash or a card payment taken elsewhere, recorded by the
 * person who saw it. More than is owed is refused as a likely typo unless
 * they say that much really arrived (`overpaid`): then it's all recorded, the
 * extra is credit on the customer's account (refund it from this invoice, or
 * it comes off their next one), and the team is told, as for a card
 * overpayment, so the records always match the bank.
 */
export async function recordManualPayment(
  projectId: string,
  input: {
    invoiceId: string;
    amountPence: number;
    method: Payment["method"];
    reference?: string;
    receivedOn: string;
    note?: string;
    requestId: string;
    /** More than is owed really arrived: record it all, the extra as account credit. */
    overpaid?: boolean;
  },
  staff: StaffMember,
): Promise<Outcome<{ payment: Payment; duplicate: boolean }>> {
  const invoice = await invoicesRepo.get(input.invoiceId);
  if (!invoice || invoice.projectId !== projectId) return fail("That invoice isn't on this project.", 404);
  if (!live(invoice) || invoice.kind === "credit-note") return fail("Payments go against an issued invoice.");
  const today = londonToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.receivedOn) || input.receivedOn > today) return fail("The date it arrived must be today or earlier.");
  if (input.method === "bank-transfer" && !input.reference?.trim()) return fail("Add the bank reference the customer used, so it can be matched.");
  const all = await invoicesRepo.listForProject(projectId);
  const owed = invoiceOutstanding(invoice, all);
  const extra = input.amountPence - owed;
  if (extra > 0 && !input.overpaid) {
    return fail(
      `That's more than is left on ${invoice.number} (${money(owed)}). Check the amount. If that much really arrived, tick "More than is owed arrived" and record it all: the extra ${money(extra)} stays as credit on their account.`,
    );
  }
  const recorded = await recordPayment(
    {
      projectId,
      invoiceId: invoice.id,
      method: input.method,
      provider: "manual",
      providerRef: `manual:${input.requestId}`,
      amountPence: input.amountPence,
      status: "succeeded",
      receivedAt: `${input.receivedOn}T12:00:00.000Z`,
      recordedBy: staff.name,
      ...(input.reference?.trim() ? { reference: input.reference.trim() } : {}),
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    },
    staff,
    { refuseVoid: true },
  );
  if (recorded.ok && !recorded.value.duplicate && extra > 0) {
    await notify("team-alert", {
      projectId,
      data: {
        title: `Overpaid: ${money(extra)} more than was owed on ${invoice.number}`,
        lines: [
          `${staff.name} recorded ${money(input.amountPence)} by ${input.method === "bank-transfer" ? "bank transfer" : input.method}${input.reference?.trim() ? ` (reference ${input.reference.trim()})` : ""}; ${owed > 0 ? `${money(owed)} was owed` : "nothing was owed"}. The extra is credit on their account.`,
          "Refund the extra (Money, this invoice, Record a refund: no credit note goes with it), or leave it to come off their next invoice, and tell them which.",
        ],
        urgent: true,
      },
      discriminator: `overpaid:${recorded.value.payment.id}`,
    });
    return { ...recorded, message: `Recorded. ${money(extra)} of it is more than was owed: it's credit on their account, and the team has been told.` };
  }
  return recorded;
}

/**
 * What a refund means for the invoice it's recorded against, when it would
 * otherwise leave that invoice asking to be paid again:
 *  * "reduction" (the default): they keep it, so a credit note for it goes
 *    with the refund (goodwill, a snag, a cancellation);
 *  * "correction": it was invoiced in error; the credit note cancels it and
 *    the balance bills the right figure;
 *  * "owed": they still owe it (a payment bounced back, say): no credit
 *    note, and the invoice is open again.
 * A refund of money they overpaid, or of credit already on the account,
 * needs no credit note whichever is picked, and gets none.
 */
export type RefundTreatment = CreditPurpose | "owed";

/**
 * A refund we made: a negative payment against the invoice it came from (or
 * the account credit note it pays out), with the reason.
 *
 * A card payment taken through Stripe is refunded in Stripe, and recorded
 * here from Stripe's own confirmation (recordStripeRefund), so it's refused
 * here as a card refund: recording it by hand as well would count it twice.
 */
export async function recordRefund(
  projectId: string,
  input: {
    invoiceId: string;
    amountPence: number;
    method: Payment["method"];
    reference?: string;
    refundedOn: string;
    reason: string;
    requestId: string;
    treatment?: RefundTreatment;
  },
  staff: StaffMember,
): Promise<Outcome<{ payment: Payment; duplicate: boolean; creditNote?: Invoice }>> {
  const today = londonToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.refundedOn) || input.refundedOn > today) return fail("The refund date must be today or earlier.");
  if (input.method === "card" && stripeConfigured()) {
    const paidByStripe = (await paymentsRepo.listForInvoice(input.invoiceId)).some((p) => p.provider === "stripe" && p.amountPence > 0);
    if (paidByStripe) {
      return fail(
        "That was paid by card through Stripe, so refund it in Stripe (Payments, open the payment, Refund). It's recorded here by itself within a minute of Stripe confirming it, with a credit note so it isn't asked for again.",
      );
    }
  }
  return applyRefund(
    projectId,
    {
      invoiceId: input.invoiceId,
      amountPence: input.amountPence,
      method: input.method,
      provider: "manual",
      providerRef: `refund:${input.requestId}`,
      refundedAt: `${input.refundedOn}T12:00:00.000Z`,
      reason: input.reason,
      creditRequestId: `refund-credit:${input.requestId}`,
      recordedBy: staff.name,
      ...(input.reference?.trim() ? { reference: input.reference.trim() } : {}),
      ...(input.treatment ? { treatment: input.treatment } : {}),
    },
    staff,
  );
}

/** The refund itself, however it was made: checks, the negative payment, and the credit note when it reopened the invoice. */
async function applyRefund(
  projectId: string,
  input: {
    invoiceId: string;
    amountPence: number;
    method: Payment["method"];
    provider: Payment["provider"];
    providerRef: string;
    refundedAt: string;
    reason: string;
    creditRequestId: string;
    recordedBy?: string;
    reference?: string;
    eventId?: string;
    treatment?: RefundTreatment;
  },
  actor: Issuer,
): Promise<Outcome<{ payment: Payment; duplicate: boolean; creditNote?: Invoice }>> {
  const invoice = await invoicesRepo.get(input.invoiceId);
  if (!invoice || invoice.projectId !== projectId) return fail("That invoice isn't on this project.", 404);
  if (!input.reason.trim()) return fail("Say why the money went back.");
  if (!(input.amountPence > 0)) return fail("Enter the amount refunded.");
  const asActor = "roles" in actor ? actor : ({ kind: "system", name: actor.name } as const);
  let owedBefore: number;
  let recorded: Outcome<{ payment: Payment; duplicate: boolean }>;
  const existing = await paymentsRepo.getByProviderRef(input.providerRef);
  if (existing && existing.projectId === projectId) {
    // A replay (a double click, Stripe sending it again): finish whatever the first left undone,
    // never check it again against the totals it already changed.
    recorded = await recordPayment({ ...existing }, asActor);
    if (!recorded.ok) return recorded;
    const now = await invoicesRepo.listForProject(projectId);
    owedBefore = Math.max(0, invoiceOutstanding(now.find((i) => i.id === invoice.id) ?? invoice, now) - input.amountPence);
  } else {
    const before = await invoicesRepo.listForProject(projectId);
    if (invoice.kind === "credit-note") {
      // Paying out credit on the account: never more than is left on it, or than they're in credit overall.
      const refundable = refundableCreditPence(invoice, before);
      if (input.amountPence > refundable) {
        const inCredit = Math.max(0, -outstandingPence(before));
        return fail(
          refundable > 0
            ? `Only ${money(refundable)} of ${invoice.number} can be refunded: the rest is covering what they owe.`
            : inCredit > 0
              ? `${invoice.number} has nothing left to refund.`
              : `The customer isn't in credit: ${invoice.number} is covering what they owe.`,
        );
      }
    } else if (input.amountPence > invoice.paidPence) {
      return fail(`Only ${money(invoice.paidPence)} has been paid on ${invoice.number}.`);
    }
    owedBefore = invoiceOutstanding(invoice, before);
    recorded = await recordPayment(
      {
        projectId,
        invoiceId: invoice.id,
        method: input.method,
        provider: input.provider,
        providerRef: input.providerRef,
        amountPence: -input.amountPence,
        status: "refunded",
        receivedAt: input.refundedAt,
        ...(input.recordedBy ? { recordedBy: input.recordedBy } : {}),
        note: input.reason.trim(),
        ...(input.reference ? { reference: input.reference } : {}),
        ...(input.eventId ? { eventId: input.eventId } : {}),
      },
      asActor,
    );
  }
  if (!recorded.ok || invoice.kind === "credit-note" || (input.treatment ?? "reduction") === "owed") return recorded;

  // The refund reopened the invoice: unless they still owe it, a credit note
  // for the part that isn't overpayment or account credit, so nobody asks for it again.
  const after = await invoicesRepo.listForProject(projectId);
  const fresh = after.find((i) => i.id === invoice.id) ?? invoice;
  const reopened = Math.min(input.amountPence, invoiceOutstanding(fresh, after) - owedBefore);
  if (reopened <= 0) return recorded;
  const credited = await issueInvoice(
    projectId,
    {
      kind: "credit-note",
      amountPence: reopened,
      reason: `Refunded: ${input.reason.trim()}`,
      creditsInvoiceId: invoice.id,
      creditPurpose: input.treatment === "correction" ? "correction" : "reduction",
      requestId: input.creditRequestId,
    },
    actor,
  );
  if (!credited.ok) {
    return { ...recorded, warning: `Refund recorded, but the credit note for it wasn't issued (${credited.error}): issue one against ${invoice.number} so it isn't asked for again.` };
  }
  return {
    ...recorded,
    value: { ...recorded.value, creditNote: credited.value },
    message: `Refund recorded, with credit note ${credited.value.number} against ${invoice.number}, so it isn't asked for again.`,
    ...(credited.warning ? { warning: credited.warning } : {}),
  };
}

/**
 * The demo simulator (no Stripe keys, demo sign-in allowed): records a
 * provider "demo" card payment for what's left on the invoice. Labelled
 * everywhere; refused anywhere real.
 */
export async function simulateCardPayment(projectId: string, invoiceId: string, requestId: string, who: string): Promise<Outcome<{ payment: Payment; duplicate: boolean }>> {
  if (!(await cardAvailability()).simulate) return fail("Simulated payments are only available in demo mode.", 403);
  const invoice = await invoicesRepo.get(invoiceId);
  if (!invoice || invoice.projectId !== projectId) return fail("That invoice isn't on this project.", 404);
  const all = await invoicesRepo.listForProject(projectId);
  const owed = invoiceOutstanding(invoice, all);
  if (owed <= 0) return fail("Nothing is left to pay on this invoice.");
  return recordPayment(
    {
      projectId,
      invoiceId,
      method: "card",
      provider: "demo",
      providerRef: `demo:${invoiceId}:${requestId}`,
      amountPence: owed,
      status: "succeeded",
      receivedAt: new Date().toISOString(),
      recordedBy: `${who} (DEMO simulation: no money moved)`,
      note: "DEMO: simulated card payment. No money moved.",
    },
    { kind: "system", name: "demo payment simulator" },
    { refuseVoid: true },
  );
}

/**
 * A card payment Stripe has confirmed: from a signature-verified webhook, or
 * a Checkout Session read back from Stripe's API after the redirect (never
 * from the redirect itself). Idempotent on the session id, so the webhook
 * and the return page can both run it.
 */
export async function recordStripePayment(facts: {
  sessionId: string;
  invoiceId: string;
  projectId: string;
  amountPence: number;
  paymentIntent?: string;
  receivedAt: string;
  eventId: string;
}): Promise<Outcome<{ payment: Payment; duplicate: boolean }>> {
  const invoice = await invoicesRepo.get(facts.invoiceId);
  if (!invoice || invoice.projectId !== facts.projectId) {
    console.error(`[stripe] session ${facts.sessionId} names invoice ${facts.invoiceId} on ${facts.projectId}, which doesn't match our records`);
    return fail("That invoice isn't on that project.", 404);
  }
  // What was still owed before this arrived: more than that is an overpayment (two Checkout pages
  // for one bill both paid, say), recorded as it came in and flagged for the team.
  const owedBefore = invoice.status === "void" ? 0 : invoiceOutstanding(invoice, await invoicesRepo.listForProject(facts.projectId));
  const result = await recordPayment(
    {
      projectId: facts.projectId,
      invoiceId: facts.invoiceId,
      method: "card",
      provider: "stripe",
      providerRef: facts.sessionId,
      amountPence: facts.amountPence,
      status: "succeeded",
      receivedAt: facts.receivedAt,
      ...(facts.paymentIntent ? { reference: facts.paymentIntent } : {}),
      eventId: facts.eventId,
    },
    { kind: "system", name: "Stripe" },
  );
  if (result.ok && !result.value.duplicate && invoice.status === "void") {
    await notify("team-alert", {
      projectId: facts.projectId,
      data: { title: `Card payment on a void invoice: ${invoice.number}`, lines: ["The money arrived and is recorded. Refund it, or set it against another invoice."], urgent: true },
      discriminator: `void-payment:${facts.sessionId}`,
    });
  } else if (result.ok && !result.value.duplicate && facts.amountPence > owedBefore) {
    const extra = facts.amountPence - owedBefore;
    await notify("team-alert", {
      projectId: facts.projectId,
      data: {
        title: `Overpaid by card: ${money(extra)} more than was owed on ${invoice.number}`,
        lines: [
          `Stripe took ${money(facts.amountPence)}; ${owedBefore > 0 ? `${money(owedBefore)} was owed` : "nothing was owed"}. The extra is on their account as credit.`,
          "Refund the extra in Stripe (it's recorded here by itself), or leave it to come off their next invoice and tell them so.",
          `Stripe session ${facts.sessionId}`,
        ],
        urgent: true,
      },
      discriminator: `overpaid:${facts.sessionId}`,
    });
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Refunds and disputes made in Stripe                                 */
/* ------------------------------------------------------------------ */

/** The card payment a Stripe refund or dispute is about: by our invoice id when Stripe carried it, else by the PaymentIntent. */
export async function findStripePayment(ref: { paymentIntent?: string; invoiceId?: string }): Promise<Payment | null> {
  if (!ref.paymentIntent) return null;
  if (ref.invoiceId) {
    const onInvoice = (await paymentsRepo.listForInvoice(ref.invoiceId)).find((p) => p.provider === "stripe" && p.amountPence > 0 && p.reference === ref.paymentIntent);
    if (onInvoice) return onInvoice;
  }
  return paymentsRepo.findStripeByIntent(ref.paymentIntent);
}

export interface StripeRefundInput {
  refundId: string;
  paymentIntent?: string;
  amountPence: number;
  status: string;
  refundedAt: string;
  reason?: string;
  invoiceId?: string;
  eventId: string;
}

const STRIPE_REASON: Record<string, string> = {
  requested_by_customer: "the customer asked",
  duplicate: "a duplicate payment",
  fraudulent: "fraud",
  expired_uncaptured_charge: "the payment was never captured",
};

/**
 * A refund made in Stripe (its dashboard, mostly): recorded against the card
 * payment it came from, once (`stripe-refund:<refund id>`), the same way as a
 * refund recorded by hand: a negative payment, and when it reopens the
 * invoice, a credit note so nobody asks for that money again ("they keep it",
 * the hand form's default). Money they'd overpaid needs none and gets none.
 * The team hears what was done. A refund that failed at Stripe records
 * nothing (or, if it was recorded while pending, tells the team to put it
 * back).
 */
export async function recordStripeRefund(refund: StripeRefundInput): Promise<Outcome<{ payment?: Payment; recorded: boolean; creditNote?: Invoice }>> {
  const providerRef = `stripe-refund:${refund.refundId}`;
  const original = await findStripePayment({ ...(refund.paymentIntent ? { paymentIntent: refund.paymentIntent } : {}), ...(refund.invoiceId ? { invoiceId: refund.invoiceId } : {}) });
  if (!original || !original.invoiceId) {
    console.error(`[stripe] refund ${refund.refundId} (${refund.paymentIntent ?? "no payment intent"}) matches no card payment we recorded`);
    await notify("team-alert", {
      data: {
        title: `A Stripe refund we couldn't match: ${money(refund.amountPence)}`,
        lines: [
          `Stripe refunded ${money(refund.amountPence)} (refund ${refund.refundId}${refund.paymentIntent ? `, payment ${refund.paymentIntent}` : ""}), and it isn't a card payment recorded here.`,
          "Find the project in Stripe's dashboard (the payment's description names the invoice) and record the refund by hand: Money, Record a refund, How: Other.",
        ],
        urgent: true,
      },
      discriminator: `stripe-refund-unmatched:${refund.refundId}`,
    });
    return { ok: true, value: { recorded: false }, message: "No matching payment." };
  }
  const projectId = original.projectId;
  const already = await paymentsRepo.getByProviderRef(providerRef);
  if (refund.status === "failed" || refund.status === "canceled") {
    if (already) {
      await notify("team-alert", {
        projectId,
        data: {
          title: `A refund failed at Stripe: ${money(refund.amountPence)}`,
          lines: [
            `Stripe says refund ${refund.refundId} ${refund.status === "failed" ? "failed" : "was cancelled"}, so the money didn't go back to the customer.`,
            "It was recorded here while it was pending, with a credit note. Don't refund it again or record it by hand (either counts it twice, and the form refuses the money while the credit note covers it): ask the developer to reverse the recorded refund and its credit note, then sort it out with the customer.",
          ],
          urgent: true,
        },
        discriminator: `stripe-refund-failed:${refund.refundId}`,
      });
    }
    return { ok: true, value: { recorded: false }, message: `Refund ${refund.status}: nothing recorded.` };
  }
  if (refund.status !== "succeeded" && refund.status !== "pending") {
    return { ok: true, value: { recorded: false }, message: `Refund ${refund.status}: not yet.` };
  }
  const why = refund.reason ? STRIPE_REASON[refund.reason] ?? refund.reason.replace(/_/g, " ") : null;
  const result = await applyRefund(
    projectId,
    {
      invoiceId: original.invoiceId,
      amountPence: refund.amountPence,
      method: "card",
      provider: "stripe",
      providerRef,
      refundedAt: refund.refundedAt,
      reason: `Refunded in Stripe${why ? ` (${why})` : ""}`,
      creditRequestId: `stripe-refund-credit:${refund.refundId}`,
      recordedBy: "Stripe",
      reference: refund.refundId,
      eventId: refund.eventId,
      treatment: "reduction",
    },
    { kind: "system", name: "Stripe" },
  );
  if (!result.ok) {
    // Most likely recorded by hand already: more refunded than is recorded as paid.
    await notify("team-alert", {
      projectId,
      data: {
        title: `A Stripe refund couldn't be recorded: ${money(refund.amountPence)}`,
        lines: [`Stripe refunded ${money(refund.amountPence)} (refund ${refund.refundId}), but it wasn't recorded: ${result.error}`, "Check the money page: if it was already recorded by hand, nothing more is needed."],
        urgent: true,
      },
      discriminator: `stripe-refund-refused:${refund.refundId}`,
    });
    return { ok: true, value: { recorded: false }, message: result.error };
  }
  if (!already) {
    const invoice = await invoicesRepo.get(original.invoiceId);
    const credit = result.value.creditNote;
    await notify("team-alert", {
      projectId,
      data: {
        title: `Card refund recorded from Stripe: ${money(refund.amountPence)}${invoice ? ` on ${invoice.number}` : ""}`,
        lines: [
          `Refunded in Stripe (${refund.refundId}) and recorded here from Stripe's confirmation.`,
          credit
            ? `Credit note ${credit.number} went with it (money off the price), so it isn't asked for again.`
            : "It was money they'd overpaid or had as credit, so no credit note was needed.",
          ...(result.warning ? [result.warning] : []),
        ],
      },
      discriminator: `stripe-refund:${refund.refundId}`,
    });
  }
  return { ok: true, value: { payment: result.value.payment, recorded: true, ...(result.value.creditNote ? { creditNote: result.value.creditNote } : {}) }, ...(result.warning ? { warning: result.warning } : {}) };
}

/** A chargeback opened or settled at Stripe: the team must hear at once (the evidence has a deadline). */
export async function alertStripeDispute(d: {
  phase: "created" | "closed";
  disputeId: string;
  paymentIntent?: string;
  amountPence: number;
  reason?: string;
  status?: string;
  respondBy?: string;
}): Promise<void> {
  const original = d.paymentIntent ? await findStripePayment({ paymentIntent: d.paymentIntent }) : null;
  const invoice = original?.invoiceId ? await invoicesRepo.get(original.invoiceId) : null;
  const on = invoice ? ` on ${invoice.number}` : "";
  const lines =
    d.phase === "created"
      ? [
          `The customer's bank is disputing a card payment of ${money(d.amountPence)}${on}${d.reason ? ` (${d.reason.replace(/_/g, " ")})` : ""}. Stripe holds the money until it's decided.`,
          `Answer it in Stripe's dashboard (Payments, Disputes)${d.respondBy ? ` by ${d.respondBy.slice(0, 10)}` : ""}: the contract, the proposal and the job's photos are the evidence.`,
          "Nothing has changed here yet: the payment still shows as received.",
        ]
      : d.status === "won"
        ? [`The dispute over ${money(d.amountPence)}${on} was decided in our favour: the money stays with us. Nothing to change here.`]
        : [
            `The dispute over ${money(d.amountPence)}${on} closed as "${(d.status ?? "lost").replace(/_/g, " ")}".`,
            d.status === "lost"
              ? "The money has gone back to the customer's bank. Record it on the money page (Record a refund, How: Other, and say they still owe it) so the invoice shows it's unpaid again."
              : "Check Stripe's dashboard for what it means for the money.",
          ];
  await notify("team-alert", {
    ...(original ? { projectId: original.projectId } : {}),
    data: {
      title: d.phase === "created" ? `Chargeback: a card payment of ${money(d.amountPence)}${on} is disputed` : `Chargeback closed (${d.status ?? "closed"}): ${money(d.amountPence)}${on}`,
      lines: [...lines, `Stripe dispute ${d.disputeId}${original ? "" : " (no matching payment recorded here)"}`],
      urgent: d.phase === "created" || d.status === "lost",
    },
    discriminator: `stripe-dispute:${d.disputeId}:${d.phase}`,
  });
}

/**
 * Invoices the customer still owes something on, with what's left on each
 * (after any credit on their account, which `creditPence` says).
 */
export function payableInvoices(invoices: Invoice[]): (Invoice & { owedPence: number; creditPence: number })[] {
  return invoices
    .filter((i) => live(i) && i.kind !== "credit-note")
    .map((i) => ({ ...i, owedPence: invoiceOutstanding(i, invoices), creditPence: accountCreditUsedOn(i, invoices) }))
    .filter((i) => i.owedPence > 0);
}

export { INVOICE_KIND_LABEL };
