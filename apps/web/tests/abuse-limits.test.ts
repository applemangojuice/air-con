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
const { issueMagicLink, SIGN_IN_LINKS_PER_ADDRESS, SIGN_IN_LINKS_PER_ADDRESS_PER_DAY } = await import("../lib/auth/magic.ts");
const { sharedHit, sharedRateLimit, sharedRateLimits } = await import("../lib/rate-limit-shared.ts");
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

test("sign-in links: a daily cap per address too, however the quarter hours are spaced", async () => {
  const email = `day.${crypto.randomUUID().slice(0, 8)}@example.test`;
  const customer = await customersRepo.findOrCreate({ email, name: "DEMO Daily" });
  // Earlier today, outside the quarter hour: one short of the daily cap.
  const now = Date.now();
  for (let i = 0; i < SIGN_IN_LINKS_PER_ADDRESS_PER_DAY - 1; i++) {
    const at = new Date(now - (30 + i * 60) * 60_000).toISOString();
    await requireDb().from("login_tokens").insert({ token_hash: `demo-${crypto.randomUUID()}`, subject_kind: "customer", subject_id: customer.id, email, purpose: "sign-in", expires_at: at, created_at: at });
  }
  assert.ok((await issueMagicLink({ email, kind: "customer" })).devLink, "the last one for today goes");
  const over = await issueMagicLink({ email, kind: "customer" });
  assert.ok(!over.devLink && !over.sent, "then none until tomorrow, with the same answer");
});

test("shared rate limits: the database's count decides across instances, and a missing one falls back to memory", async () => {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const fake = (answer: { data: unknown; error: { message: string } | null }) =>
    ({
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return answer;
      },
    }) as never;
  const refused = await sharedHit(fake({ data: [{ allowed: false, retry_after_seconds: 42 }], error: null }), "magic-email:sam@example.test", 5, 15 * 60_000);
  assert.deepEqual(refused, { ok: false, retryAfterSeconds: 42 });
  assert.equal(calls[0]!.fn, "rate_limit_hit");
  assert.equal(calls[0]!.args.p_limit, 5);
  assert.equal(calls[0]!.args.p_window_seconds, 900);
  assert.match(String(calls[0]!.args.p_key), /^[0-9a-f]{64}$/, "hashed: no address leaves the process");
  assert.doesNotMatch(String(calls[0]!.args.p_key), /sam/);
  assert.deepEqual(await sharedHit(fake({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null }), "k", 5, 60_000), { ok: true, retryAfterSeconds: 0 });
  // 0012 not run: no answer, and the caller keeps its in-memory count.
  assert.equal(await sharedHit(fake({ data: null, error: { message: "Could not find the function public.rate_limit_hit" } }), "k", 5, 60_000), null);

  // On the local backend it's the in-memory count, every limit counted.
  const key = `t-${crypto.randomUUID()}`;
  assert.equal((await sharedRateLimit(key, 2, 60_000)).ok, true);
  assert.equal((await sharedRateLimit(key, 2, 60_000)).ok, true);
  assert.equal((await sharedRateLimit(key, 2, 60_000)).ok, false);
  const other = `t-${crypto.randomUUID()}`;
  assert.equal((await sharedRateLimits([{ key, limit: 2, windowMs: 60_000 }, { key: other, limit: 5, windowMs: 60_000 }])).ok, false);
  assert.equal((await sharedRateLimit(other, 2, 60_000)).ok, true, "the other limit was counted once, not dodged");
  assert.equal((await sharedRateLimit(other, 2, 60_000)).ok, false);
});

test("break-glass: a flood of junk attempts locks out only the network sending it, never a founder elsewhere", async () => {
  const { breakGlassLimits } = await import("../lib/auth/access.ts");
  const run = crypto.randomUUID().slice(0, 8);
  const attacker = `203.0.113.${run.length}`;
  const founderEmail = `founder-${run}@example.test`;
  // Every key names the caller's network: nothing is shared with another one.
  for (const { key } of breakGlassLimits(attacker, founderEmail)) assert.ok(key.includes(attacker), key);
  // 21 junk tries from one network, some with the founder's own address.
  const answers = { checked: 0, refused: 0 };
  for (let i = 0; i < 21; i++) {
    const email = i % 2 ? founderEmail : `junk-${i}-${run}@example.test`;
    if ((await sharedRateLimits(breakGlassLimits(attacker, email))).ok) answers.checked++;
    else answers.refused++;
  }
  assert.deepEqual(answers, { checked: 5, refused: 16 }, "the flooding network is slowed to 5 checked tries a quarter hour");
  // The founder, from another network, with their own address: their attempt is checked.
  assert.equal((await sharedRateLimits(breakGlassLimits(`198.51.100.${run.length}`, founderEmail))).ok, true);
  // IPv6: the attacker's whole /64 counts as one network.
  const v6 = (n: number) => `2001:db8:${run.length}:1::${n}`;
  const { rateLimitIdentity } = await import("../lib/rate-limit.ts");
  let ok = 0;
  for (let n = 1; n <= 8; n++) if ((await sharedRateLimits(breakGlassLimits(rateLimitIdentity(v6(n)), `x${n}-${run}@example.test`))).ok) ok++;
  assert.equal(ok, 5, "rotating addresses inside one /64 doesn't buy more tries");
});
