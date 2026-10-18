import { notify } from "@/lib/comms/outbox";
import { recordStripePayment } from "@/lib/money-server";
import { stripeMode, stripeWebhookSecret, verifyStripeSignature } from "@/lib/providers/stripe";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServiceClient } from "@/lib/supabase-server";
import { decideStripeEvent, parseStripeEvent } from "./stripe-events";

/**
 * POST /api/stripe/webhook: Stripe's signed notifications, the only way a
 * card payment becomes a payment record (a redirect back from Checkout
 * proves nothing).
 *
 *  * The raw body is verified against STRIPE_WEBHOOK_SECRET (HMAC-SHA256,
 *    five-minute tolerance) before anything is parsed. Bad signature: 400.
 *  * Idempotent: the payment's provider reference is the Checkout Session id
 *    (unique), so Stripe's retries and replays record it once.
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
