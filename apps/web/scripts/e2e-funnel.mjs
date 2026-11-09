/**
 * End-to-end smoke of the quote funnel in a real browser:
 * homepage address → instant price (no email) → "Refine my quote" → email
 * gate → house → rooms (price) → firm up (optional, skipped) → details +
 * consent → saved quote page → "Book my survey" → project page. Plus the
 * out-of-area path.
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
  if (existsSync(`${root}/chromium`)) return `${root}/chromium`; // the image's stable symlink
  if (existsSync(root)) {
    const dir = readdirSync(root).find((d) => /^chromium-\d+$/.test(d));
    for (const p of [`${root}/${dir}/chrome-linux64/chrome`, `${root}/${dir}/chrome-linux/chrome`]) {
      if (dir && existsSync(p)) return p;
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
  // 1. Homepage → address → funnel (client-side navigation)
  await page.goto(BASE, { waitUntil: "networkidle" });
  check(
    "homepage renders hero",
    await page.locator("h1").first().textContent().then((t) => t.toLowerCase().includes("hot")),
  );
  const home = (await page.locator("main").textContent()) ?? "";
  check("homepage makes no 'single day' or 'guaranteed' promise", !/single day|guaranteed|price locked/i.test(home));
  check("homepage frames heating and cooling", /warm it in winter/i.test(home));
  check("homepage shows no brand artwork in the hero", (await page.locator('img[src*="dang-its-hot"]').count()) === 0);
  check("homepage lists the five customer steps", /virtual survey/i.test(home) && /purchase/i.test(home) && /aftercare/i.test(home));
  await page.fill('input[name="postcode"]', "SW16 2BE");
  await page.fill('input[name="address"]', "12");
  await page.click('button:has-text("Start")');
  await page.waitForURL("**/quote**");
  check("address form navigates to /quote", page.url().includes("/quote"));

  // 2. The instant price: no email asked, the home filled in for them.
  await page.waitForSelector("text=Here's your price", { timeout: 20000 });
  await page.waitForSelector("text=/£[0-9,]+/");
  const priceScreen = (await page.locator("main").textContent()) ?? "";
  check("price shows before any email field", (await page.locator('input[type="email"]').count()) === 0);
  check("price screen says what it rests on", /Priced for/.test(priceScreen) && /(public records|homes around you|typical home)/.test(priceScreen));
  check("price screen is not a numbered step", !/Step \d of \d/.test(priceScreen));
  const strip = page.locator('[aria-label="Your journey"] li');
  check("journey strip has five steps, price first", (await strip.count()) === 5 && /Price/.test((await strip.first().textContent()) ?? ""));
  check("journey strip reads virtual survey, purchase, install, aftercare", /Virtual survey.*Purchase.*Install.*Aftercare/s.test((await page.locator('[aria-label="Your journey"]').textContent()) ?? ""));
  check("terms and privacy linked on the step", (await page.locator('a[href="/terms"]').count()) > 0 && (await page.locator('a[href="/privacy"]').count()) > 0);
  check("a secondary save path is offered", (await page.locator('button:has-text("Looks right, save it")').count()) === 1);
  await page.click('button:has-text("Refine my quote")');

  // 3. The email gate: address confirmed, email required, reminder offered.
  await page.waitForSelector("text=Refine your quote");
  const addressInput = page.locator('input[autocomplete="address-line1"]');
  const typed = await addressInput.inputValue();
  check("the house typed on the homepage is carried over", typed.startsWith("12"));
  if (typed.trim().length < 5) await addressInput.fill("12 Example Road");
  await page.click('button[type="submit"]');
  await page.waitForSelector("text=/Add an email address/");
  check("continuing without an email is refused with a reason", true);
  await page.fill('input[type="email"]', "e2e@example.com");
  // Told at collection, free to refuse: one reminder, ticked unless they untick it.
  const reminder = page.getByLabel(/Email me one reminder if I don't finish/);
  const offered = (await reminder.count()) === 1 && (await reminder.isChecked());
  if (offered) await reminder.uncheck();
  const unticks = offered && !(await reminder.isChecked());
  if (offered) await reminder.check();
  check("a reminder email is offered under the email, ticked, and can be unticked", unticks && /Untick and we won't/.test((await page.locator("main").textContent()) ?? ""));
  await page.click('button[type="submit"]');

  // 4–6. House, rooms (price), firm-up (skipped): the numbered refine form.
  await page.waitForSelector("text=Step 1 of 4");
  check("house step reached, option groups are fieldsets", (await page.locator("fieldset legend").count()) >= 4);
  check("progressbar is exposed", (await page.locator('[role="progressbar"][aria-valuenow="1"]').count()) === 1);
  check("no autofocus keyboard pop on step change", !(await focusIsTextInput()));
  await page.click('button[type="submit"]');
  await page.waitForSelector("text=Step 2 of 4");
  await page.waitForSelector("text=/£[0-9,]+/");
  check("rooms step shows a price", true);
  check("no finance example without a lender", !/\/mo\b|\bAPR\b/.test((await page.locator("main").textContent()) ?? ""));
  await page.click('button[type="submit"]');
  await page.waitForSelector("text=Step 3 of 4");
  check("optional firm-up step offered", (await page.locator('button:has-text("Skip for now")').count()) === 1);
  await page.click('button[type="submit"]');

  // 7. Details: consent is required, marketing is optional and unticked.
  await page.waitForSelector("text=Step 4 of 4");
  check("email from the gate is carried into the details", (await page.locator('input[type="email"]').inputValue()) === "e2e@example.com");
  const boxes = page.locator('input[type="checkbox"]');
  check("two separate consent boxes, both unticked", (await boxes.count()) === 2 && !(await boxes.nth(0).isChecked()) && !(await boxes.nth(1).isChecked()));
  await page.fill('input[autocomplete="name"]', "DEMO Funnel Tester");
  await page.click('button[type="submit"]');
  await page.waitForSelector("text=/Tick the first box/");
  check("saving without operational consent is refused with a reason", true);
  await page.locator('label:has-text("Save my quote and keep me posted")').click();
  await page.click('button[type="submit"]');

  // 8. Saved quote page (or the demo result when there's no database).
  await page.waitForSelector("text=Book my survey", { timeout: 20000 });
  const result = (await page.locator("main").textContent()) ?? "";
  check("price renders on the result", /£[0-9,]+/.test(result));
  check("result says confirmed at survey, not locked", /confirmed at your (home )?survey/i.test(result) && !/price locked|guaranteed/i.test(result));
  check("result states validity", /Valid (until|for)/.test(result));

  // 9. The journey continues: Book my survey → the project page.
  await page.click('button:has-text("Book my survey")');
  await page.waitForURL("**/p/**", { timeout: 15000 });
  check("Book my survey lands on the project page", page.url().includes("/p/"));
  await page.waitForLoadState("networkidle");
  const hub = (await page.locator("main").textContent()) ?? "";
  check("the browser that saved the quote opens its project (no sign-in wall)", !/Sign in to see your project/.test(hub));
  check("no placeholder phone number on the project page", !/0800 000 0000/.test(hub));

  // 10. Out of area: honest, with an optional heads-up, before any price.
  await page.goto(`${BASE}/quote?postcode=${encodeURIComponent("E8 1AA")}&address=12`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=/not in .*E8/i", { timeout: 15000 });
  check("out-of-area postcode is told the truth", (await page.locator("text=/we cover/i").count()) === 0);
  check("no price is shown out of area", !/Here's your price/.test((await page.locator("main").textContent()) ?? ""));
  await page.fill('input[type="email"]', "later@example.com");
  await page.click('button:has-text("Tell me when")');
  await page.waitForSelector("text=/We'll email/", { timeout: 15000 });
  check("out-of-area heads-up is stored", true);

  // 11. A direct visit with no address: the address screen, then the price.
  await page.goto(`${BASE}/quote`, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("text=Where's your home?");
  await page.fill('input[autocomplete="postal-code"]', "SW16 2BE");
  await page.waitForSelector("text=/we cover SW16/i", { timeout: 15000 });
  const direct = page.locator('input[autocomplete="address-line1"]');
  if (await direct.count()) {
    await direct.fill("12 Example Road");
  } else {
    await page.locator("select").first().selectOption({ index: 1 });
  }
  await page.click('button:has-text("Show my price")');
  await page.waitForSelector("text=Here's your price", { timeout: 20000 });
  await page.waitForSelector("text=/£[0-9,]+/");
  check("a direct visit gets the price straight after the address", true);
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
