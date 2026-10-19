import { test } from "node:test";
import assert from "node:assert/strict";
import { invoiceOutstanding, outstandingPence, type StaffMember } from "@aircon/domain";
import { registerAppResolver } from "./helpers/resolve-app.ts";

// Credit notes and refunds on the real money module, in-memory backend, on DEMO 3
// (an accepted contract with its deposit paid).
process.env.DATA_BACKEND = "memory";
delete process.env.SUPABASE_URL;
registerAppResolver();
const { resetDemoData } = await import("../lib/demo-seed/index.ts");
const { issueInvoice, loadMoney, payableInvoices, recordRefund } = await import("../lib/money-server.ts");
const { loadReadinessContext } = await import("../lib/project-service.ts");
const invoicesRepo = await import("../lib/repo/invoices.ts");

const OFFICE: StaffMember = { id: "aa000000-0000-4000-8000-0000000000c1", email: "office@demo.dang.invalid", name: "DEMO Office", roles: ["admin"], external: false, active: true, qualifications: [] };
const today = () => new Date().toISOString().slice(0, 10);
const rid = () => crypto.randomUUID();

async function demo3(): Promise<string> {
  const summary = await resetDemoData({ now: new Date().toISOString() });
  return summary.projects.find((p) => p.label.startsWith("DEMO 3"))!.id;
}

test("a goodwill credit stays off the price: the balance doesn't bill it back, and it can be refunded", async () => {
  const id = await demo3();
  const before = (await loadMoney(id))!;
  const balance = before.plans.balance.totalPence;
  assert.ok(balance > 0, "DEMO 3 has a balance to bill");
  assert.equal((await loadReadinessContext(id))!.money?.unbilledPence, balance, "the closed gate sees what's unbilled");

  const goodwill = await issueInvoice(id, { kind: "credit-note", amountPence: 20_000, reason: "Goodwill (DEMO)", requestId: rid() }, OFFICE);
  assert.ok(goodwill.ok);
  assert.equal(goodwill.value.creditPurpose, "reduction", "on its own, a credit is money off the price");
  const after = (await loadMoney(id))!;
  assert.equal(after.plans.balance.totalPence, balance, "not billed back");
  assert.equal(after.summary.toInvoicePence, before.summary.toInvoicePence, "still to invoice doesn't grow");
  assert.equal((await loadReadinessContext(id))!.money?.unbilledPence, balance);

  // A typo can't credit more than the price.
  const typo = await issueInvoice(id, { kind: "credit-note", amountPence: 2_000_000, reason: "Goodwill (DEMO)", requestId: rid() }, OFFICE);
  assert.ok(!typo.ok && /at most/.test(typo.error), !typo.ok ? typo.error : "");

  // Deposit paid in full, so the customer is £200 in credit: refund it from the credit note.
  assert.equal(outstandingPence(after.invoices), -20_000);
  const tooMuch = await recordRefund(id, { invoiceId: goodwill.value.id, amountPence: 20_001, method: "bank-transfer", refundedOn: today(), reason: "Goodwill paid out", requestId: rid() }, OFFICE);
  assert.equal(tooMuch.ok, false);
  const refund = await recordRefund(id, { invoiceId: goodwill.value.id, amountPence: 20_000, method: "bank-transfer", refundedOn: today(), reason: "Goodwill paid out", requestId: rid() }, OFFICE);
  assert.ok(refund.ok, !refund.ok ? refund.error : "");
  const settled = await invoicesRepo.listForProject(id);
  assert.equal(outstandingPence(settled), 0);
  assert.deepEqual(payableInvoices(settled), [], "nothing is asked of the customer");
});

test("refunding a paid deposit issues a credit note with it, so it's never asked for again (unless it's still owed)", async () => {
  const id = await demo3();
  const deposit = (await invoicesRepo.listForProject(id)).find((i) => i.kind === "deposit" && i.paidPence > 0)!;
  assert.ok(deposit, "DEMO 3's deposit is paid");

  const keep = await recordRefund(id, { invoiceId: deposit.id, amountPence: 10_000, method: "bank-transfer", refundedOn: today(), reason: "Scuffed skirting (DEMO)", requestId: rid() }, OFFICE);
  assert.ok(keep.ok, !keep.ok ? keep.error : "");
  assert.ok(keep.value.creditNote, "a credit note goes with the refund");
  assert.equal(keep.value.creditNote!.creditsInvoiceId, deposit.id);
  assert.equal(keep.value.creditNote!.totalPence, -10_000);
  assert.equal(keep.value.creditNote!.creditPurpose, "reduction");
  let all = await invoicesRepo.listForProject(id);
  assert.equal(invoiceOutstanding(all.find((i) => i.id === deposit.id)!, all), 0, "the deposit isn't owed again");
  assert.ok(!payableInvoices(all).some((i) => i.id === deposit.id), "nor on the customer's pay page");

  // "They still owe it": no credit note, the deposit is open again.
  const owed = await recordRefund(id, { invoiceId: deposit.id, amountPence: 5_000, method: "card", refundedOn: today(), reason: "Card payment reversed (DEMO)", requestId: rid(), treatment: "owed" }, OFFICE);
  assert.ok(owed.ok && !owed.value.creditNote);
  all = await invoicesRepo.listForProject(id);
  assert.equal(invoiceOutstanding(all.find((i) => i.id === deposit.id)!, all), 5_000);
});
