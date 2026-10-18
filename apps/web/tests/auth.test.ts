import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SESSION_TTL_SECONDS,
  base64urlDecode,
  base64urlEncode,
  constantTimeEqual,
  hmacSha256Hex,
  sessionCookieOptions,
  sessionExpiry,
  MIN_SESSION_SECRET_LENGTH,
  sessionSecret,
  sessionSecretUsable,
  signSession,
  verifySession,
  type CustomerSession,
  type StaffSession,
} from "../lib/auth/session.ts";

const SECRET = "test-secret-not-real";
const NOW = Date.UTC(2026, 9, 18, 12, 0, 0);
const nowSeconds = Math.floor(NOW / 1000);

/** DEMO identities only: fictional people, reserved .invalid addresses. */
const staff: StaffSession = {
  kind: "staff",
  staffId: "de300000-0000-4000-8000-000000000003",
  email: "demo.techlead@demo.dang.invalid",
  name: "DEMO Tess Ó'Brien", // non-ASCII on purpose: names must survive the round trip
  roles: ["tech-lead"],
  external: false,
  exp: nowSeconds + 3600,
};

const customer: CustomerSession = {
  kind: "customer",
  customerId: "c0000000-0000-4000-8000-000000000001",
  email: "demo.customer@demo.dang.invalid",
  name: "DEMO Alex",
  projectIds: ["p0000000-0000-4000-8000-000000000001"],
  exp: nowSeconds + 3600,
};

const verify = (token: string | null | undefined, opts: { secret?: string | null; nowMs?: number } = {}) =>
  verifySession(token, { secret: SECRET, nowMs: NOW, ...opts });

/** Swap one character for another valid one in the same alphabet. */
function flip(s: string, i: number, alphabet: string): string {
  const c = s[i]!;
  const replacement = alphabet[(alphabet.indexOf(c) + 1) % alphabet.length]!;
  return s.slice(0, i) + replacement + s.slice(i + 1);
}

test("sign → verify round-trips staff and customer sessions exactly", async () => {
  assert.deepEqual(await verify(await signSession(staff, SECRET)), staff);
  assert.deepEqual(await verify(await signSession(customer, SECRET)), customer);
});

test("token format: base64url(payload).hex(hmac-sha256)", async () => {
  const token = await signSession(staff, SECRET);
  const [payload, sig, ...rest] = token.split(".");
  assert.equal(rest.length, 0);
  assert.match(payload!, /^[A-Za-z0-9_-]+$/, "base64url, no padding");
  assert.match(sig!, /^[0-9a-f]{64}$/, "SHA-256 hex");
  assert.deepEqual(JSON.parse(new TextDecoder().decode(base64urlDecode(payload!))), staff);
});

test("tampering with the payload or the signature is rejected", async () => {
  const token = await signSession(staff, SECRET);
  const dot = token.indexOf(".");
  const b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  for (const i of [0, 5, dot - 1]) {
    assert.equal(await verify(flip(token, i, b64)), null, `payload char ${i}`);
  }
  for (const i of [dot + 1, token.length - 1]) {
    assert.equal(await verify(flip(token, i, "0123456789abcdef")), null, `signature char ${i}`);
  }

  // Re-signing a promoted payload without the secret: still rejected.
  const promoted = base64urlEncode(JSON.stringify({ ...staff, roles: ["admin"] }));
  assert.equal(await verify(`${promoted}${token.slice(dot)}`), null);
});

test("a different secret, or no secret, verifies nothing", async () => {
  const token = await signSession(staff, SECRET);
  assert.equal(await verify(token, { secret: "another-secret" }), null);
  assert.equal(await verify(token, { secret: null }), null);
});

test("expiry: valid until exp, rejected from exp on", async () => {
  const token = await signSession(staff, SECRET);
  assert.ok(await verify(token, { nowMs: (staff.exp - 1) * 1000 }));
  assert.equal(await verify(token, { nowMs: staff.exp * 1000 }), null);
  assert.equal(await verify(token, { nowMs: (staff.exp + 86_400) * 1000 }), null);
});

test("malformed tokens are rejected, never thrown on", async () => {
  for (const bad of [undefined, null, "", "abc", ".", "abc.", ".abc", "a.b.c", "x".repeat(9000)]) {
    assert.equal(await verify(bad), null, String(bad).slice(0, 20));
  }
  // Correctly signed, but not a session.
  for (const payload of [{ kind: "staff" }, { ...staff, exp: "never" }, { ...customer, projectIds: "all" }, [1, 2], "hi"]) {
    const b64 = base64urlEncode(JSON.stringify(payload));
    assert.equal(await verify(`${b64}.${await hmacSha256Hex(SECRET, b64)}`), null, JSON.stringify(payload));
  }
  // Signed garbage that isn't JSON.
  const notJson = base64urlEncode("{not json");
  assert.equal(await verify(`${notJson}.${await hmacSha256Hex(SECRET, notJson)}`), null);
});

test("base64url: URL-safe alphabet, no padding, round-trips bytes and unicode", () => {
  const bytes = new Uint8Array([0xfb, 0xff, 0xbf, 0x00, 0x3e, 0x3f]);
  const encoded = base64urlEncode(bytes);
  assert.doesNotMatch(encoded, /[+/=]/);
  assert.deepEqual(base64urlDecode(encoded), bytes);
  for (const s of ["", "a", "ab", "abc", "Dang, It's Hot", "Zoë · £150 ☃"]) {
    assert.equal(new TextDecoder().decode(base64urlDecode(base64urlEncode(s))), s);
  }
  assert.throws(() => base64urlDecode("ab+c"));
  assert.throws(() => base64urlDecode("ab/c"));
});

test("constantTimeEqual compares exactly", () => {
  assert.equal(constantTimeEqual("abc", "abc"), true);
  assert.equal(constantTimeEqual("abc", "abd"), false);
  assert.equal(constantTimeEqual("abc", "ab"), false);
  assert.equal(constantTimeEqual("", ""), true);
});

test("secrets: SESSION_SECRET wins, dev falls back, production refuses to sign", async () => {
  const strong = "0123456789abcdef".repeat(4); // openssl rand -hex 32 → 64 characters
  assert.equal(sessionSecret({ SESSION_SECRET: strong, NODE_ENV: "production" }), strong);
  assert.equal(sessionSecret({ NODE_ENV: "production" }), null);
  assert.ok(sessionSecret({ NODE_ENV: "development" }), "dev fallback");
  await assert.rejects(signSession(staff, null), /SESSION_SECRET/);
});

test("secrets: production treats a short SESSION_SECRET as unset", async () => {
  assert.equal(MIN_SESSION_SECRET_LENGTH, 32);
  const prod = (secret: string) => ({ SESSION_SECRET: secret, NODE_ENV: "production" });
  assert.equal(sessionSecret(prod("configured")), null);
  assert.equal(sessionSecret(prod("x".repeat(31))), null);
  assert.equal(sessionSecret(prod("x".repeat(32))), "x".repeat(32));
  assert.equal(sessionSecretUsable(prod("short")), false);
  assert.equal(sessionSecretUsable(prod("x".repeat(32))), true);
  assert.equal(sessionSecretUsable({ NODE_ENV: "production" }), false);
  // Outside production any secret works (tests and dev use short ones).
  assert.equal(sessionSecret({ SESSION_SECRET: "configured", NODE_ENV: "development" }), "configured");
  assert.equal(sessionSecretUsable({ SESSION_SECRET: "configured", NODE_ENV: "test" }), true);
  // Nothing signed with a weak secret is trusted in production.
  const token = await signSession(staff, "short");
  assert.equal(await verifySession(token, { secret: sessionSecret(prod("short")), nowMs: NOW }), null);
});

test("expiry defaults to 30 days; cookie is httpOnly, Lax, Secure in production", () => {
  assert.equal(SESSION_TTL_SECONDS, 30 * 24 * 60 * 60);
  assert.equal(sessionExpiry(NOW), nowSeconds + SESSION_TTL_SECONDS);
  assert.equal(sessionExpiry(NOW, 60), nowSeconds + 60);
  const prod = sessionCookieOptions({ NODE_ENV: "production" });
  assert.equal(prod.httpOnly, true);
  assert.equal(prod.sameSite, "lax");
  assert.equal(prod.secure, true);
  assert.equal(prod.path, "/");
  assert.equal(sessionCookieOptions({ NODE_ENV: "development" }).secure, false);
});
