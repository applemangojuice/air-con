/**
 * Keeps apps/web/lib/db/db-schema.generated.ts (what the local data backend
 * knows about every table: columns, types, NOT NULL, defaults, keys,
 * uniques, foreign keys, checks) in step with the migrations.
 *
 *   psql … -f supabase/tests/schema-dump.sql | node supabase/tests/schema-sync.mjs --check
 *   psql … -f supabase/tests/schema-dump.sql | node supabase/tests/schema-sync.mjs --write
 *
 * run-migrations.sh runs --check after applying every migration (and
 * --write when UPDATE_SCHEMA=1). Test harness only; no dependencies.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = join(HERE, "../../apps/web/lib/db/db-schema.generated.ts");
const mode = process.argv[2];
if (mode !== "--check" && mode !== "--write") {
  console.error("usage: schema-sync.mjs --check | --write   (schema-dump.sql output on stdin)");
  process.exit(2);
}

const input = readFileSync(0, "utf8").trim();
const dump = JSON.parse(input);

const q = (s) => JSON.stringify(s);
const list = (xs) => `[${xs.map(q).join(", ")}]`;

function render(schema) {
  const out = [];
  out.push("/**");
  out.push(" * Every table in `public` as supabase/migrations leave it: columns (Postgres");
  out.push(" * type, NOT NULL, default), primary key, unique constraints, partial or");
  out.push(" * expression unique indexes (by name), foreign keys and check constraints.");
  out.push(" * The local data backend enforces it (lib/db/local-schema.ts), so code that");
  out.push(" * would fail on Supabase fails in the tests too.");
  out.push(" *");
  out.push(" * GENERATED from a migrated database by supabase/tests/schema-sync.mjs: don't");
  out.push(" * edit by hand. `bash supabase/tests/run-migrations.sh` fails when it's out of");
  out.push(" * date; `UPDATE_SCHEMA=1 bash supabase/tests/run-migrations.sh` rewrites it.");
  out.push(" */");
  out.push("");
  out.push("export type DbColumn = readonly [name: string, type: string, notNull: boolean, defaultSql: string | null];");
  out.push("");
  out.push("export interface DbTable {");
  out.push("  columns: readonly DbColumn[];");
  out.push("  primaryKey: readonly string[];");
  out.push("  unique: readonly { name: string; columns: readonly string[] }[];");
  out.push("  uniqueIndexes: readonly string[];");
  out.push('  foreignKeys: readonly { name: string; column: string; references: string; refColumn: string; onDelete: "cascade" | "set null" | "set default" | "restrict" | "no action" }[];');
  out.push("  checks: readonly string[];");
  out.push("}");
  out.push("");
  out.push("export const DB_SCHEMA: Record<string, DbTable> = {");
  for (const table of Object.keys(schema).sort()) {
    const t = schema[table];
    out.push(`  ${table}: {`);
    out.push("    columns: [");
    for (const [name, type, notNull, def] of t.columns) out.push(`      [${q(name)}, ${q(type)}, ${notNull}, ${def === null ? "null" : q(def)}],`);
    out.push("    ],");
    out.push(`    primaryKey: ${list(t.primaryKey)},`);
    out.push(`    unique: [${t.unique.map((u) => `{ name: ${q(u.name)}, columns: ${list(u.columns)} }`).join(", ")}],`);
    out.push(`    uniqueIndexes: ${list(t.uniqueIndexes)},`);
    out.push(
      `    foreignKeys: [${t.foreignKeys
        .map((f) => `\n      { name: ${q(f.name)}, column: ${q(f.column)}, references: ${q(f.references)}, refColumn: ${q(f.refColumn)}, onDelete: ${q(f.onDelete)} },`)
        .join("")}${t.foreignKeys.length ? "\n    " : ""}],`,
    );
    out.push(`    checks: ${list(t.checks)},`);
    out.push("  },");
  }
  out.push("};");
  out.push("");
  return out.join("\n");
}

const wanted = render(dump);
if (mode === "--write") {
  writeFileSync(TARGET, wanted);
  console.log(`schema-sync: wrote ${Object.keys(dump).length} tables to apps/web/lib/db/db-schema.generated.ts`);
  process.exit(0);
}

let current = "";
try {
  current = readFileSync(TARGET, "utf8");
} catch {
  /* missing: different */
}
if (current === wanted) {
  console.log(`    db-schema.generated.ts matches the migrations (${Object.keys(dump).length} tables)`);
  process.exit(0);
}
const have = new Set(current.split("\n"));
const missing = wanted.split("\n").filter((l) => !have.has(l)).slice(0, 15);
console.error("schema-sync: apps/web/lib/db/db-schema.generated.ts is out of date with the migrations.");
console.error("The local data backend enforces that file; regenerate it with:");
console.error("  UPDATE_SCHEMA=1 bash supabase/tests/run-migrations.sh");
if (missing.length) console.error(`Lines the migrations give that the file lacks:\n  ${missing.join("\n  ")}`);
process.exit(1);
