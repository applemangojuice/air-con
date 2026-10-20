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

const { EMAIL_BUDGET, emailBudgetChecks, londonDayKey, spendEmailBudget } = await import("../lib/email-budget.ts");

/** With a (fake) email provider set, as on the live site: the budget only counts real sends. */
async function withEmailLive<T>(fn: () => Promise<T>): Promise<T> {
  const saved = { key: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM };
  process.env.RESEND_API_KEY = "re_demo_budget_test_key_123";
  process.env.EMAIL_FROM = "DEMO <hello@demo.dang.invalid>";
  try {
    return await fn();
  } finally {
    if (saved.key === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = saved.key;
    if (saved.from === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = saved.from;
  }
}

test("the public email budget's day is the London day, across the clocks going back (25 Oct 2026)", () => {
  assert.equal(londonDayKey(new Date("2026-10-24T22:59:59Z")), "2026-10-24", "23:59 BST on Sat 24 Oct");
  assert.equal(londonDayKey(new Date("2026-10-24T23:00:00Z")), "2026-10-25", "midnight BST: Sunday in London, Saturday in UTC");
  assert.equal(londonDayKey(new Date("2026-10-25T00:30:00Z")), "2026-10-25", "01:30 BST");
  assert.equal(londonDayKey(new Date("2026-10-25T01:30:00Z")), "2026-10-25", "01:30 GMT, the hour that happens twice");
  assert.equal(londonDayKey(new Date("2026-10-25T23:59:59Z")), "2026-10-25", "the 25-hour day's last second");
  assert.equal(londonDayKey(new Date("2026-10-26T00:00:00Z")), "2026-10-26", "midnight GMT");
  const [day, hour] = emailBudgetChecks("public", new Date("2026-10-25T00:30:00Z"));
  assert.ok(day!.windowMs >= 25 * 3600_000, "the day's window outlasts the longest London day");
  assert.notEqual(hour!.key, emailBudgetChecks("public", new Date("2026-10-25T01:30:00Z"))[1]!.key, "01:00-02:00 BST and GMT are two hours");
  assert.equal(day!.key, emailBudgetChecks("public", new Date("2026-10-25T23:30:00Z"))[0]!.key, "one budget for the whole of Sunday");
  const allPools = Object.values(EMAIL_BUDGET).reduce((n, b) => n + b.perDay, 0);
  assert.ok(allPools <= 65, `every email the website can trigger, ${allPools} a day, stays well under Resend Free's 100, leaving the office's own`);
  assert.ok(EMAIL_BUDGET["follow-up"].perDay <= 10, "the unfinished-quote reminders have their own small pool");
});

test("the public email budget holds across a day, per hour and per London day, and starts again at London midnight", async () => {
  await withEmailLive(async () => {
    const spend = async (iso: string, n: number) => {
      const out: boolean[] = [];
      for (let i = 0; i < n; i++) out.push(await spendEmailBudget("public", new Date(iso)));
      return out;
    };
    const { perDay, perHour } = EMAIL_BUDGET.public;
    // 00:10 BST on Sun 25 Oct (23:10 UTC on Saturday): the hour's cap.
    const first = await spend("2026-10-24T23:10:00Z", perHour + 1);
    assert.deepEqual(first, [...Array<boolean>(perHour).fill(true), false]);
    // 01:10 BST, then 01:10 GMT: two different hours, the same London day.
    assert.ok((await spend("2026-10-25T00:10:00Z", perHour)).every(Boolean));
    // Every attempt counts towards the day, the one the hour refused too (so none can be dodged).
    const left = perDay - 2 * perHour - 1;
    const third = await spend("2026-10-25T01:10:00Z", left + 1);
    assert.deepEqual(third, [...Array<boolean>(left).fill(true), false], "then the day's cap");
    // Still Sunday at 23:50 GMT: nothing more today.
    assert.deepEqual(await spend("2026-10-25T23:50:00Z", 1), [false]);
    // Monday in London: a fresh budget.
    assert.deepEqual(await spend("2026-10-26T00:10:00Z", 1), [true]);
    // The sign-in pool is its own: a quote flood never stops a customer's sign-in link.
    assert.equal(await spendEmailBudget("sign-in", new Date("2026-10-25T23:50:00Z")), true);
  });
  // Without an email provider nothing is sent, so nothing is spent.
  assert.equal(await spendEmailBudget("public", new Date("2026-10-25T23:50:00Z")), true);
});

test("sign-in links asked for from the website come out of the budget: over it, no token and no email", async () => {
  const email = `budget.${crypto.randomUUID().slice(0, 8)}@example.test`;
  await customersRepo.findOrCreate({ email, name: "DEMO Budget" });
  await withEmailLive(async () => {
    for (let i = 0; i < EMAIL_BUDGET["sign-in"].perHour; i++) await spendEmailBudget("sign-in");
    const held = await issueMagicLink({ email, kind: "customer", next: "/portal", budget: "sign-in" });
    assert.deepEqual(held, { sent: false, heldBack: true });
  });
  const { count } = await requireDb().from("login_tokens").select("id", { count: "exact", head: true }).eq("email", email);
  assert.equal(count, 0, "no token minted");
  // Staff sending one from the project (no budget) are never held back by it.
  assert.ok((await issueMagicLink({ email, kind: "customer", next: "/portal" })).devLink);
});

const { readTextCapped } = await import("../lib/http-body.ts");
const { surveySchema } = await import("../lib/schemas.ts");
const track = await import("../app/api/track/route.ts");

test("public bodies are read with a cap: a declared or streamed body past it is refused unread", async () => {
  const req = (body: BodyInit, headers: Record<string, string> = {}) => new Request("http://localhost/x", { method: "POST", body, headers, duplex: "half" } as RequestInit);
  assert.equal(await readTextCapped(req("small"), 10), "small");
  assert.equal(await readTextCapped(req("x".repeat(11)), 10), null, "streamed past the cap");
  assert.equal(await readTextCapped(req("tiny", { "content-length": "4000000" }), 4096), null, "declared past the cap: not read at all");
  // A stream that never says how long it is, chunk by chunk.
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      c.enqueue(new Uint8Array(1024).fill(65));
    },
  });
  assert.equal(await readTextCapped(req(stream), 4096), null, "an endless body is cut off after the cap");
});

test("/api/track stores one small event: a 4 MB blob, nested or numerous facts are refused, and the user agent is trimmed", async () => {
  const count = async () => (await requireDb().from("analytics_events").select("id", { count: "exact", head: true })).count ?? 0;
  const post = (body: string, headers: Record<string, string> = {}) =>
    track.POST(new Request("http://localhost/api/track", { method: "POST", body, headers: { "content-type": "text/plain", "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 200)}`, ...headers } }));
  const before = await count();

  const blob = await post(JSON.stringify({ type: "page_view", meta: { x: "A".repeat(4_000_000) } }));
  assert.equal(blob.status, 413, "the finding's 4 MB beacon");
  assert.equal((await post(JSON.stringify({ type: "page_view", meta: { x: "A".repeat(5_000) } }))).status, 413, "one event is a few hundred bytes");
  assert.equal((await post(JSON.stringify({ type: "page_view", meta: { deep: { a: 1 } } }))).status, 400, "flat facts only");
  assert.equal((await post(JSON.stringify({ type: "page_view", meta: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, i])) }))).status, 400, "20 facts at most");
  assert.equal(await count(), before, "nothing stored");

  const ok = await post(JSON.stringify({ type: "quote_submit", path: "/quote", meta: { status: "saved", totalGbp: 3450, rooms: 2, postcode: "SW16 2HB", marketing: false } }), { "user-agent": "DEMO ".repeat(400) });
  assert.equal(ok.status, 200);
  assert.equal(await count(), before + 1);
  const { data } = await requireDb().from("analytics_events").select("meta, user_agent").eq("type", "quote_submit");
  const row = (data ?? []).at(-1) as { meta: Record<string, unknown>; user_agent: string };
  assert.deepEqual(row.meta, { status: "saved", totalGbp: 3450, rooms: 2, postcode: "SW16 2HB", marketing: false }, "what track() really sends still goes through");
  assert.equal(row.user_agent.length, 300);
});

test("survey bodies keep their photos bounded: long strings refused, more than 40 in a list dropped, not the answer", () => {
  const photo = (i: number) => ({ id: `p-${i}`, kind: "room", storagePath: `11111111-1111-4111-8111-111111111111/room-${i}.jpg` });
  const survey = {
    postcode: "SW16 2HB",
    addressLine: "1 DEMO Road",
    property: { type: "semi-detached", era: "1930-1950", bedrooms: 3, ownership: "owner" },
    rooms: [{ id: "r1", name: "Bedroom", type: "bedroom", size: "medium", floor: "first", glazing: "medium", orientation: "south", hasExternalWall: true, photos: Array.from({ length: 55 }, (_, i) => photo(i)) }],
    outdoor: { location: "ground-rear", photos: [] },
    electrics: { condition: "unsure", photos: [] },
  };
  const parsed = surveySchema.parse(survey);
  assert.equal(parsed.rooms[0]!.photos.length, 40);
  assert.equal(surveySchema.safeParse({ ...survey, rooms: [{ ...survey.rooms[0]!, photos: [{ ...photo(1), storagePath: "x".repeat(301) }] }] }).success, false);
  assert.equal(surveySchema.safeParse({ ...survey, rooms: [{ ...survey.rooms[0]!, photos: [{ ...photo(1), fileName: "x".repeat(256) }] }] }).success, false);
  assert.equal(surveySchema.safeParse({ ...survey, rooms: [{ ...survey.rooms[0]!, id: "r".repeat(81) }] }).success, false);
});
