/**
 * End-to-end smoke of the quote funnel in a real browser:
 * homepage postcode → address+email → house → rooms → contact → price.
 *
 * Run against a production build:
 *   pnpm build && pnpm start -p 3000 &
 *   BASE_URL=http://localhost:3000 node scripts/e2e-funnel.mjs
 *
 * Uses playwright-core (devDependency; no bundled browsers). Point
 * CHROMIUM_PATH at a Chromium/Chrome binary; on Claude Code / CI images
 * with pre-installed Playwright browsers it's auto-discovered.
 */
import { chromium } from "playwright-core";
import { existsSync, readdirSync } from "node:fs";

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
  if (existsSync(root)) {
    const dir = readdirSync(root).find((d) => /^chromium-\d+$/.test(d));
    if (dir) {
      const p = `${root}/${dir}/chrome-linux/chrome`;
      if (existsSync(p)) return p;
    }
  }
  console.error("No Chromium found. Set CHROMIUM_PATH to a Chrome/Chromium binary.");
  process.exit(2);
}

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch({
  executablePath: findChromium(),
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); // phone-sized
const fails = [];
const check = (name, ok) => {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) fails.push(name);
};

try {
  // 1. Homepage → postcode → funnel (client-side navigation)
  await page.goto(BASE, { waitUntil: "networkidle" });
  check(
    "homepage renders hero",
    await page.locator("h1").first().textContent().then((t) => t.toLowerCase().includes("hot")),
  );
  await page.fill('input[name="postcode"]', "SW16 1AA");
  await page.click('button:has-text("Start")');
  await page.waitForURL("**/quote**");
  check("postcode form navigates to /quote", page.url().includes("/quote"));

  // 2. Address step: postcode carried over, address + email in
  await page.waitForSelector("text=Step 1 of 4");
  const pcVal = await page.locator("input").first().inputValue();
  check("postcode carried into funnel", pcVal.replace(/\s/g, "") === "SW161AA");
  const addressInput = page.locator('input[autocomplete="address-line1"]');
  if (await addressInput.count()) {
    await addressInput.fill("12 Example Road");
  } else {
    // Known-address picker (property intelligence): choose the first entry.
    await page.locator("select").first().selectOption({ index: 1 });
  }
  await page.fill('input[type="email"]', "e2e@example.com");
  await page.click('button[type="submit"]');

  // 3–4. House and rooms steps advance on the generated defaults.
  await page.waitForSelector("text=Step 2 of 4");
  check("house step reached", true);
  await page.click('button[type="submit"]');
  await page.waitForSelector("text=Step 3 of 4");
  check("rooms step reached", true);
  await page.click('button[type="submit"]');

  // 5. Contact step: autofocus lands in the name field.
  await page.waitForSelector("text=Step 4 of 4");
  const nameInput = page.locator('input[autocomplete="name"]');
  check(
    "contact step autofocuses name",
    await nameInput.evaluate((el) => el === document.activeElement),
  );
  await nameInput.fill("E2E Tester");
  await page.click('button[type="submit"]');

  // 6. Result: a real price renders (demo mode: computed client-side).
  await page.waitForSelector("text=/£[0-9,]+/", { timeout: 15000 });
  check("price renders on result", true);

  // 7. The journey continues: start the installation plan → the timeline.
  await page.click('button:has-text("installation plan"), button:has-text("timeline")');
  await page.waitForURL("**/p/**", { timeout: 15000 });
  check("start-plan lands on the project timeline", page.url().includes("/p/"));
  await page.waitForSelector("text=/site visit/i", { timeout: 15000 });
  check("timeline renders the journey stages", true);
} catch (err) {
  console.error("E2E failure:", err.message);
  fails.push(err.message);
}

await browser.close();
if (fails.length) {
  console.error(`\n${fails.length} check(s) failed`);
  process.exit(1);
}
console.log("\nAll E2E checks passed");
