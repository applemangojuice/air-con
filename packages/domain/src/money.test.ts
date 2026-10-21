import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accountCreditNotes,
  accountCreditPence,
  accountCreditUsedOn,
  applyPayment,
  balanceLinesFor,
  buildBalanceInvoiceLines,
  creditPurposeOf,
  creditNoteLines,
  depositInvoiceLines,
  depositPence,
  invoiceDueOn,
  invoiceLineFromTotal,
  invoiceNumber,
  invoiceOutstanding,
  owedInvoices,
  invoiceTotals,
  isInvoiceOverdue,
  moneySummary,
  outstandingPence,
  refundableCreditPence,
  settleInvoice,
  stillToBillPence,
  type Invoice,
  type InvoiceLine,
  type Payment,
  variationsBillableAlone,
} from "./money.ts";
import { DEFAULT_SETTINGS, mergeSettings } from "./settings.ts";

const withDeposit = (pct: number) => mergeSettings({ payments: { ...DEFAULT_SETTINGS.payments, depositPct: pct } });

function invoice(over: Partial<Invoice> & { totalPence: number }): Invoice {
  return {
    id: over.id ?? "inv-1",
    projectId: "p-1",
    number: "DIH-0001",
    kind: "balance",
    status: "issued",
    lines: [],
    netPence: over.totalPence,
    taxPence: 0,
    paidPence: 0,
    ...over,
  };
}

test("invoice numbers pad to four digits", () => {
  assert.equal(invoiceNumber("dih", 7), "DIH-0007");
  assert.equal(invoiceNumber("DIH", 12345), "DIH-12345");
});

test("deposit is a whole-pence share of the contract, zero when not set", () => {
  assert.equal(depositPence(480_000, DEFAULT_SETTINGS), 0, "default is no deposit");
  assert.equal(depositPence(480_000, withDeposit(20)), 96_000);
  assert.equal(depositPence(333_333, withDeposit(20)), 66_667);
  assert.equal(depositPence(100_000, withDeposit(150)), 100_000, "never more than the contract");
  assert.equal(depositPence(0, withDeposit(20)), 0);
  assert.deepEqual(depositInvoiceLines(480_000, DEFAULT_SETTINGS, "outside-scope"), []);
  const [line] = depositInvoiceLines(480_000, withDeposit(25), "outside-scope");
  assert.equal(line?.totalPence, 120_000);
  assert.match(line!.label, /25%/);
});

test("a line splits VAT out of the total, and never adds it on", () => {
  const none = invoiceLineFromTotal("Install", 480_000, "outside-scope");
  assert.deepEqual([none.netPence, none.taxPence, none.totalPence], [480_000, 0, 480_000]);
  const std = invoiceLineFromTotal("Service", 12_000, "standard-20");
  assert.deepEqual([std.netPence, std.taxPence, std.totalPence], [10_000, 2_000, 12_000]);
  const reduced = invoiceLineFromTotal("Install", 105_000, "reduced-5");
  assert.equal(reduced.netPence + reduced.taxPence, 105_000);
  assert.equal(reduced.taxPence, 5_000);
  const odd = invoiceLineFromTotal("Odd", 1_001, "standard-20");
  assert.equal(odd.netPence + odd.taxPence, 1_001, "net + tax is exactly the total");
  assert.throws(() => invoiceLineFromTotal("x", 10.5, "standard-20"));
});

test("the balance invoice: contract plus variations and fees, less everything invoiced", () => {
  const lines = buildBalanceInvoiceLines({
    contractTotalPence: 480_000,
    acceptedVariationsPence: 25_000,
    changeFeesPence: 5_000,
    alreadyInvoicedPence: 96_000,
    taxCode: "outside-scope",
  });
  assert.deepEqual(
    lines.map((l) => [l.label, l.totalPence]),
    [
      ["Contract price, as accepted", 480_000],
      ["Accepted variations", 25_000],
      ["Date change fees", 5_000],
      ["Less: already invoiced", -96_000],
    ],
  );
  assert.equal(invoiceTotals(lines).totalPence, 414_000);
});

test("balance lines leave out zero parts, carry credits, and tax each line by the code", () => {
  const lines = buildBalanceInvoiceLines({
    contractTotalPence: 120_000,
    acceptedVariationsPence: 0,
    changeFeesPence: 0,
    alreadyInvoicedPence: 0,
    taxCode: "standard-20",
    credits: [{ label: "Survey fee already paid", pence: 15_000 }],
  });
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((l) => l.totalPence), [120_000, -15_000]);
  assert.deepEqual(lines.map((l) => l.taxPence), [20_000, -2_500]);
  assert.ok(lines.every((l: InvoiceLine) => l.taxCode === "standard-20"));
});

test("nothing left to bill gives no lines", () => {
  assert.deepEqual(
    buildBalanceInvoiceLines({ contractTotalPence: 100_000, acceptedVariationsPence: 0, changeFeesPence: 0, alreadyInvoicedPence: 100_000, taxCode: "outside-scope" }),
    [],
  );
});

test("payments move an invoice through part-paid to paid, and refunds back", () => {
  const inv = invoice({ totalPence: 100_000 });
  const part = applyPayment(inv, 40_000);
  assert.equal(part.status, "part-paid");
  assert.equal(part.paidPence, 40_000);
  const paid = applyPayment(part, 60_000);
  assert.equal(paid.status, "paid");
  const refunded = applyPayment(paid, -10_000);
  assert.equal(refunded.status, "part-paid");
  assert.equal(inv.paidPence, 0, "pure: the input isn't changed");
  assert.equal(applyPayment(invoice({ totalPence: 100_000, status: "void" }), 100_000).status, "void", "void stays void, money still counted");
  assert.throws(() => applyPayment(inv, 0.5));
});

test("settling from the payment list can't count a payment twice", () => {
  const inv = invoice({ id: "inv-9", totalPence: 50_000, paidPence: 50_000, status: "paid" });
  const payments: Pick<Payment, "invoiceId" | "amountPence" | "status">[] = [
    { invoiceId: "inv-9", amountPence: 50_000, status: "succeeded" },
    { invoiceId: "inv-9", amountPence: 9_999, status: "failed" },
    { invoiceId: "other", amountPence: 1_000, status: "succeeded" },
  ];
  const settled = settleInvoice(inv, payments);
  assert.equal(settled.paidPence, 50_000);
  assert.equal(settled.status, "paid");
  assert.equal(settleInvoice(settled, payments).paidPence, 50_000, "idempotent");
});

test("outstanding: issued totals less paid, credit notes and void ignored properly", () => {
  const invoices = [
    invoice({ id: "a", totalPence: 96_000, paidPence: 96_000, status: "paid", kind: "deposit" }),
    invoice({ id: "b", totalPence: 384_000, paidPence: 0 }),
    invoice({ id: "c", totalPence: 50_000, status: "void" }),
    invoice({ id: "d", totalPence: 70_000, status: "draft" }),
    invoice({ id: "e", totalPence: -20_000, kind: "credit-note", creditsInvoiceId: "b" }),
  ];
  assert.equal(outstandingPence(invoices), 364_000);
  assert.equal(invoiceOutstanding(invoices[1]!, invoices), 364_000, "the credit note is set against invoice b");
  assert.equal(invoiceOutstanding(invoices[0]!, invoices), 0);
  assert.equal(invoiceOutstanding(invoices[4]!, invoices), 0, "a credit note owes nothing");
  assert.equal(outstandingPence([invoice({ totalPence: 10_000, paidPence: 12_000, status: "paid" })]), -2_000, "in credit");
});

test("credit notes are negative whatever sign they're given", () => {
  assert.equal(creditNoteLines("Goodwill", 5_000, "outside-scope")[0]?.totalPence, -5_000);
  assert.equal(creditNoteLines("Goodwill", -5_000, "outside-scope")[0]?.totalPence, -5_000);
  assert.deepEqual(creditNoteLines("Nothing", 0, "outside-scope"), []);
});

test("money summary: invoiced, received, refunded, outstanding and still to invoice", () => {
  const invoices = [
    invoice({ id: "a", kind: "deposit", totalPence: 96_000, paidPence: 96_000, status: "paid" }),
    invoice({ id: "v", kind: "variation", totalPence: 25_000 }),
  ];
  const payments = [
    { amountPence: 96_000, status: "succeeded" as const },
    { amountPence: -1_000, status: "refunded" as const },
    { amountPence: 5_000, status: "failed" as const },
  ];
  const s = moneySummary(invoices, payments, 480_000);
  assert.equal(s.invoicedPence, 121_000);
  assert.equal(s.receivedPence, 96_000);
  assert.equal(s.refundedPence, 1_000);
  assert.equal(s.outstandingPence, 25_000);
  assert.equal(s.toInvoicePence, 384_000, "variations don't count against the contract");
  assert.equal(moneySummary([], [], undefined).toInvoicePence, null);
});

test("due dates: deposits on issue, others after the payment terms; overdue only when owed", () => {
  assert.equal(invoiceDueOn("2026-10-18", "deposit", DEFAULT_SETTINGS), "2026-10-18");
  assert.equal(invoiceDueOn("2026-10-18T09:00:00Z", "balance", DEFAULT_SETTINGS), "2026-10-25");
  assert.equal(invoiceDueOn("2026-10-18", "credit-note", DEFAULT_SETTINGS), undefined);
  const due = invoice({ totalPence: 1_000, dueOn: "2026-10-20" });
  assert.equal(isInvoiceOverdue(due, [due], "2026-10-21"), true);
  assert.equal(isInvoiceOverdue(due, [due], "2026-10-20"), false);
  const paid = { ...due, paidPence: 1_000, status: "paid" as const };
  assert.equal(isInvoiceOverdue(paid, [paid], "2026-11-01"), false);
});

test("variationsBillableAlone: a balance invoice covers what was accepted before it; later ones bill alone", () => {
  const v1 = { id: "v1", variation: { decidedAt: "2026-10-20T10:00:00.000Z" } };
  const v2 = { id: "v2", variation: { decidedAt: "2026-10-28T10:00:00.000Z" } };
  const v3 = { id: "v3", variation: { decidedAt: "2026-10-21T10:00:00.000Z" } };
  assert.deepEqual(variationsBillableAlone([v1, v2], []).map((v) => v.id), ["v1", "v2"], "nothing invoiced yet: both can go alone");
  const balance = { kind: "balance" as const, status: "issued" as const, issuedAt: "2026-10-25T09:00:00.000Z" };
  assert.deepEqual(variationsBillableAlone([v1, v2], [balance]).map((v) => v.id), ["v2"], "v1 is on the balance; v2 came after it");
  const own = { kind: "variation" as const, status: "issued" as const, issueId: "v3", issuedAt: "2026-10-22T09:00:00.000Z" };
  assert.deepEqual(variationsBillableAlone([v3], [own]).map((v) => v.id), [], "already billed on its own");
  const voided = { ...balance, status: "void" as const };
  assert.deepEqual(variationsBillableAlone([v1], [voided]).map((v) => v.id), ["v1"], "a void balance covers nothing");
});

/* Credit notes: correcting vs money off; credit on the account. */

// DEMO 3's numbers: a £7,641.50 contract with a £1,528.30 deposit, paid.
const CONTRACT = 764_150;
const deposit = () => invoice({ id: "dep", number: "DIH-0003", kind: "deposit", totalPence: 152_830, paidPence: 152_830, status: "paid", issuedAt: "2026-10-01T09:00:00.000Z" });
const credit = (over: Partial<Invoice> & { totalPence: number }) =>
  invoice({ id: "cn", number: "DIH-0004", kind: "credit-note", issuedAt: "2026-10-05T09:00:00.000Z", ...over });
const toBill = (invoices: Invoice[]) =>
  stillToBillPence({ contractTotalPence: CONTRACT, acceptedVariationsPence: 0, changeFeesPence: 0, surveyFeePaidPence: 0, invoices });

test("a goodwill credit is never billed back by the balance", () => {
  assert.equal(toBill([deposit()]), 611_320);
  const goodwill = credit({ totalPence: -20_000, reason: "Goodwill" });
  assert.equal(creditPurposeOf(goodwill), "reduction", "older untied credit notes are money off");
  assert.equal(toBill([deposit(), goodwill]), 611_320, "the balance still bills the price, not the price plus the credit");
  const lines = balanceLinesFor({ contractTotalPence: CONTRACT, acceptedVariationsPence: 0, changeFeesPence: 0, surveyFeePaidPence: 0, invoices: [deposit(), goodwill], taxCode: "outside-scope" });
  assert.deepEqual(lines.map((l) => [l.label, l.totalPence]), [["Contract price, as accepted", CONTRACT], ["Less: already invoiced", -152_830]]);
  assert.equal(moneySummary([deposit(), goodwill], [], CONTRACT).toInvoicePence, 611_320, "still to invoice doesn't grow either");
  // Once the balance is out, a later goodwill credit doesn't reopen it.
  const balance = invoice({ id: "bal", number: "DIH-0005", kind: "balance", totalPence: 611_320, issuedAt: "2026-10-10T09:00:00.000Z" });
  assert.equal(toBill([deposit(), balance, credit({ totalPence: -20_000, issuedAt: "2026-10-12T09:00:00.000Z" })]), 0);
  assert.equal(toBill([deposit(), balance, credit({ totalPence: -20_000, creditsInvoiceId: "bal", creditPurpose: "reduction" })]), 0);
  // ...and the credit is used against what's left: the customer pays the balance less the goodwill.
  const all = [deposit(), balance, goodwill];
  assert.equal(invoiceOutstanding(balance, all), 591_320);
  assert.equal(outstandingPence(all), 591_320);
});

test("a correcting credit note is billed again, at the right figure", () => {
  const wrong = credit({ totalPence: -152_830, creditsInvoiceId: "dep", reason: "Deposit raised in error" });
  assert.equal(creditPurposeOf(wrong), "correction", "older credit notes against an invoice correct it");
  const unpaidDeposit = { ...deposit(), paidPence: 0, status: "issued" as const };
  assert.equal(toBill([unpaidDeposit, wrong]), CONTRACT, "the cancelled deposit goes back on the balance");
  assert.equal(moneySummary([unpaidDeposit, wrong], [], CONTRACT).toInvoicePence, CONTRACT);
  assert.equal(creditPurposeOf(credit({ totalPence: -100, creditPurpose: "correction" })), "correction", "an untied one can be marked as a correction");
  assert.equal(creditPurposeOf(deposit()), null);
});

test("credit on the account is used against invoices, so a refund never reopens one", () => {
  // Paid in full, then a £200 goodwill credit: the customer is in credit, nothing is owed anywhere.
  const goodwill = credit({ totalPence: -20_000 });
  let all = [deposit(), goodwill];
  assert.equal(accountCreditPence(all), 20_000);
  assert.equal(outstandingPence(all), -20_000);
  assert.equal(invoiceOutstanding(all[0]!, all), 0);
  assert.equal(refundableCreditPence(goodwill, all), 20_000, "the credit can be refunded");
  // Refunded against the deposit (the old way): the credit covers it, so the deposit isn't owed again.
  const refundedOnDeposit = { ...deposit(), paidPence: 132_830, status: "part-paid" as const };
  all = [refundedOnDeposit, goodwill];
  assert.equal(outstandingPence(all), 0);
  assert.equal(invoiceOutstanding(refundedOnDeposit, all), 0, "not asked for again");
  assert.equal(isInvoiceOverdue(refundedOnDeposit, all, "2026-12-01"), false);
  assert.equal(refundableCreditPence(goodwill, all), 0, "nothing left to refund: it's covering the deposit");
  // Refunded from the credit note itself: the credit's gone and so is the overpayment.
  const refundedCredit = { ...goodwill, paidPence: -20_000, status: "paid" as const };
  all = [deposit(), refundedCredit];
  assert.equal(accountCreditPence(all), 0);
  assert.equal(outstandingPence(all), 0);
  assert.equal(invoiceOutstanding(all[0]!, all), 0);
  assert.equal(refundableCreditPence(refundedCredit, all), 0);
});

test("account credit is used oldest invoice first, and per-invoice figures add up to what's owed", () => {
  const a = invoice({ id: "a", number: "DIH-0001", kind: "deposit", totalPence: 10_000, issuedAt: "2026-10-01T09:00:00.000Z" });
  const b = invoice({ id: "b", number: "DIH-0002", kind: "balance", totalPence: 40_000, issuedAt: "2026-10-10T09:00:00.000Z" });
  const c = credit({ totalPence: -15_000 });
  const all = [b, c, a];
  assert.equal(invoiceOutstanding(a, all), 0);
  assert.equal(invoiceOutstanding(b, all), 35_000);
  assert.equal(invoiceOutstanding(a, all) + invoiceOutstanding(b, all), outstandingPence(all));
  assert.deepEqual([accountCreditUsedOn(a, all), accountCreditUsedOn(b, all), accountCreditUsedOn(c, all)], [10_000, 5_000, 0]);
  // A credit note against an invoice that's since been voided is account credit too.
  const orphan = credit({ id: "cn2", totalPence: -5_000, creditsInvoiceId: "gone" });
  assert.equal(accountCreditPence([a, orphan]), 5_000);
  assert.equal(invoiceOutstanding(a, [a, orphan]), 5_000);
  // An overpayment on one invoice counts towards the next.
  const over = { ...a, paidPence: 12_000, status: "paid" as const };
  assert.equal(invoiceOutstanding(b, [over, b]), 38_000);
  // The credit notes an invoice's "Less: credit on your account" line names: on the account, with credit left.
  const against = credit({ id: "cn3", number: "DIH-0005", totalPence: -2_000, creditsInvoiceId: "b" });
  const spent = credit({ id: "cn4", number: "DIH-0006", totalPence: -3_000, paidPence: -3_000, status: "paid" });
  assert.deepEqual(accountCreditNotes([a, b, c, orphan, against, spent]).map((i) => i.id), [c.id, "cn2"]);
});

test("owedInvoices: what's still due across projects, net of credit notes and account credit", () => {
  const all = [
    // Project 1: a balance fully credited ("cancel what's unpaid") owes nothing.
    invoice({ id: "a", projectId: "p-1", number: "DIH-0001", totalPence: 631_320 }),
    invoice({ id: "a-cn", projectId: "p-1", number: "DIH-0002", kind: "credit-note", totalPence: -631_320, creditsInvoiceId: "a" }),
    // Project 2: part-paid, and a goodwill credit on the account comes off it.
    invoice({ id: "b", projectId: "p-2", number: "DIH-0003", totalPence: 100_000, paidPence: 40_000, status: "part-paid", dueOn: "2026-11-01" }),
    invoice({ id: "b-cn", projectId: "p-2", number: "DIH-0004", kind: "credit-note", totalPence: -10_000 }),
    // Project 3: a credit on another project never nets off this one.
    invoice({ id: "c", projectId: "p-3", number: "DIH-0005", totalPence: 25_000 }),
    invoice({ id: "d", projectId: "p-3", number: "DIH-0006", totalPence: 9_000, status: "void" }),
  ];
  const owed = owedInvoices(all);
  assert.deepEqual(
    owed.map((o) => [o.invoice.id, o.duePence]),
    [
      ["b", 50_000],
      ["c", 25_000],
    ],
  );
  // Matches what each project's money page says (outstandingPence, never below zero).
  assert.equal(owed.filter((o) => o.invoice.projectId === "p-2").reduce((n, o) => n + o.duePence, 0), outstandingPence(all.filter((i) => i.projectId === "p-2")));
});
