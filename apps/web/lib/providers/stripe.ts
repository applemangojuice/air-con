import type { Invoice } from "@aircon/domain";

/**
 * Stripe Checkout over the REST API (plain fetch, no SDK), contract §F.
 *
 * STRIPE_SECRET_KEY decides the mode: sk_live_… is live, sk_test_… is test
 * (the banner says TEST MODE), none is demo (the pay page offers a labelled
 * simulate button outside production instead). STRIPE_WEBHOOK_SECRET signs
 * the webhook.
 *
 * Honest states: a redirect back from Checkout proves nothing. Money is only
 * recorded from a webhook whose signature verifies here (or a session
 * retrieved server-side with `payment_status: "paid"`).
 *
 * Imports types only, so `node --test` loads it directly.
 */

const STRIPE_API = "https://api.stripe.com/v1";

/** Stripe's smallest GBP charge is 30p. */
export const STRIPE_MIN_CHARGE_PENCE = 30;

export type StripeMode = "live" | "test" | "demo";

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** From the key prefix. An unrecognised key is never reported as live. */
export function stripeMode(key: string | undefined = process.env.STRIPE_SECRET_KEY): StripeMode {
  if (!key) return "demo";
  if (/^(sk|rk)_live_/.test(key)) return "live";
  return "test";
}

export function stripeWebhookSecret(): string | null {
  return process.env.STRIPE_WEBHOOK_SECRET || null;
}

/* ------------------------------------------------------------------ */
/* Form encoding                                                       */
/* ------------------------------------------------------------------ */

/**
 * Stripe's form encoding: nested objects and arrays flatten to bracket keys
 * (`line_items[0][price_data][currency]=gbp`). Undefined and null are left
 * out, so optional params can be passed straight through.
 */
export function stripeForm(params: Record<string, unknown>): URLSearchParams {
  const form = new URLSearchParams();
  const walk = (key: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(`${key}[${i}]`, v));
    } else if (typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(`${key}[${k}]`, v);
    } else {
      form.append(key, String(value));
    }
  };
  for (const [k, v] of Object.entries(params)) walk(k, v);
  return form;
}

/* ------------------------------------------------------------------ */
/* Checkout                                                            */
/* ------------------------------------------------------------------ */

/** The subset of a Checkout Session we read. */
export interface CheckoutSession {
  id: string;
  url: string | null;
  status: "open" | "complete" | "expired" | null;
  payment_status: "paid" | "unpaid" | "no_payment_required";
  amount_total: number | null;
  currency: string | null;
  client_reference_id: string | null;
  customer_email: string | null;
  metadata: Record<string, string>;
  payment_intent: string | { id: string } | null;
  livemode: boolean;
}

export type StripeResult<T> = { ok: true; value: T } | { ok: false; error: string };

const INVOICE_KIND_LABEL: Record<Invoice["kind"], string> = {
  deposit: "Deposit",
  balance: "Balance",
  variation: "Variation",
  "survey-fee": "Survey fee",
  "change-fee": "Date change fee",
  "credit-note": "Credit note",
};

async function stripeRequest<T>(
  method: "GET" | "POST",
  path: string,
  form?: URLSearchParams,
  idempotencyKey?: string,
): Promise<StripeResult<T>> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { ok: false, error: "Stripe not configured" };
  try {
    const headers: Record<string, string> = { authorization: `Bearer ${key}` };
    if (form) headers["content-type"] = "application/x-www-form-urlencoded";
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
    const res = await fetch(`${STRIPE_API}${path}`, {
      method,
      headers,
      body: form?.toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
    if (!res.ok || !json) return { ok: false, error: `Stripe: ${json?.error?.message ?? `HTTP ${res.status}`}` };
    return { ok: true, value: json };
  } catch (err) {
    return { ok: false, error: `Stripe unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * A hosted Checkout page for what's still owed on one invoice, in GBP pence.
 * `client_reference_id` and `metadata` carry the invoice and project ids, on
 * the session and on the PaymentIntent, so the webhook can match the payment
 * without trusting anything from the browser. `successUrl` may contain
 * Stripe's `{CHECKOUT_SESSION_ID}` placeholder.
 */
export async function createCheckoutSession(input: {
  invoice: Pick<Invoice, "id" | "projectId" | "number" | "kind" | "totalPence" | "paidPence">;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
  /** Shown under the line item, e.g. the property address. */
  description?: string;
  /** Repeat calls with the same key (within 24 hours) return the same session. */
  idempotencyKey?: string;
}): Promise<StripeResult<{ id: string; url: string }>> {
  const { invoice } = input;
  const amountPence = invoice.totalPence - invoice.paidPence;
  if (!Number.isInteger(amountPence)) return { ok: false, error: "Amount must be whole pence" };
  if (amountPence < STRIPE_MIN_CHARGE_PENCE) return { ok: false, error: "Nothing left to pay on this invoice" };

  const metadata = { invoice_id: invoice.id, project_id: invoice.projectId, invoice_number: invoice.number };
  const name = `${INVOICE_KIND_LABEL[invoice.kind] ?? "Invoice"}: invoice ${invoice.number}`;
  const form = stripeForm({
    mode: "payment",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    customer_email: input.customerEmail || undefined,
    client_reference_id: invoice.id,
    locale: "en-GB",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "gbp",
          unit_amount: amountPence,
          product_data: { name, description: input.description || undefined },
        },
      },
    ],
    metadata,
    payment_intent_data: { description: name, metadata },
  });

  const res = await stripeRequest<CheckoutSession>("POST", "/checkout/sessions", form, input.idempotencyKey);
  if (!res.ok) return res;
  if (!res.value.url) return { ok: false, error: "Stripe returned a session without a URL" };
  return { ok: true, value: { id: res.value.id, url: res.value.url } };
}

/** Read a session back server-side: the trustworthy way to check a payment after a redirect. */
export async function retrieveCheckoutSession(id: string): Promise<StripeResult<CheckoutSession>> {
  if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return { ok: false, error: "Not a Checkout Session id" };
  return stripeRequest<CheckoutSession>("GET", `/checkout/sessions/${encodeURIComponent(id)}`);
}

/* ------------------------------------------------------------------ */
/* Webhook signatures                                                  */
/* ------------------------------------------------------------------ */

const encoder = new TextEncoder();

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time for equal lengths; lengths aren't secret (always 64 hex chars). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** "t=1700000000,v1=abc,v1=def,v0=…" → the timestamp and every v1 signature. */
export function parseStripeSignature(header: string): { t: number | null; v1: string[] } {
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === "t" && /^\d+$/.test(v)) t = Number(v);
    else if (k === "v1" && v) v1.push(v.toLowerCase());
  }
  return { t, v1 };
}

export type SignatureCheck = { ok: true; timestamp: number } | { ok: false; error: string };

/**
 * Verify a `Stripe-Signature` header against the RAW request body (read it
 * with `await req.text()` before parsing: re-serialised JSON won't match).
 * HMAC-SHA256 of `${t}.${rawBody}` with the endpoint secret; any one of the
 * v1 signatures may match (Stripe sends several while a secret is rolled).
 * Timestamps more than `toleranceSec` from now, either way, are refused so a
 * captured request can't be replayed later.
 */
export async function verifyStripeSignature(
  rawBody: string,
  header: string | null | undefined,
  secret: string,
  toleranceSec = 300,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<SignatureCheck> {
  if (!secret) return { ok: false, error: "No webhook secret configured" };
  if (!header) return { ok: false, error: "Missing Stripe-Signature header" };
  const { t, v1 } = parseStripeSignature(header);
  if (t === null) return { ok: false, error: "Signature header has no timestamp" };
  if (v1.length === 0) return { ok: false, error: "Signature header has no v1 signature" };

  const expected = await hmacSha256Hex(secret, `${t}.${rawBody}`);
  let match = false;
  for (const sig of v1) if (timingSafeEqual(sig, expected)) match = true; // no early exit
  if (!match) return { ok: false, error: "Signature doesn't match" };
  if (toleranceSec > 0 && Math.abs(nowSec - t) > toleranceSec) {
    return { ok: false, error: "Signature timestamp outside the tolerance window" };
  }
  return { ok: true, timestamp: t };
}

/** Build a valid header, the way Stripe does. For tests and the local simulate flow only. */
export async function signStripePayload(
  rawBody: string,
  secret: string,
  timestampSec: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  return `t=${timestampSec},v1=${await hmacSha256Hex(secret, `${timestampSec}.${rawBody}`)}`;
}
