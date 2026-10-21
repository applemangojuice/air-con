import { test } from "node:test";
import assert from "node:assert/strict";
import { createIssue, invoiceOutstanding, outstandingPence, type StaffMember } from "@aircon/domain";
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
const issuesRepo = await import("../lib/repo/issues.ts");
const { loadProject } = await import("../lib/project-service.ts");
const { decideVariation } = await import("../lib/portal-server.ts");
const { sendVariation } = await import("../lib/variation-server.ts");

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

/** A variation that takes £40.50 off, checked by the office and accepted by the customer on their page. */
async function acceptReduction(id: string): Promise<string> {
  const project = (await loadProject(id))!;
  const draft = await issuesRepo.insert(
    createIssue({
      id: crypto.randomUUID(),
      projectId: id,
      number: await issuesRepo.nextNumber(id),
      kind: "variation",
      title: "DEMO: no trunking needed",
      raisedBy: { kind: "staff", name: "DEMO Tech" },
      raisedAt: new Date().toISOString(),
      variation: { description: "DEMO: no trunking needed", priceDeltaNetPence: -4_050, taxCode: "outside-scope", officeReview: true },
    }),
  );
  const sent = await sendVariation(id, draft.id, { description: "DEMO: no trunking needed", priceDeltaNetPence: -4_050, unitsUnchanged: true }, OFFICE);
  assert.ok(sent.ok, !sent.ok ? sent.error : "");
  const accepted = await decideVariation(id, { customerId: project.customer.customerId! }, draft.id, "accept", { name: "Jordan Okafor", agreed: true });
  assert.ok(accepted.ok, JSON.stringify(accepted));
  return draft.id;
}

/** Everything the customer is asked to pay, plus what they've paid already. */
const askedInTotal = async (id: string) => {
  const all = await invoicesRepo.listForProject(id);
  const paid = all.filter((i) => i.kind !== "credit-note").reduce((s, i) => s + i.paidPence, 0);
  return paid + payableInvoices(all).reduce((s, i) => s + i.owedPence, 0);
};

test("a variation that takes money off, billed on its own before the balance, is a credit note: the customer pays the agreed price", async () => {
  const id = await demo3();
  const contract = (await loadProject(id))!.money.contractTotalPence!;
  const variationId = await acceptReduction(id);
  const before = (await loadMoney(id))!;
  const balanceWithReduction = before.plans.balance.totalPence;
  assert.deepEqual(before.plans.variation.variations?.map((v) => [v.id, v.totalPence]), [[variationId, -4_050]]);

  const issued = await issueInvoice(id, { kind: "variation", issueId: variationId, requestId: rid() }, OFFICE);
  assert.ok(issued.ok, !issued.ok ? issued.error : "");
  // Never a negative "invoice": a credit note tied to the variation.
  assert.equal(issued.value.kind, "credit-note");
  assert.equal(issued.value.totalPence, -4_050);
  assert.equal(issued.value.issueId, variationId);
  assert.equal(issued.value.dueOn, undefined);
  assert.match(issued.message ?? "", /credit on their account/);
  const after = (await loadMoney(id))!;
  assert.deepEqual(after.plans.variation.variations, [], "billed: not on offer again");
  assert.equal(after.summary.toInvoicePence, before.summary.toInvoicePence, "it bills the variation, not the contract");
  // The balance bills the full figure; the credit comes off what they pay.
  assert.equal(after.plans.balance.totalPence, balanceWithReduction + 4_050);
  const balance = await issueInvoice(id, { kind: "balance", earlyReason: "DEMO", requestId: rid(), expectedTotalPence: after.plans.balance.totalPence }, OFFICE);
  assert.ok(balance.ok, !balance.ok ? balance.error : "");
  const all = await invoicesRepo.listForProject(id);
  const asked = payableInvoices(all);
  assert.deepEqual(asked.map((i) => [i.kind, i.owedPence, i.creditPence]), [["balance", balanceWithReduction, 4_050]]);
  assert.equal(await askedInTotal(id), contract - 4_050, "the agreed price, not the old one");
  assert.equal(outstandingPence(all), balanceWithReduction);
  assert.equal((await loadReadinessContext(id))!.money?.unbilledPence, 0, "nothing left to bill");
});

test("a variation that takes money off, accepted after the balance went out, comes off the balance as credit", async () => {
  const id = await demo3();
  const contract = (await loadProject(id))!.money.contractTotalPence!;
  const plan = (await loadMoney(id))!.plans.balance;
  const balance = await issueInvoice(id, { kind: "balance", earlyReason: "DEMO", requestId: rid(), expectedTotalPence: plan.totalPence }, OFFICE);
  assert.ok(balance.ok, !balance.ok ? balance.error : "");
  const variationId = await acceptReduction(id);
  assert.equal((await loadReadinessContext(id))!.money?.unbilledPence, 0, "a reduction is never billed as money owed");
  const issued = await issueInvoice(id, { kind: "variation", issueId: variationId, requestId: rid() }, OFFICE);
  assert.ok(issued.ok, !issued.ok ? issued.error : "");
  assert.equal(issued.value.kind, "credit-note");
  const all = await invoicesRepo.listForProject(id);
  assert.deepEqual(payableInvoices(all).map((i) => [i.kind, i.owedPence, i.creditPence]), [["balance", plan.totalPence - 4_050, 4_050]]);
  assert.equal(await askedInTotal(id), contract - 4_050);
  assert.deepEqual((await loadMoney(id))!.plans.variation.variations, []);
});

test("with credit on the account, the invoice document and email ask for what's left, the receipt says nothing's owed, and an overpayment can be recorded", async () => {
  const { listDocuments } = await import("../lib/documents-server.ts");
  const messagesRepo = await import("../lib/repo/messages.ts");
  const { recordManualPayment } = await import("../lib/money-server.ts");
  const id = await demo3();
  const goodwill = await issueInvoice(id, { kind: "credit-note", amountPence: 20_000, reason: "Goodwill: install moved twice (DEMO)", requestId: rid() }, OFFICE);
  assert.ok(goodwill.ok);
  const plan = (await loadMoney(id))!.plans.balance;
  const balance = await issueInvoice(id, { kind: "balance", earlyReason: "DEMO", requestId: rid(), expectedTotalPence: plan.totalPence }, OFFICE);
  assert.ok(balance.ok, !balance.ok ? balance.error : "");
  const owed = payableInvoices(await invoicesRepo.listForProject(id)).find((i) => i.id === balance.value.id)!.owedPence;
  assert.equal(owed, plan.totalPence - 20_000, "the pay page takes the credit off");

  // The frozen document asks for the same figure, with the credit shown.
  const doc = (await listDocuments(id, { kind: "invoice" })).find((d) => d.id === balance.value.documentId)!;
  const snap = doc.snapshot as { toPayPence?: number; accountCredit?: { pence: number; creditNotes: string[] } };
  assert.equal(snap.toPayPence, owed);
  assert.deepEqual(snap.accountCredit, { pence: 20_000, creditNotes: [goodwill.value.number] });
  // And the email's subject.
  const mail = (await messagesRepo.listForProject(id)).find((m) => m.event === "invoice-issued" && m.channel === "email" && m.subject?.includes(balance.value.number));
  assert.ok(mail, "the invoice email was written");
  assert.match(mail!.subject ?? "", new RegExp(`£${(owed / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 }).replace(/[.,]/g, "\\$&")}`));
  assert.match(mail!.bodyText ?? "", /Less: credit on your account/);

  // More than is owed: a likely typo, refused unless they say it really arrived.
  const gross = await recordManualPayment(id, { invoiceId: balance.value.id, amountPence: plan.totalPence, method: "bank-transfer", reference: "OKAFOR BAL", receivedOn: today(), requestId: rid() }, OFFICE);
  assert.ok(!gross.ok && /More than is owed arrived/.test(gross.error), !gross.ok ? gross.error : "");

  // The right figure: the receipt says nothing's left, with the customer's own reference.
  const paid = await recordManualPayment(id, { invoiceId: balance.value.id, amountPence: owed, method: "bank-transfer", reference: "OKAFOR BAL", receivedOn: today(), requestId: rid() }, OFFICE);
  assert.ok(paid.ok, !paid.ok ? paid.error : "");
  const receipt = (await listDocuments(id, { kind: "receipt" })).find((d) => (d.snapshot as { payment: { id: string } }).payment.id === paid.value.payment.id)!;
  const rs = receipt.snapshot as { stillToPayPence?: number; payment: { reference?: string } };
  assert.equal(rs.stillToPayPence, 0, "nothing is owed on it");
  assert.equal(rs.payment.reference, "OKAFOR BAL");

  // A second transfer that arrives anyway is recorded in full, as credit, and the team hears.
  const again = await recordManualPayment(
    id,
    { invoiceId: balance.value.id, amountPence: 5_000, method: "bank-transfer", reference: "OKAFOR BAL", receivedOn: today(), requestId: rid(), overpaid: true },
    OFFICE,
  );
  assert.ok(again.ok, !again.ok ? again.error : "");
  assert.match(again.message ?? "", /credit on their account/);
  const all = await invoicesRepo.listForProject(id);
  assert.equal(outstandingPence(all), -5_000 - 20_000 + 20_000, "the extra £50 is theirs");
  assert.ok((await messagesRepo.listForProject(id)).some((m) => m.event === "team-alert" && /Overpaid: £50 more/.test(m.subject ?? "")));
  // And it can go back with no credit note (it was overpaid, not off the price).
  const back = await recordRefund(id, { invoiceId: balance.value.id, amountPence: 5_000, method: "bank-transfer", refundedOn: today(), reason: "Paid twice (DEMO)", requestId: rid() }, OFFICE);
  assert.ok(back.ok && !back.value.creditNote, back.ok ? "" : back.error);
  assert.equal(outstandingPence(await invoicesRepo.listForProject(id)), 0);
});
