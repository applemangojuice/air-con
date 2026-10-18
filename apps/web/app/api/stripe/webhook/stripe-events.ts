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
 *  * Anything else → acknowledged and ignored.
 *
 * Idempotency: the payment's provider reference is the Checkout Session id,
 * unique in `payments`, so a replayed event (same event id) or the second of
 * two events about one session can only ever record one payment.
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

export type StripeDecision =
  | { kind: "record"; payment: StripePaymentFacts }
  | { kind: "failed"; sessionId: string; invoiceId?: string; projectId?: string; eventId: string }
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

/** What one verified event means for us. `mode` is our key's mode: an event from the other mode is ignored. */
export function decideStripeEvent(event: StripeEventLike, mode: "live" | "test" | "demo"): StripeDecision {
  if (!event.type.startsWith("checkout.session.")) return { kind: "ignore", reason: `not handled: ${event.type}` };
  if (mode === "live" && !event.livemode) return { kind: "ignore", reason: "a test-mode event sent to the live endpoint" };
  if (mode === "test" && event.livemode) return { kind: "ignore", reason: "a live event sent to the test endpoint" };

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
