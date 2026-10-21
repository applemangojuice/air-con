import { test } from "node:test";
import assert from "node:assert/strict";
import { DB_SCHEMA } from "../lib/db/db-schema.generated.ts";
import { CHECKS, UNIQUE_INDEX_KEYS, tableNames, tableSchema } from "../lib/db/local-schema.ts";
import { columnType } from "../lib/db/local-types.ts";

// The local data backend enforces db-schema.generated.ts, which
// supabase/tests/run-migrations.sh keeps equal to what the migrations make.
// What the generated file can only name (partial and expression unique
// indexes, check constraints) is mirrored by hand in local-schema.ts: a
// migration that adds one fails here until it's mirrored.

test("every table the migrations make is mirrored: columns typed, defaults understood, indexes and checks implemented", () => {
  assert.ok(tableNames().length >= 30);
  for (const name of tableNames()) {
    const schema = tableSchema(name);
    assert.ok(schema, name);
    for (const [col, pgType] of DB_SCHEMA[name]!.columns) assert.ok(columnType(pgType), `${name}.${col}`);
    assert.ok(schema.primaryKey.length > 0, `${name} has a primary key`);
  }
  assert.equal(tableSchema("no_such_table"), null);
});

test("no hand mirror is left over from an index or check the migrations no longer have", () => {
  const indexes = new Set(Object.values(DB_SCHEMA).flatMap((t) => t.uniqueIndexes));
  for (const name of Object.keys(UNIQUE_INDEX_KEYS)) assert.ok(indexes.has(name), `UNIQUE_INDEX_KEYS.${name}`);
  const checks = new Set(Object.values(DB_SCHEMA).flatMap((t) => t.checks));
  for (const name of Object.keys(CHECKS)) assert.ok(checks.has(name), `CHECKS.${name}`);
});

test("foreign keys are known from both ends, for cascades and refusals", () => {
  const projects = tableSchema("projects")!;
  const children = projects.referencedBy.map((f) => `${f.table}.${f.column}:${f.onDelete}`);
  assert.ok(children.includes("media.project_id:cascade"));
  assert.ok(children.includes("invoices.project_id:cascade"));
  const quotes = tableSchema("quote_requests")!;
  assert.ok(quotes.referencedBy.some((f) => f.table === "projects" && f.onDelete === "no action"), "a quote with a project can't be deleted");
  const customers = tableSchema("customers")!;
  assert.ok(customers.referencedBy.some((f) => f.table === "projects" && f.onDelete === "set null"));
});
