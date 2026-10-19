import { test } from "node:test";
import assert from "node:assert/strict";
import type { Invoice } from "@aircon/domain";
import { decideStripeEvent, factsFromSession, parseStripeEvent, type StripeEventLike } from "../app/api/stripe/webhook/stripe-events.ts";
import { registerAppResolver } from "./helpers/resolve-app.ts";

// F5: which Stripe events become payments, and that one Checkout Session can
// only ever record one payment however many times it's reported. DEMO data,
// on the in-memory backend; no Stripe call is made.
process.env.DATA_BACKEND = "memory";
delete process.env.SUPABASE_URL;
delete process.env.STRIPE_SECRET_KEY;
registerAppResolver();

const INVOICE = "5a1e0c4d-7b0a-4f7e-9d55-0000000000f5";
const PROJECT = "5a1e0c4d-7b0a-4f7e-9d55-0000000000a1";

const session = (over: Record<string, unknown> = {}) => ({
  id: "cs_test_demo_123",
  object: "checkout.session",
  payment_status: "paid",
  amount_total: 125_000,
  currency: "gbp",
  client_reference_id: INVOICE,
  metadata: { invoice_id: INVOICE, project_id: PROJECT },
  payment_intent: "pi_demo_456",
  livemode: false,
  ...over,
});

const event = (type: string, object: Record<string, unknown>, over: Partial<StripeEventLike> = {}): StripeEventLike => ({
  id: "evt_demo_1",
  type,
  created: Date.UTC(2026, 9, 18, 9, 30) / 1000,
  livemode: false,
  data: { object },
  ...over,
});

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

test("parseStripeEvent: a well-formed event parses; junk, arrays and missing objects don't", () => {
  const raw = JSON.stringify(event("checkout.session.completed", session()));
  const parsed = parseStripeEvent(raw);
  assert.equal(parsed?.id, "evt_demo_1");
  assert.equal(parsed?.type, "checkout.session.completed");
  assert.equal(parsed?.livemode, false);
  assert.equal(parseStripeEvent("not json"), null);
  assert.equal(parseStripeEvent("null"), null);
  assert.equal(parseStripeEvent(JSON.stringify({ id: "evt", type: "x" })), null);
  assert.equal(parseStripeEvent(JSON.stringify({ id: "evt", type: "x", data: { object: null } })), null);
  assert.equal(parseStripeEvent(JSON.stringify({ id: 1, type: "x", data: { object: {} } })), null);
  // livemode is only true when Stripe says exactly true.
  assert.equal(parseStripeEvent(JSON.stringify({ ...event("x", {}), livemode: "true" }))?.livemode, false);
});

/* ------------------------------------------------------------------ */
/* Mapping                                                             */
/* ------------------------------------------------------------------ */

test("decideStripeEvent: a paid completed session records the session's own facts", () => {
  const d = decideStripeEvent(event("checkout.session.completed", session()), "test");
  assert.equal(d.kind, "record");
  if (d.kind !== "record") return;
  assert.deepEqual(d.payment, {
    sessionId: "cs_test_demo_123",
    invoiceId: INVOICE,
    projectId: PROJECT,
    amountPence: 125_000,
    paymentIntent: "pi_demo_456",
    receivedAt: "2026-10-18T09:30:00.000Z",
    eventId: "evt_demo_1",
    livemode: false,
  });
  // An expanded PaymentIntent object gives its id.
  const expanded = decideStripeEvent(event("checkout.session.completed", session({ payment_intent: { id: "pi_expanded" } })), "test");
  assert.equal(expanded.kind === "record" && expanded.payment.paymentIntent, "pi_expanded");
});

test("decideStripeEvent: only cleared money counts", () => {
  // A delayed method still clearing: nothing yet.
  const unpaid = decideStripeEvent(event("checkout.session.completed", session({ payment_status: "unpaid" })), "test");
  assert.equal(unpaid.kind, "ignore");
  // Its later success records.
  assert.equal(decideStripeEvent(event("checkout.session.async_payment_succeeded", session()), "test").kind, "record");
  // Its failure tells the team, records nothing.
  const failed = decideStripeEvent(event("checkout.session.async_payment_failed", session({ payment_status: "unpaid" })), "test");
  assert.deepEqual(failed, { kind: "failed", sessionId: "cs_test_demo_123", invoiceId: INVOICE, projectId: PROJECT, eventId: "evt_demo_1" });
  // Expired sessions and unrelated events are acknowledged and ignored.
  assert.equal(decideStripeEvent(event("checkout.session.expired", session({ payment_status: "unpaid" })), "test").kind, "ignore");
  assert.equal(decideStripeEvent(event("payment_intent.succeeded", { id: "pi_1" }), "test").kind, "ignore");
  assert.equal(decideStripeEvent(event("charge.refunded", { id: "ch_1", currency: "usd" }), "test").kind, "ignore", "not pounds");
});

test("decideStripeEvent: refunds made in Stripe, with or without the charge's refund list", () => {
  const charge = (over: Record<string, unknown> = {}) => ({
    id: "ch_demo_1",
    object: "charge",
    currency: "gbp",
    amount: 125_000,
    amount_refunded: 20_000,
    payment_intent: "pi_demo_456",
    metadata: { invoice_id: INVOICE, project_id: PROJECT },
    ...over,
  });
  // Newer API versions: no list, so the route asks Stripe for it.
  const bare = decideStripeEvent(event("charge.refunded", charge()), "test");
  assert.deepEqual(bare, { kind: "refund", refunds: null, chargeId: "ch_demo_1", paymentIntent: "pi_demo_456", invoiceId: INVOICE, projectId: PROJECT, eventId: "evt_demo_1" });
  // Older ones carry it.
  const listed = decideStripeEvent(
    event("charge.refunded", charge({ refunds: { object: "list", data: [{ id: "re_demo_1", amount: 20_000, status: "succeeded", created: Date.UTC(2026, 9, 18, 11) / 1000, reason: "requested_by_customer" }] } })),
    "test",
  );
  assert.equal(listed.kind, "refund");
  if (listed.kind !== "refund") return;
  assert.deepEqual(listed.refunds, [
    { refundId: "re_demo_1", chargeId: "ch_demo_1", paymentIntent: "pi_demo_456", amountPence: 20_000, status: "succeeded", refundedAt: "2026-10-18T11:00:00.000Z", reason: "requested_by_customer" },
  ]);
  // A Refund object on its own (refund.updated, charge.refund.updated).
  const one = decideStripeEvent(event("refund.updated", { id: "re_demo_2", object: "refund", amount: 5_000, currency: "gbp", status: "succeeded", charge: "ch_demo_1", payment_intent: "pi_demo_456", created: 1 }), "test");
  assert.equal(one.kind === "refund" && one.refunds?.[0]?.refundId, "re_demo_2");
  assert.equal(decideStripeEvent(event("charge.refund.updated", { id: "re_x", amount: 0, currency: "gbp" }), "test").kind, "ignore", "no amount");
  // The other mode's refunds are ignored too.
  assert.equal(decideStripeEvent(event("charge.refunded", charge(), { livemode: true }), "test").kind, "ignore");
});

test("decideStripeEvent: a chargeback opening or closing is a dispute for the team", () => {
  const dispute = { id: "dp_demo_1", object: "dispute", amount: 125_000, charge: "ch_demo_1", payment_intent: "pi_demo_456", reason: "fraudulent", status: "needs_response", evidence_details: { due_by: Date.UTC(2026, 9, 28) / 1000 } };
  assert.deepEqual(decideStripeEvent(event("charge.dispute.created", dispute), "test"), {
    kind: "dispute",
    phase: "created",
    disputeId: "dp_demo_1",
    chargeId: "ch_demo_1",
    paymentIntent: "pi_demo_456",
    amountPence: 125_000,
    reason: "fraudulent",
    status: "needs_response",
    respondBy: "2026-10-28T00:00:00.000Z",
    eventId: "evt_demo_1",
  });
  const closed = decideStripeEvent(event("charge.dispute.closed", { ...dispute, status: "lost" }), "test");
  assert.equal(closed.kind === "dispute" && closed.phase, "closed");
});

test("priorSession: one payable Checkout page per bill", async () => {
  const { priorSession } = await import("../app/api/pay/[invoiceId]/prior-session.ts");
  const calls: string[] = [];
  const deps = (o: { expire?: boolean; after?: "complete" | "expired" | "open"; recorded?: boolean } = {}) => ({
    expire: async (id: string) => (calls.push(`expire:${id}`), o.expire === false ? { ok: false as const, error: "Stripe: already complete" } : { ok: true as const, value: {} }),
    retrieve: async (id: string) => (calls.push(`retrieve:${id}`), { ok: true as const, value: { status: o.after ?? ("open" as const) } }),
    recorded: async () => o.recorded === true,
  });
  const s = (status: "open" | "complete" | "expired", amount = 125_000) => ({ id: "cs_test_prior", status, amount_total: amount, url: "https://checkout.stripe.com/c/pay/cs_test_prior" });
  assert.deepEqual(await priorSession(s("open"), 125_000, deps()), { url: "https://checkout.stripe.com/c/pay/cs_test_prior" }, "still open for the same amount: the same page");
  assert.equal(calls.length, 0);
  assert.equal(await priorSession(s("open", 125_000), 100_000, deps()), "new", "another amount: the old page is closed first");
  assert.deepEqual(calls, ["expire:cs_test_prior"]);
  assert.equal(await priorSession(s("complete"), 125_000, deps()), "paid", "paid but not recorded yet: read it back, don't charge again");
  assert.equal(await priorSession(s("complete"), 30_000, deps({ recorded: true })), "new", "paid and recorded: what's owed now is new");
  assert.equal(await priorSession(s("expired"), 125_000, deps()), "new");
  assert.equal(await priorSession(s("open", 1), 125_000, deps({ expire: false, after: "complete" })), "paid", "paid while we tried to close it");
  assert.equal(await priorSession(s("open", 1), 125_000, deps({ expire: false, after: "open" })), "failed");
});

test("decideStripeEvent: a test event never pays a live invoice, and the other way round", () => {
  assert.equal(decideStripeEvent(event("checkout.session.completed", session()), "live").kind, "ignore");
  const live = event("checkout.session.completed", session({ id: "cs_live_1", livemode: true }), { livemode: true });
  assert.equal(decideStripeEvent(live, "test").kind, "ignore");
  assert.equal(decideStripeEvent(live, "live").kind, "record");
});

test("decideStripeEvent: sessions that don't name one of our invoices, or aren't pounds, are ignored", () => {
  const ignore = (over: Record<string, unknown>) => decideStripeEvent(event("checkout.session.completed", session(over)), "test").kind;
  assert.equal(ignore({ metadata: {}, client_reference_id: null }), "ignore");
  assert.equal(ignore({ metadata: { invoice_id: "DIH-0001", project_id: PROJECT }, client_reference_id: null }), "ignore");
  assert.equal(ignore({ metadata: { invoice_id: INVOICE } }), "ignore", "no project id");
  assert.equal(ignore({ currency: "eur" }), "ignore");
  assert.equal(ignore({ amount_total: null }), "ignore");
  assert.equal(ignore({ amount_total: 0 }), "ignore");
  assert.equal(ignore({ amount_total: 12.5 }), "ignore");
  assert.equal(ignore({ id: "pi_not_a_session" }), "ignore");
  // The invoice id can come from client_reference_id when metadata lacks it.
  assert.equal(ignore({ metadata: { project_id: PROJECT } }), "record");
  assert.equal(ignore({ currency: "GBP" }), "record");
});

test("factsFromSession: a session read back after the redirect gives the same facts, or none when unpaid", () => {
  const s = session() as Parameters<typeof factsFromSession>[0];
  const facts = factsFromSession(s, "2026-10-18T09:31:00.000Z");
  assert.equal(facts?.sessionId, "cs_test_demo_123");
  assert.equal(facts?.amountPence, 125_000);
  assert.equal(facts?.receivedAt, "2026-10-18T09:31:00.000Z");
  assert.equal(facts?.eventId, "retrieved:cs_test_demo_123");
  assert.equal(factsFromSession({ ...s, payment_status: "unpaid" }, "2026-10-18T09:31:00.000Z"), null);
});

/* ------------------------------------------------------------------ */
/* Idempotency, on the real money server (memory backend)              */
/* ------------------------------------------------------------------ */

test("recordStripePayment: a replayed event and the return page together record one payment, applied once", async () => {
  const { resetDemoData, buildDemoDataset } = await import("../lib/demo-seed/index.ts");
  const { recordStripePayment } = await import("../lib/money-server.ts");
  const invoicesRepo = await import("../lib/repo/invoices.ts");
  const paymentsRepo = await import("../lib/repo/payments.ts");
  const { loadProject } = await import("../lib/project-service.ts");
  const { listDocuments } = await import("../lib/documents-server.ts");

  const now = "2026-10-18T10:00:00.000Z";
  await resetDemoData({ now });
  // DEMO 3: booked, deposit paid. Give it an issued balance invoice to pay.
  const projectId = buildDemoDataset({ now }).projects[2]!.project.id;
  const before = await loadProject(projectId);
  assert.ok(before, "the demo project exists");
  const balance: Invoice = {
    id: INVOICE,
    projectId,
    number: "DIH-DEMO-9001",
    kind: "balance",
    status: "issued",
    lines: [{ label: "Balance (DEMO)", netPence: 125_000, taxCode: "zero-esm", taxPence: 0, totalPence: 125_000 }],
    netPence: 125_000,
    taxPence: 0,
    totalPence: 125_000,
    paidPence: 0,
    issuedAt: now,
    notes: "DEMO invoice: no real money changed hands.",
  };
  await invoicesRepo.insert(balance);

  const decided = decideStripeEvent(event("checkout.session.completed", session({ metadata: { invoice_id: INVOICE, project_id: projectId } })), "test");
  assert.equal(decided.kind, "record");
  if (decided.kind !== "record") return;

  // The webhook and the customer's return page race; then Stripe retries the event.
  const [a, b] = await Promise.all([recordStripePayment(decided.payment), recordStripePayment({ ...decided.payment, eventId: "retrieved:cs_test_demo_123" })]);
  const c = await recordStripePayment(decided.payment);
  for (const r of [a, b, c]) assert.ok(r.ok, JSON.stringify(r));
  const outcomes = [a, b, c].map((r) => (r.ok ? r.value.duplicate : null));
  assert.equal(outcomes.filter((d) => d === false).length, 1, "exactly one call recorded it");

  const payments = await paymentsRepo.listForInvoice(INVOICE);
  assert.equal(payments.length, 1);
  assert.equal(payments[0]!.providerRef, "cs_test_demo_123");
  assert.equal(payments[0]!.provider, "stripe");
  assert.equal(payments[0]!.pendingApply, undefined, "fully applied");
  assert.ok(payments[0]!.appliedAt);

  const inv = await invoicesRepo.get(INVOICE);
  assert.equal(inv?.status, "paid");
  assert.equal(inv?.paidPence, 125_000);

  const after = await loadProject(projectId);
  assert.equal(after!.money.paidPence - before!.money.paidPence, 125_000, "the project's total moved once");

  const receipts = await listDocuments(projectId, { kind: "receipt", includeSuperseded: true });
  const forThis = receipts.filter((d) => (d.snapshot as { payment?: { id?: string } }).payment?.id === payments[0]!.id);
  assert.equal(forThis.length, 1, "one receipt");

  // A session naming an invoice on another project records nothing.
  const wrong = await recordStripePayment({ ...decided.payment, sessionId: "cs_test_other", projectId: PROJECT });
  assert.equal(wrong.ok, false);
  assert.equal((await paymentsRepo.listForInvoice(INVOICE)).length, 1);
});

test("refunds made in Stripe are recorded once against their payment, with a credit note; hand-recording them is refused", async () => {
  const { resetDemoData, buildDemoDataset } = await import("../lib/demo-seed/index.ts");
  const { recordStripePayment, recordStripeRefund, recordRefund, alertStripeDispute } = await import("../lib/money-server.ts");
  const invoicesRepo = await import("../lib/repo/invoices.ts");
  const paymentsRepo = await import("../lib/repo/payments.ts");
  const messagesRepo = await import("../lib/repo/messages.ts");
  const { invoiceOutstanding } = await import("@aircon/domain");

  const now = new Date().toISOString();
  await resetDemoData({ now });
  const projectId = buildDemoDataset({ now }).projects[2]!.project.id;
  const balance: Invoice = {
    id: INVOICE,
    projectId,
    number: "DIH-DEMO-9002",
    kind: "balance",
    status: "issued",
    lines: [{ label: "Balance (DEMO)", netPence: 125_000, taxCode: "zero-esm", taxPence: 0, totalPence: 125_000 }],
    netPence: 125_000,
    taxPence: 0,
    totalPence: 125_000,
    paidPence: 0,
    issuedAt: now,
    notes: "DEMO invoice: no real money changed hands.",
  };
  await invoicesRepo.insert(balance);
  const paid = await recordStripePayment({ sessionId: "cs_test_refund_1", invoiceId: INVOICE, projectId, amountPence: 125_000, paymentIntent: "pi_demo_refund", receivedAt: now, eventId: "evt_pay" });
  assert.ok(paid.ok);

  // Hand-recording a card refund of a Stripe payment would count it twice: refused, pointing at Stripe.
  process.env.STRIPE_SECRET_KEY = "sk_test_demo_only_not_real_0000000000";
  const OFFICE = { id: "aa000000-0000-4000-8000-0000000000c1", email: "office@demo.dang.invalid", name: "DEMO Office", roles: ["admin" as const], external: false, active: true, qualifications: [] };
  const byHand = await recordRefund(projectId, { invoiceId: INVOICE, amountPence: 10_000, method: "card", refundedOn: now.slice(0, 10), reason: "Goodwill (DEMO)", requestId: crypto.randomUUID() }, OFFICE);
  assert.ok(!byHand.ok && /refund it in Stripe/.test(byHand.error), !byHand.ok ? byHand.error : "");
  delete process.env.STRIPE_SECRET_KEY;

  // Refunded £200 in Stripe's dashboard: recorded from Stripe's word, matched by the PaymentIntent.
  const refund = { refundId: "re_demo_refund_1", paymentIntent: "pi_demo_refund", amountPence: 20_000, status: "succeeded", refundedAt: now, reason: "requested_by_customer", eventId: "evt_refund" };
  const r1 = await recordStripeRefund(refund);
  assert.ok(r1.ok && r1.value.recorded, JSON.stringify(r1));
  assert.ok(r1.ok && r1.value.creditNote, "a credit note goes with it");
  const again = await recordStripeRefund({ ...refund, eventId: "evt_refund_retry" });
  assert.ok(again.ok);
  const onInvoice = await paymentsRepo.listForInvoice(INVOICE);
  const refunds = onInvoice.filter((p) => p.amountPence < 0);
  assert.equal(refunds.length, 1, "recorded once, however often Stripe says so");
  assert.equal(refunds[0]!.provider, "stripe");
  assert.equal(refunds[0]!.providerRef, "stripe-refund:re_demo_refund_1");
  assert.equal(refunds[0]!.status, "refunded");
  assert.equal(refunds[0]!.amountPence, -20_000);
  const all = await invoicesRepo.listForProject(projectId);
  const inv = all.find((i) => i.id === INVOICE)!;
  assert.equal(inv.paidPence, 105_000);
  assert.equal(invoiceOutstanding(inv, all), 0, "not asked for again");
  assert.equal(all.filter((i) => i.kind === "credit-note" && i.creditsInvoiceId === INVOICE).length, 1, "one credit note, not one per retry");

  // A failed refund records nothing new, and one we can't match tells the team.
  const failed = await recordStripeRefund({ ...refund, refundId: "re_demo_failed", status: "failed" });
  assert.ok(failed.ok && !failed.value.recorded);
  const stray = await recordStripeRefund({ ...refund, refundId: "re_demo_stray", paymentIntent: "pi_not_ours" });
  assert.ok(stray.ok && !stray.value.recorded);

  // A chargeback is an urgent alert on the project.
  await alertStripeDispute({ phase: "created", disputeId: "dp_demo_1", paymentIntent: "pi_demo_refund", amountPence: 125_000, reason: "fraudulent", respondBy: "2026-10-28T00:00:00.000Z" });
  const alerts = (await messagesRepo.listForProject(projectId)).filter((m) => m.event === "team-alert");
  assert.ok(alerts.some((m) => /Card refund recorded from Stripe: £200 on DIH-DEMO-9002/.test(m.subject ?? "")), "the team hears about the refund");
  assert.ok(alerts.some((m) => /^\[Urgent\] Chargeback/.test(m.subject ?? "")), "and urgently about the chargeback");
});

test("a Stripe payment for more than was owed is recorded, and the team is told", async () => {
  const { resetDemoData, buildDemoDataset } = await import("../lib/demo-seed/index.ts");
  const { recordStripePayment } = await import("../lib/money-server.ts");
  const invoicesRepo = await import("../lib/repo/invoices.ts");
  const messagesRepo = await import("../lib/repo/messages.ts");
  const now = new Date().toISOString();
  await resetDemoData({ now });
  const projectId = buildDemoDataset({ now }).projects[2]!.project.id;
  const id = "5a1e0c4d-7b0a-4f7e-9d55-0000000000f6";
  await invoicesRepo.insert({
    id,
    projectId,
    number: "DIH-DEMO-9003",
    kind: "balance",
    status: "issued",
    lines: [{ label: "Balance (DEMO)", netPence: 50_000, taxCode: "zero-esm", taxPence: 0, totalPence: 50_000 }],
    netPence: 50_000,
    taxPence: 0,
    totalPence: 50_000,
    paidPence: 0,
    issuedAt: now,
  });
  // Two Checkout pages for one bill, both paid.
  assert.ok((await recordStripePayment({ sessionId: "cs_test_over_1", invoiceId: id, projectId, amountPence: 50_000, paymentIntent: "pi_over_1", receivedAt: now, eventId: "e1" })).ok);
  assert.ok((await recordStripePayment({ sessionId: "cs_test_over_2", invoiceId: id, projectId, amountPence: 50_000, paymentIntent: "pi_over_2", receivedAt: now, eventId: "e2" })).ok);
  const alerts = (await messagesRepo.listForProject(projectId)).filter((m) => m.event === "team-alert" && /Overpaid/.test(m.subject ?? ""));
  assert.equal(alerts.length, 1, "the second payment, not the first");
  assert.match(alerts[0]!.subject ?? "", /\[Urgent\] Overpaid by card: £500 more than was owed on DIH-DEMO-9003/);
});
