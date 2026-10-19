import { test } from "node:test";
import assert from "node:assert/strict";
import { registerAppResolver } from "./helpers/resolve-app.ts";

/**
 * The brakes on the public endpoints that send email: names that can only
 * be names, limits keyed by household (IPv6 /64), and a per-address cap on
 * sign-in links that's counted in the database.
 */
process.env.DATA_BACKEND = "memory";
delete process.env.SUPABASE_URL;
delete process.env.RESEND_API_KEY;
registerAppResolver();
const { personNameProblem } = await import("../lib/person-name.ts");
const { enforceRateLimit } = await import("../lib/rate-limit.ts");
const { issueMagicLink, SIGN_IN_LINKS_PER_ADDRESS } = await import("../lib/auth/magic.ts");
const customersRepo = await import("../lib/repo/customers.ts");
const { requireDb } = await import("../lib/supabase-server.ts");

test("a funnel name is a name: letters and the punctuation names use, never a number or a link", () => {
  for (const ok of ["Sam", "Siobhán O'Neill", "Jean-Luc Picard", "Dr. A. Smith", "Sam & Alex Taylor", "Zoë", "李小龍", "DEMO Funnel Tester"]) {
    assert.equal(personNameProblem(ok), null, ok);
  }
  for (const bad of ["", "S", "Call 0800 123 4567", "Your account is locked visit evil.com", "bit.ly/x", "<b>Sam</b>", "Sam\nTaylor", "x".repeat(81), "sam@example.com"]) {
    assert.notEqual(personNameProblem(bad), null, JSON.stringify(bad));
  }
});

test("rate limits count an IPv6 household (/64) as one, like the sign-in limits", () => {
  const req = (ip: string) => new Request("http://localhost/x", { headers: { "x-forwarded-for": ip } });
  const scope = `t-${crypto.randomUUID()}`;
  assert.equal(enforceRateLimit(req("2001:db8:1:2::1"), scope, 2, 60_000), null);
  assert.equal(enforceRateLimit(req("2001:db8:1:2:aaaa::9"), scope, 2, 60_000), null);
  assert.equal(enforceRateLimit(req("2001:db8:1:2:ffff:ffff:ffff:ffff"), scope, 2, 60_000)?.status, 429, "a fresh address in the same /64 is the same limit");
  assert.equal(enforceRateLimit(req("2001:db8:1:3::1"), scope, 2, 60_000), null, "the next /64 is someone else");
});

test("sign-in links: a cap per address per quarter hour, counted in the database", async () => {
  const email = `cap.${crypto.randomUUID().slice(0, 8)}@example.test`;
  await customersRepo.findOrCreate({ email, name: "DEMO Cap" });
  const results = [];
  for (let i = 0; i < SIGN_IN_LINKS_PER_ADDRESS + 2; i++) results.push(await issueMagicLink({ email, kind: "customer", next: "/portal" }));
  assert.ok(results.slice(0, SIGN_IN_LINKS_PER_ADDRESS).every((r) => r.devLink), "the first few go out (shown on screen in development)");
  assert.ok(results.slice(SIGN_IN_LINKS_PER_ADDRESS).every((r) => !r.devLink && !r.sent), "then nothing, with the same answer");
  const { count } = await requireDb().from("login_tokens").select("id", { count: "exact", head: true }).eq("email", email);
  assert.equal(count, SIGN_IN_LINKS_PER_ADDRESS, "no tokens minted past the cap");
});
