import { test } from "node:test";
import assert from "node:assert/strict";
import { QUOTE_OWNER_TTL_SECONDS, readQuoteOwner, signQuoteOwner } from "../lib/auth/quote-owner.ts";
import { signSession } from "../lib/auth/session.ts";

const SECRET = "test-secret-0123456789abcdef0123456789";
const A = "11111111-2222-4333-8444-555555555555";
const B = "22222222-2222-4333-8444-555555555555";

test("quote-owner cookie: round trip, newest first, no duplicates", async () => {
  const one = await signQuoteOwner(A, [], { secret: SECRET });
  assert.ok(one);
  assert.deepEqual(await readQuoteOwner(one, { secret: SECRET }), [A]);
  const two = await signQuoteOwner(B, [A], { secret: SECRET });
  assert.deepEqual(await readQuoteOwner(two, { secret: SECRET }), [B, A]);
  const again = await signQuoteOwner(A, [B, A], { secret: SECRET });
  assert.deepEqual(await readQuoteOwner(again, { secret: SECRET }), [A, B]);
});

test("quote-owner cookie: refuses tampering, another secret, expiry and a session cookie", async () => {
  const now = Date.UTC(2026, 9, 18);
  const value = (await signQuoteOwner(A, [], { secret: SECRET, nowMs: now }))!;
  assert.deepEqual(await readQuoteOwner(value, { secret: "another-secret-0123456789abcdef01234" }), []);
  const [payload, sig] = value.split(".");
  assert.deepEqual(await readQuoteOwner(`${payload}x.${sig}`, { secret: SECRET }), []);
  assert.deepEqual(await readQuoteOwner(value, { secret: SECRET, nowMs: now + (QUOTE_OWNER_TTL_SECONDS + 1) * 1000 }), []);
  assert.deepEqual(await readQuoteOwner(value, { secret: null }), [], "no secret, no grant");
  const session = await signSession(
    { kind: "customer", customerId: "c", email: "x@example.com", name: "", projectIds: [], exp: Math.floor(now / 1000) + 60 },
    SECRET,
  );
  assert.deepEqual(await readQuoteOwner(session, { secret: SECRET, nowMs: now }), [], "a session can't pass as a quote grant");
  assert.equal(await signQuoteOwner(A, [], { secret: null }), null);
});
