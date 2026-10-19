import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalClient, localBackendOf } from "../lib/db/local-client.ts";
import { compareValues } from "../lib/db/local-filters.ts";
import { cleanObjectPath, verifyStorageSignature } from "../lib/db/local-storage.ts";

const memory = () => createLocalClient({ backend: "memory" });

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "local-db-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** DEMO rows only: fictional people, fictional streets. */
async function seedQuotes() {
  const db = memory();
  const { error } = await db.from("quote_requests").insert([
    { customer_name: "DEMO Ada", email: "ada@example.test", status: "new", total_gbp: 4200, created_at: "2026-10-01T09:00:00.000Z", next_action_at: null },
    { customer_name: "DEMO Bo", email: "bo@example.test", status: "draft", total_gbp: 3100, created_at: "2026-10-02T09:00:00.000Z", next_action_at: "2026-10-20T09:00:00Z" },
    { customer_name: "DEMO Cy", email: "cy@example.test", status: "booked", total_gbp: 6900, created_at: "2026-10-03T09:00:00.000Z", next_action_at: "2026-10-18T09:00:00Z" },
    { customer_name: null, email: "dee@example.test", status: null, total_gbp: 5000, created_at: "2026-10-04T09:00:00.000Z", next_action_at: null },
  ]);
  assert.equal(error, null);
  return db;
}

test("filters: eq, neq (never NULL), in, is, not, comparisons, like, match, or, filter", async () => {
  const db = await seedQuotes();
  const names = async (q: PromiseLike<{ data: unknown }>) =>
    ((await q).data as { email: string }[]).map((r) => r.email.split("@")[0]);

  assert.deepEqual(await names(db.from("quote_requests").select("email").eq("status", "new")), ["ada"]);
  // SQL: NULL <> 'draft' is unknown, so dee's NULL status is excluded.
  assert.deepEqual(await names(db.from("quote_requests").select("email").neq("status", "draft")), ["ada", "cy"]);
  assert.deepEqual(await names(db.from("quote_requests").select("email").in("status", ["new", "booked"])), ["ada", "cy"]);
  assert.deepEqual(await names(db.from("quote_requests").select("email").in("status", [])), []);
  assert.deepEqual(await names(db.from("quote_requests").select("email").is("next_action_at", null)), ["ada", "dee"]);
  assert.deepEqual(await names(db.from("quote_requests").select("email").not("next_action_at", "is", null)), ["bo", "cy"]);
  assert.deepEqual(await names(db.from("quote_requests").select("email").gt("total_gbp", 4200)), ["cy", "dee"]);
  assert.deepEqual(await names(db.from("quote_requests").select("email").gte("total_gbp", 4200).lt("total_gbp", 6000)), ["ada", "dee"]);
  // Timestamps compare as instants, whatever the ISO spelling.
  assert.deepEqual(await names(db.from("quote_requests").select("email").lte("next_action_at", "2026-10-18T23:59:59Z")), ["cy"]);
  assert.deepEqual(await names(db.from("quote_requests").select("email").gte("created_at", "2026-10-03")), ["cy", "dee"]);
  assert.deepEqual(await names(db.from("quote_requests").select("email").like("customer_name", "DEMO %o")), ["bo"]);
  assert.deepEqual(await names(db.from("quote_requests").select("email").ilike("customer_name", "demo a%")), ["ada"]);
  assert.deepEqual(await names(db.from("quote_requests").select("email").match({ status: "booked", total_gbp: 6900 })), ["cy"]);
  assert.deepEqual(await names(db.from("quote_requests").select("email").or("status.eq.draft,total_gbp.gte.6000")), ["bo", "cy"]);
  assert.deepEqual(
    await names(db.from("quote_requests").select("email").or("status.is.null,and(status.eq.new,total_gbp.lt.5000)")),
    ["ada", "dee"],
  );
  assert.deepEqual(await names(db.from("quote_requests").select("email").not("status", "in", "(new,draft)")), ["cy"]);
  assert.deepEqual(await names(db.from("quote_requests").select("email").filter("status", "in", "(draft,booked)")), ["bo", "cy"]);

  const bad = await db.from("quote_requests").select("email").or("status.nearly.new");
  assert.equal(bad.error?.code, "PGRST100");
});

test("comparisons cast like Postgres: instants, numbers, booleans, uuids", () => {
  // Same instant, different spellings: string order would get all of these wrong.
  assert.equal(compareValues("2026-10-20T09:00:00Z", "2026-10-20T09:00:00.000Z"), 0);
  assert.equal(compareValues("2026-10-03T00:30:00+01:00", "2026-10-03"), -1, "23:30Z the day before");
  assert.equal(compareValues("2026-10-03T00:30:00+0100", "2026-10-02T23:30:00Z"), 0);
  assert.equal(compareValues("2026-10-03 10:00:00+00", "2026-10-03T10:00:00Z"), 0);
  assert.equal(compareValues("2026-10-03T10:00:00", "2026-10-03T10:00:00Z"), 0, "zoneless is UTC");
  assert.equal(compareValues("2026-10-03", "2026-10-03T00:00:00Z"), 0);
  assert.equal(compareValues(10, "9"), 1, "numbers compare numerically");
  assert.equal(compareValues(true, "false"), 1);
  assert.equal(compareValues("0E4AC76D-67C2-480F-9BFF-390CC0CA32FA", "0e4ac76d-67c2-480f-9bff-390cc0ca32fa"), 0);
  assert.equal(compareValues(null, "x"), null, "NULL compares as unknown");
});

test("filters on arrays and JSON paths", async () => {
  const db = memory();
  await db.from("staff").insert([
    { email: "a@example.test", roles: ["installer", "fgas"], qualifications: { fgas: { expires: "2027-01-01" } } },
    { email: "b@example.test", roles: ["surveyor"], qualifications: {} },
  ]);
  const cs = await db.from("staff").select("email").contains("roles", ["fgas"]);
  assert.deepEqual(cs.data, [{ email: "a@example.test" }]);
  const ov = await db.from("staff").select("email").overlaps("roles", ["surveyor", "admin"]);
  assert.deepEqual(ov.data, [{ email: "b@example.test" }]);
  const json = await db.from("staff").select("email, expires:qualifications->fgas->>expires").eq("qualifications->fgas->>expires", "2027-01-01");
  assert.deepEqual(json.data, [{ email: "a@example.test", expires: "2027-01-01" }]);
});

test("order (nulls last ascending, first descending), multi-key, limit and range", async () => {
  const db = await seedQuotes();
  const emails = (data: unknown) => (data as { email: string }[]).map((r) => r.email.split("@")[0]);

  const asc = await db.from("quote_requests").select("email").order("next_action_at");
  assert.deepEqual(emails(asc.data), ["cy", "bo", "ada", "dee"]);
  const desc = await db.from("quote_requests").select("email").order("next_action_at", { ascending: false });
  assert.deepEqual(emails(desc.data), ["ada", "dee", "bo", "cy"]);
  const nullsLast = await db
    .from("quote_requests")
    .select("email")
    .order("next_action_at", { ascending: false, nullsFirst: false })
    .order("total_gbp", { ascending: false });
  assert.deepEqual(emails(nullsLast.data), ["bo", "cy", "dee", "ada"]);

  const limited = await db.from("quote_requests").select("email").order("total_gbp").limit(2);
  assert.deepEqual(emails(limited.data), ["bo", "ada"]);
  const page = await db.from("quote_requests").select("email").order("total_gbp").range(1, 2);
  assert.deepEqual(emails(page.data), ["ada", "dee"]);
  const pastEnd = await db.from("quote_requests").select("email").range(10, 19);
  assert.deepEqual(pastEnd.data, []);
});

test("single and maybeSingle follow PostgREST errors", async () => {
  const db = await seedQuotes();

  const one = await db.from("quote_requests").select("email").eq("status", "new").single();
  assert.deepEqual(one.data, { email: "ada@example.test" });
  assert.equal(one.error, null);

  const none = await db.from("quote_requests").select("email").eq("status", "gone").single();
  assert.equal(none.data, null);
  assert.equal(none.error?.code, "PGRST116");
  assert.equal(none.status, 406);
  assert.match(none.error?.details ?? "", /0 rows/);

  const many = await db.from("quote_requests").select("email").not("status", "is", null).single();
  assert.equal(many.error?.code, "PGRST116");
  assert.match(many.error?.details ?? "", /3 rows/);

  const maybeNone = await db.from("quote_requests").select("email").eq("status", "gone").maybeSingle();
  assert.equal(maybeNone.data, null);
  assert.equal(maybeNone.error, null);

  const maybeMany = await db.from("quote_requests").select("email").maybeSingle();
  assert.equal(maybeMany.error?.code, "PGRST116");
});

test("projection: listed keys only, * for all, missing columns read as null", async () => {
  const db = await seedQuotes();
  const listed = await db.from("quote_requests").select("email, total_gbp, phone").eq("status", "new").single();
  assert.deepEqual(listed.data, { email: "ada@example.test", total_gbp: 4200, phone: null });

  const all = await db.from("quote_requests").select("*").eq("status", "new").single();
  const row = all.data as Record<string, unknown>;
  assert.equal(row.customer_name, "DEMO Ada");
  assert.ok(typeof row.id === "string");

  const embed = await db.from("quote_requests").select("id, projects(id)");
  assert.equal(embed.error?.code, "PGRST200");
});

test("count exact: head returns only the count; without head it counts before paging", async () => {
  const db = await seedQuotes();
  const head = await db.from("quote_requests").select("*", { count: "exact", head: true }).in("status", ["new", "draft"]);
  assert.equal(head.error, null);
  assert.equal(head.count, 2);
  assert.equal(head.data as unknown, null, "head: true returns no rows");

  const paged = await db.from("quote_requests").select("email", { count: "exact" }).order("total_gbp").range(0, 0);
  assert.equal(paged.count, 4);
  assert.equal((paged.data as unknown[]).length, 1);

  const empty = await db.from("never_written").select("*", { count: "exact", head: true });
  assert.equal(empty.count, 0);
});

test("insert: defaults, no data without select, rows with select", async () => {
  const db = memory();
  const bare = await db.from("quote_requests").insert({ email: "e@example.test", total_gbp: 1 });
  assert.equal(bare.error, null);
  assert.equal(bare.data, null);
  assert.equal(bare.status, 201);

  const { data, error } = await db
    .from("quote_requests")
    .insert({ email: "f@example.test", total_gbp: 2, booking: undefined, at: new Date("2026-10-18T10:00:00Z") })
    .select("id, status, source, created_at, updated_at, at, booking")
    .single();
  assert.equal(error, null);
  const row = data as Record<string, unknown>;
  assert.match(String(row.id), /^[0-9a-f-]{36}$/);
  assert.equal(row.status, "new", "SQL default for quote_requests.status");
  assert.equal(row.source, "web");
  assert.ok(!Number.isNaN(Date.parse(String(row.created_at))));
  assert.equal(row.updated_at, null, "quote_requests has no updated_at column");
  assert.equal(row.at, "2026-10-18T10:00:00.000Z", "Dates travel as ISO strings, like JSON over HTTP");
  assert.equal(row.booking, null);

  const staff = await db.from("staff").insert({ email: "g@example.test" }).select().single();
  const s = staff.data as Record<string, unknown>;
  assert.ok(s.created_at && s.updated_at, "house tables get both stamps");

  const settings = await db.from("settings").insert({ key: "company", value: { name: "DEMO Co" } }).select().single();
  assert.equal((settings.data as Record<string, unknown>).id, undefined, "settings is keyed by key, no id");
});

test("update with filters and select; refuses an unfiltered update", async () => {
  const db = await seedQuotes();
  const res = await db
    .from("quote_requests")
    .update({ status: "reviewed" })
    .in("status", ["new", "draft"])
    .select("email, status");
  assert.equal(res.error, null);
  assert.deepEqual(
    (res.data as { email: string; status: string }[]).map((r) => r.status),
    ["reviewed", "reviewed"],
  );

  const silent = await db.from("quote_requests").update({ status: "x" }).eq("status", "nobody");
  assert.equal(silent.error, null);
  assert.equal(silent.data, null);
  assert.equal(silent.status, 204);

  const claimed = await db.from("quote_requests").update({ status: "x" }).eq("status", "nobody").select("id");
  assert.deepEqual(claimed.data, []);

  const unfiltered = await db.from("quote_requests").update({ status: "x" });
  assert.equal(unfiltered.error?.code, "21000");
  const after = await db.from("quote_requests").select("*", { count: "exact", head: true }).eq("status", "x");
  assert.equal(after.count, 0);
});

test("returned rows are copies: mutating them never touches the store", async () => {
  const db = memory();
  await db.from("properties").insert({ id: "addr-1", intel: { marketing: { campaign: null } } });
  const first = await db.from("properties").select("intel").eq("id", "addr-1").single();
  (first.data as { intel: { marketing: { campaign: string } } }).intel.marketing.campaign = "mutated";
  const again = await db.from("properties").select("intel").eq("id", "addr-1").single();
  assert.equal((again.data as { intel: { marketing: { campaign: unknown } } }).intel.marketing.campaign, null);
});

test("upsert: merges on the conflict target, keeps id and created_at, honours ignoreDuplicates", async () => {
  const db = memory();
  const first = await db
    .from("compliance_items")
    .upsert({ project_id: "p1", key: "dno", status: "todo" }, { onConflict: "project_id,key" })
    .select()
    .single();
  const original = first.data as Record<string, unknown>;

  const second = await db
    .from("compliance_items")
    .upsert({ project_id: "p1", key: "dno", status: "done" }, { onConflict: "project_id,key" })
    .select()
    .single();
  const merged = second.data as Record<string, unknown>;
  assert.equal(merged.id, original.id);
  assert.equal(merged.created_at, original.created_at);
  assert.equal(merged.status, "done");

  const ignored = await db
    .from("compliance_items")
    .upsert({ project_id: "p1", key: "dno", status: "ignored" }, { onConflict: "project_id,key", ignoreDuplicates: true })
    .select();
  assert.deepEqual(ignored.data, []);
  const count = await db.from("compliance_items").select("*", { count: "exact", head: true });
  assert.equal(count.count, 1);

  // Default target is the primary key.
  await db.from("properties").upsert([{ id: "addr-1", priority_score: 10 }, { id: "addr-2", priority_score: 20 }]);
  await db.from("properties").upsert({ id: "addr-1", priority_score: 99 });
  const rows = await db.from("properties").select("id, priority_score, priority_band").order("id");
  assert.deepEqual(rows.data, [
    { id: "addr-1", priority_score: 99, priority_band: "low" },
    { id: "addr-2", priority_score: 20, priority_band: "low" },
  ]);

  const twice = await db.from("properties").upsert([{ id: "addr-3" }, { id: "addr-3" }]);
  assert.equal(twice.error?.code, "21000");
});

test("unique constraints produce 23505 and leave the table untouched", async () => {
  const db = memory();
  await db.from("projects").insert({ quote_id: "q1", customer_name: "DEMO" });
  const dup = await db.from("projects").insert({ quote_id: "q1", customer_name: "DEMO again" }).select("id").single();
  assert.equal(dup.error?.code, "23505");
  assert.equal(dup.status, 409);
  assert.match(dup.error?.message ?? "", /projects_quote_id_key/);
  assert.match(dup.error?.details ?? "", /\(quote_id\)=\(q1\)/);

  // A bulk insert is all-or-nothing.
  const batch = await db.from("messages").insert([
    { idempotency_key: "k1" },
    { idempotency_key: "k2" },
    { idempotency_key: "k1" },
  ]);
  assert.equal(batch.error?.code, "23505");
  const messages = await db.from("messages").select("*", { count: "exact", head: true });
  assert.equal(messages.count, 0);

  // Composite keys, and NULLs never collide.
  await db.from("designs").insert([{ project_id: "p1", version: 1 }, { project_id: "p1", version: 2 }]);
  const v1Again = await db.from("designs").insert({ project_id: "p1", version: 1 });
  assert.equal(v1Again.error?.code, "23505");
  const nulls = await db.from("payments").insert([{ provider_ref: null }, { provider_ref: null }]);
  assert.equal(nulls.error, null);

  // Primary keys too, and via update.
  const { data } = await db.from("staff").insert({ email: "a@example.test" }).select("id").single();
  const pk = await db.from("staff").insert({ id: (data as { id: string }).id, email: "b@example.test" });
  assert.equal(pk.error?.code, "23505");
  await db.from("staff").insert({ email: "c@example.test" });
  const clash = await db.from("staff").update({ email: "a@example.test" }).eq("email", "c@example.test");
  assert.equal(clash.error?.code, "23505");
});

test("delete with filters returns removed rows; unfiltered delete is refused", async () => {
  const db = await seedQuotes();
  const res = await db.from("quote_requests").delete().eq("status", "draft").select("email");
  assert.deepEqual(res.data, [{ email: "bo@example.test" }]);
  const left = await db.from("quote_requests").select("*", { count: "exact", head: true });
  assert.equal(left.count, 3);
  const all = await db.from("quote_requests").delete();
  assert.equal(all.error?.code, "21000");
});

test("accepted proposals are immutable except for superseding", async () => {
  const db = memory();
  const record = { options: [{ id: "standard", totalPence: 450_000 }] };
  await db.from("proposals").insert({ id: "pr1", project_id: "p1", version: 1, status: "accepted", record });

  const edit = await db
    .from("proposals")
    .update({ record: { options: [{ id: "standard", totalPence: 1 }] } })
    .eq("id", "pr1");
  assert.equal(edit.error?.code, "P0001");

  const sneaky = await db
    .from("proposals")
    .update({ status: "superseded", record: { options: [] } })
    .eq("id", "pr1");
  assert.equal(sneaky.error?.code, "P0001");

  const supersede = await db.from("proposals").update({ status: "superseded", record }).eq("id", "pr1");
  assert.equal(supersede.error, null);
});

test("the accepted-proposal guard matches the SQL trigger, field for field", async () => {
  const db = memory();
  const acceptance = { optionId: "standard", totalPence: 450_000, name: "DEMO Sam", at: "2026-10-27T18:00:00.000Z" };
  const record = { options: [{ id: "standard", totalPence: 450_000 }], acceptance };
  const acceptedAt = "2026-10-27T18:00:00.000Z";
  const fresh = async (id: string) => {
    await db.from("proposals").insert({ id, project_id: "p1", version: Number(id.slice(2)), status: "accepted", record, accepted_at: acceptedAt });
  };
  const refused = async (id: string, patch: Record<string, unknown>, why: string) => {
    const res = await db.from("proposals").update(patch).eq("id", id);
    assert.equal(res.error?.code, "P0001", why);
  };

  // Superseding may not touch what was agreed, or where and when it was agreed.
  await fresh("pr1");
  await refused("pr1", { status: "superseded", record: { ...record, acceptance: { ...acceptance, totalPence: 1 } } }, "acceptance");
  await refused("pr1", { status: "superseded", record: { options: record.options } }, "acceptance dropped");
  await refused("pr1", { status: "superseded", record, project_id: "p2" }, "project_id");
  await refused("pr1", { status: "superseded", record, version: 9 }, "version");
  await refused("pr1", { status: "superseded", record, accepted_at: "2026-10-28T09:00:00.000Z" }, "accepted_at");
  await refused("pr1", { status: "declined", record }, "any status but superseded");
  // Bookkeeping in the record is fine, and the same instant written another way is the same instant.
  const ok = await db
    .from("proposals")
    .update({ status: "superseded", record: { ...record, supersededBy: "pr2" }, accepted_at: "2026-10-27T18:00:00+00:00" })
    .eq("id", "pr1");
  assert.equal(ok.error, null);

  // Accepted, then superseded: still frozen.
  await refused("pr1", { record: { ...record, options: [] } }, "options of a superseded acceptance");
  await refused("pr1", { status: "draft" }, "un-superseding");
  await refused("pr1", { record: { options: record.options } }, "dropping the acceptance after superseding");
  const restated = await db.from("proposals").update({ status: "superseded", record: { ...record, supersededBy: "pr3" } }).eq("id", "pr1");
  assert.equal(restated.error, null, "re-stating it superseded, agreement untouched");

  // A superseded draft that was never accepted is ordinary data.
  await db.from("proposals").insert({ id: "pd1", project_id: "p1", version: 7, status: "superseded", record: { options: [] } });
  const free = await db.from("proposals").update({ status: "draft", record: { options: [{ id: "x" }] } }).eq("id", "pd1");
  assert.equal(free.error, null);
});

test("surveys: one row per (project, version), so a double-tapped start can't make two drafts", async () => {
  const db = memory();
  const first = await db.from("surveys").insert({ project_id: "p1", version: 1, status: "draft", data: {} });
  assert.equal(first.error, null);
  const twin = await db.from("surveys").insert({ project_id: "p1", version: 1, status: "draft", data: {} });
  assert.equal(twin.error?.code, "23505");
  const next = await db.from("surveys").insert({ project_id: "p1", version: 2, status: "draft", data: {} });
  assert.equal(next.error, null);
  const other = await db.from("surveys").insert({ project_id: "p2", version: 1, status: "draft", data: {} });
  assert.equal(other.error, null);
});

test("throwOnError throws the PostgREST error", async () => {
  const db = memory();
  await assert.rejects(
    async () => {
      await db.from("x").select("id").eq("id", "nope").single().throwOnError();
    },
    (err: { code?: string }) => err.code === "PGRST116",
  );
});

test("file backend persists across client instances and picks up outside edits", async () => {
  await withTempDir(async (dir) => {
    const a = createLocalClient({ backend: "file", dataDir: dir });
    await Promise.all(
      Array.from({ length: 25 }, (_, i) => a.from("ops_notes").insert({ quote_id: "q1", note: `DEMO note ${i}` })),
    );
    const onDisk = JSON.parse(await readFile(join(dir, "ops_notes.json"), "utf8")) as unknown[];
    assert.equal(onDisk.length, 25, "concurrent writes are serialised, none lost");

    const b = createLocalClient({ backend: "file", dataDir: dir });
    const read = await b.from("ops_notes").select("note, author", { count: "exact" }).eq("note", "DEMO note 7").single();
    assert.deepEqual(read.data, { note: "DEMO note 7", author: "ops" });

    // An edit made outside the process (another server, a seed script) is seen.
    await new Promise((r) => setTimeout(r, 15));
    await writeFile(join(dir, "ops_notes.json"), JSON.stringify([{ id: "n1", quote_id: "q2", note: "hand edit" }]));
    const fresh = await a.from("ops_notes").select("note");
    assert.deepEqual(fresh.data, [{ note: "hand edit" }]);

    const badName = await a.from("../escape").select("*");
    assert.equal(badName.error?.code, "42P01");
  });
});

test("storage: signed upload then signed read round trip, with tamper and expiry rejection", async () => {
  await withTempDir(async (dir) => {
    let clock = new Date("2026-10-18T10:00:00Z");
    const db = createLocalClient({ backend: "file", dataDir: dir, secret: "test-secret", now: () => clock });
    const local = localBackendOf(db);
    assert.ok(local, "localBackendOf finds the local client");
    assert.equal(localBackendOf({}), null);

    const bucket = db.storage.from("project-media");
    const up = await bucket.createSignedUploadUrl("p1/wall photo.jpg");
    assert.equal(up.error, null);
    const { signedUrl, path, token } = up.data!;
    assert.equal(path, "p1/wall photo.jpg");
    assert.ok(token);
    assert.ok(signedUrl.startsWith("/api/local-files/project-media/p1/wall%20photo.jpg?op=put&exp="), signedUrl);

    // What the route does with the browser's PUT.
    const putUrl = new URL(signedUrl, "http://localhost");
    const putPath = decodeURIComponent(putUrl.pathname).replace("/api/local-files/project-media/", "");
    const q = putUrl.searchParams;
    assert.equal(local.files.verify(q.get("op")!, "project-media", putPath, q.get("exp"), q.get("sig")), "ok");
    assert.equal(local.files.verify("get", "project-media", putPath, q.get("exp"), q.get("sig")), "invalid", "op is signed");
    assert.equal(local.files.verify("put", "project-media", "p1/other.jpg", q.get("exp"), q.get("sig")), "invalid", "path is signed");
    assert.equal(local.files.verify("put", "survey-photos", putPath, q.get("exp"), q.get("sig")), "invalid", "bucket is signed");
    assert.equal(local.files.verify("put", "project-media", putPath, String(Number(q.get("exp")) + 60), q.get("sig")), "invalid", "exp is signed");
    const flipped = q.get("sig")!.replace(/^./, (c) => (c === "a" ? "b" : "a"));
    assert.equal(local.files.verify("put", "project-media", putPath, q.get("exp"), flipped), "invalid");

    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    assert.equal(await local.files.write("project-media", putPath, jpeg, "image/jpeg", false), "created");
    assert.equal(await local.files.write("project-media", putPath, jpeg, "image/jpeg", false), "exists", "put never overwrites");

    const read = await bucket.createSignedUrl(path, 3600);
    assert.equal(read.error, null);
    const getUrl = new URL(read.data!.signedUrl, "http://localhost");
    const g = getUrl.searchParams;
    assert.equal(g.get("op"), "get");
    assert.equal(local.files.verify("get", "project-media", path, g.get("exp"), g.get("sig")), "ok");
    const served = await local.files.read("project-media", path);
    assert.deepEqual(served?.bytes, jpeg);
    assert.equal(served?.meta.contentType, "image/jpeg");

    clock = new Date(clock.getTime() + 3601_000);
    assert.equal(local.files.verify("get", "project-media", path, g.get("exp"), g.get("sig")), "expired");

    const blob = await bucket.download(path);
    assert.equal(blob.data?.type, "image/jpeg");
    assert.deepEqual(new Uint8Array(await blob.data!.arrayBuffer()), jpeg);

    const many = await bucket.createSignedUrls([path, "p1/missing.jpg"], 60);
    assert.equal(many.data?.[0].error, null);
    assert.ok(many.data?.[0].signedUrl);
    assert.equal(many.data?.[1].signedUrl, null);
    assert.ok(many.data?.[1].error);
    assert.equal((await bucket.createSignedUrl("p1/missing.jpg", 60)).error?.message, "Object not found");

    // The signature is an independent HMAC over op|bucket|path|exp.
    assert.equal(verifyStorageSignature("other-secret", "get", "project-media", path, g.get("exp"), g.get("sig"), 0), "invalid");
  });
});

test("storage: upload, list, remove, path traversal and unknown buckets", async () => {
  await withTempDir(async (dir) => {
    // "scratch" has no rules (lib/storage-buckets.ts), so it takes any type, like a Supabase bucket without limits.
    const db = createLocalClient({ backend: "file", dataDir: dir, buckets: ["project-media", "scratch"] });
    const bucket = db.storage.from("scratch");
    assert.match((await db.storage.from("project-media").upload("p1/a.txt", "hello", { contentType: "text/plain" })).error?.message ?? "", /not supported/, "a bucket with a type list refuses the rest");

    const up = await bucket.upload("p1/a.txt", "hello", { contentType: "text/plain" });
    assert.deepEqual(up.data && { path: up.data.path, fullPath: up.data.fullPath }, { path: "p1/a.txt", fullPath: "scratch/p1/a.txt" });
    assert.equal((await bucket.upload("p1/a.txt", "again")).error?.message, "The resource already exists");
    assert.equal((await bucket.upload("p1/a.txt", "again", { upsert: true })).error, null);
    await bucket.upload("p1/sub/b.png", new Blob([new Uint8Array([1, 2])], { type: "image/png" }));

    const listed = await bucket.list("p1");
    assert.deepEqual(listed.data?.map((e) => e.name), ["a.txt", "sub"]);
    assert.equal(listed.data?.[0].metadata?.size, 5);
    assert.equal(listed.data?.[1].id, null, "folders have no id");

    const removed = await bucket.remove(["p1/sub/b.png", "p1/never.png"]);
    assert.deepEqual(removed.data?.map((r) => r.name), ["p1/sub/b.png"]);
    assert.deepEqual((await bucket.list("p1")).data?.map((e) => e.name), ["a.txt"], "empty folders are pruned");

    for (const evil of ["../outside.txt", "p1/../../outside.txt", "p1/./x", "a\\b", ""]) {
      assert.equal(cleanObjectPath(evil), null, evil);
      assert.ok((await bucket.upload(evil, "x")).error, `upload refused: ${evil}`);
      assert.ok((await bucket.createSignedUploadUrl(evil)).error, `signing refused: ${evil}`);
    }
    assert.equal(cleanObjectPath("/p1//a.txt/"), "p1/a.txt", "slashes collapse like supabase-js");

    const nope = await db.storage.from("not-a-bucket").upload("x.txt", "x");
    assert.equal(nope.error?.message, "Bucket not found");
    assert.equal((await db.storage.getBucket("project-media")).error, null);
    assert.ok((await db.storage.getBucket("not-a-bucket")).error);
  });
});

test("memory storage round trip", async () => {
  const db = memory();
  const bucket = db.storage.from("survey-photos");
  await bucket.upload("q1/photo.jpg", new Uint8Array([9, 9]), { contentType: "image/jpeg" });
  const blob = await bucket.download("q1/photo.jpg");
  assert.deepEqual(new Uint8Array(await blob.data!.arrayBuffer()), new Uint8Array([9, 9]));
  assert.deepEqual((await bucket.list("q1")).data?.map((e) => e.name), ["photo.jpg"]);
});

test("getServiceClient: Supabase first, then local (file in dev), else demo mode", async () => {
  const { dataBackend, getServiceClient, requireDb } = await import("../lib/supabase-server.ts");
  const keys = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DATA_BACKEND", "NODE_ENV", "LOCAL_DATA_DIR", "SESSION_SECRET"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const env = process.env as Record<string, string | undefined>;
  const set = (vars: Record<string, string | undefined>) => {
    for (const k of keys) delete env[k];
    Object.assign(env, vars);
  };
  try {
    await withTempDir(async (dir) => {
      set({ SUPABASE_URL: "https://demo.supabase.test", SUPABASE_SERVICE_ROLE_KEY: "k", DATA_BACKEND: "file" });
      assert.equal(dataBackend(), "supabase");
      assert.equal(localBackendOf(getServiceClient()), null);

      set({ NODE_ENV: "development", LOCAL_DATA_DIR: dir, SESSION_SECRET: "s" });
      assert.equal(dataBackend(), "file");
      const a = getServiceClient();
      assert.equal(a, getServiceClient(), "one local client per process");
      assert.equal(localBackendOf(a)?.dataDir, dir);

      set({ NODE_ENV: "production", DATA_BACKEND: "memory", SESSION_SECRET: "s" });
      assert.equal(dataBackend(), "memory");
      assert.equal(localBackendOf(getServiceClient())?.kind, "memory");

      set({ NODE_ENV: "production" });
      assert.equal(dataBackend(), "none");
      assert.equal(getServiceClient(), null);
      assert.throws(() => requireDb(), /No database/);

      set({ NODE_ENV: "development", DATA_BACKEND: "none" });
      assert.equal(dataBackend(), "none", "DATA_BACKEND=none forces demo mode in dev");
    });
  } finally {
    set(Object.fromEntries(Object.entries(saved).filter(([, v]) => v !== undefined)));
  }
});

test("jsonb columns come back in Postgres jsonb key order (shortest key first, then bytes), like PostgREST", async () => {
  const db = memory();
  const record = { label: "Good", id: "v1", tier: "good", systems: [{ roomIds: ["r1"], outdoorItemId: "o1" }], bom: [], verdict: { ok: true, at: "x" } };
  const inserted = await db.from("designs").insert({ project_id: "p1", version: 1, record }).select("record").single();
  assert.equal(inserted.error, null);
  const read = await db.from("designs").select("*").eq("project_id", "p1").single();
  for (const got of [inserted.data, read.data] as { record: Record<string, unknown> }[]) {
    assert.deepEqual(Object.keys(got.record), ["id", "bom", "tier", "label", "systems", "verdict"]);
    assert.deepEqual(Object.keys((got.record.systems as Record<string, unknown>[])[0]), ["roomIds", "outdoorItemId"]);
    assert.deepEqual(Object.keys(got.record.verdict as Record<string, unknown>), ["at", "ok"]);
    // Same content, so an order-insensitive comparison still matches.
    assert.deepEqual(got.record, record);
    assert.notEqual(JSON.stringify(got.record), JSON.stringify(record));
  }
  // Callers get copies: changing what came back never changes the store.
  (read.data as { record: { label: string } }).record.label = "changed";
  const again = await db.from("designs").select("record").eq("project_id", "p1").single();
  assert.equal((again.data as { record: { label: string } }).record.label, "Good");
});
