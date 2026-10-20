import { test } from "node:test";
import assert from "node:assert/strict";
import { registerAppResolver } from "./helpers/resolve-app.ts";

registerAppResolver();
const { EMAIL_TIMEOUT_MS, sendEmail, sendEmailResult } = await import("../lib/email.ts");

/**
 * The one place email leaves from (lib/email.ts): Resend gets 10 seconds,
 * like Twilio, and no answer in time is a failed send the outbox retries,
 * never a request left hanging. DEMO addresses only.
 */

const ENV = { RESEND_API_KEY: "re_demo_fictional_key_for_tests_only", EMAIL_FROM: "DEMO <hello@demo.dang.invalid>" };

async function withEnv(fn: () => Promise<void>): Promise<void> {
  const before = { RESEND_API_KEY: process.env.RESEND_API_KEY, EMAIL_FROM: process.env.EMAIL_FROM };
  Object.assign(process.env, ENV);
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function withFetch(impl: (url: string, init: RequestInit) => Promise<Response>, fn: (calls: RequestInit[]) => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  const calls: RequestInit[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push(init ?? {});
    return impl(String(url), init ?? {});
  }) as typeof fetch;
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

/** A Resend that never answers: the request only ends when its signal aborts. */
const hangs = (_url: string, init: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init.signal;
    // AbortSignal.timeout's timer doesn't hold the process open; this stands in for the open socket that would.
    const socket = setTimeout(() => reject(new Error("no timeout: the request hung")), 5_000);
    if (!signal) return; // no timeout: hangs until the stand-in gives up (the bug this guards)
    signal.addEventListener("abort", () => {
      clearTimeout(socket);
      reject(signal.reason ?? new DOMException("aborted", "AbortError"));
    });
  });

test("sendEmail gives Resend 10 seconds: every request carries a timeout", async () => {
  assert.equal(EMAIL_TIMEOUT_MS, 10_000);
  await withEnv(() =>
    withFetch(
      async () => new Response(JSON.stringify({ id: "re_msg_demo_1" }), { status: 200 }),
      async (calls) => {
        assert.deepEqual(await sendEmailResult("demo.family@example.com", "DEMO", "<p>DEMO</p>"), { ok: true, providerRef: "re_msg_demo_1" });
        assert.equal(await sendEmail("demo.family@example.com", "DEMO", "<p>DEMO</p>"), true);
        assert.equal(calls.length, 2);
        for (const c of calls) assert.ok(c.signal instanceof AbortSignal, "the request can be cut off");
      },
    ),
  );
});

test("no answer in time is a failed send that says so (the outbox retries it), never a hung request", async () => {
  await withEnv(() =>
    withFetch(hangs, async () => {
      const started = Date.now();
      const res = await sendEmailResult("demo.family@example.com", "DEMO", "<p>DEMO</p>", { timeoutMs: 50 });
      assert.equal(res.ok, false);
      assert.match(res.error ?? "", /didn't answer within/);
      assert.ok(Date.now() - started < 5_000, "it gave up on the timeout");
    }),
  );
});

test("a refusal or an unreachable Resend is a failed send with the reason", async () => {
  await withEnv(() =>
    withFetch(
      async () => new Response(JSON.stringify({ message: "The to field is invalid" }), { status: 422 }),
      async () => {
        const res = await sendEmailResult("not-an-address", "DEMO", "<p>DEMO</p>");
        assert.deepEqual(res, { ok: false, error: "Resend didn't accept the message: The to field is invalid (HTTP 422)" });
      },
    ),
  );
  await withEnv(() =>
    withFetch(
      async () => {
        throw new TypeError("fetch failed");
      },
      async () => {
        assert.deepEqual(await sendEmailResult("demo.family@example.com", "DEMO", "<p>DEMO</p>"), { ok: false, error: "Resend unreachable: fetch failed" });
      },
    ),
  );
});
