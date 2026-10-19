import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { registerAppResolver } from "./helpers/resolve-app.ts";

/**
 * The one-paste upgrade (supabase/pilot-upgrade.sql) and the read-only
 * production check (supabase/check-schema.sql) stay in step with the
 * migrations and with what the app probes. supabase/tests/run-migrations.sh
 * runs both against Postgres; these are the checks that need no database.
 */

registerAppResolver();
const { PILOT_COLUMNS, PILOT_TABLES } = await import("../lib/schema-check.ts");
const { BUCKET_RULES } = await import("../lib/storage-buckets.ts");

const SUPABASE = new URL("../../../supabase/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, SUPABASE), "utf8");
const migrations = readdirSync(new URL("migrations/", SUPABASE))
  .filter((f) => f.endsWith(".sql"))
  .sort();
const upgrade = read("pilot-upgrade.sql");
const check = read("check-schema.sql");

/** The quoted names in one `name text[] := array[ … ];` declaration of check-schema.sql. */
function checkList(name: string): string[] {
  const m = new RegExp(`\\b${name} text\\[\\] := array\\[([\\s\\S]*?)\\];`).exec(check);
  assert.ok(m, `check-schema.sql declares ${name}`);
  return [...m[1]!.replace(/--[^\n]*/g, "").matchAll(/'([^']+)'/g)].map((x) => x[1]!);
}

test("pilot-upgrade.sql holds every migration from 0010, whole and in order, inside one transaction", () => {
  const pilot = migrations.filter((f) => f >= "0010");
  assert.ok(pilot.length >= 4, "0010 to 0013 at least");
  let at = upgrade.indexOf("\nbegin;\n");
  assert.ok(at > 0, "opens a transaction after the header");
  for (const f of pilot) {
    const body = read(`migrations/${f}`);
    const found = upgrade.indexOf(body, at);
    assert.ok(found > at, `${f} is in the bundle, after the one before it (run: bash supabase/build-pilot-upgrade.sh)`);
    at = found + body.length;
  }
  assert.ok(upgrade.indexOf("\ncommit;", at) >= at, "and commits after the last one");
  for (const f of migrations.filter((x) => x < "0010")) {
    assert.ok(!upgrade.includes(`-- ${f}\n`), `${f} belongs to the original site, not the bundle`);
  }
});

test("pilot-upgrade.sql's header says what it does and that it's safe to re-run", () => {
  const header = upgrade.slice(0, upgrade.indexOf("\nbegin;\n"));
  assert.match(header, /SAFE TO RE-RUN/);
  assert.match(header, /WHAT IT DOES/);
  for (const f of migrations.filter((x) => x >= "0010")) assert.match(header, new RegExp(`--   ${f.slice(0, 4)}  \\S`), `a line for ${f}`);
  assert.match(header, /SQL Editor/);
});

test("check-schema.sql lists every table the migrations create, and what the app probes", () => {
  const created = new Set<string>();
  for (const f of migrations) {
    for (const m of read(`migrations/${f}`).matchAll(/create table (?:if not exists )?public\.(\w+)/gi)) created.add(m[1]!);
  }
  const tables = checkList("tables");
  assert.deepEqual([...tables].sort(), [...created].sort(), "every created table, and nothing else");
  for (const t of PILOT_TABLES) assert.ok(tables.includes(t), `${t} (schema-check PILOT_TABLES)`);

  const columns = checkList("columns");
  for (const { table, columns: cols } of PILOT_COLUMNS) {
    for (const c of cols) assert.ok(columns.includes(`${table}.${c}`), `${table}.${c} (schema-check PILOT_COLUMNS)`);
  }
  assert.deepEqual(checkList("buckets").sort(), Object.keys(BUCKET_RULES).sort(), "the photo stores storage-buckets.ts knows");
});

test("check-schema.sql can't change anything", () => {
  const code = check.replace(/--[^\n]*/g, "");
  assert.match(code, /^\s*begin transaction read only;/m);
  assert.doesNotMatch(code, /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i);
});
