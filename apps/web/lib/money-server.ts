import {
  INVOICE_KIND_LABEL,
  buildBalanceInvoiceLines,
  creditNoteLines,
  depositPence,
  documentCompany,
  documentCustomer,
  effectiveTaxCode,
  invoiceDueOn,
  invoiceLineFromTotal,
  invoiceOutstanding,
  invoiceTotals,
  moneySummary,
  settleInvoice,
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
} from "@aircon/domain";
import { audit, type AuditActorInput } from "./audit";
import { demoLoginAllowed } from "./auth/access";
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
import { getSettings } from "./settings-server";

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
 *    finished by a retry if anything in between fails (`appliedAt`).
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
  /** For variation invoices: the variations still to bill. */
  variations?: { id: string; number: number; title: string; totalPence: number }[];
}

export interface MoneyView {
  project: Project;
  settings: PilotSettings;
  invoices: Invoice[];
  payments: Payment[];
  documents: DocumentRecord[];
  summary: ReturnType<typeof moneySummary>;
  plans: Record<Exclude<InvoiceKind, "credit-note">, InvoicePlan>;
  taxCode: TaxCodeId;
  card: { available: boolean; mode: "live" | "test" | "demo"; simulate: boolean };
  today: string;
}

/** Card payments: live/test Stripe, or (where demo sign-in is allowed and Stripe isn't set up) the labelled simulator. */
export function cardAvailability(): MoneyView["card"] {
  const configured = stripeConfigured();
  return {
    available: configured,
    mode: stripeMode(),
    simulate: !configured && demoLoginAllowed(process.env),
  };
}

/** The tax code invoices use: the accepted option's, else the settings default. */
function taxCodeFor(proposal: ProposalRecord | null, settings: PilotSettings): TaxCodeId {
  const accepted = proposal?.acceptance ? proposal.options.find((o) => o.id === proposal.acceptance!.optionId) : undefined;
  return accepted?.pricing?.taxCode ?? effectiveTaxCode(settings);
}

const live = (i: Invoice) => i.status !== "void" && i.status !== "draft";

/** Accepted variations, from the issues list. */
function acceptedVariations(issues: Issue[]): Issue[] {
  return issues.filter((i) => i.kind === "variation" && i.variation?.status === "accepted");
}

/** What each kind of invoice would bill right now, with the reason when it can't be raised. */
export function planInvoices(input: {
  project: Project;
  invoices: Invoice[];
  issues: Issue[];
  settings: PilotSettings;
  taxCode: TaxCodeId;
}): MoneyView["plans"] {
  const { project: p, invoices, issues, settings, taxCode } = input;
  const issued = invoices.filter(live);
  const contract = p.money.contractTotalPence ?? (p.proposal.status === "accepted" ? p.proposal.contractTotalPence : undefined);
  const plan = (kind: InvoicePlan["kind"], lines: InvoiceLine[], reason?: string, extra: Partial<InvoicePlan> = {}): InvoicePlan => {
    const total = invoiceTotals(lines).totalPence;
    const available = !reason && lines.length > 0 && total !== 0;
    return { kind, available, ...(available ? {} : { reason: reason ?? "Nothing to bill." }), lines, totalPence: total, ...extra };
  };

  // Deposit
  let deposit: InvoicePlan;
  if (!contract) deposit = plan("deposit", [], "There's no accepted contract to take a deposit on.");
  else if (issued.some((i) => i.kind === "deposit")) deposit = plan("deposit", [], "A deposit invoice has already been issued.");
  else if (settings.payments.depositPct <= 0) deposit = plan("deposit", [], "Deposits are off in settings (0%). Set a percentage there to ask for one.");
  else {
    const amount = depositPence(contract, settings);
    deposit = plan("deposit", [invoiceLineFromTotal(`Deposit (${settings.payments.depositPct}% of the contract price)`, amount, taxCode)]);
  }

  // Balance
  const variations = acceptedVariations(issues);
  const variationsPence = variations.reduce((s, i) => s + (i.variation?.totalDeltaPence ?? 0), 0);
  const alreadyInvoiced = issued.filter((i) => i.kind !== "survey-fee").reduce((s, i) => s + i.totalPence, 0);
  const balance = !contract
    ? plan("balance", [], "There's no accepted contract to bill.")
    : plan(
        "balance",
        buildBalanceInvoiceLines({
          contractTotalPence: contract,
          acceptedVariationsPence: variationsPence,
          changeFeesPence: p.money.changeFeesPence,
          alreadyInvoicedPence: alreadyInvoiced,
          taxCode,
        }),
        undefined,
      );
  if (contract && !balance.available) balance.reason = "Everything on the contract is already invoiced.";

  // Variations not yet billed on their own (the balance picks them up otherwise).
  const unbilled = variations.filter((v) => !issued.some((i) => i.issueId === v.id));
  const variation = plan(
    "variation",
    [],
    unbilled.length ? "Pick the variation to bill." : variations.length ? "Every accepted variation is billed." : "No accepted variations.",
    { variations: unbilled.map((v) => ({ id: v.id, number: v.number, title: v.title, totalPence: v.variation?.totalDeltaPence ?? 0 })) },
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
  return {
    project,
    settings,
    invoices,
    payments,
    documents: documents.filter((d) => d.kind === "invoice" || d.kind === "receipt"),
    summary: moneySummary(invoices, payments, project.money.contractTotalPence),
    plans: planInvoices({ project, invoices, issues, settings, taxCode }),
    taxCode,
    card: cardAvailability(),
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
  /** Credit notes: how much, why, and (optionally) the invoice it credits. */
  amountPence?: number;
  reason?: string;
  creditsInvoiceId?: string;
  /** The form's one-off id: a double click returns the first invoice. */
  requestId?: string;
  notes?: string;
}

const KIND_TITLE: Record<InvoiceKind, string> = {
  deposit: "deposit",
  balance: "balance",
  variation: "variation",
  "survey-fee": "survey fee",
  "change-fee": "date change fees",
  "credit-note": "credit note",
};

/** Raise and issue an invoice (or a credit note) in one step. */
export async function issueInvoice(projectId: string, input: IssueInput, staff: StaffMember): Promise<Outcome<Invoice>> {
  const project = await loadProject(projectId);
  if (!project) return fail("Project not found.", 404);
  const [settings, invoices, issues, proposal] = await Promise.all([
    getSettings(),
    invoicesRepo.listForProject(projectId),
    issuesRepo.listForProject(projectId),
    proposalsRepo.acceptedForProject(projectId),
  ]);
  if (input.requestId) {
    const again = invoices.find((i) => i.requestId === input.requestId);
    if (again) return { ok: true, value: again, message: `Invoice ${again.number} is issued.` };
  }
  const taxCode = taxCodeFor(proposal, settings);
  let lines: InvoiceLine[];
  let extra: Partial<Invoice> = {};

  if (input.kind === "credit-note") {
    const amount = Math.round(input.amountPence ?? 0);
    const reason = input.reason?.trim();
    if (!(amount > 0)) return fail("Enter the amount to credit.");
    if (!reason) return fail("Say why you're crediting it: it's printed on the credit note.");
    if (input.creditsInvoiceId) {
      const target = invoices.find((i) => i.id === input.creditsInvoiceId);
      if (!target || !live(target) || target.kind === "credit-note") return fail("That invoice can't be credited.");
      const left = invoiceOutstanding(target, invoices);
      if (amount > left) {
        return fail(`${left > 0 ? `Only ${money(left)} is` : "Nothing is"} left unpaid on ${target.number}. For money already paid, record a refund instead.`);
      }
      extra = { creditsInvoiceId: target.id };
    }
    lines = creditNoteLines(input.creditsInvoiceId ? `Credit against invoice ${invoices.find((i) => i.id === input.creditsInvoiceId)!.number}: ${reason}` : reason, amount, taxCode);
    extra = { ...extra, reason };
  } else if (input.kind === "variation") {
    const plans = planInvoices({ project, invoices, issues, settings, taxCode });
    const v = plans.variation.variations?.find((x) => x.id === input.issueId);
    if (!v) return fail("Pick an accepted variation that isn't billed yet.");
    lines = [invoiceLineFromTotal(`Variation ${v.number}: ${v.title}`, v.totalPence, taxCode)];
    extra = { issueId: v.id };
  } else {
    const plan = planInvoices({ project, invoices, issues, settings, taxCode })[input.kind];
    if (!plan.available) return fail(plan.reason ?? "Nothing to bill.");
    lines = plan.lines;
  }

  const totals = invoiceTotals(lines);
  if (totals.totalPence === 0 || lines.length === 0) return fail("Nothing to bill.");
  if (input.expectedTotalPence !== undefined && input.expectedTotalPence !== totals.totalPence) {
    return fail(`The amount changed since this page loaded (it's now ${money(totals.totalPence)}). Check it and issue again.`);
  }

  const now = new Date().toISOString();
  const today = londonToday();
  const dueOn = invoiceDueOn(today, input.kind, settings);
  const invoice = await invoicesRepo.insertNumbered({
    id: crypto.randomUUID(),
    projectId,
    kind: input.kind,
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
    ...extra,
  });
  await audit({ actor: staff, action: "invoice.issue", entity: "invoice", entityId: invoice.id, detail: { projectId, number: invoice.number, kind: invoice.kind, totalPence: invoice.totalPence } });
  const finished = await finishIssue(invoice, staff);
  return {
    ok: true,
    value: finished.invoice,
    message: `${input.kind === "credit-note" ? "Credit note" : "Invoice"} ${invoice.number} issued.`,
    ...(finished.warning ? { warning: finished.warning } : {}),
  };
}

/**
 * Everything that follows an issued invoice, each step skipped when it's
 * already done, so running it again (the "finish issuing" button, after a
 * failure part-way) never doubles anything: the printable document, the
 * project's invoiced total, the deposit request, the customer's email.
 */
export async function finishIssue(invoice: Invoice, actor: StaffMember): Promise<{ invoice: Invoice; warning?: string }> {
  let inv = invoice;
  const warnings: string[] = [];
  const project = await loadProject(inv.projectId);
  if (!project) return { invoice: inv, warning: "The project couldn't be read." };
  const settings = await getSettings();
  const card = cardAvailability();

  if (!inv.documentId) {
    try {
      const payments = await paymentsRepo.listForInvoice(inv.id);
      const doc = await createDocument(
        inv.projectId,
        "invoice",
        {
          company: documentCompany(settings),
          customer: documentCustomer(project),
          issuedAt: inv.issuedAt ?? new Date().toISOString(),
          invoice: inv,
          payments,
          payTo: {
            methods: settings.payments.methods.filter((m) => m !== "card" || card.available),
            ...(settings.company.bank ? { bank: settings.company.bank } : {}),
            reference: inv.number,
          },
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

  if (inv.kind !== "credit-note" && inv.totalPence > 0) {
    const sent = await notify("invoice-issued", {
      projectId: inv.projectId,
      data: {
        invoiceNumber: inv.number,
        kind: inv.kind,
        totalPence: inv.totalPence,
        ...(inv.dueOn ? { dueOn: inv.dueOn } : {}),
        cardPayments: card.available || card.simulate,
      },
      discriminator: inv.id,
    });
    if (sent.status === "error" || sent.status === "no-recipient" || sent.status === "failed") {
      warnings.push(sent.status === "no-recipient" ? "there's no email address to send it to" : "the email didn't go (see Messages)");
    }
  }
  return { invoice: inv, ...(warnings.length ? { warning: `Issued, but ${warnings.join("; ")}.` } : {}) };
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
  const row: Payment = { ...payment, id: payment.id ?? crypto.randomUUID(), recordedAt: new Date().toISOString() };
  const { payment: stored, duplicate } = await paymentsRepo.insertIdempotent(row);
  if (duplicate) {
    const stale = !stored.appliedAt && Date.now() - Date.parse(stored.recordedAt ?? stored.receivedAt) > STALE_APPLY_MS;
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
  return { ok: true, value: { payment: stored, duplicate }, ...(applied.warning ? { warning: applied.warning } : {}) };
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
  if (!payment || payment.appliedAt) return {};
  const warnings: string[] = [];
  let invoice: Invoice | null = null;

  if (payment.invoiceId) {
    const all = await paymentsRepo.listForInvoice(payment.invoiceId);
    const res = await mutateRow<Invoice>("invoices", payment.invoiceId, invoicesRepo, (cur) => ({ ok: true, value: settleInvoice(cur, all) }));
    if (res.ok) invoice = res.value;
    else warnings.push(`the invoice didn't update (${res.error})`);
  }

  const counted = payment.status === "succeeded" || payment.status === "refunded";
  if (counted) {
    const r = await dispatch(payment.projectId, { type: "payment-recorded", amountPence: payment.amountPence }, actor);
    if ("error" in r) {
      // Leave appliedAt unset: a retry finishes the job.
      return { warning: `Recorded, but the project's totals didn't update (${r.error}). Try again in a minute: it finishes where it stopped.` };
    }
    if (invoice && invoice.status === "paid" && payment.amountPence > 0) {
      if (invoice.kind === "deposit" && r.project.booking.depositStatus !== "paid") {
        const d = await dispatch(payment.projectId, { type: "deposit-paid", amountPence: invoice.totalPence }, actor);
        if ("error" in d) warnings.push(`the deposit wasn't marked paid (${d.error})`);
      }
      if (invoice.kind === "survey-fee" && r.project.survey.paymentStatus === "unpaid") {
        const d = await dispatch(payment.projectId, { type: "survey-fee-paid", amountPence: invoice.totalPence }, actor);
        if ("error" in d) warnings.push(`the survey fee wasn't marked paid (${d.error})`);
      }
    }
  }

  try {
    await paymentsRepo.update({ ...payment, appliedAt: new Date().toISOString() });
  } catch (err) {
    console.error(`[money] marking payment ${payment.id} applied failed:`, err);
  }

  if (payment.status === "succeeded" && payment.amountPence > 0) {
    const project = await loadProject(payment.projectId);
    try {
      const existing = await listDocuments(payment.projectId, { kind: "receipt", includeSuperseded: true });
      const already = existing.some((d) => (d.snapshot as { payment?: { id?: string } } | null)?.payment?.id === payment.id);
      if (!already && project) {
        const settings = await getSettings();
        await createDocument(
          payment.projectId,
          "receipt",
          {
            company: documentCompany(settings),
            customer: documentCustomer(project),
            issuedAt: new Date().toISOString(),
            payment,
            ...(invoice ? { invoice } : {}),
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
    const invoices = await invoicesRepo.listForProject(payment.projectId);
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

/** A bank transfer, cash or a card payment taken elsewhere, recorded by the person who saw it. */
export async function recordManualPayment(
  projectId: string,
  input: { invoiceId: string; amountPence: number; method: Payment["method"]; reference?: string; receivedOn: string; note?: string; requestId: string },
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
  if (input.amountPence > owed) {
    return fail(`That's more than is left on ${invoice.number} (${money(owed)}). Check the amount, or record the extra against another invoice.`);
  }
  return recordPayment(
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
}

/** A refund we made: a negative payment against the invoice it came from, with the reason. */
export async function recordRefund(
  projectId: string,
  input: { invoiceId: string; amountPence: number; method: Payment["method"]; reference?: string; refundedOn: string; reason: string; requestId: string },
  staff: StaffMember,
): Promise<Outcome<{ payment: Payment; duplicate: boolean }>> {
  const invoice = await invoicesRepo.get(input.invoiceId);
  if (!invoice || invoice.projectId !== projectId) return fail("That invoice isn't on this project.", 404);
  if (!input.reason.trim()) return fail("Say why the money went back.");
  if (!(input.amountPence > 0)) return fail("Enter the amount refunded.");
  if (input.amountPence > invoice.paidPence) return fail(`Only ${money(invoice.paidPence)} has been paid on ${invoice.number}.`);
  const today = londonToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.refundedOn) || input.refundedOn > today) return fail("The refund date must be today or earlier.");
  return recordPayment(
    {
      projectId,
      invoiceId: invoice.id,
      method: input.method,
      provider: "manual",
      providerRef: `refund:${input.requestId}`,
      amountPence: -input.amountPence,
      status: "refunded",
      receivedAt: `${input.refundedOn}T12:00:00.000Z`,
      recordedBy: staff.name,
      note: input.reason.trim(),
      ...(input.reference?.trim() ? { reference: input.reference.trim() } : {}),
    },
    staff,
  );
}

/**
 * The demo simulator (no Stripe keys, demo sign-in allowed): records a
 * provider "demo" card payment for what's left on the invoice. Labelled
 * everywhere; refused anywhere real.
 */
export async function simulateCardPayment(projectId: string, invoiceId: string, requestId: string, who: string): Promise<Outcome<{ payment: Payment; duplicate: boolean }>> {
  if (!cardAvailability().simulate) return fail("Simulated payments are only available in demo mode.", 403);
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

/** Invoices the customer still owes something on, with what's left on each. */
export function payableInvoices(invoices: Invoice[]): (Invoice & { owedPence: number })[] {
  return invoices
    .filter((i) => live(i) && i.kind !== "credit-note")
    .map((i) => ({ ...i, owedPence: invoiceOutstanding(i, invoices) }))
    .filter((i) => i.owedPence > 0);
}

export { INVOICE_KIND_LABEL };
