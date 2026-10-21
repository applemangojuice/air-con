import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { registerAppResolver } from "./helpers/resolve-app.ts";

/**
 * The schema checks against a stub PostgREST that behaves like Supabase
 * with migration 0010 never run: unknown tables answer 404 PGRST205 (with an
 * empty body on a HEAD, which postgrest-js reads as "204, no error"), and the
 * columns 0010 adds to `projects` don't exist. Every check must see it.
 */

const MISSING = new Set(["staff", "login_tokens", "customers", "media", "surveys", "designs", "proposals", "catalogue_items", "catalogue_compatibility", "purchase_orders", "compliance_items", "install_jobs", "install_evidence", "issues", "time_entries", "invoices", "payments", "messages", "documents", "learnings", "settings", "audit_log"]);
const PILOT_PROJECT_COLUMNS = ["schema_version", "customer_id", "pilot_number", "owner_staff_id", "next_action", "next_action_at", "value_pence", "blocked"];

/** "denied": every table answers as on a Supabase project that granted nothing (42501 even for the service role). */
let mode: "unmigrated" | "denied" = "unmigrated";

function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://stub");
  if (url.pathname.startsWith("/storage/v1/bucket/")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: url.pathname.split("/").pop(), name: url.pathname.split("/").pop(), public: false }));
    return;
  }
  const table = url.pathname.replace("/rest/v1/", "");
  if (mode === "denied") {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(req.method === "HEAD" ? undefined : JSON.stringify({ code: "42501", message: `permission denied for table ${table}`, details: null, hint: null }));
    return;
  }
  if (table === "bodiless") {
    // A proxy in the way: 404 and nothing else.
    res.writeHead(404);
    res.end();
    return;
  }
  if (MISSING.has(table)) {
    res.writeHead(404, { "content-type": "application/json" });
    // A HEAD gets no body, exactly what fooled the old checks.
    res.end(req.method === "HEAD" ? undefined : JSON.stringify({ code: "PGRST205", message: `Could not find the table 'public.${table}' in the schema cache`, details: null, hint: null }));
    return;
  }
  const select = url.searchParams.get("select") ?? "*";
  if (table === "projects" && PILOT_PROJECT_COLUMNS.some((c) => select.split(",").includes(c))) {
    const col = PILOT_PROJECT_COLUMNS.find((c) => select.split(",").includes(c));
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ code: "42703", message: `column projects.${col} does not exist`, details: null, hint: null }));
    return;
  }
  res.writeHead(200, { "content-type": "application/json", "content-range": "*/3" });
  res.end(req.method === "HEAD" ? undefined : "[]");
}

const server = createServer(handler);
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as AddressInfo).port;
after(() => server.close());

process.env.SUPABASE_URL = `http://127.0.0.1:${port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-service-role-key-for-tests";
delete process.env.DATA_BACKEND;
registerAppResolver();

const { checkPilotSchema, isMissingSchemaError, isPermissionDeniedError, needsUpgrade, probeTable, resetSchemaStatusCache, schemaProblems, staffTableMissing } = await import(
  "../lib/schema-check.ts"
);
const { healthReport } = await import("../lib/health.ts");
const { getServiceClient } = await import("../lib/supabase-server.ts");

test("a GET probe sees a missing table; the old HEAD probe didn't", async () => {
  const client = getServiceClient()!;
  const head = await client.from("staff").select("*", { count: "exact", head: true });
  assert.equal(head.error, null, "the trap: postgrest-js turns an empty-bodied 404 into a 204 with no error");
  const probe = await probeTable(client, "staff", { count: true });
  assert.deepEqual([probe.ok, probe.missing], [false, true]);
  assert.match(probe.error!, /Could not find the table/);
  const present = await probeTable(client, "quote_requests", { count: true });
  assert.deepEqual([present.ok, present.count], [true, 3]);
  // No body at all is no answer: unknown, never "there" (and never "missing" either).
  const bodiless = await probeTable(client, "bodiless");
  assert.deepEqual([bodiless.ok, bodiless.missing], [false, false]);
});

test("checkPilotSchema names every missing table and the missing columns", async () => {
  const s = await checkPilotSchema();
  assert.equal(s.checked, true);
  assert.equal(s.missingTables.length, MISSING.size);
  assert.ok(s.missingColumns.includes("projects.schema_version"));
  assert.ok(s.missingColumns.includes("projects.blocked"));
  assert.deepEqual(s.errors, []);
  resetSchemaStatusCache();
  assert.equal(await staffTableMissing(), true, "break-glass falls back to the synthetic admin");
});

test("healthReport (/api/health, /ops/status): reachable but unhealthy, never 'empty'", async () => {
  const r = await healthReport();
  assert.equal(r.configured, true);
  assert.equal(r.reachable, true, "an unmigrated database isn't an unreachable one");
  assert.equal(r.healthy, false);
  const staff = r.tables.find((t) => t.table === "staff")!;
  assert.deepEqual([staff.ok, staff.missing, staff.count], [false, true, null]);
  const projects = r.tables.find((t) => t.table === "projects")!;
  assert.equal(projects.ok, false);
  assert.match(projects.error!, /pilot columns/);
  assert.ok(r.tables.some((t) => t.table === "purchase_orders"), "every 0010 table is checked, not four of them");
});

test("isMissingSchemaError: missing tables and columns, never a network error", () => {
  assert.equal(isMissingSchemaError({ code: "PGRST205", message: "x" }), true);
  assert.equal(isMissingSchemaError({ code: "42P01", message: "x" }), true);
  assert.equal(isMissingSchemaError({ code: "PGRST204", message: "Could not find the 'blocked' column of 'projects'" }), true);
  assert.equal(isMissingSchemaError({ message: 'relation "public.staff" does not exist' }), true);
  assert.equal(isMissingSchemaError({ message: "TypeError: fetch failed" }), false);
  assert.equal(isMissingSchemaError({ code: "PGRST301", message: "JWT expired" }), false);
  assert.equal(isMissingSchemaError(null), false);
});

test("tables the server's key isn't granted (Supabase's 2026 default): needs the upgrade, never 'fine' or 'unreachable'", async () => {
  mode = "denied";
  try {
    resetSchemaStatusCache();
    const client = getServiceClient()!;
    const probe = await probeTable(client, "staff");
    assert.deepEqual([probe.ok, probe.missing, probe.denied], [false, true, true]);
    assert.match(probe.error!, /isn't allowed to use "staff".*0014/);
    const s = await checkPilotSchema();
    assert.deepEqual(s.missingTables, [], "they're there");
    assert.ok(s.deniedTables.includes("staff") && s.deniedTables.includes("projects"), s.deniedTables.join(", "));
    assert.deepEqual(s.missingColumns, [], "no column is reported missing on a table the key can't read");
    assert.deepEqual(s.errors, []);
    assert.equal(needsUpgrade(s), true);
    assert.ok(schemaProblems(s).includes("staff (there, but not granted to the server's key)"));
    assert.equal(await staffTableMissing(), true, "break-glass falls back to the synthetic admin, so /ops/status opens");
    const r = await healthReport();
    assert.equal(r.reachable, true, "a database without grants isn't an unreachable one");
    assert.equal(r.healthy, false);
    assert.equal(r.tables.find((t) => t.table === "staff")!.missing, true);
  } finally {
    mode = "unmigrated";
    resetSchemaStatusCache();
  }
});

test("isPermissionDeniedError: 42501 and Postgres's words, nothing else", () => {
  assert.equal(isPermissionDeniedError({ code: "42501", message: "permission denied for table staff" }), true);
  assert.equal(isPermissionDeniedError({ message: "permission denied for table quote_requests" }), true);
  assert.equal(isPermissionDeniedError({ code: "PGRST205", message: "Could not find the table" }), false);
  assert.equal(isPermissionDeniedError({ message: "TypeError: fetch failed" }), false);
  assert.equal(isPermissionDeniedError(null), false);
  assert.equal(needsUpgrade({ checked: false, missingTables: ["staff"], missingColumns: [], deniedTables: [] }), false, "nothing checked, nothing claimed");
});
