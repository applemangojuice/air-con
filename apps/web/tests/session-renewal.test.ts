import { test } from "node:test";
import assert from "node:assert/strict";
import { registerAppResolver } from "./helpers/resolve-app.ts";

/**
 * Rolling staff sessions (§K45): renewed once more than half the life has
 * passed, 30 days at a time, never past 90 days from the sign-in; never for
 * a deactivated person, a break-glass session, a customer or a cookie from
 * before renewals. The pure rules, then the real /auth/renew route on the
 * in-memory backend. DEMO people only.
 */
process.env.DATA_BACKEND = "memory";
delete process.env.SUPABASE_URL;
registerAppResolver();
const S = await import("../lib/auth/session.ts");
const route = await import("../app/auth/renew/route.ts");
const staffRepo = await import("../lib/repo/staff.ts");
const { NextRequest } = await import("next/server");

const DAY = 86_400;
const T0 = Math.floor(Date.UTC(2026, 9, 1, 9) / 1000);
const base = {
  kind: "staff" as const,
  staffId: "de300000-0000-4000-8000-0000000000aa",
  email: "demo.renew@demo.dang.invalid",
  name: "DEMO Renew",
  roles: ["installer" as const],
  external: false,
};
const fresh = (signedIn: number, iat = signedIn) => ({ ...base, iat, auth: signedIn, exp: iat + S.SESSION_TTL_SECONDS });
const at = (seconds: number) => seconds * 1000;

test("not before half the life; then 30 more days from now, the sign-in time kept", () => {
  const s = fresh(T0);
  assert.equal(S.renewableFrom(s), T0 + 15 * DAY);
  assert.equal(S.renewedSession(s, at(T0 + 14 * DAY)), null, "day 14: not yet");
  const r = S.renewedSession(s, at(T0 + 16 * DAY));
  assert.ok(r);
  assert.equal(r.iat, T0 + 16 * DAY);
  assert.equal(r.exp, T0 + 46 * DAY);
  assert.equal(r.auth, T0, "the sign-in time never moves");
  assert.equal(r.staffId, s.staffId);
});

test("never past 90 days from the sign-in, however it's used", () => {
  let s: import("../lib/auth/session.ts").StaffSession | null = fresh(T0);
  let now = T0;
  const exps: number[] = [];
  for (let i = 0; i < 10 && s; i++) {
    now = S.renewableFrom(s) ?? now;
    const r = S.renewedSession(s, at(now + 60));
    if (!r) break;
    exps.push(r.exp);
    s = r;
  }
  assert.equal(Math.max(...exps), T0 + 90 * DAY, "capped at the 90th day");
  assert.equal(S.renewableFrom(s!), null, "at the cap, nothing more");
  assert.equal(S.renewedSession(s!, at(T0 + 89 * DAY)), null);
  assert.equal(S.sessionHardEnd(fresh(T0)), T0 + 90 * DAY);
});

test("break-glass, customer and pre-renewal cookies never renew", () => {
  const breakGlass = { ...base, iat: T0, auth: T0, exp: T0 + 12 * 3600 };
  assert.equal(S.renewableFrom(breakGlass), null, "12-hour emergencies stay 12 hours");
  assert.equal(S.renewedSession(breakGlass, at(T0 + 11 * 3600)), null);
  const legacy = { ...base, exp: T0 + 30 * DAY };
  assert.equal(S.renewableFrom(legacy), null);
  assert.equal(S.renewedSession(legacy, at(T0 + 29 * DAY)), null);
  assert.equal(S.sessionHardEnd(legacy), legacy.exp);
  const customer = { kind: "customer" as const, customerId: "c1", email: "c@example.test", name: "", projectIds: [], iat: T0, auth: T0, exp: T0 + 30 * DAY };
  assert.equal(S.renewableFrom(customer), null);
});

test("the cookie carries iat and auth through signing; an old cookie without them reads as before", async () => {
  const secret = "renew-test-secret-0123456789-0123456789";
  const s = fresh(T0);
  assert.deepEqual(await S.verifySession(await S.signSession(s, secret), { secret, nowMs: at(T0 + DAY) }), s);
  const legacy = { ...base, exp: T0 + 30 * DAY };
  assert.deepEqual(await S.verifySession(await S.signSession(legacy, secret), { secret, nowMs: at(T0 + DAY) }), legacy);
  const half = { ...base, exp: T0 + 30 * DAY, iat: T0 } as unknown as typeof s;
  const read = await S.verifySession(await S.signSession(half, secret), { secret, nowMs: at(T0 + DAY) });
  assert.equal(read && "iat" in read, false, "one without the other is ignored: no renewal");
});

/* ------------------------------------------------------------------ */
/* The route                                                           */
/* ------------------------------------------------------------------ */

async function staffRow(active = true) {
  return staffRepo.insert(
    { email: `renew.${crypto.randomUUID().slice(0, 8)}@demo.dang.invalid`, name: "DEMO Renew", roles: ["installer"], external: false, active, qualifications: [] },
    null,
  );
}

async function post(cookie: string | null, origin = "http://localhost:3000") {
  return route.POST(
    new NextRequest("http://localhost:3000/auth/renew", {
      method: "POST",
      headers: { origin, ...(cookie ? { cookie: `${S.SESSION_COOKIE}=${cookie}` } : {}) },
    }),
  );
}

const now = () => Math.floor(Date.now() / 1000);
const sessionFor = (staff: { id: string; email: string; name: string }, ageDays: number) => {
  const signedIn = now() - ageDays * DAY;
  return { ...base, staffId: staff.id, email: staff.email, name: staff.name, iat: signedIn, auth: signedIn, exp: signedIn + S.SESSION_TTL_SECONDS };
};

test("/auth/renew: an active staff member past half-life gets a fresh 30 days, same sign-in time", async () => {
  const staff = await staffRow();
  const s = sessionFor(staff, 16);
  const res = await post(await S.signSession(s));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { renewed: boolean; exp: number; hardEnd: number };
  assert.equal(body.renewed, true);
  assert.ok(Math.abs(body.exp - (now() + S.SESSION_TTL_SECONDS)) < 5);
  assert.equal(body.hardEnd, s.auth + S.SESSION_MAX_SECONDS);
  const cookie = res.cookies.get(S.SESSION_COOKIE);
  assert.ok(cookie?.value);
  assert.equal(cookie.httpOnly, true);
  assert.ok(Math.abs((cookie.maxAge ?? 0) - S.SESSION_TTL_SECONDS) < 5);
  const renewed = await S.verifySession(cookie.value);
  assert.equal(renewed?.kind === "staff" && renewed.auth, s.auth);
  assert.equal(renewed?.kind === "staff" && renewed.staffId, staff.id);
});

test("/auth/renew: a deactivated staff member is refused at once, and nothing is renewed", async () => {
  const staff = await staffRow();
  const cookie = await S.signSession(sessionFor(staff, 20));
  await staffRepo.update({ ...staff, active: false }, null);
  const res = await post(cookie);
  assert.equal(res.status, 401);
  assert.equal(res.cookies.get(S.SESSION_COOKIE), undefined);
});

test("/auth/renew: not due yet, a stranger's site, no cookie or a forged one: nothing renewed", async () => {
  const staff = await staffRow();
  const early = await post(await S.signSession(sessionFor(staff, 2)));
  assert.equal(early.status, 200);
  assert.equal(((await early.json()) as { renewed: boolean }).renewed, false);
  assert.equal(early.cookies.get(S.SESSION_COOKIE), undefined);

  const due = await S.signSession(sessionFor(staff, 20));
  assert.equal((await post(due, "https://evil.example")).status, 403);
  assert.equal((await post(null)).status, 401);
  assert.equal((await post(`${due.slice(0, -2)}00`)).status, 401, "a bad signature");
  const otherSecret = await S.signSession(sessionFor(staff, 20), "someone-elses-secret-0123456789-0123456789");
  assert.equal((await post(otherSecret)).status, 401, "a rotated secret revokes, and renewal can't undo it");
});

test("/auth/renew: a break-glass session stays 12 hours", async () => {
  const staff = await staffRow();
  const t = now() - 7 * 3600;
  const res = await post(await S.signSession({ ...base, staffId: staff.id, email: staff.email, iat: t, auth: t, exp: t + 12 * 3600 }));
  assert.equal(((await res.json()) as { renewed: boolean }).renewed, false);
  assert.equal(res.cookies.get(S.SESSION_COOKIE), undefined);
});
