import { test } from "node:test";
import assert from "node:assert/strict";
import { createProject, generateQuote, instantiateCompliance, type Survey } from "@aircon/domain";
import { registerAppResolver } from "./helpers/resolve-app.ts";

// Supabase's Max Rows: a select returns at most 1000 rows and says nothing
// about the rest. The local backend enforces the same cap (here a tiny one,
// LOCAL_MAX_ROWS=7, so a few DEMO rows show it), and the board's batched
// reads page past it instead of silently losing compliance items.
process.env.DATA_BACKEND = "memory";
process.env.LOCAL_MAX_ROWS = "7";
delete process.env.SUPABASE_URL;
registerAppResolver();
const { createLocalClient } = await import("../lib/db/local-client.ts");
const { db, selectAllPages } = await import("../lib/repo/base.ts");
const { loadAllProjects, loadProjectRecords } = await import("../lib/ops-core-server.ts");
const complianceRepo = await import("../lib/repo/compliance.ts");

/** Fictional DEMO home. */
const SURVEY: Survey = {
  postcode: "SW16 9ZZ",
  addressLine: "7 Demo Road",
  property: { type: "semi-detached", era: "1930-1950", bedrooms: 3, ownership: "owner" },
  rooms: [{ id: "r1", name: "Main bedroom", type: "bedroom", size: "medium", floor: "first", glazing: "medium", orientation: "south", hasExternalWall: true, photos: [] }],
  outdoor: { location: "ground-rear", photos: [] },
  electrics: { condition: "modern-spare-ways", photos: [] },
};

const projectId = (n: number) => `0000000${n}`.slice(-8) + "-de5e-4000-8000-00000000abcd";

test("the local backend cuts a select off at its Max Rows, like Supabase, and range pages past it", async () => {
  const local = createLocalClient({ backend: "memory", maxRows: 3 });
  await local.from("ops_notes").insert(Array.from({ length: 8 }, (_, i) => ({ quote_id: "q", note: `DEMO note ${i}` })));
  const all = await local.from("ops_notes").select("note");
  assert.equal(all.data?.length, 3, "cut to the cap, without an error");
  assert.equal(all.error, null);
  const big = await local.from("ops_notes").select("note").limit(100);
  assert.equal(big.data?.length, 3, "a bigger limit doesn't lift the cap");
  const counted = await local.from("ops_notes").select("*", { count: "exact", head: true });
  assert.equal(counted.count, 8, "counts aren't capped");
  // Asking for bigger pages than the server's cap still gets everything: it pages by what came back.
  const calls: number[] = [];
  const paged = await selectAllPages(
    (from, to, count) => {
      calls.push(from);
      return local.from("ops_notes").select("note", count ? { count: "exact" } : undefined).order("note").range(from, to) as unknown as PromiseLike<{ data: unknown[] | null; error: null; count?: number | null }>;
    },
    "notes",
  );
  assert.equal(paged.length, 8, "every row, a page at a time");
  assert.deepEqual(calls, [0, 3, 6]);
  // Under the cap it's one request, as before.
  calls.length = 0;
  const few = await selectAllPages(
    (from, to, count) => {
      calls.push(from);
      return local.from("ops_notes").select("note", count ? { count: "exact" } : undefined).eq("note", "DEMO note 1").order("note").range(from, to) as unknown as PromiseLike<{ data: unknown[] | null; error: null; count?: number | null }>;
    },
    "notes",
  );
  assert.equal(few.length, 1);
  assert.deepEqual(calls, [0]);
});

test("the board's batched reads get every compliance item, past the row cap", async () => {
  const ids = [1, 2, 3].map(projectId);
  const items = ids.flatMap((id) => instantiateCompliance(id, () => crypto.randomUUID()));
  assert.ok(items.length > 7 * 3, "more rows than the cap");
  for (const item of items) await db().from("compliance_items").insert(complianceRepo.toRow(item));
  const direct = await db().from("compliance_items").select("id");
  assert.equal(direct.data?.length, 7, "an unpaged read would have stopped at the cap");

  const records = await loadProjectRecords(ids);
  for (const id of ids) {
    assert.equal(records.compliance.get(id)?.length, items.filter((i) => i.projectId === id).length, `all of ${id}'s items`);
  }
});

test("loadAllProjects pages past the cap, and still stops at its own limit", async () => {
  for (let n = 10; n < 30; n++) {
    const id = projectId(n);
    const p = createProject({
      id,
      quoteId: id.replace("de5e", "0000"),
      createdAt: "2026-10-01T09:00:00.000Z",
      customerName: `DEMO Customer ${n}`,
      customerEmail: `demo${n}@example.test`,
      survey: SURVEY,
      quote: generateQuote(SURVEY),
    });
    await db().from("projects").insert({ id, quote_id: p.quoteId, schema_version: 2, project: p, updated_at: `2026-10-${String(n - 9).padStart(2, "0")}T09:00:00.000Z` });
  }
  const all = await loadAllProjects();
  assert.equal(all.length, 20);
  assert.equal(all[0]!.project.id, projectId(29), "most recently touched first");
  assert.equal((await loadAllProjects(9)).length, 9);
});
