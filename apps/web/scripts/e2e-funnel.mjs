/**
 * End-to-end smoke of the quote funnel in a real browser:
 * homepage postcode → postcode/address (coverage) → house → rooms (price)
 * → firm up (optional, skipped) → details + consent → saved quote page
 * → "Book my home survey" → project page. Plus the out-of-area path.
 *
 * Run against a production build with a database (file backend is fine):
 *   pnpm build && DATA_BACKEND=file pnpm start -p 3000 &
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
const focusIsTextInput = () =>
  page.evaluate(() => {
    const el = document.activeElement;
    return el instanceof HTMLInputElement && ["text", "email", "tel", "number", ""].includes(el.type);
  });

try {
  // 1. Homepage → postcode → funnel (client-side navigation)
  await page.goto(BASE, { waitUntil: "networkidle" });
  check(
    "homepage renders hero",
    await page.locator("h1").first().textContent().then((t) => t.toLowerCase().includes("hot")),
  );
  const home = (await page.locator("main").textContent()) ?? "";
  check("homepage makes no 'single day' or 'guaranteed' promise", !/single day|guaranteed|price locked/i.test(home));
  check("homepage frames heating and cooling", /warm it in winter/i.test(home));
  await page.fill('input[name="postcode"]', "SW16 2BE");
  await page.click('button:has-text("Start")');
  await page.waitForURL("**/quote**");
  check("postcode form navigates to /quote", page.url().includes("/quote"));

  // 2. Postcode step: carried over, coverage confirmed from settings, terms + privacy linked
  await page.waitForSelector("text=Step 1 of 5");
  const pcVal = await page.locator('input[autocomplete="postal-code"]').inputValue();
  check("postcode carried into funnel", pcVal.replace(/\s/g, "") === "SW162BE");
  await page.waitForSelector("text=/we cover SW16/i", { timeout: 15000 });
  check("coverage confirmed for a configured outcode", true);
  check("terms and privacy linked on the step", (await page.locator('a[href="/terms"]').count()) > 0 && (await page.locator('a[href="/privacy"]').count()) > 0);
  check("progressbar is exposed", (await page.locator('[role="progressbar"][aria-valuenow="1"]').count()) === 1);
  const addressInput = page.locator('input[autocomplete="address-line1"]');
  if (await addressInput.count()) {
    await addressInput.fill("12 Example Road");
  } else {
    // Known-address picker (property intelligence): choose the first entry.
    await page.locator("select").first().selectOption({ index: 1 });
  }
  await page.fill('input[type="email"]', "e2e@example.com");
  await page.click('button[type="submit"]');

  // 3–5. House, rooms (price), firm-up (skipped).
  await page.waitForSelector("text=Step 2 of 5");
  check("house step reached, option groups are fieldsets", (await page.locator("fieldset legend").count()) >= 4);
  check("no autofocus keyboard pop on step change", !(await focusIsTextInput()));
  await page.click('button[type="submit"]');
  await page.waitForSelector("text=Step 3 of 5");
  await page.waitForSelector("text=/£[0-9,]+/");
  check("rooms step shows a price", true);
  check("no finance example without a lender", !/\/mo\b|\bAPR\b/.test((await page.locator("main").textContent()) ?? ""));
  await page.click('button[type="submit"]');
  await page.waitForSelector("text=Step 4 of 5");
  check("optional firm-up step offered", (await page.locator('button:has-text("Skip for now")').count()) === 1);
  await page.click('button[type="submit"]');

  // 6. Details: consent is required, marketing is optional and unticked.
  await page.waitForSelector("text=Step 5 of 5");
  const boxes = page.locator('input[type="checkbox"]');
  check("two separate consent boxes, both unticked", (await boxes.count()) === 2 && !(await boxes.nth(0).isChecked()) && !(await boxes.nth(1).isChecked()));
  await page.fill('input[autocomplete="name"]', "E2E Tester");
  await page.click('button[type="submit"]');
  await page.waitForSelector("text=/Tick the first box/");
  check("saving without operational consent is refused with a reason", true);
  await page.locator('label:has-text("Save my quote and keep me posted")').click();
  await page.click('button[type="submit"]');

  // 7. Saved quote page (or the demo result when there's no database).
  await page.waitForSelector("text=Book my home survey", { timeout: 20000 });
  const result = (await page.locator("main").textContent()) ?? "";
  check("price renders on the result", /£[0-9,]+/.test(result));
  check("result says confirmed at survey, not locked", /confirmed at your home survey/i.test(result) && !/price locked|guaranteed/i.test(result));
  check("result states validity", /Valid (until|for)/.test(result));

  // 8. The journey continues: Book my home survey → the project page.
  await page.click('button:has-text("Book my home survey")');
  await page.waitForURL("**/p/**", { timeout: 15000 });
  check("Book my home survey lands on the project page", page.url().includes("/p/"));

  // 9. Out of area: honest, with an optional heads-up.
  await page.goto(`${BASE}/quote?postcode=${encodeURIComponent("E8 1AA")}`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=/not in .*E8/i", { timeout: 15000 });
  check("out-of-area postcode is told the truth", (await page.locator("text=/we cover/i").count()) === 0);
  await page.fill('input[type="email"]', "later@example.com");
  await page.click('button:has-text("Tell me when")');
  await page.waitForSelector("text=/We'll email/", { timeout: 15000 });
  check("out-of-area heads-up is stored", true);
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
