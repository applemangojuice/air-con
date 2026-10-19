import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Contract §A7 / §C, checked statically: every page, route handler and
 * server action under the staff surfaces (/ops, /field) calls a guard from
 * lib/auth/server.ts itself. Middleware only proves the cookie is signed; it
 * can't see a deactivation or a missing permission, and server actions are
 * reachable by id from any route, so each one has to check on its own.
 *
 * A new page that fails here needs `await requireStaff(perm)` (pages and
 * actions), `requireStaffApi(request, perm)` (route handlers) or
 * `requireProjectAccess(id, …)` (one project) before it touches data.
 */

const APP = new URL("../app/", import.meta.url).pathname;
const STAFF_SURFACES = ["ops", "field"];
const GUARD = /\brequire(Staff|StaffApi|ProjectAccess)\(/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** The `{ … }` body that starts at or after `from`, by brace matching (enough for this codebase's own files). */
function bodyAt(src: string, from: number): string {
  const open = src.indexOf("{", from);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}

/** Function name → body, for every `function name(` declaration in the file. */
function functionBodies(src: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of src.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g)) {
    // Skip the parameter list (it may hold destructuring braces) before looking for the body.
    let i = (m.index ?? 0) + m[0].length;
    for (let depth = 1; depth > 0 && i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") depth--;
    }
    out.set(m[1]!, bodyAt(src, i));
  }
  return out;
}

/** Guarded directly, or through a local helper that is (e.g. a shared `run()`). */
function reachesGuard(body: string, bodies: Map<string, string>, seen = new Set<string>()): boolean {
  if (GUARD.test(body)) return true;
  for (const [name, helper] of bodies) {
    if (seen.has(name) || !new RegExp(`\\b${name}\\(`).test(body)) continue;
    seen.add(name);
    if (reachesGuard(helper, bodies, seen)) return true;
  }
  return false;
}

const files = STAFF_SURFACES.flatMap((s) => walk(join(APP, s))).filter((f) => /\.(ts|tsx)$/.test(f));
const rel = (f: string) => relative(APP, f);

test("every /ops and /field page and route handler calls a staff guard", () => {
  const entries = files.filter((f) => /(^|\/)(page\.tsx|route\.ts)$/.test(f));
  assert.ok(entries.length > 10, "found the ops pages");
  const unguarded = entries.filter((f) => {
    const src = readFileSync(f, "utf8");
    const bodies = functionBodies(src);
    if (f.endsWith("route.ts")) {
      const handlers = [...bodies].filter(([name]) => /^(GET|POST|PUT|PATCH|DELETE)$/.test(name));
      return handlers.length === 0 || handlers.some(([, body]) => !reachesGuard(body, bodies));
    }
    const page = /export\s+default\s+(?:async\s+)?function\s+(\w+)/.exec(src)?.[1];
    // The page's own guard, not one inside an inline action it declares.
    const ownCode = (bodies.get(page ?? "") ?? "").split(/["']use server["']/)[0]!;
    return !page || !reachesGuard(ownCode, bodies);
  });
  assert.deepEqual(unguarded.map(rel), []);
});

test("every server action under /ops and /field checks the session itself", () => {
  const problems: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    if (!src.includes("use server")) continue;
    const bodies = functionBodies(src);
    if (/^\s*["']use server["'];/.test(src)) {
      // Module-level: every exported function is an action.
      for (const m of src.matchAll(/export\s+async\s+function\s+(\w+)/g)) {
        if (!reachesGuard(bodies.get(m[1]!) ?? "", bodies)) problems.push(`${rel(f)}: ${m[1]}`);
      }
      continue;
    }
    // Inline actions: the guard is the first statement after the directive.
    for (const m of src.matchAll(/["']use server["'];\s*\n\s*([^\n]*)/g)) {
      if (!GUARD.test(m[1]!)) problems.push(`${rel(f)}: inline action starting "${m[1]!.trim().slice(0, 40)}"`);
    }
  }
  assert.deepEqual(problems, []);
});

/**
 * An action that takes a project id changes one project, so it checks that
 * project too (requireProjectAccess), not only a permission: a permission
 * says what someone may do, assignment says where (§C). The page around it
 * is no protection, since actions are reachable from any route.
 */
const PROJECT_GUARD = /\brequireProjectAccess\(/;

function reachesProjectGuard(body: string, bodies: Map<string, string>, seen = new Set<string>()): boolean {
  if (PROJECT_GUARD.test(body)) return true;
  for (const [name, helper] of bodies) {
    if (seen.has(name) || !new RegExp(`\\b${name}\\(`).test(body)) continue;
    seen.add(name);
    if (reachesProjectGuard(helper, bodies, seen)) return true;
  }
  return false;
}

test("every server action that takes a project id checks access to that project", () => {
  const problems: string[] = [];
  let checked = 0;
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    if (!/^\s*["']use server["'];/.test(src)) continue;
    const bodies = functionBodies(src);
    for (const m of src.matchAll(/export\s+async\s+function\s+(\w+)\s*\(\s*projectId\b/g)) {
      checked++;
      if (!reachesProjectGuard(bodies.get(m[1]!) ?? "", bodies)) problems.push(`${rel(f)}: ${m[1]}`);
    }
  }
  assert.ok(checked > 20, `found the project actions (${checked})`);
  assert.deepEqual(problems, []);
});

test("the extractor sees through destructured params and shared helpers", () => {
  const src = `
async function run(id: string) { await requireStaff("projects.edit"); return id; }
export async function a({ x }: { x: string }) { return run(x); }
export async function b() { return 1; }
export default async function Page({ params }: { params: Promise<{ id: string }> }) { await requireStaff(); }`;
  const bodies = functionBodies(src);
  assert.equal(reachesGuard(bodies.get("a")!, bodies), true, "guarded through run()");
  assert.equal(reachesGuard(bodies.get("b")!, bodies), false);
  assert.equal(reachesGuard(bodies.get("Page")!, bodies), true, "body found past the destructured params");
});
