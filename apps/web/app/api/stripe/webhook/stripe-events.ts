/**
 * Stripe webhook events as decisions: pure (no I/O), so what a payment
 * record looks like, which events count and which don't is tested directly
 * (tests/stripe-webhook.test.ts). The route verifies the signature first;
 * nothing here trusts anything that hasn't been through that.
 *
 *  * checkout.session.completed with payment_status "paid" → record it.
 *    (Card payments land here; "unpaid" means a delayed method is still
 *    clearing, and only its async_payment_succeeded counts.)
 *  * checkout.session.async_payment_succeeded → record it.
 *  * checkout.session.async_payment_failed → tell the team, record nothing.
 *  * charge.refunded (a Charge), charge.refund.updated, refund.created,
 *    refund.updated (a Refund) → record each refund made in Stripe's
 *    dashboard against the payment it came from (a charge.refunded without
 *    its refund list has them fetched by the route). Without these, a
 *    dashboard refund left the invoice "paid".
 *  * charge.dispute.created / charge.dispute.closed → an urgent team alert
 *    (a chargeback: the money may be leaving us), nothing recorded.
 *  * Anything else → acknowledged and ignored.
 *
 * Idempotency: the payment's provider reference is the Checkout Session id,
 * unique in `payments`, so a replayed event (same event id) or the second of
 * two events about one session can only ever record one payment; a refund's
 * is `stripe-refund:<refund id>`, the same way.
 */

export interface StripeEventLike {
  id: string;
  type: string;
  created: number;
  livemode: boolean;
  data: { object: Record<string, unknown> };
}

export interface StripePaymentFacts {
  sessionId: string;
  invoiceId: string;
  projectId: string;
  amountPence: number;
  /** The PaymentIntent id, when Stripe gives one. */
  paymentIntent?: string;
  /** When Stripe says it happened (the event's creation time). */
  receivedAt: string;
  eventId: string;
  livemode: boolean;
}

/** One refund Stripe made (from its dashboard, or its API). */
export interface StripeRefundFacts {
  refundId: string;
  chargeId?: string;
  paymentIntent?: string;
  amountPence: number;
  /** Stripe's status: pending and succeeded mean the money is going back; failed and canceled that it isn't. */
  status: string;
  /** When Stripe made it. */
  refundedAt: string;
  reason?: string;
}

export type StripeDecision =
  | { kind: "record"; payment: StripePaymentFacts }
  | { kind: "failed"; sessionId: string; invoiceId?: string; projectId?: string; eventId: string }
  | {
      kind: "refund";
      /** The refunds in the event, or null when the charge didn't carry its list (the route asks Stripe for it). */
      refunds: StripeRefundFacts[] | null;
      chargeId?: string;
      paymentIntent?: string;
      /** Our ids, when Stripe copied the payment's metadata onto the charge. */
      invoiceId?: string;
      projectId?: string;
      eventId: string;
    }
  | {
      kind: "dispute";
      phase: "created" | "closed";
      disputeId: string;
      chargeId?: string;
      paymentIntent?: string;
      amountPence: number;
      reason?: string;
      /** closed: won, lost or warning_closed; created: needs_response and the like. */
      status?: string;
      /** When the evidence is due (created). */
      respondBy?: string;
      eventId: string;
    }
  | { kind: "ignore"; reason: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The raw body as an event, or null when it isn't one. */
export function parseStripeEvent(raw: string): StripeEventLike | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null) return null;
  const e = json as Record<string, unknown>;
  const data = e.data as { object?: unknown } | undefined;
  if (typeof e.id !== "string" || typeof e.type !== "string" || typeof data?.object !== "object" || data.object === null) return null;
  return {
    id: e.id,
    type: e.type,
    created: typeof e.created === "number" ? e.created : 0,
    livemode: e.livemode === true,
    data: { object: data.object as Record<string, unknown> },
  };
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
/** An id field that may be expanded into its object. */
const idOf = (v: unknown): string | undefined => (typeof v === "string" ? str(v) : str((v as { id?: unknown } | null)?.id));
const isoOf = (sec: unknown, fallbackSec: number): string =>
  new Date((typeof sec === "number" && sec > 0 ? sec : fallbackSec || Math.floor(Date.now() / 1000)) * 1000).toISOString();

const REFUND_EVENTS = new Set(["charge.refunded", "charge.refund.updated", "refund.created", "refund.updated"]);
const DISPUTE_EVENTS = new Set(["charge.dispute.created", "charge.dispute.closed"]);

/** A Refund object as our facts, or null when it isn't one we can use (not pounds, no amount). */
export function refundFacts(r: Record<string, unknown>, fallbackSec: number): StripeRefundFacts | null {
  const refundId = str(r.id);
  if (!refundId || !refundId.startsWith("re_")) return null;
  if (String(r.currency ?? "gbp").toLowerCase() !== "gbp") return null;
  const amount = r.amount;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) return null;
  const chargeId = idOf(r.charge);
  const paymentIntent = idOf(r.payment_intent);
  const reason = str(r.reason);
  return {
    refundId,
    ...(chargeId ? { chargeId } : {}),
    ...(paymentIntent ? { paymentIntent } : {}),
    amountPence: amount,
    status: str(r.status) ?? "succeeded",
    refundedAt: isoOf(r.created, fallbackSec),
    ...(reason ? { reason } : {}),
  };
}

/** What one verified event means for us. `mode` is our key's mode: an event from the other mode is ignored. */
export function decideStripeEvent(event: StripeEventLike, mode: "live" | "test" | "demo"): StripeDecision {
  const handled = event.type.startsWith("checkout.session.") || REFUND_EVENTS.has(event.type) || DISPUTE_EVENTS.has(event.type);
  if (!handled) return { kind: "ignore", reason: `not handled: ${event.type}` };
  if (mode === "live" && !event.livemode) return { kind: "ignore", reason: "a test-mode event sent to the live endpoint" };
  if (mode === "test" && event.livemode) return { kind: "ignore", reason: "a live event sent to the test endpoint" };

  if (REFUND_EVENTS.has(event.type)) return decideRefund(event);
  if (DISPUTE_EVENTS.has(event.type)) return decideDispute(event);

  const s = event.data.object;
  const sessionId = str(s.id);
  if (!sessionId || !sessionId.startsWith("cs_")) return { kind: "ignore", reason: "no Checkout Session id" };
  const metadata = (typeof s.metadata === "object" && s.metadata !== null ? s.metadata : {}) as Record<string, unknown>;
  const invoiceId = str(metadata.invoice_id) ?? str(s.client_reference_id);
  const projectId = str(metadata.project_id);

  if (event.type === "checkout.session.async_payment_failed") {
    return { kind: "failed", sessionId, ...(invoiceId ? { invoiceId } : {}), ...(projectId ? { projectId } : {}), eventId: event.id };
  }
  const paid =
    (event.type === "checkout.session.completed" && s.payment_status === "paid") ||
    (event.type === "checkout.session.async_payment_succeeded" && s.payment_status === "paid");
  if (!paid) {
    return {
      kind: "ignore",
      reason: event.type === "checkout.session.completed" ? `payment not cleared yet (${String(s.payment_status)})` : `not handled: ${event.type}`,
    };
  }
  if (!invoiceId || !UUID.test(invoiceId) || !projectId || !UUID.test(projectId)) {
    return { kind: "ignore", reason: "the session doesn't name one of our invoices" };
  }
  if (String(s.currency ?? "").toLowerCase() !== "gbp") return { kind: "ignore", reason: `not in pounds (${String(s.currency)})` };
  const amount = s.amount_total;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) return { kind: "ignore", reason: "no amount on the session" };
  const intent = typeof s.payment_intent === "string" ? s.payment_intent : str((s.payment_intent as { id?: unknown } | null)?.id);
  return {
    kind: "record",
    payment: {
      sessionId,
      invoiceId,
      projectId,
      amountPence: amount,
      ...(intent ? { paymentIntent: intent } : {}),
      receivedAt: new Date((event.created || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
      eventId: event.id,
      livemode: event.livemode,
    },
  };
}

function decideRefund(event: StripeEventLike): StripeDecision {
  const o = event.data.object;
  if (event.type === "charge.refunded") {
    const chargeId = str(o.id);
    if (!chargeId || !chargeId.startsWith("ch_")) return { kind: "ignore", reason: "no charge id" };
    if (String(o.currency ?? "").toLowerCase() !== "gbp") return { kind: "ignore", reason: `not in pounds (${String(o.currency)})` };
    const metadata = (typeof o.metadata === "object" && o.metadata !== null ? o.metadata : {}) as Record<string, unknown>;
    const invoiceId = str(metadata.invoice_id);
    const projectId = str(metadata.project_id);
    const paymentIntent = idOf(o.payment_intent);
    // Older API versions carry the refunds on the charge; newer ones don't, and the route fetches them.
    const list = (o.refunds as { data?: unknown } | null | undefined)?.data;
    const refunds = Array.isArray(list)
      ? list
          .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
          .map((r) => refundFacts({ ...r, charge: r.charge ?? chargeId, payment_intent: r.payment_intent ?? paymentIntent, currency: r.currency ?? o.currency }, event.created))
          .filter((r): r is StripeRefundFacts => r !== null)
      : null;
    return {
      kind: "refund",
      refunds,
      chargeId,
      ...(paymentIntent ? { paymentIntent } : {}),
      ...(invoiceId && UUID.test(invoiceId) ? { invoiceId } : {}),
      ...(projectId && UUID.test(projectId) ? { projectId } : {}),
      eventId: event.id,
    };
  }
  // A Refund object (charge.refund.updated, refund.created, refund.updated).
  const facts = refundFacts(o, event.created);
  if (!facts) return { kind: "ignore", reason: "not a refund in pounds" };
  const metadata = (typeof o.metadata === "object" && o.metadata !== null ? o.metadata : {}) as Record<string, unknown>;
  const invoiceId = str(metadata.invoice_id);
  return {
    kind: "refund",
    refunds: [facts],
    ...(facts.chargeId ? { chargeId: facts.chargeId } : {}),
    ...(facts.paymentIntent ? { paymentIntent: facts.paymentIntent } : {}),
    ...(invoiceId && UUID.test(invoiceId) ? { invoiceId } : {}),
    eventId: event.id,
  };
}

function decideDispute(event: StripeEventLike): StripeDecision {
  const d = event.data.object;
  const disputeId = str(d.id);
  if (!disputeId || !disputeId.startsWith("dp_")) return { kind: "ignore", reason: "no dispute id" };
  const amount = typeof d.amount === "number" && Number.isInteger(d.amount) ? d.amount : 0;
  const chargeId = idOf(d.charge);
  const paymentIntent = idOf(d.payment_intent);
  const reason = str(d.reason);
  const status = str(d.status);
  const due = (d.evidence_details as { due_by?: unknown } | null | undefined)?.due_by;
  return {
    kind: "dispute",
    phase: event.type === "charge.dispute.closed" ? "closed" : "created",
    disputeId,
    ...(chargeId ? { chargeId } : {}),
    ...(paymentIntent ? { paymentIntent } : {}),
    amountPence: amount,
    ...(reason ? { reason } : {}),
    ...(status ? { status } : {}),
    ...(typeof due === "number" && due > 0 ? { respondBy: new Date(due * 1000).toISOString() } : {}),
    eventId: event.id,
  };
}

/** A Checkout Session read back from Stripe's API (after a redirect) as the same facts. */
export function factsFromSession(
  session: { id: string; payment_status: string; amount_total: number | null; currency: string | null; metadata: Record<string, string>; client_reference_id: string | null; payment_intent: string | { id: string } | null; livemode: boolean },
  nowIso: string,
): StripePaymentFacts | null {
  const decision = decideStripeEvent(
    {
      id: `retrieved:${session.id}`,
      type: "checkout.session.completed",
      created: Math.floor(Date.parse(nowIso) / 1000),
      livemode: session.livemode,
      data: { object: session as unknown as Record<string, unknown> },
    },
    session.livemode ? "live" : "test",
  );
  return decision.kind === "record" ? decision.payment : null;
}
