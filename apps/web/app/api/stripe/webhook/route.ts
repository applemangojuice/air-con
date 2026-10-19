import { notify } from "@/lib/comms/outbox";
import { alertStripeDispute, recordStripePayment, recordStripeRefund } from "@/lib/money-server";
import { listRefundsForCharge, stripeMode, stripeWebhookSecret, verifyStripeSignature } from "@/lib/providers/stripe";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServiceClient } from "@/lib/supabase-server";
import { decideStripeEvent, parseStripeEvent, refundFacts, type StripeRefundFacts } from "./stripe-events";

/**
 * POST /api/stripe/webhook: Stripe's signed notifications, the only way a
 * card payment becomes a payment record (a redirect back from Checkout
 * proves nothing).
 *
 *  * The raw body is verified against STRIPE_WEBHOOK_SECRET (HMAC-SHA256,
 *    five-minute tolerance) before anything is parsed. Bad signature: 400.
 *  * Idempotent: the payment's provider reference is the Checkout Session id
 *    (unique), so Stripe's retries and replays record it once; a refund's is
 *    its refund id, the same way.
 *  * Refunds made in Stripe are recorded against the payment they came from;
 *    disputes (chargebacks) and overpayments are urgent team alerts.
 *  * 200 for anything handled or deliberately ignored; 500 only when our side
 *    failed, so Stripe retries later.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request): Promise<Response> {
  const limited = enforceRateLimit(request, "stripe-webhook", 300, 60_000);
  if (limited) return limited;
  const secret = stripeWebhookSecret();
  if (!secret) {
    console.error("[stripe] webhook called but STRIPE_WEBHOOK_SECRET isn't set");
    return json({ error: "Webhook not configured" }, 503);
  }
  const raw = await request.text();
  const check = await verifyStripeSignature(raw, request.headers.get("stripe-signature"), secret);
  if (!check.ok) return json({ error: check.error }, 400);
  const event = parseStripeEvent(raw);
  if (!event) return json({ error: "Not an event" }, 400);
  if (!getServiceClient()) return json({ error: "No database" }, 503);

  const decision = decideStripeEvent(event, stripeMode());
  try {
    if (decision.kind === "ignore") return json({ received: true, ignored: decision.reason });

    if (decision.kind === "failed") {
      if (decision.projectId) {
        await notify("team-alert", {
          projectId: decision.projectId,
          data: {
            title: "A card payment didn't go through",
            lines: ["The customer's delayed payment failed at Stripe. Nothing was recorded; their invoice is still open.", `Stripe session ${decision.sessionId}`],
          },
          discriminator: `stripe-failed:${decision.sessionId}`,
        });
      }
      return json({ received: true });
    }

    if (decision.kind === "dispute") {
      await alertStripeDispute(decision);
      return json({ received: true });
    }

    if (decision.kind === "refund") {
      let refunds: StripeRefundFacts[] | null = decision.refunds;
      if (refunds === null && decision.chargeId) {
        // Newer API versions leave the refund list off the charge: ask Stripe for it (a 500 makes Stripe retry if it can't answer).
        const listed = await listRefundsForCharge(decision.chargeId);
        if (!listed.ok) {
          console.error(`[stripe] couldn't list the refunds on ${decision.chargeId}: ${listed.error}`);
          return json({ error: "Couldn't read the refunds; Stripe will retry" }, 500);
        }
        const at = Math.floor(Date.now() / 1000);
        refunds = listed.value
          .map((r) => refundFacts({ ...r, charge: r.charge ?? decision.chargeId, payment_intent: r.payment_intent ?? decision.paymentIntent }, at))
          .filter((r): r is StripeRefundFacts => r !== null);
      }
      for (const r of refunds ?? []) {
        const pi = r.paymentIntent ?? decision.paymentIntent;
        await recordStripeRefund({
          refundId: r.refundId,
          ...(pi ? { paymentIntent: pi } : {}),
          amountPence: r.amountPence,
          status: r.status,
          refundedAt: r.refundedAt,
          ...(r.reason ? { reason: r.reason } : {}),
          ...(decision.invoiceId ? { invoiceId: decision.invoiceId } : {}),
          eventId: decision.eventId,
        });
      }
      return json({ received: true, refunds: refunds?.length ?? 0 });
    }

    const result = await recordStripePayment(decision.payment);
    if (!result.ok) {
      // Not ours to retry: the session names an invoice we don't have.
      return json({ received: true, ignored: result.error });
    }
    if (result.value.payment.pendingApply) {
      // Recorded, but not yet applied to the invoice and project: a 500 makes Stripe come back,
      // and its later retry finishes the job (the record itself can't be made twice).
      console.error(`[stripe] payment for ${decision.payment.sessionId} recorded but not applied: ${result.warning ?? ""}`);
      return json({ error: "Recorded, not yet applied; retry later" }, 500);
    }
    return json({ received: true, duplicate: result.value.duplicate });
  } catch (err) {
    console.error(`[stripe] handling ${event.type} ${event.id} failed:`, err);
    return json({ error: "Couldn't record it; Stripe will retry" }, 500);
  }
}
