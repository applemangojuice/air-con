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
  assert.equal(decideStripeEvent(event("charge.refunded", { id: "ch_1" }), "test").kind, "ignore");
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
