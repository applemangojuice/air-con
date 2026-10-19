import { test } from "node:test";
import assert from "node:assert/strict";
import { registerAppResolver } from "./helpers/resolve-app.ts";

/**
 * Demo sign-in and the demo seed never reach real data (lib/auth/demo-guard,
 * contract §C): the env flags are a claim, and on a Supabase database the
 * guard checks it against what's stored. The decision is pure (access.ts);
 * the look at the database runs here on the in-memory backend, with only
 * fictional DEMO data and made-up addresses.
 */

process.env.DATA_BACKEND = "memory";
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
registerAppResolver();
const { countRealRecords, demoModeAllowed, resetDemoGuardCache, CUSTOMER_SAMPLE } = await import("../lib/auth/demo-guard.ts");
const { demoAllowedWithData, describeRealRecords } = await import("../lib/auth/access.ts");
const { requireDb } = await import("../lib/supabase-server.ts");
const { resetDemoData } = await import("../lib/demo-seed/index.ts");
const { DEMO_STAFF } = await import("../lib/auth/demo-staff.ts");
const staffRepo = await import("../lib/repo/staff.ts");

const NOW = "2026-10-18T10:00:00.000Z";
const NONE = { quotes: 0, customers: 0, staff: 0 };
const PROD_DEMO = { NODE_ENV: "production", ALLOW_DEMO_LOGIN: "1", DEMO_DEPLOYMENT: "1", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" };

test("on Supabase, demo needs the flags and a database with nothing real in it", () => {
  assert.equal(demoAllowedWithData(PROD_DEMO, "supabase", NONE), true, "a demo deployment's own demo database");
  assert.equal(demoAllowedWithData(PROD_DEMO, "supabase", { ...NONE, quotes: 1 }), false, "a real quote");
  assert.equal(demoAllowedWithData(PROD_DEMO, "supabase", { ...NONE, customers: 1 }), false, "a real customer");
  assert.equal(demoAllowedWithData(PROD_DEMO, "supabase", { ...NONE, staff: 1 }), false, "a real team member");
  assert.equal(demoAllowedWithData(PROD_DEMO, "supabase", null), false, "a database that couldn't be asked");

  // ALLOW_DEMO_LOGIN=1 on the live business, without DEMO_DEPLOYMENT: refused before anything is asked.
  const { DEMO_DEPLOYMENT: _, ...live } = PROD_DEMO;
  assert.equal(demoAllowedWithData(live, "supabase", NONE), false);
  assert.equal(demoAllowedWithData({ ...live, ALLOW_DEMO_LOGIN: undefined }, "supabase", NONE), false);

  // A laptop's dev server pointed at the live database: development, but real records.
  const laptop = { NODE_ENV: "development", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" };
  assert.equal(demoAllowedWithData(laptop, "supabase", { ...NONE, customers: 3 }), false);
  assert.equal(demoAllowedWithData(laptop, "supabase", NONE), true);

  // The file and memory backends are a developer's own machine or a throwaway demo: the flags decide.
  assert.equal(demoAllowedWithData({ NODE_ENV: "development" }, "file", null), true);
  assert.equal(demoAllowedWithData({ NODE_ENV: "production", ALLOW_DEMO_LOGIN: "1" }, "memory", null), true);
  assert.equal(demoAllowedWithData({ NODE_ENV: "production" }, "memory", NONE), false);
});

test("describeRealRecords names what was found, in plain words", () => {
  assert.equal(describeRealRecords(NONE), "");
  assert.equal(describeRealRecords({ ...NONE, quotes: 2 }), "real quotes");
  assert.equal(describeRealRecords({ quotes: 1, customers: 1, staff: 1 }), "real quotes, customers and team members");
});

test("the demo seed and the DEMO team never count as real", async () => {
  const db = requireDb();
  assert.deepEqual(await countRealRecords(db), NONE, "an empty database");
  await resetDemoData({ now: NOW });
  for (const s of Object.values(DEMO_STAFF)) {
    if (!(await staffRepo.get(s.id))) await staffRepo.insert(s, null);
  }
  const quotes = await db.from("quote_requests").select("id");
  assert.ok((quotes.data ?? []).length > 0, "the seed wrote its quotes");
  assert.deepEqual(await countRealRecords(db), NONE, "DEMO quotes, example.com customers and DEMO staff only");
});

test("one real quote, customer or team member is enough", async () => {
  const db = requireDb();
  const quote = await db.from("quote_requests").insert({ source: "web", customer_name: "Made-up Person", postcode: "SW16 1AA" }).select().single();
  assert.equal(quote.error, null);
  assert.deepEqual(await countRealRecords(db), { ...NONE, quotes: 1 });
  await db.from("quote_requests").delete().eq("id", (quote.data as { id: string }).id);

  // A made-up address on an ordinary domain: what a real household's would look like.
  const customer = await db.from("customers").insert({ email: "first.household@pilot-home.co.uk", name: "Made-up Household" }).select().single();
  assert.equal(customer.error, null);
  assert.deepEqual(await countRealRecords(db), { ...NONE, customers: 1 });
  await db.from("customers").delete().eq("id", (customer.data as { id: string }).id);

  const member = await staffRepo.insert(
    { id: crypto.randomUUID(), email: "fitter@pilot-home.co.uk", name: "Made-up Fitter", roles: ["installer"], external: false, active: true, qualifications: [] },
    null,
  );
  assert.deepEqual(await countRealRecords(db), { ...NONE, staff: 1 });
  await db.from("staff").delete().eq("id", member.id);

  assert.deepEqual(await countRealRecords(db), NONE, "back to demo only");
});

test("a database too full of customers to check counts as real", async () => {
  const db = requireDb();
  const rows = Array.from({ length: CUSTOMER_SAMPLE }, (_, i) => ({ email: `demo.extra.${i}@example.com`, name: `DEMO Extra ${i}` }));
  assert.equal((await db.from("customers").insert(rows)).error, null);
  assert.equal((await countRealRecords(db)).customers, 1, "a full page of DEMO addresses could hide a real one past it");
  await db.from("customers").delete().like("email", "demo.extra.%");
});

test("demoModeAllowed: the flags decide on the local backends; nothing is asked without them", async () => {
  const env = process.env as Record<string, string | undefined>;
  const before = { NODE_ENV: env.NODE_ENV, ALLOW_DEMO_LOGIN: env.ALLOW_DEMO_LOGIN };
  try {
    resetDemoGuardCache();
    env.NODE_ENV = "production";
    delete env.ALLOW_DEMO_LOGIN;
    assert.equal(await demoModeAllowed(), false, "production without ALLOW_DEMO_LOGIN");
    env.ALLOW_DEMO_LOGIN = "1";
    assert.equal(await demoModeAllowed(), true, "a throwaway demo on the memory backend");
    env.NODE_ENV = "development";
    delete env.ALLOW_DEMO_LOGIN;
    assert.equal(await demoModeAllowed(), true, "a developer's own machine");
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  }
});

test("demoModeAllowed: a Supabase database that can't be asked is a no, even with every flag on", async () => {
  const env = process.env as Record<string, string | undefined>;
  const before = { NODE_ENV: env.NODE_ENV, ALLOW_DEMO_LOGIN: env.ALLOW_DEMO_LOGIN, DEMO_DEPLOYMENT: env.DEMO_DEPLOYMENT };
  const errors = console.error;
  try {
    console.error = () => {};
    resetDemoGuardCache();
    Object.assign(env, { NODE_ENV: "production", ALLOW_DEMO_LOGIN: "1", DEMO_DEPLOYMENT: "1" });
    // A name that never resolves (.invalid is reserved): the check fails, and fails closed.
    env.SUPABASE_URL = "https://demo-guard.supabase.invalid";
    env.SUPABASE_SERVICE_ROLE_KEY = "not-a-key";
    assert.equal(await demoModeAllowed(), false);
    env.NODE_ENV = "development";
    assert.equal(await demoModeAllowed(), false, "development is no exception once a Supabase database is connected");
  } finally {
    console.error = errors;
    resetDemoGuardCache();
    delete env.SUPABASE_URL;
    delete env.SUPABASE_SERVICE_ROLE_KEY;
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  }
});
