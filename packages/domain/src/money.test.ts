import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyPayment,
  buildBalanceInvoiceLines,
  creditNoteLines,
  depositInvoiceLines,
  depositPence,
  invoiceDueOn,
  invoiceLineFromTotal,
  invoiceNumber,
  invoiceOutstanding,
  invoiceTotals,
  isInvoiceOverdue,
  moneySummary,
  outstandingPence,
  settleInvoice,
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
