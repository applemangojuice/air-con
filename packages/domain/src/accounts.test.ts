import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accountsCell,
  accountsInvoicesCsv,
  accountsPaymentsCsv,
  accountsRangeProblem,
  accountsSummary,
  accountsSummaryCsv,
  londonDayOf,
  poundsCell,
  type AccountsInput,
} from "./accounts.ts";
import { invoiceLineFromTotal, type Invoice, type Payment } from "./money.ts";

/** DEMO books: two projects, one live and one cancelled after an early start with a charge. */
const LIVE = "11111111-0000-4000-8000-000000000001";
const GONE = "22222222-0000-4000-8000-000000000002";

function invoice(over: Partial<Invoice> & Pick<Invoice, "id" | "projectId" | "number" | "kind">, total: number, issuedAt: string): Invoice {
  const line = invoiceLineFromTotal(over.kind === "credit-note" ? "DEMO credit" : `DEMO ${over.kind}`, total, "standard-20");
  return {
    status: "issued",
    lines: [line],
    netPence: line.netPence,
    taxPence: line.taxPence,
    totalPence: line.totalPence,
    paidPence: 0,
    issuedAt,
    ...over,
  };
}
function payment(over: Partial<Payment> & Pick<Payment, "id" | "projectId" | "amountPence" | "receivedAt">): Payment {
  return { method: "bank-transfer", provider: "manual", providerRef: `manual:${over.id}`, status: over.amountPence < 0 ? "refunded" : "succeeded", ...over };
}

const books = (over: Partial<AccountsInput> = {}): AccountsInput => {
  // Live: a deposit issued 23:30 UTC on 30 Sep (00:30 London, 1 Oct) and paid by card; a balance in October, part-paid.
  const dep = invoice({ id: "inv-1", projectId: LIVE, number: "DIH-0001", kind: "deposit", paidPence: 180_000, status: "paid", dueOn: "2026-10-01" }, 180_000, "2026-09-30T23:30:00.000Z");
  const bal = invoice({ id: "inv-2", projectId: LIVE, number: "DIH-0002", kind: "balance", paidPence: 100_000, status: "part-paid", dueOn: "2026-11-05" }, 420_000, "2026-10-22T10:00:00.000Z");
  // A goodwill credit against the balance, with a reason someone typed as a formula.
  const good = invoice({ id: "inv-3", projectId: LIVE, number: "DIH-0003", kind: "credit-note", creditsInvoiceId: "inv-2", creditPurpose: "reduction", reason: "=HYPERLINK(\"http://x\")" }, -12_000, "2026-10-23T10:00:00.000Z");
  // Cancelled: deposit paid, then cancelled after an early start; the deposit credited, a charge for the work done, the rest refunded.
  const gDep = invoice({ id: "inv-4", projectId: GONE, number: "DIH-0004", kind: "deposit", paidPence: 60_000, status: "paid" }, 150_000, "2026-10-02T10:00:00.000Z");
  const gCredit = invoice({ id: "inv-5", projectId: GONE, number: "DIH-0005", kind: "credit-note", creditsInvoiceId: "inv-4", creditPurpose: "reduction", reason: "The contract was cancelled" }, -150_000, "2026-10-20T10:00:00.000Z");
  const gCharge = invoice({ id: "inv-6", projectId: GONE, number: "DIH-0006", kind: "cancellation-charge", reason: "Day 1 of 3: a third of the labour" }, 50_000, "2026-10-20T10:05:00.000Z");
  // A balance that was voided at the cancellation (after the period), and a draft that never counts.
  const gVoid = invoice({ id: "inv-7", projectId: GONE, number: "DIH-0007", kind: "survey-fee", status: "void", voidedAt: "2026-10-20T09:00:00.000Z" }, 9_000, "2026-10-10T10:00:00.000Z");
  const draft = invoice({ id: "inv-8", projectId: LIVE, number: "DIH-0008", kind: "variation", status: "draft" }, 5_000, "2026-10-24T10:00:00.000Z");
  return {
    from: "2026-10-01",
    to: "2026-10-31",
    vatRegistered: true,
    invoices: [dep, bal, good, gDep, gCredit, gCharge, gVoid, draft],
    payments: [
      payment({ id: "pay-1", projectId: LIVE, invoiceId: "inv-1", amountPence: 180_000, receivedAt: "2026-09-30T23:45:00.000Z", method: "card", provider: "stripe", providerRef: "pi_DEMO1", reference: "pi_DEMO1" }),
      payment({ id: "pay-2", projectId: LIVE, invoiceId: "inv-2", amountPence: 100_000, receivedAt: "2026-10-25T12:00:00.000Z", reference: "=cmd|' /C calc'!A0" }),
      payment({ id: "pay-3", projectId: GONE, invoiceId: "inv-4", amountPence: 60_000, receivedAt: "2026-10-02T12:00:00.000Z" }),
      payment({ id: "pay-4", projectId: GONE, invoiceId: "inv-4", amountPence: -10_000, receivedAt: "2026-10-28T12:00:00.000Z", note: "The rest after the charge" }),
      // In November: outside the range, but it changes nothing about 31 October.
      payment({ id: "pay-5", projectId: LIVE, invoiceId: "inv-2", amountPence: 50_000, receivedAt: "2026-11-02T12:00:00.000Z" }),
      // A DEMO card payment and a refund that failed: listed, never counted.
      payment({ id: "pay-6", projectId: LIVE, invoiceId: "inv-2", amountPence: 7_00, receivedAt: "2026-10-26T12:00:00.000Z", provider: "demo", method: "card" }),
      payment({ id: "pay-7", projectId: GONE, invoiceId: "inv-4", amountPence: -5_000, receivedAt: "2026-10-27T12:00:00.000Z", status: "failed", method: "card", provider: "stripe", providerRef: "re_DEMOFAIL" }),
    ],
    projects: [
      { id: LIVE, ref: "Pilot 1", customerRef: "C-AAAA0001", customerName: "DEMO Alex Live", cancelled: false },
      { id: GONE, ref: "Pilot 2", customerRef: "C-BBBB0002", customerName: "@DEMO Sam, Gone", cancelled: true },
    ],
    ...over,
  };
};

/** A CSV (RFC 4180, as written here) back into rows of cells. */
function parse(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i]!;
    if (quoted) {
      if (c === '"' && csv[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\r" && csv[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += c;
  }
  return rows;
}
const table = (csv: string) => {
  const [head, ...rows] = parse(csv);
  return rows.map((r) => Object.fromEntries(head!.map((h, i) => [h, r[i] ?? ""])));
};

test("ranges: London dates, both ends included, at most three years", () => {
  assert.equal(accountsRangeProblem("2026-10-01", "2026-10-31"), null);
  assert.equal(accountsRangeProblem("2026-10-01", "2026-10-01"), null);
  assert.match(accountsRangeProblem("2026-10-31", "2026-10-01")!, /after the end/);
  assert.match(accountsRangeProblem("2026-02-30", "2026-03-01")!, /Pick/);
  assert.match(accountsRangeProblem("", "2026-03-01")!, /Pick/);
  assert.match(accountsRangeProblem("2020-01-01", "2026-03-01")!, /three years/);
  assert.equal(londonDayOf("2026-09-30T23:30:00.000Z"), "2026-10-01", "BST: half past midnight in London");
  assert.equal(londonDayOf("2026-12-31T23:30:00.000Z"), "2026-12-31", "GMT");
  assert.equal(londonDayOf("2026-10-05"), "2026-10-05");
});

test("cells: pounds to two decimals stay numbers; text that a spreadsheet would run is defused", () => {
  assert.equal(poundsCell(123_456), "1234.56");
  assert.equal(poundsCell(-1_200), "-12.00");
  assert.equal(poundsCell(5), "0.05");
  assert.equal(accountsCell(poundsCell(-1_200)), "-12.00", "a negative amount isn't a formula");
  for (const bad of ["=1+1", "+44 20", "-2+3", "@SUM(A1)", "\tx", "\rx"]) assert.equal(accountsCell(bad).replace(/^"/, "")[0], "'", JSON.stringify(bad));
  assert.equal(accountsCell('a "quoted", word'), '"a ""quoted"", word"');
  assert.equal(accountsCell("plain"), "plain");
});

test("invoices file: every invoice and credit note issued in the range, with London dates, VAT and what was owed at the end", () => {
  const rows = table(accountsInvoicesCsv(books()));
  assert.deepEqual(
    rows.map((r) => r.number),
    ["DIH-0001", "DIH-0004", "DIH-0007", "DIH-0005", "DIH-0006", "DIH-0002", "DIH-0003"],
    "issued in October (the deposit at 00:30 London on the 1st), oldest first; no draft",
  );
  const dep = rows.find((r) => r.number === "DIH-0001")!;
  assert.deepEqual(
    { type: dep.type, on: dep.issued_on, net: dep.net_gbp, vat: dep.vat_gbp, total: dep.total_gbp, code: dep.tax_code, rate: dep.vat_rate_pct, ref: dep.project_ref, cust: dep.customer_ref, rev: dep.revenue_net_gbp },
    { type: "Invoice", on: "2026-10-01", net: "1500.00", vat: "300.00", total: "1800.00", code: "standard-20", rate: "20", ref: "Pilot 1", cust: "C-AAAA0001", rev: "1500.00" },
  );
  const bal = rows.find((r) => r.number === "DIH-0002")!;
  assert.equal(bal.paid_by_end_gbp, "1000.00", "the November payment isn't counted at 31 October, nor the DEMO one");
  assert.equal(bal.owed_at_end_gbp, "3080.00", "4,200 less 1,000 paid less the 120 credit");
  const good = rows.find((r) => r.number === "DIH-0003")!;
  assert.deepEqual({ type: good.type, total: good.total_gbp, credits: good.credits_invoice, purpose: good.credit_purpose }, { type: "Credit note", total: "-120.00", credits: "DIH-0002", purpose: "reduction" });
  assert.equal(good.description, "'=HYPERLINK(\"http://x\")", "a typed formula is defused");

  // The cancelled contract earns nothing, except the charge for the work done.
  const gone = rows.filter((r) => r.project_ref === "Pilot 2");
  assert.ok(gone.every((r) => r.cancelled_contract === "yes"));
  assert.deepEqual(Object.fromEntries(gone.map((r) => [r.number, r.revenue_net_gbp])), { "DIH-0004": "0.00", "DIH-0005": "0.00", "DIH-0006": "416.67", "DIH-0007": "0.00" });
  assert.equal(rows.find((r) => r.number === "DIH-0006")!.kind, "Work done before cancelling");
  assert.equal(rows.find((r) => r.number === "DIH-0006")!.description, "Day 1 of 3: a third of the labour");
  assert.equal(rows.find((r) => r.number === "DIH-0007")!.status, "void");
  assert.equal(rows.find((r) => r.number === "DIH-0004")!.customer_name, "'@DEMO Sam, Gone", "a name starting @ is defused, and quoted for its comma");
});

test("not VAT registered: the totals only, no net or VAT columns filled", () => {
  const rows = table(accountsInvoicesCsv(books({ vatRegistered: false })));
  const dep = rows.find((r) => r.number === "DIH-0001")!;
  assert.deepEqual({ net: dep.net_gbp, vat: dep.vat_gbp, rate: dep.vat_rate_pct, total: dep.total_gbp }, { net: "", vat: "", rate: "", total: "1800.00" });
});

test("payments file: card and bank transfer, refunds negative, provider references, DEMO and failed ones listed but not counted", () => {
  const rows = table(accountsPaymentsCsv(books()));
  assert.deepEqual(rows.map((r) => r.payment_id), ["pay-1", "pay-3", "pay-2", "pay-6", "pay-7", "pay-4"], "dated in October, in time order");
  const card = rows.find((r) => r.payment_id === "pay-1")!;
  assert.deepEqual(
    { type: card.type, date: card.date, method: card.method, provider: card.provider, ref: card.provider_ref, inv: card.invoice_number, amount: card.amount_gbp, counted: card.counted },
    { type: "Payment", date: "2026-10-01", method: "Card", provider: "Stripe", ref: "pi_DEMO1", inv: "DIH-0001", amount: "1800.00", counted: "yes" },
  );
  const refund = rows.find((r) => r.payment_id === "pay-4")!;
  assert.deepEqual({ type: refund.type, amount: refund.amount_gbp, status: refund.status, method: refund.method }, { type: "Refund", amount: "-100.00", status: "refunded", method: "Bank transfer" });
  assert.equal(rows.find((r) => r.payment_id === "pay-2")!.customer_reference, "'=cmd|' /C calc'!A0");
  assert.equal(rows.find((r) => r.payment_id === "pay-6")!.counted, "no", "DEMO");
  assert.equal(rows.find((r) => r.payment_id === "pay-7")!.counted, "no", "failed");
});

test("summary: invoiced, credited, revenue, received, refunded and owed at the end date reconcile with the two files", () => {
  const s = accountsSummary(books());
  const line = (start: string) => s.find((r) => r.line.startsWith(start))!;
  assert.deepEqual({ n: line("Invoices issued").count, t: line("Invoices issued").totalPence }, { n: 4, t: 180_000 + 150_000 + 50_000 + 420_000 }, "void and draft left out");
  assert.equal(line("Credit notes issued").totalPence, -162_000);
  assert.equal(line("Net invoiced").totalPence, 638_000);
  // Revenue: the live project's invoices less its credit, and only the cancelled one's charge.
  assert.equal(line("Revenue").netPence, 150_000 + 350_000 - 10_000 + 41_667);
  assert.equal(line("Received by card").totalPence, 180_000);
  assert.equal(line("Received by bank transfer").totalPence, 160_000);
  assert.equal(line("Received in total").totalPence, 340_000);
  assert.equal(line("Refunded in total").totalPence, -10_000);
  assert.equal(line("Net received").totalPence, 330_000);
  // At 31 October: the live project owes 3,080 on its balance; the cancelled one is in credit 600 − 100 refunded − 500 charge = 0.
  assert.equal(line("Owed to us at the end of 2026-10-31").totalPence, 308_000);
  assert.equal(line("Customers in credit at the end of 2026-10-31").totalPence, 0);
  assert.deepEqual({ n: line("Listed but not counted").count, t: line("Listed but not counted").totalPence }, { n: 2, t: 700 - 5_000 });

  // The files agree with it to the penny.
  const pays = table(accountsPaymentsCsv(books())).filter((r) => r.counted === "yes");
  const pence = (v: string) => Math.round(Number(v) * 100);
  assert.equal(pays.reduce((t, r) => t + pence(r.amount_gbp!), 0), line("Net received").totalPence);
  const invs = table(accountsInvoicesCsv(books())).filter((r) => r.status !== "void");
  assert.equal(invs.reduce((t, r) => t + pence(r.total_gbp!), 0), line("Net invoiced").totalPence);
  assert.equal(invs.reduce((t, r) => t + pence(r.revenue_net_gbp!), 0), line("Revenue").netPence);
  assert.equal(invs.reduce((t, r) => t + pence(r.owed_at_end_gbp!), 0), line("Owed to us").totalPence);

  // At the end of the 20th, before the refund: the cancelled customer was in credit.
  const earlier = accountsSummary(books({ to: "2026-10-20" }));
  assert.equal(earlier.find((r) => r.line.startsWith("Customers in credit"))!.totalPence, 10_000);
  // At the end of the 15th the void survey fee was still live (voided on the 20th): owed then.
  const before = accountsSummary(books({ to: "2026-10-15" }));
  assert.equal(before.find((r) => r.line.startsWith("Owed to us"))!.totalPence, 90_000 + 9_000, "the cancelled deposit's unpaid 900 and the survey fee");
  const csv = table(accountsSummaryCsv(books()));
  assert.equal(csv.find((r) => r.line!.startsWith("Owed to us"))!.total_gbp, "3080.00");
});
