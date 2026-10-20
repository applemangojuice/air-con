import { test } from "node:test";
import assert from "node:assert/strict";
import type { Invoice } from "@aircon/domain";
import { registerAppResolver } from "./helpers/resolve-app.ts";

/**
 * A Stripe refund that fails after it was recorded (§K45): signed fake
 * events through the real webhook route, on the in-memory backend with the
 * DEMO books. The refund is marked failed (never deleted), what the family
 * is owed back reappears, the credit note stays, the team is told what to
 * do, and every step is safe to replay or receive out of order.
 */
process.env.DATA_BACKEND = "memory";
delete process.env.SUPABASE_URL;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.RESEND_API_KEY;
process.env.STRIPE_WEBHOOK_SECRET = "whsec_demo_refund_failure_0123456789";
registerAppResolver();
const webhook = await import("../app/api/stripe/webhook/route.ts");
const { decideStripeEvent } = await import("../app/api/stripe/webhook/stripe-events.ts");
const { signStripePayload } = await import("../lib/providers/stripe.ts");
const { resetDemoData, buildDemoDataset } = await import("../lib/demo-seed/index.ts");
const { recordStripePayment, recordRefund, loadMoney } = await import("../lib/money-server.ts");
const { loadProject, londonToday } = await import("../lib/project-service.ts");
const { DEMO_STAFF } = await import("../lib/auth/demo-staff.ts");
const invoicesRepo = await import("../lib/repo/invoices.ts");
const paymentsRepo = await import("../lib/repo/payments.ts");
const messagesRepo = await import("../lib/repo/messages.ts");
const { accountsPaymentsCsv, outstandingPence, invoiceOutstanding } = await import("@aircon/domain");

const INVOICE = "5a1e0c4d-7b0a-4f7e-9d55-0000000000f9";
const PI = "pi_demo_refund_fails";
const CH = "ch_demo_refund_fails";
let seq = 0;

async function post(type: string, object: Record<string, unknown>, opts: { id?: string; badSignature?: boolean } = {}) {
  const body = JSON.stringify({ id: opts.id ?? `evt_demo_${++seq}`, type, created: Math.floor(Date.now() / 1000), livemode: false, data: { object } });
  const signature = opts.badSignature ? `t=${Math.floor(Date.now() / 1000)},v1=${"ab".repeat(32)}` : await signStripePayload(body, process.env.STRIPE_WEBHOOK_SECRET!);
  return webhook.POST(
    new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      body,
      headers: { "content-type": "application/json", "stripe-signature": signature, "x-forwarded-for": `198.51.100.${(seq % 200) + 1}` },
    }),
  );
}
const refundObject = (id: string, status: string, over: Record<string, unknown> = {}) => ({
  id,
  object: "refund",
  amount: 125_000,
  currency: "gbp",
  status,
  payment_intent: PI,
  charge: CH,
  reason: "requested_by_customer",
  created: Math.floor(Date.now() / 1000),
  ...over,
});

async function paidByCard(): Promise<string> {
  const now = new Date().toISOString();
  await resetDemoData({ now });
  const projectId = buildDemoDataset({ now }).projects[2]!.project.id;
  const balance: Invoice = {
    id: INVOICE,
    projectId,
    number: "DIH-DEMO-9301",
    kind: "balance",
    status: "issued",
    lines: [{ label: "Balance (DEMO)", netPence: 125_000, taxCode: "zero-esm", taxPence: 0, totalPence: 125_000 }],
    netPence: 125_000,
    taxPence: 0,
    totalPence: 125_000,
    paidPence: 0,
    issuedAt: now,
  };
  await invoicesRepo.insert(balance);
  const paid = await recordStripePayment({ sessionId: "cs_test_refund_fails", invoiceId: INVOICE, projectId, amountPence: 125_000, paymentIntent: PI, receivedAt: now, eventId: "evt_pay" });
  assert.ok(paid.ok, JSON.stringify(paid));
  return projectId;
}

test("the events a refund's status change produces are all read, with the failure reason", () => {
  for (const type of ["refund.created", "refund.updated", "refund.failed", "charge.refund.updated"]) {
    const d = decideStripeEvent({ id: "evt_x", type, created: 1, livemode: false, data: { object: refundObject("re_x", "failed", { failure_reason: "declined" }) } }, "test");
    assert.equal(d.kind, "refund", type);
    if (d.kind === "refund") {
      assert.equal(d.refunds?.[0]?.status, "failed", type);
      assert.equal(d.refunds?.[0]?.failureReason, "declined", type);
    }
  }
  // refund.failed is a failure even if the object's status hasn't caught up.
  const odd = decideStripeEvent({ id: "evt_y", type: "refund.failed", created: 1, livemode: false, data: { object: refundObject("re_y", "pending") } }, "test");
  assert.ok(odd.kind === "refund" && odd.refunds?.[0]?.status === "failed");
});

test("a pending refund recorded, then failed: marked failed, paid again, owed back to the family, credit note kept, team told", async () => {
  const projectId = await paidByCard();
  const before = (await loadProject(projectId))!.money.paidPence;

  // Refunded in Stripe's dashboard: pending, so it's recorded (with its credit note).
  assert.equal((await post("refund.created", refundObject("re_demo_fail_1", "pending"))).status, 200);
  const refund = (await paymentsRepo.getByProviderRef("stripe-refund:re_demo_fail_1"))!;
  assert.equal(refund.status, "refunded");
  let all = await invoicesRepo.listForProject(projectId);
  const credits = all.filter((i) => i.kind === "credit-note" && i.creditsInvoiceId === INVOICE);
  assert.equal(credits.length, 1, "the refund's credit note");
  assert.equal(all.find((i) => i.id === INVOICE)!.paidPence, 0);
  assert.equal((await loadProject(projectId))!.money.paidPence, before - 125_000);

  // A forged failure changes nothing.
  assert.equal((await post("refund.failed", refundObject("re_demo_fail_1", "failed"), { badSignature: true })).status, 400);
  assert.equal((await paymentsRepo.getByProviderRef("stripe-refund:re_demo_fail_1"))!.status, "refunded");

  // Then Stripe says it failed.
  const failedEvent = "evt_demo_refund_failed_1";
  assert.equal((await post("refund.failed", refundObject("re_demo_fail_1", "failed", { failure_reason: "expired_or_canceled_card" }), { id: failedEvent })).status, 200);
  const failed = (await paymentsRepo.getByProviderRef("stripe-refund:re_demo_fail_1"))!;
  assert.equal(failed.id, refund.id, "the same row, kept");
  assert.equal(failed.status, "failed");
  assert.equal(failed.amountPence, -125_000);
  assert.equal(failed.failureReason, "expired_or_canceled_card");
  assert.ok(failed.failedAt && failed.reversedOnProjectAt);
  assert.match(failed.note ?? "", /failed \(the card has expired or been cancelled\)/);

  all = await invoicesRepo.listForProject(projectId);
  const inv = all.find((i) => i.id === INVOICE)!;
  assert.equal(inv.paidPence, 125_000, "the money is with us again: paid again");
  assert.equal(inv.status, "paid");
  assert.equal(all.filter((i) => i.kind === "credit-note" && i.creditsInvoiceId === INVOICE).length, 1, "the credit note stays, never deleted");
  assert.equal(invoiceOutstanding(inv, all), 0, "nothing for them to pay");
  assert.equal(outstandingPence(all), -125_000, "they're in credit: owed back");
  const project = (await loadProject(projectId))!;
  assert.equal(project.money.paidPence, before, "the project's totals took it back");
  assert.match(project.events.at(-1)!.label, /refund of £1,250 we sent didn't go through/);
  const view = (await loadMoney(projectId))!;
  assert.equal(view.summary.outstandingPence, -125_000, "the money page's In credit");
  assert.ok(view.summary.refundedPence === 0, "and nothing counted as refunded");

  const alerts = (await messagesRepo.listForProject(projectId)).filter((m) => m.event === "team-alert" && /refund failed at Stripe/.test(m.subject ?? ""));
  assert.equal(alerts.length, 1);
  assert.match(alerts[0]!.subject ?? "", /^\[Urgent\] A card refund failed at Stripe: £1,250 on DIH-DEMO-9301/);
  assert.match(alerts[0]!.bodyText, /They're £1,250 in credit/);
  assert.match(alerts[0]!.bodyText, /contact the family/);
  assert.match(alerts[0]!.bodyText, /refund it again, in Stripe if their card works now/);

  // Replayed, and a late "succeeded" for the same refund: nothing moves twice, nothing moves back.
  assert.equal((await post("refund.failed", refundObject("re_demo_fail_1", "failed"), { id: failedEvent })).status, 200);
  assert.equal((await post("charge.refund.updated", refundObject("re_demo_fail_1", "failed"))).status, 200);
  assert.equal((await post("refund.updated", refundObject("re_demo_fail_1", "succeeded"))).status, 200);
  assert.equal((await paymentsRepo.getByProviderRef("stripe-refund:re_demo_fail_1"))!.status, "failed");
  assert.equal((await loadProject(projectId))!.money.paidPence, before);
  assert.equal((await invoicesRepo.get(INVOICE))!.paidPence, 125_000);
  assert.equal((await messagesRepo.listForProject(projectId)).filter((m) => m.event === "team-alert" && /refund failed at Stripe/.test(m.subject ?? "")).length, 1);

  // The accountant sees it, not counted.
  const csv = accountsPaymentsCsv({ from: "2000-01-01", to: "2099-12-31", invoices: all, payments: await paymentsRepo.listForProject(projectId), projects: [], vatRegistered: false });
  assert.match(csv, /Refund,[^\r\n]*,-1250\.00,failed,no,/);

  // Refunded again by bank transfer: the credit pays out, no second credit note, nothing left either way.
  const again = await recordRefund(
    projectId,
    { invoiceId: INVOICE, amountPence: 125_000, method: "bank-transfer", refundedOn: londonToday(), reason: "DEMO: the card refund failed", requestId: crypto.randomUUID() },
    DEMO_STAFF.admin,
  );
  assert.ok(again.ok, JSON.stringify(again));
  assert.equal(again.value.creditNote, undefined);
  const settled = await invoicesRepo.listForProject(projectId);
  assert.equal(outstandingPence(settled), 0);
  assert.equal(settled.filter((i) => i.kind === "credit-note" && i.creditsInvoiceId === INVOICE).length, 1);
});

test("a refund that fails before we ever saw it pending is kept as failed, so a late 'pending' can't record it", async () => {
  const projectId = await paidByCard();
  const before = (await loadProject(projectId))!.money.paidPence;
  assert.equal((await post("charge.refund.updated", refundObject("re_demo_fail_2", "canceled", { failure_reason: "merchant_request" }))).status, 200);
  const row = (await paymentsRepo.getByProviderRef("stripe-refund:re_demo_fail_2"))!;
  assert.equal(row.status, "failed");
  assert.equal(row.reversedOnProjectAt, undefined, "never counted, so nothing to take back");
  assert.equal((await invoicesRepo.get(INVOICE))!.paidPence, 125_000);
  assert.equal((await loadProject(projectId))!.money.paidPence, before);
  const alert = (await messagesRepo.listForProject(projectId)).find((m) => m.event === "team-alert" && /was cancelled at Stripe/.test(m.subject ?? ""))!;
  assert.match(alert.bodyText, /never recorded here as a refund/);
  // Stripe's earlier "pending", arriving late.
  assert.equal((await post("refund.created", refundObject("re_demo_fail_2", "pending"))).status, 200);
  assert.equal((await paymentsRepo.getByProviderRef("stripe-refund:re_demo_fail_2"))!.status, "failed");
  assert.equal((await invoicesRepo.get(INVOICE))!.paidPence, 125_000);
  assert.equal((await invoicesRepo.listForProject(projectId)).filter((i) => i.kind === "credit-note").length, 0, "no credit note for money that never moved");
});

test("a refund waiting on the customer (requires_action) records nothing yet", async () => {
  const projectId = await paidByCard();
  assert.equal((await post("refund.updated", refundObject("re_demo_wait", "requires_action"))).status, 200);
  assert.equal(await paymentsRepo.getByProviderRef("stripe-refund:re_demo_wait"), null);
  assert.equal((await invoicesRepo.get(INVOICE))!.paidPence, 125_000);
  void projectId;
});
