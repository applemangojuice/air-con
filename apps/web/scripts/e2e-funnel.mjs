/**
 * End-to-end smoke of the quote funnel in a real browser:
 * homepage postcode → address → guide price (no email, rooms and size
 * adjustable) → "Refine my quote" → email gate (one notice, one opt-out) →
 * "Your home" (rooms ticked, saved as they go) → "Next: confirm your price"
 * → saved quote page → "Book my virtual survey" → project page. Plus a
 * returning visitor, the out-of-area path and a direct visit.
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
  // Postcode in → the addresses we know there, as a dropdown; a house field only when we know none.
  await page.waitForSelector('select[name="address"], input[name="address"]', { timeout: 15000 });
  const picker = page.locator('select[name="address"]');
  let homeAddress = "12";
  if (await picker.count()) {
    await picker.selectOption({ index: 1 });
    homeAddress = await picker.inputValue();
    check("known addresses offered as a dropdown from the postcode alone", homeAddress.length > 0);
  } else {
    await page.fill('input[name="address"]', homeAddress);
    check("no known addresses: a house field is offered instead", true);
  }
  await page.click('button:has-text("Start")');
  await page.waitForURL("**/quote**");
  check("address form navigates to /quote", page.url().includes("/quote"));

  // 2. The guide price: no email asked, the home filled in for them, rooms and size adjustable.
  await page.waitForSelector("text=Your guide price", { timeout: 20000 });
  await page.waitForSelector("text=/£[0-9,]+/");
  const priceScreen = (await page.locator("main").textContent()) ?? "";
  check("price shows before any email field", (await page.locator('input[type="email"]').count()) === 0);
  check("it's called a guide price, confirmed at the survey, with the virtual-survey note", /Guide price/.test(priceScreen) && /Confirmed at your survey/.test(priceScreen) && /virtual survey/i.test(priceScreen));
  check("no confidence score on the guide price", !/confidence/i.test(priceScreen) && !/\d+\/100/.test(priceScreen));
  check("price screen is not a numbered step", !/Step \d of \d/.test(priceScreen));
  const strip = page.locator('[aria-label="Your journey"] li');
  check("journey strip has five steps, price first", (await strip.count()) === 5 && /Price/.test((await strip.first().textContent()) ?? ""));
  check("journey strip reads virtual survey, purchase, install, aftercare", /Virtual survey.*Purchase.*Install.*Aftercare/s.test((await page.locator('[aria-label="Your journey"]').textContent()) ?? ""));
  check("terms and privacy linked on the step", (await page.locator('a[href="/terms"]').count()) > 0 && (await page.locator('a[href="/privacy"]').count()) > 0);
  const card = page.locator('[data-testid="basics"]');
  const cardText = async () => (await card.textContent()) ?? "";
  check("the card says what's priced in a sentence", /Priced for \d+ bedrooms?, .*(kitchen|living)/.test(await cardText()));
  check("no home type, era, bathrooms or layout on the card", !/terraced|detached|bathroom|built/i.test(await cardText()));
  const price = async () => (await page.locator("text=/£[0-9,]+/").first().textContent()) ?? "";
  const before = await price();
  const chips = card.locator('button[aria-label^="Leave out"]');
  const chipCount = await chips.count();
  await chips.last().click();
  check("✕ on a room takes it out of the price", (await chips.count()) === chipCount - 1 && (await price()) !== before);
  check("a room left out can be added back", (await card.locator('button:has-text("+ ")').count()) >= 1);
  await card.locator('button:has-text("+ ")').first().click();
  check("adding it back restores the price", (await price()) === before && (await chips.count()) === chipCount);
  await card.locator('button:has-text("+ Bedroom")').click();
  check("+ Bedroom adds one", (await chips.count()) === chipCount + 1);
  await card.locator('label:has-text("120–140")').click();
  check("size bands are tappable", await card.locator('label:has-text("120–140") input').isChecked());
  check("one button, Refine my quote", (await page.locator('button:has-text("Refine my quote")').count()) === 1 && (await page.locator('button:has-text("Looks right")').count()) === 0);
  await page.click('button:has-text("Refine my quote")');

  // 3. The email gate: address confirmed, email required, the legal-minimum notice with one unticked opt-out.
  await page.waitForSelector("text=Refine your quote");
  const addressInput = page.locator('input[autocomplete="address-line1"]');
  const typed = await addressInput.inputValue();
  check("the address from the homepage is carried over", typed.startsWith(homeAddress.split(",")[0]));
  if (typed.trim().length < 5) await addressInput.fill("12 Example Road");
  await page.click('button[type="submit"]');
  await page.waitForSelector("text=/Add an email address/");
  check("continuing without an email is refused with a reason", true);
  const gate = (await page.locator("main").textContent()) ?? "";
  check("no 'Email me one reminder' box; one notice line instead", !/Email me one reminder/.test(gate) && /one reminder if you stop part-way/.test(gate));
  const optOut = page.getByLabel(/Don't send me the reminder or any news/);
  check("one opt-out box, unticked", (await page.locator('input[type="checkbox"]').count()) === 1 && (await optOut.count()) === 1 && !(await optOut.isChecked()));
  const email = `e2e-${Date.now()}@example.com`;
  await page.fill('input[type="email"]', email);
  await page.click('button[type="submit"]');

  // 4. "Your home": one page. Rooms ticked at the top, not-included under them, the few answers, no photos, no name.
  await page.waitForSelector("text=Rooms to air-condition", { timeout: 15000 });
  const homeText = (await page.locator("main").textContent()) ?? "";
  const rooms = page.locator('[data-testid="rooms"] input[type="checkbox"]');
  check("rooms to air-condition are listed with ticks, the one left out unticked", (await rooms.count()) >= 4);
  check("no public-records notice, home type, era or bathrooms", !/public records|What kind of home|when was it built|Bathrooms/i.test(homeText));
  check("kitchen and living labels in plain words", /One kitchen and living area/.test(homeText) && /Separate kitchen area and living room/.test(homeText) && /Two living rooms and a kitchen area/.test(homeText));
  check("ownership and timeframe asked here", /Do you own the home/.test(homeText) && /When are you hoping to install/.test(homeText));
  check("no photo uploads, fuse-board question, name or phone", (await page.locator('input[type="file"]').count()) === 0 && !/fuse board/i.test(homeText) && (await page.locator('input[autocomplete="name"], input[type="tel"]').count()) === 0);
  check("no autofocus keyboard pop on step change", !(await focusIsTextInput()));
  const homePrice = await price();
  await rooms.first().uncheck();
  check("unticking a room changes the price", (await price()) !== homePrice);
  await rooms.first().check();
  check("no finance example without a lender", !/\/mo\b|\bAPR\b/.test((await page.locator("main").textContent()) ?? ""));

  // 5. Saved as they go: a reload on this device comes back to "Your home".
  await page.waitForTimeout(3000);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("text=Rooms to air-condition", { timeout: 15000 });
  check("a refresh comes back to the same page", true);

  // 6. Next: confirm your price → the saved quote page (or the demo result when there's no database).
  await page.click('button:has-text("Next: confirm your price")');
  await page.waitForSelector("text=Book my virtual survey", { timeout: 20000 });
  const result = (await page.locator("main").textContent()) ?? "";
  check("price renders on the result", /£[0-9,]+/.test(result));
  check("result says confirmed at survey, not locked", /confirmed at your (home )?survey/i.test(result) && !/price locked|guaranteed/i.test(result));
  check("result states validity", /Valid (until|for)/.test(result));
  check("the next step is the virtual survey", /Confirm your price with a virtual survey/.test(result));

  // 7. Coming back with the same email and postcode on another device: we email the link, no second quote.
  const other = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await other.goto(`${BASE}/quote?postcode=${encodeURIComponent("SW16 2BE")}&address=${encodeURIComponent("12 Example Road")}`, { waitUntil: "networkidle" });
  await other.waitForSelector("text=Your guide price", { timeout: 20000 });
  await other.click('button:has-text("Refine my quote")');
  await other.waitForSelector("text=Refine your quote");
  await other.fill('input[type="email"]', `back-${email}`);
  await other.click('button[type="submit"]');
  await other.waitForSelector("text=Rooms to air-condition", { timeout: 15000 });
  await other.close();
  const third = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await third.goto(`${BASE}/quote?postcode=${encodeURIComponent("SW16 2BE")}&address=${encodeURIComponent("12 Example Road")}`, { waitUntil: "networkidle" });
  await third.waitForSelector("text=Your guide price", { timeout: 20000 });
  await third.click('button:has-text("Refine my quote")');
  await third.waitForSelector("text=Refine your quote");
  await third.fill('input[type="email"]', `back-${email}`);
  await third.click('button[type="submit"]');
  await third.waitForSelector("text=Welcome back", { timeout: 15000 });
  check("same email and postcode again: we email the link instead of a second quote", /emailed you a link/.test((await third.locator("main").textContent()) ?? ""));
  await third.close();

  // 8. The journey continues: Book my virtual survey → the project page.
  await page.click('button:has-text("Book my virtual survey")');
  await page.waitForURL("**/p/**", { timeout: 15000 });
  check("Book my virtual survey lands on the project page", page.url().includes("/p/"));
  await page.waitForLoadState("networkidle");
  const hub = (await page.locator("main").textContent()) ?? "";
  check("the browser that saved the quote opens its project (no sign-in wall)", !/Sign in to see your project/.test(hub));
  check("no placeholder phone number on the project page", !/0800 000 0000/.test(hub));

  // 10. Out of area: honest, with an optional heads-up, before any price.
  await page.goto(`${BASE}/quote?postcode=${encodeURIComponent("E8 1AA")}&address=12`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=/not in .*E8/i", { timeout: 15000 });
  check("out-of-area postcode is told the truth", (await page.locator("text=/we cover/i").count()) === 0);
  check("no price is shown out of area", !/guide price/i.test((await page.locator("main").textContent()) ?? ""));
  await page.fill('input[type="email"]', "later@example.com");
  await page.click('button:has-text("Tell me when")');
  await page.waitForSelector("text=/We'll email/", { timeout: 15000 });
  check("out-of-area heads-up is stored", true);

  // 11. A direct visit with no address: the address screen, then the price.
  // "load", not "networkidle": a Next.js prefetch can sit open in the browser (the server answers it at once),
  // and the screen itself is what's waited for next.
  await page.goto(`${BASE}/quote`, { waitUntil: "load" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "load" });
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
  await page.waitForSelector("text=Your guide price", { timeout: 20000 });
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
