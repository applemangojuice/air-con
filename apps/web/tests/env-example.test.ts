import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * apps/web/.env.example is the founder's list of every setting: complete
 * (every variable the code reads is in it), grouped (the eight go-live ones
 * first, demo and developer switches never live), and blank. guards.test.ts
 * checks no value ships in it.
 */

const WEB = new URL("../", import.meta.url).pathname;
const text = readFileSync(join(WEB, ".env.example"), "utf8");
const SKIP = new Set(["node_modules", ".next", "tests", ".data", "public"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx|mjs|js)$/.test(name) ? [path] : [];
  });
}

/** Every variable name the code reads: process.env.X, env.X, realEnv(env, "X"), has("X"), process.env["X"]. */
function readByCode(): Map<string, string> {
  const found = new Map<string, string>();
  const patterns = [
    /process\.env\.([A-Z][A-Z0-9_]+)/g,
    /\benv\.([A-Z][A-Z0-9_]+)\b/g,
    /\b(?:realEnv\(\s*[\w.]+\s*,|has\(|placeholder\()\s*"([A-Z][A-Z0-9_]+)"/g,
    /process\.env\[\s*"([A-Z][A-Z0-9_]+)"\s*\]/g,
  ];
  for (const file of walk(WEB)) {
    const src = readFileSync(file, "utf8");
    for (const re of patterns) for (const m of src.matchAll(re)) if (!found.has(m[1]!)) found.set(m[1]!, file.slice(WEB.length));
  }
  return found;
}

/** The text of one numbered or named section, up to the next banner. */
function section(title: string): string {
  const start = text.indexOf(`# ${title}`);
  assert.ok(start >= 0, `a "${title}" section`);
  const next = text.indexOf("# =====", text.indexOf("\n", text.indexOf("# =====", start + 1) + 1));
  return text.slice(start, next < 0 ? undefined : next);
}

const listed = (block: string) => [...block.matchAll(/^#? ?([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]!);
const live = (block: string) => [...block.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]!);

test("every variable the web app reads is in .env.example", () => {
  const read = readByCode();
  assert.ok(read.size > 20, "found the code's variables");
  const named = new Set(listed(text));
  const automatic = ["NODE_ENV", "NEXT_RUNTIME"]; // set by Next.js and Vercel
  for (const k of automatic) assert.match(text, new RegExp(`never set these:.*\\b${k}\\b`));
  const missing = [...read].filter(([k]) => !named.has(k) && !automatic.includes(k)).map(([k, f]) => `${k} (${f})`);
  assert.deepEqual(missing, []);
});

test("the eight go-live variables come first, ready to fill in", () => {
  assert.deepEqual(live(section("1. REQUIRED FOR GO-LIVE")).sort(), [
    "ADMIN_EMAILS",
    "CRON_SECRET",
    "EMAIL_FROM",
    "NEXT_PUBLIC_APP_URL",
    "RESEND_API_KEY",
    "SESSION_SECRET",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_URL",
  ]);
  assert.match(section("1. REQUIRED FOR GO-LIVE"), /openssl rand -hex 32/, "how to make SESSION_SECRET");
});

test("demo and developer switches are listed but commented out, so pasting the file can't turn them on", () => {
  const never = section("3. NEVER ON THE LIVE SITE");
  assert.deepEqual(listed(never).sort(), ["ALLOW_DEMO_LOGIN", "DATA_BACKEND", "DEMO_DEPLOYMENT", "LOCAL_DATA_DIR", "LOCAL_MAX_ROWS"]);
  assert.deepEqual(live(never), [], "none of them uncommented");
  const scripts = section("SCRIPTS AND TESTS ONLY");
  assert.deepEqual(live(scripts), [], "script-only variables are commented out too");
  for (const k of ["ALLOW_DEMO_LOGIN", "DEMO_DEPLOYMENT", "DATA_BACKEND", "LOCAL_DATA_DIR"]) {
    assert.doesNotMatch(text, new RegExp(`^${k}=`, "m"), `${k} never appears uncommented`);
  }
});

test("the optional group holds the providers", () => {
  const optional = live(section("2. OPTIONAL"));
  for (const k of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM", "GETADDRESS_API_KEY", "LEADS_NOTIFY_EMAIL", "OPS_PASSWORD"]) {
    assert.ok(optional.includes(k), k);
  }
  // The Stripe webhook needs every event the handler records from, or refunds and disputes go unseen.
  for (const e of ["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "charge.refunded", "charge.refund.updated", "charge.dispute.created", "charge.dispute.closed"]) {
    assert.ok(text.includes(e), e);
  }
});
