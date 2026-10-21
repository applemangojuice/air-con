import * as nodeModule from "node:module";

/**
 * Let `node --test` load app modules the way Next's bundler does: `@/x`
 * resolves from apps/web, extensionless relative imports try `.ts`
 * then `/index.ts`, and Next's `next/headers`-style entry points resolve to
 * their `.js` files (so server modules load; calling `cookies()` outside a
 * request still throws, as it should). Call it before the dynamic imports of the modules
 * under test (static imports are resolved before any code runs).
 */

const APP_ROOT = new URL("../../", import.meta.url);

type Next = (specifier: string, context?: unknown) => unknown;
type Hooks = { resolve: (specifier: string, context: unknown, next: Next) => unknown };

const HAS_EXT = /\.[cm]?[jt]sx?$|\.json$/;

function firstResolvable(candidates: string[], context: unknown, next: Next): unknown {
  let last: unknown;
  for (const c of candidates) {
    try {
      return next(c, context);
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

function candidatesFor(base: string): string[] {
  return HAS_EXT.test(base) ? [base] : [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, base];
}

let registered = false;

export function registerAppResolver(): void {
  if (registered) return;
  registered = true;
  const m = nodeModule as unknown as { registerHooks?: (hooks: Hooks) => void };
  if (!m.registerHooks) throw new Error("This Node has no module.registerHooks (needs Node 22.15+).");
  m.registerHooks({
    resolve(specifier, context, next) {
      if (specifier.startsWith("@/")) {
        return firstResolvable(candidatesFor(new URL(specifier.slice(2), APP_ROOT).href), context, next);
      }
      try {
        return next(specifier, context);
      } catch (err) {
        if (specifier.startsWith(".") && !HAS_EXT.test(specifier)) return firstResolvable(candidatesFor(specifier), context, next);
        // Next's subpath entry points ("next/headers", "next/cache") are CommonJS files without an exports map.
        if (/^next\/[a-z-]+$/.test(specifier)) return next(`${specifier}.js`, context);
        throw err;
      }
    },
  });
}
