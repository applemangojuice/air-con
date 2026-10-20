import { test } from "node:test";
import assert from "node:assert/strict";
import { generateQuote } from "@aircon/domain";
import { registerAppResolver } from "./helpers/resolve-app.ts";
import { quoteRow } from "./helpers/rows.ts";

/**
 * Sign-in codes (§K45): every sign-in email carries a 6-digit code beside
 * its link, for signing in on a browser other than the one the link opens in.
 * The real magic-link module, the real /auth/code route and the outbox, on
 * the in-memory backend. DEMO people and reserved addresses only.
 */
process.env.DATA_BACKEND = "memory";
delete process.env.SUPABASE_URL;
delete process.env.RESEND_API_KEY;
registerAppResolver();
const access = await import("../lib/auth/access.ts");
const magic = await import("../lib/auth/magic.ts");
const route = await import("../app/auth/code/route.ts");
const customersRepo = await import("../lib/repo/customers.ts");
const staffRepo = await import("../lib/repo/staff.ts");
const { requireDb } = await import("../lib/supabase-server.ts");
const { createProjectForQuote, DEMO_SURVEY } = await import("../lib/project-service.ts");
const { SESSION_COOKIE, verifySession } = await import("../lib/auth/session.ts");
const { NextRequest } = await import("next/server");

const tokenOf = (link: string) => new URL(link, "http://localhost").searchParams.get("t");
const fresh = (who: string) => `${who}.${crypto.randomUUID().slice(0, 8)}@example.test`;

async function customer(email: string) {
  return customersRepo.findOrCreate({ email, name: "DEMO Code" });
}

/** Push one link's token back in time (the code's 15 minutes are counted from its creation). */
async function age(link: string, minutes: number) {
  const at = new Date(Date.now() - minutes * 60_000).toISOString();
  await requireDb().from("login_tokens").update({ created_at: at }).eq("token_hash", await magic.hashToken(tokenOf(link)!));
}

test("codes as typed: six digits, spaces and dashes ignored; printed in two threes", () => {
  assert.equal(access.normaliseSignInCode("123456"), "123456");
  assert.equal(access.normaliseSignInCode(" 123 456 "), "123456");
  assert.equal(access.normaliseSignInCode("123-456"), "123456");
  for (const bad of ["", "12345", "1234567", "12a456", "１２３４５６", null, undefined]) assert.equal(access.normaliseSignInCode(bad), null, String(bad));
  assert.equal(access.formatSignInCode("012345"), "012 345");
});

test("a code lasts as long as its link or 15 minutes, whichever is shorter", () => {
  assert.equal(access.signInCodeMinutes(20), 15, "staff links (20 minutes)");
  assert.equal(access.signInCodeMinutes(60), 15, "portal links (an hour)");
  assert.equal(access.signInCodeMinutes(30 * 24 * 60), 15, "a 30-day welcome link");
  assert.equal(access.signInCodeMinutes(10), 10, "a shorter link: the link's life");
});

test("typing codes is limited per address and per network, by the quarter hour and the day", () => {
  const limits = access.signInCodeLimits("203.0.113.9", "customer", "Sam@Example.test");
  assert.deepEqual(
    limits.map((l) => [l.key, l.limit, l.windowMs]),
    [
      ["code-email:customer:sam@example.test", 5, 15 * 60_000],
      ["code-email-day:customer:sam@example.test", 10, 24 * 3600_000],
      ["code-ip:203.0.113.9", 10, 15 * 60_000],
      ["code-ip-day:203.0.113.9", 40, 24 * 3600_000],
    ],
  );
  assert.notEqual(access.signInCodeLimits("x", "staff", "a@example.test")[0]!.key, limits[0]!.key.replace("sam", "a"), "staff and customer counts are separate");
});

test("same-origin posts only: another site, or a sandboxed frame, is refused", () => {
  assert.equal(access.isSameOrigin(null, "dang.example"), true);
  assert.equal(access.isSameOrigin("https://dang.example", "dang.example"), true);
  assert.equal(access.isSameOrigin("https://evil.example", "dang.example"), false);
  assert.equal(access.isSameOrigin("null", "dang.example"), false);
  assert.equal(access.isSameOrigin("not a url", "dang.example"), false);
});

test("the code is derived from the stored hash with the secret: never stored, and the hash alone can't make it", async () => {
  const hash = "a".repeat(64);
  const one = await magic.signInCodeFor(hash, "sam@example.test", "secret-one-0123456789-0123456789");
  const again = await magic.signInCodeFor(hash, "SAM@example.test", "secret-one-0123456789-0123456789");
  const other = await magic.signInCodeFor(hash, "sam@example.test", "secret-two-0123456789-0123456789");
  assert.match(one!, /^\d{6}$/);
  assert.equal(one, again, "the same address, however it's typed");
  assert.notEqual(one, other, "another secret, another code");
  assert.notEqual(one, await magic.signInCodeFor(hash, "alex@example.test", "secret-one-0123456789-0123456789"), "bound to the address");
  assert.equal(await magic.signInCodeFor(hash, "sam@example.test", null), null, "no secret, no code");
});

test("a code signs in once, and spends the link with it (and the link spends the code)", async () => {
  const email = fresh("once");
  const c = await customer(email);
  const sent = await magic.issueMagicLink({ email, kind: "customer", next: "/portal" });
  assert.ok(sent.devLink && sent.devCode, "on a developer's machine both are shown");
  assert.match(sent.devCode!, /^\d{6}$/);
  const { data: rows } = await requireDb().from("login_tokens").select("*").eq("email", email);
  assert.equal(rows!.length, 1);
  assert.equal(rows![0]!.purpose, "login-code", "a sign-in email's token is marked as carrying a code");
  assert.ok(!JSON.stringify(rows).includes(sent.devCode!), "the code isn't stored anywhere in the row");

  const subject = await magic.consumeSignInCode({ email: email.toUpperCase(), kind: "customer", code: ` ${sent.devCode!.slice(0, 3)} ${sent.devCode!.slice(3)} ` });
  assert.equal(subject?.subjectId, c.id);
  assert.equal(subject?.next, "/portal");
  assert.equal(await magic.consumeSignInCode({ email, kind: "customer", code: sent.devCode! }), null, "single use");
  assert.equal(await magic.consumeToken(tokenOf(sent.devLink!)), null, "the link died with it");

  // And the other way round.
  const second = await magic.issueMagicLink({ email, kind: "customer" });
  assert.ok(await magic.consumeToken(tokenOf(second.devLink!)));
  assert.equal(await magic.consumeSignInCode({ email, kind: "customer", code: second.devCode! }), null, "the code died with the link");
});

test("a code is bound to its address and kind, and only the newest one works", async () => {
  const email = fresh("bound");
  await customer(email);
  const otherEmail = fresh("other");
  await customer(otherEmail);
  const first = await magic.issueMagicLink({ email, kind: "customer" });
  assert.equal(await magic.consumeSignInCode({ email: otherEmail, kind: "customer", code: first.devCode! }), null, "another address");
  assert.equal(await magic.consumeSignInCode({ email, kind: "staff", code: first.devCode! }), null, "a staff sign-in");
  const wrong = String((Number(first.devCode) + 1) % 1_000_000).padStart(6, "0");
  assert.equal(await magic.consumeSignInCode({ email, kind: "customer", code: wrong }), null, "a wrong code");

  await new Promise((r) => setTimeout(r, 5));
  const second = await magic.issueMagicLink({ email, kind: "customer" });
  if (second.devCode !== first.devCode) {
    assert.equal(await magic.consumeSignInCode({ email, kind: "customer", code: first.devCode! }), null, "an older email's code");
  }
  assert.ok(await magic.consumeSignInCode({ email, kind: "customer", code: second.devCode! }), "the newest one's");
  assert.ok(await magic.consumeToken(tokenOf(first.devLink!)), "the older link still works on its own");
});

test("a code lasts 15 minutes even when its link lasts 30 days; links in operational emails carry none", async () => {
  const email = fresh("welcome");
  await customer(email);
  const welcome = await magic.issueMagicLink({ email, kind: "customer", ttlMinutes: 30 * 24 * 60 });
  await age(welcome.devLink!, 16);
  assert.equal(await magic.consumeSignInCode({ email, kind: "customer", code: welcome.devCode! }), null, "16 minutes later");
  assert.ok(await magic.consumeToken(tokenOf(welcome.devLink!)), "the link itself still works");

  const short = await magic.issueMagicLink({ email, kind: "customer" });
  await age(short.devLink!, 14);
  assert.ok(await magic.consumeSignInCode({ email, kind: "customer", code: short.devCode! }), "14 minutes later, still fine");

  // A token in a proposal or booking email (customerLink) is `login`: never a code's.
  await requireDb().from("login_tokens").insert({
    token_hash: `demo-${crypto.randomUUID()}`,
    subject_kind: "customer",
    email,
    purpose: "login",
    expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
  });
  const { data: plain } = await requireDb().from("login_tokens").select("token_hash").eq("purpose", "login").eq("email", email).single();
  const derived = await magic.signInCodeFor(String(plain!.token_hash), email);
  assert.equal(await magic.consumeSignInCode({ email, kind: "customer", code: derived! }), null);
});

test("staff codes: an active staff member's address, signed in as their staff row", async () => {
  const email = fresh("staff");
  const staff = await staffRepo.insert({ email, name: "DEMO Code Crew", roles: ["installer"], external: false, active: true, qualifications: [], demo: true }, null);
  const sent = await magic.issueMagicLink({ email, kind: "staff", next: "/field" });
  assert.ok(sent.devCode);
  const subject = await magic.consumeSignInCode({ email, kind: "staff", code: sent.devCode! });
  assert.equal(subject?.subjectId, staff.id);
  assert.equal(subject?.next, "/field");
});

/* ------------------------------------------------------------------ */
/* The family's route                                                  */
/* ------------------------------------------------------------------ */

let ipSeq = 10;
const nextIp = () => `198.51.100.${ipSeq++}`;
const post = (body: unknown, opts: { origin?: string | null; type?: string; ip?: string } = {}) =>
  route.POST(
    new NextRequest("http://localhost:3000/auth/code", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: {
        "content-type": opts.type ?? "application/json",
        "x-forwarded-for": opts.ip ?? nextIp(),
        ...(opts.origin === null ? {} : { origin: opts.origin ?? "http://localhost:3000" }),
      },
    }),
  );

test("/auth/code: the right code signs the family in on this browser and says where to go", async () => {
  const email = fresh("route");
  const c = await customer(email);
  const sent = await magic.issueMagicLink({ email, kind: "customer", next: "/portal" });
  const res = await post({ email, code: sent.devCode });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; next: string };
  assert.deepEqual(body, { ok: true, next: "/portal" });
  const cookie = res.cookies.get(SESSION_COOKIE);
  assert.ok(cookie?.value);
  assert.equal(cookie.httpOnly, true);
  const session = await verifySession(cookie.value);
  assert.equal(session?.kind, "customer");
  assert.equal(session?.kind === "customer" ? session.customerId : null, c.id);
  assert.equal(res.headers.get("cache-control"), "no-store");

  const again = await post({ email, code: sent.devCode });
  assert.equal(again.status, 400, "spent");
  assert.equal(again.cookies.get(SESSION_COOKIE), undefined);
});

test("/auth/code: a project page's code is checked against the project's own address", async () => {
  const email = fresh("project");
  const quoteId = crypto.randomUUID();
  await requireDb().from("quote_requests").insert(quoteRow({ id: quoteId, customer_name: "DEMO Sam", email, source: "web", survey: DEMO_SURVEY, quote: generateQuote(DEMO_SURVEY) }));
  const created = await createProjectForQuote(quoteId);
  assert.ok("id" in created);
  const sent = await magic.issueMagicLink({ email, kind: "customer", next: `/p/${created.id}` });
  const wrongProject = await post({ projectId: crypto.randomUUID(), code: sent.devCode });
  assert.equal(wrongProject.status, 400, "another project's address isn't this one");
  const res = await post({ projectId: created.id, code: sent.devCode });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { next: string }).next, `/p/${created.id}`);
});

test("/auth/code: cross-site posts and non-JSON bodies are refused before anything is checked", async () => {
  const email = fresh("csrf");
  await customer(email);
  const sent = await magic.issueMagicLink({ email, kind: "customer" });
  assert.equal((await post({ email, code: sent.devCode }, { origin: "https://evil.example" })).status, 403);
  assert.equal((await post({ email, code: sent.devCode }, { origin: "null" })).status, 403);
  assert.equal((await post(`{"email":"${email}","code":"${sent.devCode}"}`, { type: "text/plain" })).status, 415, "a form can't post JSON");
  assert.equal((await post({ email, code: sent.devCode, extra: 1 })).status, 400);
  // Still unspent: none of those touched it.
  assert.equal((await post({ email, code: sent.devCode })).status, 200);
});

test("/auth/code: five wrong tries for an address and the sixth is refused, even with the right code", async () => {
  const email = fresh("brake");
  await customer(email);
  const sent = await magic.issueMagicLink({ email, kind: "customer" });
  const wrong = String((Number(sent.devCode) + 7) % 1_000_000).padStart(6, "0");
  for (let i = 0; i < 5; i++) {
    const r = await post({ email, code: wrong });
    assert.equal(r.status, 400, `try ${i + 1}`);
    assert.match(((await r.json()) as { error: string }).error, /didn't work/);
  }
  const blocked = await post({ email, code: sent.devCode });
  assert.equal(blocked.status, 429, "the address is resting, whichever network asks");
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  assert.ok(await magic.consumeToken(tokenOf(sent.devLink!)), "and the link in the email still works");
});

test("/auth/code: one network trying many addresses is slowed too", async () => {
  const ip = "192.0.2.77";
  const statuses: number[] = [];
  for (let i = 0; i < 11; i++) statuses.push((await post({ email: fresh(`spray${i}`), code: "000000" }, { ip })).status);
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(400));
  assert.equal(statuses[10], 429);
});

test("an unknown address gets the same answer as a wrong code", async () => {
  const r = await post({ email: fresh("nobody"), code: "123456" });
  assert.equal(r.status, 400);
  assert.match(((await r.json()) as { error: string }).error, /didn't work/);
});
