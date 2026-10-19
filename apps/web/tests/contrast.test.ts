import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * WCAG AA on the brand tokens (apps/web/app/globals.css): secondary text on
 * the cream ground and the surface, white text on every primary button, and
 * the focus ring (3:1 for non-text). The primary buttons all use one orange.
 */
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const token = (name: string) => {
  const m = new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, "i").exec(css);
  assert.ok(m, `token ${name}`);
  return m[1]!;
};
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

test("secondary text, button text and the focus ring meet WCAG AA", () => {
  for (const ground of ["cream", "surface"]) {
    assert.ok(ratio(token("ink-500"), token(ground)) >= 4.5, `ink-500 on ${ground}: ${ratio(token("ink-500"), token(ground)).toFixed(2)}`);
  }
  for (const fill of ["accent-700", "accent-800"]) assert.ok(ratio("#ffffff", token(fill)) >= 4.5, `white on ${fill}`);
  assert.match(css, /:focus-visible\s*{\s*outline:\s*2px solid var\(--color-accent-700\)/);
  assert.ok(ratio(token("accent-700"), token("cream")) >= 3, "focus ring on cream");
});

test("primary buttons are accent-700 everywhere (the kit, the portal, the funnel)", () => {
  const kit = readFileSync(new URL("../components/kit/button.tsx", import.meta.url), "utf8");
  const portal = readFileSync(new URL("../components/portal/bits.tsx", import.meta.url), "utf8");
  const site = readFileSync(new URL("../components/site/styles.ts", import.meta.url), "utf8");
  assert.match(kit, /primary: "bg-accent-700 text-white/);
  assert.match(portal, /bg-accent-700 px-6 py-3 text-base font-semibold text-white/);
  assert.match(site, /bg-accent-700/);
  for (const src of [kit, portal]) assert.doesNotMatch(src, /bg-accent-600[^"]*text-white/);
});
