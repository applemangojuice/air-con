import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createCheckoutSession,
  parseStripeSignature,
  retrieveCheckoutSession,
  signStripePayload,
  stripeForm,
  stripeMode,
  verifyStripeSignature,
} from "../lib/providers/stripe.ts";
import { fitSms, gsmSafe, isTextable, isUkMobile, normaliseUkPhone, sendSms, smsLength } from "../lib/providers/sms.ts";

/* ------------------------------------------------------------------ */
/* Helpers: env and fetch, restored after each test                    */
/* ------------------------------------------------------------------ */

async function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const before: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    before[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

type Captured = { url: string; init: RequestInit };

async function withFetch(
  respond: (c: Captured) => { status?: number; json: unknown },
  fn: (calls: Captured[]) => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  const calls: Captured[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const c = { url: String(url), init: init ?? {} };
    calls.push(c);
    const r = respond(c);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

/* ------------------------------------------------------------------ */
/* Stripe webhook signatures                                           */
/* ------------------------------------------------------------------ */

const SECRET = "whsec_test_fictional_secret";
const BODY = JSON.stringify({ id: "evt_demo_1", type: "checkout.session.completed", data: { object: { id: "cs_test_demo" } } });
const T = 1_790_000_000;

test("a correctly signed payload verifies", async () => {
  const header = await signStripePayload(BODY, SECRET, T);
  assert.match(header, /^t=1790000000,v1=[0-9a-f]{64}$/);
  const res = await verifyStripeSignature(BODY, header, SECRET, 300, T + 10);
  assert.deepEqual(res, { ok: true, timestamp: T });
});

test("a tampered body, a wrong secret or a swapped timestamp fails", async () => {
  const header = await signStripePayload(BODY, SECRET, T);
  const tampered = BODY.replace("cs_test_demo", "cs_test_other");
  assert.equal((await verifyStripeSignature(tampered, header, SECRET, 300, T)).ok, false);
  assert.equal((await verifyStripeSignature(BODY, header, "whsec_wrong", 300, T)).ok, false);
  const sig = parseStripeSignature(header).v1[0];
  assert.equal((await verifyStripeSignature(BODY, `t=${T + 1},v1=${sig}`, SECRET, 300, T)).ok, false, "the timestamp is signed too");
});

test("expired and far-future timestamps fail even with a valid signature", async () => {
  const header = await signStripePayload(BODY, SECRET, T);
  const old = await verifyStripeSignature(BODY, header, SECRET, 300, T + 301);
  assert.equal(old.ok, false);
  assert.match(!old.ok ? old.error : "", /tolerance/);
  assert.equal((await verifyStripeSignature(BODY, header, SECRET, 300, T - 301)).ok, false);
  assert.equal((await verifyStripeSignature(BODY, header, SECRET, 300, T + 300)).ok, true, "the edge of the window still passes");
  assert.equal((await verifyStripeSignature(BODY, header, SECRET, 0, T + 86_400)).ok, true, "tolerance 0 turns the check off");
});

test("several v1 signatures: any one matching is enough (secret rotation)", async () => {
  const good = parseStripeSignature(await signStripePayload(BODY, SECRET, T)).v1[0];
  const other = parseStripeSignature(await signStripePayload(BODY, "whsec_old_secret", T)).v1[0];
  const header = `t=${T},v1=${other},v0=deadbeef,v1=${good.toUpperCase()}`;
  assert.deepEqual(parseStripeSignature(header), { t: T, v1: [other, good] });
  assert.equal((await verifyStripeSignature(BODY, header, SECRET, 300, T)).ok, true);
  assert.equal((await verifyStripeSignature(BODY, `t=${T},v1=${other}`, SECRET, 300, T)).ok, false);
});

test("malformed headers are refused with a reason, never thrown", async () => {
  const sig = parseStripeSignature(await signStripePayload(BODY, SECRET, T)).v1[0];
  for (const header of [null, "", "garbage", `v1=${sig}`, `t=${T}`, `t=abc,v1=${sig}`, `t=${T},v0=${sig}`]) {
    const res = await verifyStripeSignature(BODY, header, SECRET, 300, T);
    assert.equal(res.ok, false, String(header));
  }
  assert.equal((await verifyStripeSignature(BODY, `t=${T},v1=${sig}`, "", 300, T)).ok, false, "no secret, no pass");
});

/* ------------------------------------------------------------------ */
/* Stripe Checkout                                                     */
/* ------------------------------------------------------------------ */

test("stripeMode reads the key prefix and never calls an unknown key live", () => {
  assert.equal(stripeMode(undefined), "demo");
  assert.equal(stripeMode(""), "demo");
  assert.equal(stripeMode("sk_test_abc"), "test");
  assert.equal(stripeMode("rk_test_abc"), "test");
  assert.equal(stripeMode("sk_live_abc"), "live");
  assert.equal(stripeMode("rk_live_abc"), "live");
  assert.equal(stripeMode("something_else"), "test");
});

test("stripeForm flattens nested params into bracket keys and drops empties", () => {
  const form = stripeForm({
    mode: "payment",
    customer_email: undefined,
    line_items: [{ quantity: 1, price_data: { currency: "gbp", unit_amount: 12345 } }],
    metadata: { invoice_id: "inv-1", empty: null },
  });
  assert.equal(form.get("mode"), "payment");
  assert.equal(form.get("line_items[0][quantity]"), "1");
  assert.equal(form.get("line_items[0][price_data][currency]"), "gbp");
  assert.equal(form.get("line_items[0][price_data][unit_amount]"), "12345");
  assert.equal(form.get("metadata[invoice_id]"), "inv-1");
  assert.equal(form.has("customer_email"), false);
  assert.equal(form.has("metadata[empty]"), false);
});

const INVOICE = {
  id: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-000000000002",
  number: "DIH-0007",
  kind: "balance" as const,
  totalPence: 450_000,
  paidPence: 50_000,
};

test("createCheckoutSession posts what's left to pay, in GBP pence, with ids in metadata", async () => {
  await withEnv({ STRIPE_SECRET_KEY: "sk_test_fictional" }, () =>
    withFetch(
      () => ({ json: { id: "cs_test_123", url: "https://checkout.stripe.com/c/pay/cs_test_123" } }),
      async (calls) => {
        const res = await createCheckoutSession({
          invoice: INVOICE,
          successUrl: "https://example.test/p/x/pay?session={CHECKOUT_SESSION_ID}",
          cancelUrl: "https://example.test/p/x/pay",
          customerEmail: "demo@example.test",
          idempotencyKey: "checkout:inv-1:400000",
        });
        assert.deepEqual(res, { ok: true, value: { id: "cs_test_123", url: "https://checkout.stripe.com/c/pay/cs_test_123" } });
        assert.equal(calls.length, 1);
        const { url, init } = calls[0];
        assert.equal(url, "https://api.stripe.com/v1/checkout/sessions");
        assert.equal(init.method, "POST");
        const headers = init.headers as Record<string, string>;
        assert.equal(headers.authorization, "Bearer sk_test_fictional");
        assert.equal(headers["content-type"], "application/x-www-form-urlencoded");
        assert.equal(headers["idempotency-key"], "checkout:inv-1:400000");
        const form = new URLSearchParams(String(init.body));
        assert.equal(form.get("mode"), "payment");
        assert.equal(form.get("line_items[0][price_data][currency]"), "gbp");
        assert.equal(form.get("line_items[0][price_data][unit_amount]"), "400000");
        assert.equal(form.get("line_items[0][quantity]"), "1");
        assert.equal(form.get("customer_email"), "demo@example.test");
        assert.equal(form.get("client_reference_id"), INVOICE.id);
        assert.equal(form.get("metadata[invoice_id]"), INVOICE.id);
        assert.equal(form.get("metadata[project_id]"), INVOICE.projectId);
        assert.equal(form.get("payment_intent_data[metadata][invoice_id]"), INVOICE.id);
        assert.equal(form.get("success_url"), "https://example.test/p/x/pay?session={CHECKOUT_SESSION_ID}");
        assert.equal(form.get("cancel_url"), "https://example.test/p/x/pay");
      },
    ),
  );
});

test("createCheckoutSession refuses nothing-to-pay and reports Stripe errors without throwing", async () => {
  await withEnv({ STRIPE_SECRET_KEY: "sk_test_fictional" }, () =>
    withFetch(
      () => ({ status: 400, json: { error: { message: "Invalid currency" } } }),
      async (calls) => {
        const paid = await createCheckoutSession({ invoice: { ...INVOICE, paidPence: INVOICE.totalPence }, successUrl: "s", cancelUrl: "c" });
        assert.equal(paid.ok, false);
        assert.equal(calls.length, 0, "no request for a paid invoice");
        const bad = await createCheckoutSession({ invoice: INVOICE, successUrl: "s", cancelUrl: "c" });
        assert.deepEqual(bad, { ok: false, error: "Stripe: Invalid currency" });
      },
    ),
  );
  await withEnv({ STRIPE_SECRET_KEY: undefined }, async () => {
    const res = await createCheckoutSession({ invoice: INVOICE, successUrl: "s", cancelUrl: "c" });
    assert.deepEqual(res, { ok: false, error: "Stripe not configured" });
  });
});

test("retrieveCheckoutSession only asks Stripe about session ids", async () => {
  await withEnv({ STRIPE_SECRET_KEY: "sk_test_fictional" }, () =>
    withFetch(
      () => ({ json: { id: "cs_test_123", payment_status: "paid", amount_total: 400000, metadata: {} } }),
      async (calls) => {
        assert.equal((await retrieveCheckoutSession("../../v1/charges")).ok, false);
        assert.equal(calls.length, 0);
        const res = await retrieveCheckoutSession("cs_test_123");
        assert.equal(res.ok && res.value.payment_status, "paid");
        assert.equal(calls[0].url, "https://api.stripe.com/v1/checkout/sessions/cs_test_123");
        assert.equal(calls[0].init.method, "GET");
      },
    ),
  );
});

/* ------------------------------------------------------------------ */
/* Phone numbers                                                       */
/* ------------------------------------------------------------------ */

test("UK numbers normalise to E.164 however they're typed", () => {
  // Ofcom's drama ranges: never real people.
  const cases: [string, string | null][] = [
    ["07700 900123", "+447700900123"],
    ["07700900123", "+447700900123"],
    ["+44 7700 900123", "+447700900123"],
    ["+44 (0)7700 900123", "+447700900123"],
    ["+4407700900123", "+447700900123"],
    ["0044 7700 900123", "+447700900123"],
    ["447700900123", "+447700900123"],
    ["07700-900-123", "+447700900123"],
    ["(07700) 900.123", "+447700900123"],
    ["020 7946 0018", "+442079460018"],
    ["0113 496 0000", "+441134960000"],
    ["+33 6 12 34 56 78", "+33612345678"],
    ["", null],
    ["   ", null],
    ["0770090012", "+44770090012"], // 9 national digits: some UK ranges are this short
    ["077009001234", null], // too long
    ["7700 900123", null], // no trunk prefix: ambiguous
    ["07700 9001ab", null],
    ["+0 1234 5678", null],
  ];
  for (const [input, expected] of cases) assert.equal(normaliseUkPhone(input), expected, input);
  assert.equal(normaliseUkPhone(null), null);
  assert.equal(normaliseUkPhone(undefined), null);
});

test("only mobiles are textable in the UK", () => {
  assert.equal(isUkMobile("+447700900123"), true);
  assert.equal(isUkMobile("+442079460018"), false);
  assert.equal(isTextable("+447700900123"), true);
  assert.equal(isTextable("+442079460018"), false);
  assert.equal(isTextable("+33612345678"), true);
});

/* ------------------------------------------------------------------ */
/* SMS text                                                            */
/* ------------------------------------------------------------------ */

test("segments: 160/153 in GSM-7, 70/67 in UCS-2, extension characters count twice", () => {
  assert.deepEqual(smsLength("a".repeat(160)), { encoding: "gsm7", units: 160, segments: 1 });
  assert.deepEqual(smsLength("a".repeat(161)), { encoding: "gsm7", units: 161, segments: 2 });
  assert.equal(smsLength("a".repeat(306)).segments, 2);
  assert.equal(smsLength("a".repeat(307)).segments, 3);
  assert.deepEqual(smsLength("€".repeat(80)), { encoding: "gsm7", units: 160, segments: 1 });
  assert.equal(smsLength("£ and é are GSM").encoding, "gsm7");
  assert.deepEqual(smsLength("ë".repeat(70)), { encoding: "ucs2", units: 70, segments: 1 });
  assert.equal(smsLength("ë".repeat(71)).segments, 2);
  assert.equal(smsLength("").segments, 0);
});

test("gsmSafe keeps texts in GSM-7 without mangling what it can't map", () => {
  assert.equal(gsmSafe("It’s “ready” – see you…"), "It's \"ready\" - see you...");
  assert.equal(gsmSafe("Zoë Brontë"), "Zoe Bronte");
  assert.equal(gsmSafe("Renée"), "Renée", "é is already GSM");
  assert.equal(smsLength(gsmSafe("Hi Zoë, it’s Dang, It’s Hot")).encoding, "gsm7");
  assert.equal(gsmSafe("Hi 李"), "Hi 李", "no transliteration for other scripts");
});

test("fitSms takes the first candidate within two segments", () => {
  const long = "x".repeat(400);
  const short = "Dang, It's Hot: on the way. Call 0800 000 0000.";
  assert.equal(fitSms([long, short]), short);
  assert.equal(fitSms(["  spaced   out  "]), "spaced out");
  assert.equal(fitSms([long, "y".repeat(350)]), "y".repeat(350), "nothing fits: the shortest");
});

test("sendSms posts to Twilio with basic auth and refuses landlines and junk locally", async () => {
  await withEnv({ TWILIO_ACCOUNT_SID: "AC_fictional", TWILIO_AUTH_TOKEN: "token", TWILIO_FROM: "DangItsHot" }, () =>
    withFetch(
      () => ({ status: 201, json: { sid: "SM123", status: "queued" } }),
      async (calls) => {
        assert.deepEqual(await sendSms("020 7946 0018", "hello"), { ok: false, error: "Not a mobile number" });
        assert.deepEqual(await sendSms("not a number", "hello"), { ok: false, error: "Not a valid phone number" });
        assert.equal(calls.length, 0);

        const res = await sendSms("07700 900123", "Your installer’s on the way.");
        assert.deepEqual(res, { ok: true, providerRef: "SM123" });
        const { url, init } = calls[0];
        assert.equal(url, "https://api.twilio.com/2010-04-01/Accounts/AC_fictional/Messages.json");
        const headers = init.headers as Record<string, string>;
        assert.equal(headers.authorization, `Basic ${btoa("AC_fictional:token")}`);
        const form = new URLSearchParams(String(init.body));
        assert.equal(form.get("To"), "+447700900123");
        assert.equal(form.get("From"), "DangItsHot");
        assert.equal(form.get("Body"), "Your installer's on the way.");
      },
    ),
  );
  await withEnv({ TWILIO_ACCOUNT_SID: "AC_fictional", TWILIO_AUTH_TOKEN: "token", TWILIO_FROM: "DangItsHot" }, () =>
    withFetch(
      () => ({ status: 400, json: { code: 21211, message: "Invalid 'To' Phone Number" } }),
      async () => {
        assert.deepEqual(await sendSms("07700 900123", "hi"), { ok: false, error: "Twilio: Invalid 'To' Phone Number (21211)" });
      },
    ),
  );
  await withEnv({ TWILIO_ACCOUNT_SID: undefined, TWILIO_AUTH_TOKEN: undefined, TWILIO_FROM: undefined }, async () => {
    assert.deepEqual(await sendSms("07700 900123", "hi"), { ok: false, error: "SMS not configured" });
  });
  await withEnv({ TWILIO_ACCOUNT_SID: "AC_fictional", TWILIO_AUTH_TOKEN: "token", TWILIO_FROM: "Way too long a sender" }, async () => {
    const res = await sendSms("07700 900123", "hi");
    assert.equal(res.ok, false);
  });
});
