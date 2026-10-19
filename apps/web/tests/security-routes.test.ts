import { test } from "node:test";
import assert from "node:assert/strict";
import { registerAppResolver } from "./helpers/resolve-app.ts";

/**
 * The two routes the pilot E2E can't flip env for on a running server:
 * the Stripe webhook with a webhook secret set, and the demo seed with demo
 * sign-in off. The real route handlers, on the in-memory backend.
 */
process.env.DATA_BACKEND = "memory";
delete process.env.SUPABASE_URL;
registerAppResolver();
const webhook = await import("../app/api/stripe/webhook/route.ts");
const seed = await import("../app/api/dev/seed/route.ts");

const SECRET = "whsec_test_not_real_0123456789";

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

const event = JSON.stringify({
  id: "evt_demo_1",
  type: "checkout.session.completed",
  livemode: false,
  data: { object: { id: "cs_demo_1", object: "checkout.session", payment_status: "paid", amount_total: 100, currency: "gbp", metadata: { invoice_id: "x", project_id: "y" } } },
});
const post = (body: string, signature: string | null, ip: string) =>
  new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    body,
    headers: { "content-type": "application/json", "x-forwarded-for": ip, ...(signature ? { "stripe-signature": signature } : {}) },
  });

test("Stripe webhook: a bad, missing or replayed-old signature is a 400 and records nothing", async () => {
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  try {
    const now = Math.floor(Date.now() / 1000);
    const forged = await webhook.POST(post(event, `t=${now},v1=${"ab".repeat(32)}`, "203.0.113.1"));
    assert.equal(forged.status, 400);
    const wrongSecret = await webhook.POST(post(event, `t=${now},v1=${await hmac("whsec_someone_else", `${now}.${event}`)}`, "203.0.113.2"));
    assert.equal(wrongSecret.status, 400);
    const missing = await webhook.POST(post(event, null, "203.0.113.3"));
    assert.equal(missing.status, 400);
    const old = now - 3600;
    const stale = await webhook.POST(post(event, `t=${old},v1=${await hmac(SECRET, `${old}.${event}`)}`, "203.0.113.4"));
    assert.equal(stale.status, 400, "outside the five-minute tolerance");
    const tampered = await webhook.POST(post(event.replace('"amount_total":100', '"amount_total":999999'), `t=${now},v1=${await hmac(SECRET, `${now}.${event}`)}`, "203.0.113.5"));
    assert.equal(tampered.status, 400, "the signature covers the body");
  } finally {
    delete process.env.STRIPE_WEBHOOK_SECRET;
  }
});

test("Stripe webhook: without a webhook secret nothing is processed (503)", async () => {
  delete process.env.STRIPE_WEBHOOK_SECRET;
  const r = await webhook.POST(post(event, "t=1,v1=00", "203.0.113.6"));
  assert.equal(r.status, 503);
});

test("demo seed: refused (404) wherever demo sign-in isn't allowed", async () => {
  const env = process.env as Record<string, string | undefined>;
  const before = { NODE_ENV: env.NODE_ENV, ALLOW_DEMO_LOGIN: env.ALLOW_DEMO_LOGIN, DEMO_DEPLOYMENT: env.DEMO_DEPLOYMENT };
  const req = () => new Request("http://localhost:3000/api/dev/seed", { method: "POST", headers: { "x-dih-seed": "login", origin: "http://localhost:3000" } });
  try {
    env.NODE_ENV = "production";
    delete env.ALLOW_DEMO_LOGIN;
    assert.equal((await seed.POST(req())).status, 404, "production without ALLOW_DEMO_LOGIN");
    env.ALLOW_DEMO_LOGIN = "true";
    assert.equal((await seed.POST(req())).status, 404, "only exactly 1 turns it on");
    env.ALLOW_DEMO_LOGIN = "1";
    env.SUPABASE_URL = "https://demo.supabase.invalid";
    env.SUPABASE_SERVICE_ROLE_KEY = "not-a-key";
    delete env.DEMO_DEPLOYMENT;
    assert.equal((await seed.POST(req())).status, 404, "a real Supabase database without DEMO_DEPLOYMENT=1");
  } finally {
    delete env.SUPABASE_URL;
    delete env.SUPABASE_SERVICE_ROLE_KEY;
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  }
});
