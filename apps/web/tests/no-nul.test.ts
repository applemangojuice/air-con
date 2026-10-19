import { test } from "node:test";
import assert from "node:assert/strict";
import { createLocalClient } from "../lib/db/local-client.ts";
import { nulSafe, withoutNul } from "../lib/db/no-nul.ts";
import { quoteRow } from "./helpers/rows.ts";

// Postgres refuses U+0000 in text and jsonb (22P05), so one pasted into the
// quote funnel lost the quote on Supabase. Writes through getServiceClient
// drop it; the bare local backend refuses it, as Postgres does.

test("withoutNul cleans strings, keys and nested values, and leaves everything else alone", () => {
  assert.equal(withoutNul("1 Demo\u0000 Street"), "1 Demo Street");
  assert.deepEqual(withoutNul({ "a\u0000": ["x\u0000y", 3, null, true], nested: { note: "\u0000" } }), { a: ["xy", 3, null, true], nested: { note: "" } });
  const when = new Date("2026-10-19T10:00:00Z");
  assert.equal(withoutNul(when), when);
  assert.equal(withoutNul(7), 7);
});

test("the wrapped client stores what the bare one refuses", async () => {
  const bare = createLocalClient({ backend: "memory" });
  const refused = await bare.from("quote_requests").insert(quoteRow({ address_line: "1 Demo\u0000 Street" }));
  assert.equal(refused.error?.code, "22P05", "the local backend refuses NUL like Postgres");

  const db = nulSafe(bare);
  const row = quoteRow({ address_line: "1 Demo\u0000 Street", survey: { note: "a\u0000b" } });
  const saved = await db.from("quote_requests").insert(row).select("address_line, survey").single();
  assert.equal(saved.error, null);
  assert.deepEqual(saved.data, { address_line: "1 Demo Street", survey: { note: "ab" } });
  const patched = await db.from("quote_requests").update({ customer_name: "Sam\u0000" }).eq("id", row.id).select("customer_name").single();
  assert.equal(patched.data?.customer_name, "Sam");
  const upserted = await db.from("settings").upsert({ key: "k", value: { v: "\u0000x" } }, { onConflict: "key" }).select("value").single();
  assert.deepEqual(upserted.data?.value, { v: "x" });
  // Reads, storage and everything else pass straight through.
  assert.equal((await db.from("quote_requests").select("id", { count: "exact", head: true })).count, 1);
  assert.ok(db.storage);
});
