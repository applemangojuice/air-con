import { test } from "node:test";
import assert from "node:assert/strict";
import { rateLimit, clientKey, enforceRateLimit, rateLimitIdentity } from "../lib/rate-limit.ts";

test("allows up to the limit, then blocks", () => {
  const key = `t1-${Math.random()}`;
  for (let i = 0; i < 5; i++) {
    assert.equal(rateLimit(key, 5, 60_000).ok, true, `hit ${i + 1} should pass`);
  }
  const blocked = rateLimit(key, 5, 60_000);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterSeconds >= 1);
});

test("window slides: old hits expire", async () => {
  const key = `t2-${Math.random()}`;
  assert.equal(rateLimit(key, 1, 50).ok, true);
  assert.equal(rateLimit(key, 1, 50).ok, false);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(rateLimit(key, 1, 50).ok, true, "after the window, hits pass again");
});

test("keys are independent", () => {
  const a = `t3a-${Math.random()}`;
  const b = `t3b-${Math.random()}`;
  assert.equal(rateLimit(a, 1, 60_000).ok, true);
  assert.equal(rateLimit(a, 1, 60_000).ok, false);
  assert.equal(rateLimit(b, 1, 60_000).ok, true, "another key is unaffected");
});

test("clientKey prefers first x-forwarded-for hop", () => {
  const req = new Request("http://x", {
    headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
  });
  assert.equal(clientKey(req), "203.0.113.9");
});

test("clientKey falls back to x-real-ip then unknown", () => {
  const real = new Request("http://x", { headers: { "x-real-ip": "198.51.100.7" } });
  assert.equal(clientKey(real), "198.51.100.7");
  assert.equal(clientKey(new Request("http://x")), "unknown");
});

test("enforceRateLimit returns a 429 Response with Retry-After when tripped", async () => {
  const req = new Request("http://x", { headers: { "x-real-ip": "192.0.2.55" } });
  const scope = `t6-${Math.random()}`;
  assert.equal(enforceRateLimit(req, scope, 1, 60_000), null);
  const limited = enforceRateLimit(req, scope, 1, 60_000);
  assert.ok(limited instanceof Response);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) >= 1);
  const body = (await limited.json()) as { error: string };
  assert.equal(body.error, "Too many requests");
});

test("rateLimitIdentity: IPv4 as-is, IPv6 by its /64", () => {
  assert.equal(rateLimitIdentity("203.0.113.7"), "203.0.113.7");
  assert.equal(rateLimitIdentity(" unknown "), "unknown");
  assert.equal(rateLimitIdentity("2001:db8:1:2:3:4:5:6"), "2001:db8:1:2::/64");
  assert.equal(rateLimitIdentity("2001:DB8:0001:0002:ffff:ffff:ffff:ffff"), "2001:db8:1:2::/64");
  assert.equal(rateLimitIdentity("2001:db8:1:2::1"), "2001:db8:1:2::/64", "compressed tail");
  assert.equal(rateLimitIdentity("2001:db8::1"), "2001:db8:0:0::/64", "compressed middle");
  assert.equal(rateLimitIdentity("[2001:db8:1:2::9]"), "2001:db8:1:2::/64");
  assert.equal(rateLimitIdentity("fe80::1%eth0"), "fe80:0:0:0::/64");
  assert.equal(rateLimitIdentity("::ffff:198.51.100.4"), "198.51.100.4");
  assert.equal(rateLimitIdentity("not:an:ip::x"), "not:an:ip::x", "junk passes through unchanged");
  // Two addresses in one /64 share a limit.
  assert.equal(rateLimitIdentity("2001:db8:aa:bb::1"), rateLimitIdentity("2001:db8:aa:bb:dead:beef:0:2"));
});
