/**
 * The whole pilot, end to end, in a real browser, the way the people who use
 * it do: admin at a desk, customers and the crew on their phones.
 *
 *   A  Admin (DEMO sign-in) sets up a new pilot (pilot number typed in), owner and surveyor.
 *   B  Customer opens their sign-in link, books the survey, agrees to documents by email.
 *   C  Surveyor on a phone: on my way, start, every section (2 rooms measured, photos,
 *      a drawing with the indoor unit and pipe route), outdoor, electrics, PD checks, risks, submit at 100%.
 *   D  Catalogue loaded and priced (CSV price list), design drafted by the surveyor, layout
 *      photos chosen, sent for review, approved and signed by the technical lead (F-gas).
 *   E  Proposal: two options, cost-plus, PILOT15; issue is blocked by the Schedule 2 settings,
 *      which are filled in, then it issues.
 *   F  Customer: views, accepts option 1 with an early-start request and a typed name; the
 *      contract document renders.
 *   G  Ops: early-start evidence, install dates, crew, deposit invoice paid by bank transfer,
 *      booking confirmed, purchase orders ordered, delivered and checked, compliance approved.
 *   H  Field, on phones: Today shows the job next up on its booked day; on my way, day 1
 *      started (the app records today as day 1: the 5-day lead time means the booked dates are
 *      never today, and no ops date change can make them today), so this project runs end to
 *      end instead of a seeded one. Every step's evidence, an issue and a variation (the
 *      customer approves it on the portal), end-of-day updates with photos (never the issue's)
 *      and learnings; electrical steps by the electrician, F-gas steps by the technical lead.
 *   I  Technical lead sets the job's targets and signs commissioning: the certificate renders.
 *   J  Handover pack published, customer signs "All good" on the installer's phone, the crew
 *      ends day 3 after it (update, learnings, clock), balance invoice paid (DEMO card
 *      simulator), electrical certificate in, warranty registered, open issues resolved,
 *      closed; the customer's documents are all there.
 *   K  Every customer message logged as demo; /ops/pilots shows the pilot with its numbers;
 *      the CSV downloads.
 *   L  Isolation and permissions: a duplicate pilot number, another customer (pages,
 *      documents, invoices, photos, the variation API), a subcontractor (ops pages, other
 *      jobs, media APIs), signed-out visitors, a forged cookie, a bad Stripe signature, the
 *      demo seed route.
 *
 * It boots nothing: point it at a production build on the local file backend.
 *
 *   pnpm --filter @aircon/web build
 *   cd apps/web && DATA_BACKEND=file LOCAL_DATA_DIR=$(mktemp -d) ALLOW_DEMO_LOGIN=1 \
 *     SESSION_SECRET=<at least 32 characters> PORT=3330 npx next start
 *   BASE_URL=http://localhost:3330 pnpm --filter @aircon/web test:e2e:pilot
 *
 * Use a fresh LOCAL_DATA_DIR per run. Every person, home and price here is
 * fictional and labelled DEMO; customers use example.com addresses, which a
 * demo deployment may show sign-in links for on screen (nothing is emailed).
 *
 * Env: BASE_URL (default http://localhost:3330), CHROMIUM_PATH (else found
 * under PLAYWRIGHT_BROWSERS_PATH or /opt/pw-browsers), SHOTS_DIR (screenshots;
 * default a new temp dir, printed at the end), E2E_UNTIL (a phase letter: stop
 * after it, to set up data for poking at by hand).
 *
 * Phones are 390x844 (customer, surveyor, crew); ops is a 1280x800 desk.
 * Exit code 0 only if every check passed; on a failure each person's last
 * requests are printed and a FAIL screenshot is taken of every open page.
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

/* ------------------------------------------------------------------ */
/* Set-up                                                              */
/* ------------------------------------------------------------------ */

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

const BASE = (process.env.BASE_URL ?? "http://localhost:3330").replace(/\/$/, "");
const SHOTS = process.env.SHOTS_DIR ?? mkdtempSync(join(tmpdir(), "e2e-pilot-"));
mkdirSync(SHOTS, { recursive: true });
const RUN = Date.now().toString(36).slice(-5);
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESK = { viewport: { width: 1280, height: 800 } };

/** A small photo (a PNG drawn here, no fixtures): a wall-ish gradient with a grid. */
function makePng(w, h, [r0, g0, b0]) {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const i = y * (w * 3 + 1) + 1 + x * 3;
      const grid = x % 40 === 0 || y % 40 === 0 ? -40 : 0;
      raw[i] = Math.max(0, Math.min(255, r0 + grid - (y * 30) / h));
      raw[i + 1] = Math.max(0, Math.min(255, g0 + grid - (y * 30) / h));
      raw[i + 2] = Math.max(0, Math.min(255, b0 + grid + (x * 20) / w));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const PHOTO = join(SHOTS, "demo-photo.png");
writeFileSync(PHOTO, makePng(640, 480, [214, 206, 192]));

/* ------------------------------------------------------------------ */
/* Reporting                                                           */
/* ------------------------------------------------------------------ */

const fails = [];
const serverErrors = [];
let checks = 0;
function check(name, ok, detail) {
  checks++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${!ok && detail ? `\n      ${String(detail).slice(0, 400)}` : ""}`);
  if (!ok) fails.push(name);
  return ok;
}
/** A check the rest of the walk depends on. */
function must(name, ok, detail) {
  if (!check(name, ok, detail)) throw new Error(`Stopped: ${name}`);
}

const browser = await chromium.launch({ executablePath: findChromium(), args: ["--no-sandbox"] });
const pages = {};
const trails = {};

/** A person with their own browser (cookies, phone or desk). */
async function person(key, kind) {
  const context = await browser.newContext(kind === "phone" ? PHONE : DESK);
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  // Confirm dialogs ("Issue this invoice?") are answered yes, as a person would.
  page.on("dialog", (d) => d.accept().catch(() => {}));
  page.on("response", (r) => {
    if (r.status() >= 500 && !r.url().includes("/api/stripe/webhook")) serverErrors.push(`${key}: ${r.status()} ${r.request().method()} ${r.url()}`);
  });
  // Keep the last HTML document this person loaded: a hydration error is diagnosed by diffing it with the DOM.
  let lastDoc = { url: "", html: "" };
  page.on("response", (r) => {
    if (r.request().resourceType() === "document" && r.status() === 200) r.text().then((html) => (lastDoc = { url: r.url(), html }), () => {});
  });
  page.on("pageerror", (e) => {
    serverErrors.push(`${key}: page error on ${page.url()} (${currentPhase}, ${new Date().toISOString().slice(11, 19)}): ${e.message}`);
    if (/error #(418|419|423|425)/.test(e.message)) {
      const n = serverErrors.length;
      setTimeout(() => {
        writeFileSync(join(SHOTS, `hydration-${n}-${key}-server.html`), `<!-- ${lastDoc.url} -->\n${lastDoc.html}`);
        page.content().then((dom) => writeFileSync(join(SHOTS, `hydration-${n}-${key}-dom.html`), dom), () => {});
      }, 300);
    }
  });
  // The last few requests and console lines, printed when a step doesn't take.
  const trail = [];
  const note = (line) => {
    trail.push(`${new Date().toISOString().slice(11, 23)} ${line}`);
    if (trail.length > 80) trail.shift();
  };
  page.on("request", (r) => r.method() !== "GET" || r.headers()["rsc"] ? note(`→ ${r.method()} ${r.url().replace(BASE, "")}${r.headers()["next-action"] ? " [action]" : ""}${r.headers()["rsc"] ? " [rsc]" : ""}`) : undefined);
  page.on("response", (r) => (r.request().method() !== "GET" || r.request().headers()["rsc"] ? note(`← ${r.status()} ${r.url().replace(BASE, "")}`) : undefined));
  page.on("requestfailed", (r) => note(`✗ ${r.method()} ${r.url().replace(BASE, "")} ${r.failure()?.errorText}`));
  page.on("console", (m) => note(`console ${m.type()}: ${m.text().slice(0, 200)}`));
  trails[key] = trail;
  pages[key] = page;
  return page;
}

/**
 * React has hydrated the page: its event handlers are attached. Clicking a
 * server-rendered button before that does nothing, so every navigation
 * waits for it (React marks hydrated DOM nodes with __reactFiber keys).
 */
async function hydrated(page) {
  await page
    .waitForFunction(
      () => {
        // Every control on the page: Suspense boundaries hydrate one by one, in any order.
        const els = [...document.querySelectorAll('main button, main input:not([type="hidden"]), main select, main textarea, body > div button')];
        return els.every((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber") || k.startsWith("__reactProps")));
      },
      undefined,
      { timeout: 20_000 },
    )
    .catch(() => {});
}

/** Open a page and wait until it's usable. */
async function go(page, path) {
  const r = await page.goto(path.startsWith("http") ? path : `${BASE}${path}`, { waitUntil: "load" });
  await hydrated(page);
  return r;
}

/** "Try as…" on /login, with that person's own browser. */
async function tryAs(page, role) {
  await go(page, "/login");
  await page.locator("form").filter({ has: page.locator(`input[name="role"][value="${role}"]`) }).getByRole("button").click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 });
  await page.waitForLoadState("load");
  await hydrated(page);
}

let shotN = 0;
async function shot(page, name, fullPage = false) {
  shotN++;
  const file = join(SHOTS, `${String(shotN).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage }).catch(() => {});
  return file;
}

const text = async (page, sel = "main") => ((await page.locator(sel).first().innerText().catch(() => "")) ?? "").replace(/\n{2,}/g, "\n");
const has = async (page, re, sel = "main") => re.test(await text(page, sel));
/** Wait until the page says something (the server re-rendered after an action). */
async function waitFor(page, re, timeout = 20_000, sel = "main") {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (re.test(await text(page, sel))) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

/** Does it appear within the time? */
const visible = (locator, timeout = 15_000) =>
  locator
    .first()
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);

/** Tick a radio or checkbox the way a thumb does: on its label (many are styled, with the input hidden). */
async function choose(input) {
  const label = input.locator("xpath=ancestor::label[1]");
  if (await label.count()) await label.click();
  else await input.check({ force: true });
}

/** E2E_UNTIL=E stops after phase E (for working on one part of the walk). */
const UNTIL = (process.env.E2E_UNTIL ?? "").toUpperCase();
let stopped = false;
let currentPhase = "set-up";
async function phase(title, fn) {
  if (stopped) return;
  currentPhase = title.split(" ")[0];
  console.log(`\n${title}`);
  await fn();
  if (UNTIL && title.startsWith(UNTIL)) stopped = true;
}

const ids = {};

/* ------------------------------------------------------------------ */
/* Field helpers: evidence slots, targets, day start and end          */
/* ------------------------------------------------------------------ */

/** A plausible reading for a slot, from its window when it has one, else from its unit and label. */
function readingFor(slotText) {
  const n = Number;
  let m = slotText.match(/window (-?[\d.]+) to (-?[\d.]+)/);
  if (m) return String(Math.round(((n(m[1]) + n(m[2])) / 2) * 100) / 100);
  m = slotText.match(/window at least (-?[\d.]+)/);
  if (m) return String(n(m[1]) + 1);
  m = slotText.match(/window at most (-?[\d.]+)/);
  if (m) return String(Math.round(n(m[1]) * 0.6 * 100) / 100);
  m = slotText.match(/window (-?[\d.]+)\b/);
  if (m) return m[1];
  m = slotText.match(/design: (\d+) g/);
  if (m) return m[1];
  if (/· bar/.test(slotText)) return "30";
  if (/· microns?/.test(slotText)) return /after|decay|hold/i.test(slotText) ? "420" : "350";
  if (/· kg/.test(slotText)) return "1.1";
  if (/· °C/.test(slotText)) return /heating/i.test(slotText) ? "19" : "11.5";
  if (/· dB/.test(slotText)) return "38";
  if (/· N·m/.test(slotText)) return /gas|9\.52|3\/8/i.test(slotText) ? "42" : "18";
  if (/· mm\/m/.test(slotText)) return "10";
  if (/· Ω/.test(slotText)) return "0.3";
  if (/· m\b/.test(slotText)) return "10";
  return "20";
}

/** Capture every required slot of one runsheet step. Returns a line for the log. */
async function completeStep(page, li, refFor) {
  const head = li.locator("h3 button");
  const title = (await head.innerText()).replace(/\s+/g, " ").trim();
  if (/ (Done|N\/A) /.test(` ${title} `)) return { title, state: "done" };
  if (/· locked/.test(title)) return { title, state: "locked" };
  if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
  const body = li.locator(":scope > div").first();
  const slots = body.locator(":scope > ul > li");
  const count = await slots.count();
  for (let i = 0; i < count; i++) {
    if ((await head.getAttribute("aria-expanded")) !== "true") break; // the step completed and folded away
    const s = slots.nth(i);
    const t = (await s.innerText()).replace(/\s+/g, " ");
    if (/\(optional\)/.test(t)) continue;
    const tick = s.locator('button[aria-pressed="false"]:not([disabled])').filter({ hasText: "Confirm" });
    if (await tick.count()) {
      await tick.first().click();
      await page.waitForTimeout(400);
      continue;
    }
    const take = s.getByRole("button", { name: /^(Take photo|Film it)$/ });
    if (await take.count()) {
      await s.locator('input[type="file"][capture]').first().setInputFiles(PHOTO);
      for (let w = 0; w < 80 && (await take.count()); w++) await page.waitForTimeout(250);
      continue;
    }
    const input = s.locator('input:not([type="file"])').first();
    if (await input.count()) {
      const ph = (await input.getAttribute("placeholder")) ?? "";
      if (/Change it|New reading/.test(ph)) continue;
      const value = /Reading/.test(ph) ? readingFor(t) : refFor(t);
      await input.fill(value);
      await s.getByRole("button", { name: "Save", exact: true }).click();
      await page.waitForTimeout(500);
    }
  }
  for (let w = 0; w < 40; w++) {
    const now = (await head.innerText()).replace(/\s+/g, " ");
    if (/ Done /.test(` ${now} `)) return { title, state: "completed" };
    await page.waitForTimeout(250);
  }
  return { title, state: "incomplete", now: (await head.innerText()).replace(/\s+/g, " ") };
}

/** Every step on the open day page this person may do. */
async function completeDay(page, refFor = () => `DEMO-SN-${Math.floor(Math.random() * 1e6)}`) {
  const steps = page.locator("main li").filter({ has: page.locator("h3 > button[aria-expanded]") });
  const out = [];
  const count = await steps.count();
  for (let i = 0; i < count; i++) out.push(await completeStep(page, steps.nth(i), refFor));
  return out;
}

async function openActions(page) {
  await page.getByRole("button", { name: "Actions" }).click();
  return page.locator('[role="dialog"]').last();
}

async function startDay(page, n) {
  const sheet = await openActions(page);
  await sheet.getByRole("button", { name: new RegExp(`^Arrived: start day ${n}`) }).click();
  const d = page.locator('[role="dialog"]').last();
  const intro = await d.innerText();
  await d.getByRole("button", { name: `Start day ${n}` }).click();
  await d.getByText(/Day \d+ started\.|can't start yet|You're offline/).waitFor({ timeout: 30_000 });
  const outcome = await d.innerText();
  await d.getByRole("button", { name: /^(Go to the runsheet|Close)$/ }).last().click();
  return { intro, outcome };
}

async function endDay(page, n, update, learnings) {
  const sheet = await openActions(page);
  await sheet.getByRole("button", { name: new RegExp(`^End day ${n}`) }).click();
  const d = page.locator('[role="dialog"]').last();
  await d.getByLabel("Summary for the office").fill(`DEMO: day ${n} complete, nothing outstanding.`);
  await d.getByLabel("Update for the customer").fill(update);
  await d.getByRole("button", { name: "Next: customer update" }).click();
  const boxes = d.locator('input[type="checkbox"]');
  await boxes.first().waitFor();
  // Two finished-work photos (the newest first). Each is named by its caption (the issue photo's would be its title).
  const offered = [];
  for (let i = 0; i < (await boxes.count()); i++) offered.push((await boxes.nth(i).getAttribute("aria-label")) ?? "");
  let picked = 0;
  for (let i = 0; i < offered.length && picked < 2; i++) {
    if (/DEMO:/.test(offered[i])) continue;
    await choose(boxes.nth(i));
    picked++;
  }
  await d.getByRole("button", { name: "Preview the update" }).click();
  await d.getByText("PREVIEW · EMAIL TO THE CUSTOMER", { exact: false }).waitFor();
  const preview = await d.innerText();
  await d.getByRole("button", { name: new RegExp(`^End day ${n} and send`) }).click();
  await d.getByText(new RegExp(`Day ${n} closed`)).waitFor({ timeout: 20_000 });
  const closed = await d.innerText();
  await d.getByRole("button", { name: /^Two minutes/ }).click();
  for (const [q, a] of Object.entries(learnings ?? {})) await d.getByLabel(q).fill(a);
  await d.getByRole("button", { name: learnings ? "Save and finish" : "Skip" }).click();
  await d.getByRole("button", { name: /Done|Close/ }).first().click().catch(() => {});
  return { preview, closed, picked, offered };
}

const TARGETS = {
  "Nitrogen test pressure": { min: "2", max: "41.5" },
  "Vacuum target": { max: "500" },
  "Decay test": { max: "500" },
  "Flare torque": {},
  "Condensate drain fall": { recordOnly: true },
};
async function setTargets(page) {
  const out = [];
  for (let round = 0; round < 12; round++) {
    const cards = page
      .locator("main li")
      .filter({ has: page.getByRole("button", { name: /^(Set target|Confirm these numbers)$/ }) })
      .filter({ hasText: /No target yet|Candidate: confirm it/ });
    if (!(await cards.count())) break;
    const c = cards.first();
    const label = (await c.locator("p").first().innerText()).trim();
    const t = TARGETS[Object.keys(TARGETS).find((k) => label.startsWith(k)) ?? ""] ?? {};
    if (t.min !== undefined) await c.getByLabel(/^Minimum/).fill(t.min);
    if (t.max !== undefined) await c.getByLabel(/^Maximum/).fill(t.max);
    await c.getByLabel("Source (manual page)").fill("DEMO: installation manual, commissioning table");
    await c.getByRole("button", { name: t.recordOnly ? "Record only" : /^(Set target|Confirm these numbers)$/ }).click();
    await page.waitForTimeout(1200);
    const err = await c.getByRole("alert").allInnerTexts().catch(() => []);
    out.push(`${label}${err.length ? `: ${err.join(" ")}` : ""}`);
    if (err.length) break;
  }
  return out;
}

/** Approve (or mark not applicable) every open compliance item a reviewer can settle, except those named. */
async function reviewCompliance(page, skip = /$^/) {
  const done = [];
  for (let round = 0; round < 30; round++) {
    const cards = page.locator("main li").filter({ has: page.locator("h3") }).filter({ has: page.locator("summary", { hasText: /^\s*▸?\s*Review\s*$/ }) });
    let acted = false;
    const count = await cards.count();
    for (let i = 0; i < count; i++) {
      const c = cards.nth(i);
      const label = (await c.locator("h3").innerText()).trim();
      const body = await c.innerText();
      if (skip.test(label) || /\n(Approved|Not applicable)\n/.test(body) || /Updates automatically/.test(body)) continue;
      const det = c.locator("details").filter({ has: page.locator("summary", { hasText: /^\s*▸?\s*Review\s*$/ }) });
      if (!(await det.evaluate((e) => e.open))) await det.locator("summary").click();
      const approve = det.getByLabel("Approve", { exact: true });
      if (await approve.count()) await approve.check();
      else await det.getByLabel("Not applicable", { exact: true }).check();
      await det.locator("textarea").fill(`DEMO: checked against the survey record, photos and design (${label}).`);
      await det.getByRole("button", { name: "Save the review" }).click();
      await page.waitForTimeout(1500);
      const err = await c.locator('[role="alert"]').allInnerTexts().catch(() => []);
      if (err.join("").trim()) throw new Error(`Compliance review refused for ${label}: ${err.join(" ")}`);
      done.push(label);
      acted = true;
      break;
    }
    if (!acted) break;
  }
  return done;
}

/* ------------------------------------------------------------------ */
/* The walk                                                            */
/* ------------------------------------------------------------------ */

const CUSTOMER = { name: "Pat Example (DEMO)", email: `demo.pat.${RUN}@example.com`, phone: "07700 900123", address: `${RUN.toUpperCase()} Demo Street` };
const CUSTOMER2 = { name: "Robin Sample (DEMO)", email: `demo.robin.${RUN}@example.com`, address: `${RUN.toUpperCase()} Sample Road` };

try {
  const admin = await person("admin", "desk");

  await phase("A · Admin sets up a new pilot", async () => {
    await tryAs(admin, "admin");
    check("demo admin lands on the ops console", admin.url().endsWith("/ops") && (await has(admin, /Today/)));
    await go(admin, `/ops/projects/new`);
    await admin.fill('input[name="name"]', CUSTOMER.name);
    await admin.fill('input[name="email"]', CUSTOMER.email);
    await admin.fill('input[name="phone"]', CUSTOMER.phone);
    await admin.fill('input[name="addressLine"]', CUSTOMER.address);
    await admin.fill('input[name="postcode"]', "SW16 2BE");
    const suggested = await admin.locator('input[name="pilotNumber"]').inputValue();
    check("pilot number defaults to the next free one", /^\d+$/.test(suggested), suggested);
    // The admin types the pilot number they've agreed for this household.
    ids.pilotNumber = suggested;
    await admin.fill('input[name="pilotNumber"]', ids.pilotNumber);
    await admin.fill('input[name="pilotLabel"]', "DEMO Streatham semi");
    await choose(admin.getByLabel(/Email them a link to their project now/));
    check("the form shows an instant price before anything is saved", await has(admin, /What gets created\s*£[\d,]+/));
    await shot(admin, "A-new-pilot");
    await admin.getByRole("button", { name: "Set up the pilot" }).click();
    const box = admin.locator('[role="status"]').filter({ hasText: "the customer's link" });
    await box.waitFor({ timeout: 20_000 });
    ids.link = (await box.locator("p.font-mono").innerText()).trim();
    check("email isn't set up, so the DEMO customer's link is shown on screen (never for a real address)", /^\/auth\/verify\?t=/.test(ids.link), ids.link);
    await box.getByRole("link", { name: "Open the project" }).click();
    await admin.waitForURL(/\/ops\/projects\/[0-9a-f-]{36}/);
    ids.pid = admin.url().match(/projects\/([0-9a-f-]{36})/)[1];
    await admin.waitForLoadState("load");
    await hydrated(admin);
    check("command centre shows the pilot tag", await has(admin, new RegExp(`Pilot ${ids.pilotNumber} · DEMO Streatham semi`)));
    check("command centre says the survey is next", await has(admin, /The home survey isn't booked yet/));

    // Owner and surveyor.
    const owner = admin.locator("form").filter({ has: admin.locator('select[name="staffId"]') }).filter({ hasText: "Owner" }).first();
    await owner.locator("select").selectOption({ label: "DEMO Ada (admin)" });
    await owner.getByRole("button", { name: "Set" }).click();
    await admin.waitForTimeout(1200);
    check("owner is DEMO Ada", (await owner.locator("select option:checked").innerText()).includes("DEMO Ada"));
    await admin.locator("summary").filter({ hasText: "Assign a surveyor" }).click();
    const assign = admin.locator("form").filter({ has: admin.getByRole("button", { name: "Assign" }) }).first();
    await assign.locator("select").selectOption({ label: "DEMO Sam (surveyor)" });
    await assign.getByRole("button", { name: "Assign" }).click();
    check("surveyor assigned", await waitFor(admin, /Surveyor\s*DEMO Sam \(surveyor\)/));
    await shot(admin, "A-command-centre");

    // Tokens are never stored: the outbox keeps a placeholder where the link goes.
    await go(admin, `/ops/messages?event=magic-link`);
    check("the sign-in email is logged as Demo, not sent, to the customer", await has(admin, new RegExp(`Magic link · Email to ${CUSTOMER.email.replace(/\./g, "\\.")}`)) && (await has(admin, /Demo, not sent/)));
  });

  const customer = await person("customer", "phone");
  await phase("B · Customer signs in from their link and books the survey", async () => {
    await go(customer, `${ids.link}`);
    check("the link asks before signing in (masked address)", await has(customer, /Continue as d\*\*\*@example\.com/, "body"));
    await customer.getByRole("button", { name: /^Continue as/ }).click();
    await customer.waitForURL(new RegExp(`/p/${ids.pid}`));
    await customer.waitForLoadState("load");
    await hydrated(customer);
    check("lands on their project page", await waitFor(customer, /Hello, Pat/));
    check("one next step: book the survey", await has(customer, /YOUR NEXT STEP\s*Book your home survey/));
    await shot(customer, "B-hub");
    const m = customer.locator("main");
    // The first day with a free slot (other surveys may have taken some), and its last time.
    const days = m.locator('input[type="radio"][name$="-day"]');
    const times = m.locator('input[type="radio"][name$="-time"]');
    for (let i = 0; i < (await days.count()); i++) {
      await choose(days.nth(i));
      await customer.waitForTimeout(200);
      if ((await times.count()) > 0) break;
    }
    must("a survey slot is free", (await times.count()) > 0);
    await choose(times.last());
    await choose(m.getByLabel(/^I'm happy to receive my proposal and contract documents by email/));
    const book = m.getByRole("button", { name: /^Book my survey: / });
    ids.surveySlot = (await book.innerText()).replace("Book my survey: ", "");
    await book.click();
    check("survey booked, and the next step says how to get ready", await waitFor(customer, /Get ready for your survey/));
    check("the booking and the consent are on the timeline", (await has(customer, /You agreed to get your proposal, contract and cancellation information by email/)) && (await has(customer, /Home survey booked for/)));
    check("the survey is free to move, as advertised (no short-notice fee)", (await has(customer, /Move my survey\s*Free to move/)) && !(await has(customer, /short-notice fee/)));
    await shot(customer, "B-booked");

    // Reopening the used link: still signed in, they go straight back to their project, never the team sign-in.
    await go(customer, `${ids.link}`);
    check("a used link, still signed in: back to their project", new RegExp(`/p/${ids.pid}`).test(customer.url()) && !(await has(customer, /Team sign-in/, "body")), customer.url());
    const stranger = await person("stranger", "phone");
    await go(stranger, `${ids.link}`);
    check(
      "a used link, signed out: a customer page that offers a fresh link",
      /\/portal\?link=expired/.test(stranger.url()) && (await has(stranger, /That link has expired or was already used/, "body")) && (await has(stranger, /Your email address/, "body")) && !(await has(stranger, /^Team sign-in$/m, "h1")),
      stranger.url(),
    );
    await stranger.context().close();
  });

  const surveyor = await person("surveyor", "phone");
  await phase("C · Surveyor on a phone", async () => {
    await tryAs(surveyor, "surveyor");
    await go(surveyor, `/field/survey/${ids.pid}`);
    check("survey visit card shows the booked slot", await waitFor(surveyor, new RegExp(ids.surveySlot)), ids.surveySlot);
    await surveyor.getByRole("button", { name: "On my way" }).click();
    let sheet = surveyor.locator('[role="dialog"]').last();
    await sheet.getByRole("button", { name: "30 min" }).click();
    check("the ETA text is previewed before sending", await visible(sheet.getByText(/DEMO Sam \(surveyor\) is on the way to your home survey/)));
    await sheet.getByRole("button", { name: /^Send: about 30 min/ }).click();
    await sheet.getByText(/Recorded at .*not sent: demo mode/).waitFor();
    check("ETA recorded honestly (demo mode, not sent)", true);
    await sheet.getByRole("button", { name: "Done" }).click();
    await surveyor.getByRole("button", { name: "Start survey" }).click();
    await surveyor.getByText(/to do/).first().waitFor();
    await shot(surveyor, "C-sections");
    const m = surveyor.locator("main");
    const open = async (name) => {
      await m.getByRole("button", { name: new RegExp(`^${name}`) }).first().click();
      await surveyor.waitForTimeout(400);
    };
    const next = async (name) => {
      await surveyor.getByRole("button", { name: new RegExp(`^Next: ${name}`) }).click();
      await surveyor.waitForTimeout(400);
    };

    await open("Site & people");
    await choose(m.getByLabel("Address confirmed"));
    await m.getByLabel("Who makes the decision?").fill(CUSTOMER.name);
    await choose(m.getByLabel("Owner", { exact: true }));
    await choose(m.getByLabel("Authority to go ahead confirmed"));
    await m.getByLabel("Access").fill("DEMO: side gate on the left, key safe 1234");
    await m.getByLabel("Parking").fill("DEMO: on street, no permit needed");
    check("site section complete", await waitFor(surveyor, /Nothing left to do here/));
    await next("Wishes");
    await choose(m.getByLabel("Quiet"));
    await choose(m.getByLabel("Main heating"));
    await m.getByLabel("When would they like it?").fill("Before the winter");
    await next("House");
    await m.getByLabel("Main wall construction").selectOption("cavity");
    await choose(m.getByLabel("Yes, a hatch we can use"));
    await choose(m.locator("fieldset").filter({ has: surveyor.locator("legend", { hasText: "Listed, conservation" }) }).getByLabel("No", { exact: true }));
    await choose(m.getByLabel("Nothing suspected"));
    check("house section complete", await waitFor(surveyor, /Nothing left to do here/));
    await next("Rooms");
    // Two rooms surveyed: the living room and the main bedroom. The rest are left out.
    const include = m.getByText("Survey this room", { exact: true });
    await include.nth(1).click(); // kitchen
    await include.nth(3).click(); // bedroom 2
    await include.nth(4).click(); // bedroom 3
    await surveyor.waitForTimeout(500);
    await m.getByText("Living room", { exact: true }).first().click();
    await surveyor.waitForTimeout(400);

    // Living room: photo, drawing (indoor unit + pipe route), measurements.
    await m.getByLabel("Choose photo").setInputFiles(PHOTO);
    await m.getByText("Mark up", { exact: true }).waitFor({ timeout: 30_000 });
    await m.getByText("Mark up", { exact: true }).click();
    const dlg = surveyor.locator('[role="dialog"]').last();
    const img = dlg.locator("img").first();
    await img.waitFor();
    const b = await img.boundingBox();
    const at = (fx, fy) => [b.x + b.width * fx, b.y + b.height * fy];
    await dlg.getByRole("button", { name: "Indoor unit", exact: true }).click();
    const [x1, y1] = at(0.3, 0.15);
    const [x2, y2] = at(0.7, 0.3);
    await surveyor.mouse.move(x1, y1);
    await surveyor.mouse.down();
    await surveyor.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 4 });
    await surveyor.mouse.move(x2, y2, { steps: 4 });
    await surveyor.mouse.up();
    await dlg.getByRole("button", { name: "Done", exact: true }).click();
    await dlg.getByRole("button", { name: "Pipe route" }).click();
    for (const [fx, fy] of [[0.7, 0.22], [0.9, 0.22], [0.9, 0.85]]) {
      const [x, y] = at(fx, fy);
      await surveyor.mouse.click(x, y);
      await surveyor.waitForTimeout(150);
    }
    await dlg.getByRole("button", { name: "Done", exact: true }).click();
    check("the drawing has an indoor unit and a pipe route", /Indoor unit[\s\S]*Pipe route/.test(await dlg.innerText()));
    await shot(surveyor, "C-annotation");
    await dlg.getByRole("button", { name: "Save", exact: true }).click();
    check("drawing saved (the photo now offers to edit it)", await visible(m.getByText("Edit drawing")));
    await m.getByLabel(/^Length/).fill("5.2");
    await m.getByLabel(/^Width/).fill("4.1");
    await m.getByLabel(/^Ceiling height/).fill("2.4");
    await choose(m.locator('input[type="radio"][value="south"]'));
    await m.getByLabel("Wall the unit fixes to").selectOption("cavity");
    await m.getByLabel(/^Pipe run/).fill("4");
    await m.getByLabel(/^Height difference/).fill("0");
    await choose(m.getByLabel("Straight through the wall"));
    await choose(m.getByLabel("Gravity"));
    check("living room complete", await waitFor(surveyor, /Nothing left to do here/));
    await surveyor.getByRole("button", { name: /^Next room: Main bedroom/ }).click();
    await surveyor.waitForTimeout(400);
    await m.getByLabel("Choose photo").setInputFiles(PHOTO);
    await m.getByText("Mark up", { exact: true }).waitFor({ timeout: 30_000 });
    await m.getByLabel(/^Length/).fill("3.8");
    await m.getByLabel(/^Width/).fill("3.4");
    await m.getByLabel(/^Ceiling height/).fill("2.4");
    await choose(m.locator('input[type="radio"][value="west"]'));
    await m.getByLabel(/^Pipe run/).fill("6");
    await m.getByLabel(/^Height difference/).fill("2.5");
    await choose(m.getByLabel("Outside, in trunking"));
    await choose(m.getByLabel("Pump"));
    check("main bedroom complete", await waitFor(surveyor, /Nothing left to do here/));
    await shot(surveyor, "C-room");
    await next("Outdoor");
    await m.getByText(/Customer's choice:/).first().click();
    await surveyor.waitForTimeout(400);
    await choose(m.getByLabel(/^Use this position/));
    await m.getByLabel("Choose photo").setInputFiles(PHOTO);
    await m.getByText("Mark up", { exact: true }).waitFor({ timeout: 30_000 });
    await m.getByLabel("Distance to the nearest neighbour's window").fill("6");
    await m.getByRole("button", { name: "Gravel soakaway under the unit" }).click();
    check("outdoor position complete", await waitFor(surveyor, /Nothing left to do here/));
    await next("Electrics");
    await m.getByLabel("Choose photo").setInputFiles(PHOTO);
    await choose(m.getByLabel("Modern, RCD protected"));
    await m.getByLabel("Spare ways").fill("2");
    await choose(m.getByLabel("TN-C-S (PME)"));
    await m.getByLabel(/^Cable run, board to outdoor unit/).fill("9");
    await m.getByLabel("How it would run").fill("DEMO: under the stairs, out through the back wall");
    check("electrics complete (board photo uploaded)", await waitFor(surveyor, /Nothing left to do here/, 30_000));
    await next("Permissions");
    const yes = m.locator('input[type="radio"][value="yes"]');
    for (let i = 0; i < (await yes.count()); i++) await choose(yes.nth(i));
    check("all eight PD checks answered", await waitFor(surveyor, /Nothing left to do here/));
    await next("Risks");
    await choose(m.locator('input[type="radio"][value="yes"]').nth(0));
    await choose(m.locator('input[type="radio"][value="no"]').nth(1));
    await choose(m.locator('input[type="radio"][value="no"]').nth(2));
    await m.getByLabel("Risk notes").fill("DEMO: first-floor core hole from outside, ladder work at about 3 m");
    await next("Assumptions");
    await m.getByLabel("Add to assumptions").fill("DEMO: the cavity is unfilled at the core hole");
    await m.getByRole("button", { name: "Add", exact: true }).first().click();
    await next("Documents by email");
    check("documents-by-email shows as agreed (the customer ticked it)", !(await has(surveyor, /Record their agreement/)) || (await has(surveyor, /agreed|Agreed/)));
    await next("Check and submit");
    check("completeness is 100% (All done)", await has(surveyor, /All done/) && (await has(surveyor, /Everything's in/)));
    await shot(surveyor, "C-check");
    await surveyor.getByRole("button", { name: "Submit survey" }).click();
    await surveyor.getByRole("button", { name: "Submit", exact: true }).click();
    check("survey submitted", await waitFor(surveyor, /Survey submitted/, 30_000));
    check("self-survey diff is shown", await has(surveyor, /Customer's survey vs what we measured/));
    await shot(surveyor, "C-submitted");
  });

  const tech = await person("tech", "desk");
  const designer = await person("designer", "desk");
  await phase("D · Catalogue, design, review and sign-off", async () => {
    await tryAs(tech, "tech-lead");
    await tryAs(designer, "surveyor");
    await go(designer, `/ops/projects/${ids.pid}/design`);
    if (await has(designer, /The catalogue needs loading first/)) {
      await go(tech, `/ops/catalogue`);
      await tech.getByRole("button", { name: "Load researched catalogue" }).click();
      check("researched catalogue loaded", await waitFor(tech, /Catalogue items/, 30_000));
    }
    // Prices: a DEMO supplier price list (CSV) for everything not yet priced.
    await go(tech, `/ops/catalogue`);
    const [download] = await Promise.all([tech.waitForEvent("download"), tech.getByRole("link", { name: "Export CSV" }).click()]);
    const csv = readFileSync(await download.path(), "utf8");
    const rows = parseCsv(csv);
    const head = rows[0];
    const items = rows.slice(1).map((r) => Object.fromEntries(head.map((k, i) => [k, r[i] ?? ""])));
    const price = (i) =>
      i.kind === "indoor" ? (i.tier === "premium" ? 450 : 320) : i.kind === "outdoor" ? (Number(i.ports || 1) > 1 ? 1150 : 600) : i.kind === "material" ? (/per m|per kg/.test(i.unit) ? 4 : /coil|drum|reel/.test(i.unit) ? 65 : 14) : null;
    const q = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const lines = ["id,kind,label,costGbpExVat,costSupplier,costObservedAt,costNote"];
    for (const i of items) {
      if (i.costGbpExVat) continue;
      const p = price(i);
      if (p !== null) lines.push([i.id, i.kind, q(i.label), p.toFixed(2), "DEMO supplier", new Date().toISOString().slice(0, 10), "DEMO price list"].join(","));
    }
    const priceFile = join(SHOTS, "demo-prices.csv");
    writeFileSync(priceFile, `${lines.join("\r\n")}\r\n`);
    if (lines.length > 1) {
      await go(tech, `/ops/catalogue/import`);
      await tech.locator('input[type="file"]').setInputFiles(priceFile);
      await tech.getByRole("button", { name: "Check the file" }).click();
      const imp = tech.getByRole("button", { name: /^Import \d+ rows?$/ });
      await imp.waitFor();
      await imp.click();
      check(`price list imported (${lines.length - 1} rows)`, await waitFor(tech, /Imported \d+ rows?/, 30_000));
    }

    // The surveyor drafts the design from their own survey.
    await go(designer, `/ops/projects/${ids.pid}/design`);
    if (await designer.getByRole("button", { name: "Draft the design" }).count()) {
      await designer.getByLabel("Brand").selectOption("Panasonic").catch(() => {});
      await designer.getByRole("button", { name: "Draft the design" }).click();
    }
    check("design v1 drafted from the survey", await waitFor(designer, /Design v\d/, 30_000));
    // The outdoor unit's sound power from its datasheet, so the noise check can run.
    const outdoorId = await designer.getByLabel("Outdoor model").first().inputValue();
    if (await has(designer, /add the outdoor unit's sound power/)) {
      await go(tech, `/ops/catalogue/${outdoorId}`);
      await tech.getByLabel("Sound power (LWA) (dB(A))").fill("61");
      await tech.getByRole("button", { name: "Save changes" }).click();
      check("datasheet LWA saved on the outdoor unit", await waitFor(tech, /Saved\./));
      await designer.reload({ waitUntil: "load" });
      await hydrated(designer);
    }
    check("no check is blocked", await has(designer, /BLOCKED\s*0/), (await text(designer)).match(/Checks[\s\S]{0,400}/)?.[0]);
    check("bill of materials fully priced", !(await has(designer, /have no buy price/)));
    const layout = designer.getByLabel("Layout photo");
    for (let i = 0; i < (await layout.count()); i++) if (!(await layout.nth(i).isChecked())) await choose(layout.nth(i));
    check("layout photos chosen", (await layout.count()) >= 2);
    await shot(designer, "D-design", true);
    await designer.getByRole("button", { name: /^(Save and submit|Submit) for review$/ }).first().click();
    check("design sent for review", await waitFor(designer, /in review/i, 30_000));
    check("a surveyor can't approve", await has(designer, /Approving needs a technical lead/));

    await go(tech, `/ops/projects/${ids.pid}/design`);
    if (await tech.getByLabel(/^I have checked the manufacturer's combination table/).count()) await choose(tech.getByLabel(/^I have checked the manufacturer's combination table/));
    check("the tech lead signs with their F-gas certificate", await has(tech, /Signing as DEMO Tess \(technical lead\), F-gas Category I DEMO-FGAS-0001/));
    await tech.getByRole("button", { name: /Approve and sign/ }).first().click();
    check("design approved and signed", await waitFor(tech, /Approved and signed\. Version \d+ is now the design/, 30_000));
    check("after signing the studio is read-only (no 'changing an approved design' banner)", !(await has(tech, /You're changing an approved design/)) && (await has(tech, /Signed by DEMO Tess/)));
    await shot(tech, "D-approved");
  });

  await phase("E · Proposal: two options, PILOT15, Schedule 2 settings, issue", async () => {
    await go(admin, `/ops/projects/${ids.pid}/proposal`);
    await admin.getByRole("button", { name: "Start the proposal" }).click();
    const started = await visible(admin.getByRole("tab"), 30_000);
    must("the proposal draft opens", started, trails.admin.slice(-30).join("\n      "));
    const m = admin.locator("main");
    for (const tab of ["Standard", "Quiet"]) {
      await m.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
      const delivery = m.getByLabel("Unit cost for Kit delivery");
      if (await delivery.count()) {
        await delivery.fill("45");
        await delivery.blur();
      }
      await choose(m.getByLabel(/^Cost-plus/));
      await m.getByLabel("Target gross margin").fill("40");
      await m.getByLabel("Target gross margin").blur();
      await m.getByLabel("Pilot discount").selectOption("PILOT15");
      await admin.waitForTimeout(1500);
      const t = await text(admin);
      check(`${tab}: priced with every cost line`, /All lines priced/.test(t), t.match(/OUR COST[\s\S]{0,80}/)?.[0]);
      check(`${tab}: PILOT15 shown as its own line`, /DISCOUNT\s*−£[\d,]+\s*PILOT15/.test(t));
      check(`${tab}: margin above the 25% minimum after the discount`, /GROSS MARGIN\s*(2[5-9]|[3-9]\d)\.\d%/.test(t), t.match(/GROSS MARGIN[\s\S]{0,40}/)?.[0]);
    }
    check("units read as quantities (no 'per ms')", !(await has(admin, /per ms\b/)));
    await waitFor(admin, /All changes saved/);
    await shot(admin, "E-builder");
    await m.getByRole("button", { name: "Issue proposal" }).click();
    const first = await waitFor(admin, /The project isn't ready for a proposal yet|Issued\s*Customer's page/, 30_000);
    const blocked = first && (await has(admin, /The project isn't ready for a proposal yet/));
    if (blocked || !first) {
      check("issue refused with the Schedule 2 blocker shown", blocked && (await has(admin, /pre-contract information is missing from settings/)), trails.admin.slice(-30).join("\n      "));
      await shot(admin, "E-blocked");
      await go(admin, `/ops/settings`);
      const s = admin.locator("main");
      await s.getByLabel(/^Phone/).fill("020 7946 0999");
      await s.getByLabel(/^Geographic address/).fill("DEMO Unit 1, 1 Example Yard, London SW16 9ZZ");
      await s.getByLabel(/^Complaints process/).fill("DEMO: email us with what went wrong; we reply within 2 working days and aim to put it right within 14 days.");
      await s.getByLabel("Workmanship guarantee", { exact: true }).fill("DEMO: we put right any fault in our workmanship for 2 years from handover. Email us to claim.");
      await s.getByLabel("Workmanship guarantee (years)").fill("2");
      await s.getByLabel("F-gas company certificate: body").fill("DEMO certification body");
      await s.getByLabel("F-gas certificate number").fill("DEMO-CO-0001");
      await s.getByLabel("Bank account name").fill("DEMO Dang Its Hot Ltd");
      await s.getByLabel("Sort code").fill("00-00-00");
      await s.getByLabel("Account number").fill("00000000");
      await s.getByLabel("Deposit (%)").fill("20");
      await s.getByRole("button", { name: "Save settings" }).click();
      check("settings saved, Schedule 2 complete", await waitFor(admin, /All the pre-contract \(Schedule 2\) details are in/));
      await go(admin, `/ops/projects/${ids.pid}/proposal`);
      await m.getByRole("button", { name: "Issue proposal" }).click();
      const issued = await waitFor(admin, /Issued\s*Customer's page/, 30_000);
      check("proposal issued", issued, `busy: ${await has(admin, /Issuing…/)}\n      ${trails.admin.slice(-30).join("\n      ")}`);
    } else {
      console.log("    (settings were already complete from an earlier run on this data: issued first time)");
      check("proposal issued", true);
    }
    const t = await text(admin);
    ids.standard = t.match(/Standard\s*(£[\d,]+)/)?.[1];
    check("both options on the issued version", /Standard\s*£[\d,]+[\s\S]*Quiet\s*£[\d,]+/.test(t));
    await shot(admin, "E-issued");
  });

  await phase("F · Customer views and accepts option 1 with early start", async () => {
    await go(customer, `/p/${ids.pid}`);
    check("hub's next step is the proposal", await waitFor(customer, /YOUR NEXT STEP\s*Review your proposal/));
    await customer.getByRole("link", { name: "Review your proposal" }).first().click();
    await customer.waitForURL(/\/proposal/);
    await customer.waitForLoadState("load");
    await hydrated(customer);
    check("proposal page shows both options and the pilot price", (await waitFor(customer, /Choose an option/)) && (await has(customer, /Founding pilot price/)));
    check("rooms drawn on their own photos", await has(customer, /Your rooms[\s\S]*LIVING ROOM[\s\S]*MAIN BEDROOM/));
    check("our 2-year workmanship guarantee is in the proposal", await has(customer, /Our workmanship guarantee: 2 years/));
    check("the deposit is stated", await has(customer, /A 20% deposit of £[\d,]+, when you accept/));
    await shot(customer, "F-proposal");
    await customer.getByRole("button", { name: "Continue", exact: true }).click();
    await customer.getByText("STEP 2 OF 4").waitFor();
    await customer.getByRole("button", { name: "Continue", exact: true }).click();
    await customer.getByText("STEP 3 OF 4").waitFor();
    await choose(customer.getByLabel(/^I want you to start within my cancellation period/));
    await customer.getByRole("button", { name: "Continue", exact: true }).click();
    await customer.getByText("STEP 4 OF 4").waitFor();
    await choose(customer.getByLabel(/^I've read the cancellation information/));
    await customer.getByLabel(/^Your full name/).fill(CUSTOMER.name.replace(" (DEMO)", ""));
    check("starting early is stated before they accept", await has(customer, /Starting early\s*Yes, you've asked us to start within your cancellation period/));
    await shot(customer, "F-accept");
    await customer.getByRole("button", { name: /^I accept and agree to pay/ }).click();
    check("confirmation shown", await waitFor(customer, /Accepted\. Thank you\./, 30_000));
    check("the early-start confirmation wording is given", await has(customer, /Please start my installation before my cancellation period ends/));
    await shot(customer, "F-accepted");
    await customer.getByRole("link", { name: "View your contract" }).click();
    await customer.waitForURL(/\/d\/[0-9a-f-]{36}/);
    ids.contractDoc = customer.url().match(/\/d\/([0-9a-f-]{36})/)[1];
    check("contract document renders", await waitFor(customer, /Your contract confirmation[\s\S]*Acceptance record/, 20_000, "body"));
    check("contract carries the guarantee as accepted", await has(customer, /Our workmanship guarantee: 2 years/, "body"));
    await shot(customer, "F-contract");
  });

  await phase("G · Ops: evidence, dates, crew, deposit, kit, compliance", async () => {
    await go(admin, `/ops/projects/${ids.pid}`);
    check("deposit shows as due, not 'Not required'", await has(admin, /Deposit\s*£[\d,]+ due/));
    // The early-start request goes on file with the copy itself: their email (a screenshot here), when it came, who from.
    const ev = admin.locator("main form").filter({ hasText: "Which one" });
    await ev.getByLabel("Their email", { exact: true }).check();
    await ev.locator('input[type="file"]').setInputFiles(PHOTO);
    await ev.getByText("Uploaded").waitFor({ timeout: 30_000 });
    check("the From address starts as the customer's own", (await ev.getByLabel(/^From/).inputValue()) === CUSTOMER.email);
    await ev.getByLabel(/^Which one/).fill("DEMO email, subject: Re: Your contract");
    await ev.getByLabel(/in the words we gave them/).check();
    await ev.getByLabel(/^From/).fill("someone.else@example.com");
    await ev.getByRole("button", { name: "Record" }).click();
    check("an email from another address is refused", await waitFor(admin, /It has to come from the address on the contract/));
    await ev.getByLabel(/^From/).fill(CUSTOMER.email);
    await ev.getByRole("button", { name: "Record" }).click();
    check("early-start evidence on file, with its copy", await waitFor(admin, /Early start on file \(email: DEMO email[^)]*from [^)]*copy stored/));

    await admin.getByRole("link", { name: /^Dates, crew and deposit/ }).click();
    await admin.waitForURL(new RegExp(`/ops/projects/${ids.pid}/booking`));
    await hydrated(admin);
    ids.firstDay = await admin.getByLabel("First install day").inputValue();
    await admin.getByRole("button", { name: "Set install dates" }).click();
    check("3 working days set", await waitFor(admin, /INSTALL DATES\s*\w{3} \d+ \w{3}\s*3 working days/));
    const crew = admin.locator("main form").filter({ hasText: "Who's on the job" });
    for (const n of ["DEMO Eli \\(electrician\\)", "DEMO Ivo \\(installer\\)", "DEMO Tess \\(technical lead\\)"]) await choose(crew.getByLabel(new RegExp(`^${n}`)));
    await crew.getByRole("button", { name: "Save the crew" }).click();
    check("crew covers F-gas, Part P and the tech lead", await waitFor(admin, /F-gas certified engineer: covered[\s\S]*Part P registered electrician: covered[\s\S]*Technical lead with current F-gas certification: covered/));
    await admin.getByRole("button", { name: /^Send the deposit invoice/ }).click();
    check("deposit invoice issued", await waitFor(admin, /DEPOSIT\s*Requested\s*Invoice DIH-/));
    await admin.getByRole("link", { name: "Record a payment" }).click();
    await admin.waitForURL(/\/money/);
    await admin.locator("summary").filter({ hasText: "Record a payment you've seen" }).first().click();
    const pay = admin.locator("form").filter({ has: admin.getByRole("button", { name: "Record the payment" }) }).first();
    await pay.getByLabel("Reference on the statement").fill("DEMO bank ref");
    await pay.getByRole("button", { name: "Record the payment" }).click();
    check("deposit bank transfer recorded", await waitFor(admin, /£[\d,]+ received · DIH-\d+[\s\S]*Bank transfer/));
    await go(admin, `/ops/projects/${ids.pid}/booking`);
    await admin.getByRole("button", { name: "Confirm booking and tell the customer" }).click();
    check("booking confirmed", await waitFor(admin, /BOOKING\s*Confirmed/));
    await shot(admin, "G-booking");

    await go(admin, `/ops/projects/${ids.pid}/kit`);
    await admin.getByRole("button", { name: "Raise purchase orders" }).click();
    check("purchase order raised from the design", await waitFor(admin, /purchase orders? raised/));
    await admin.getByRole("button", { name: "Approve to order" }).click();
    await admin.getByRole("button", { name: "Mark as ordered" }).waitFor();
    await admin.getByRole("button", { name: "Mark as ordered" }).click();
    check("ordered", await waitFor(admin, /Ordered/));
    const delivery = admin.locator("details").filter({ has: admin.locator("summary", { hasText: "Record a delivery" }) }).first();
    await delivery.locator("summary").click();
    await delivery.getByLabel("Taken in by").fill("Pat Example (DEMO), at home");
    await delivery.getByRole("button", { name: "Save the delivery" }).click();
    check("delivered, recorded by a person", await waitFor(admin, /DELIVERED\s*(\d+) of \1/));
    const inspect = admin.locator("details").filter({ has: admin.locator("summary", { hasText: "Check the kit against the design" }) }).first();
    if (!(await inspect.evaluate((e) => e.open))) await inspect.locator("summary").click();
    const serials = inspect.locator('input[name^="serials:"]');
    for (let i = 0; i < (await serials.count()); i++) await serials.nth(i).fill(`DEMO-SN-${RUN}-${i}`);
    await inspect.getByRole("button", { name: "Save the check" }).click();
    check("every line checked good", await waitFor(admin, /CHECKED GOOD\s*(\d+) of \1/));
    check("customer wording is honest about who checked", await has(admin, /Customer sees: Your kit has been checked by our team/));
    await shot(admin, "G-kit");

    await go(tech, `/ops/projects/${ids.pid}/compliance`);
    const reviewed = await reviewCompliance(tech, /Electrical certificate|warranty|Commissioning results/i);
    check(`compliance reviewed by the tech lead with notes (${reviewed.length} items)`, reviewed.length >= 10);
    check("no statutory item left open before install", await has(tech, /STATUTORY OPEN\s*[0-2]\b/));
    await shot(tech, "G-compliance");
    await go(admin, `/ops/projects/${ids.pid}`);
    check("nothing blocks install day 1", await has(admin, /Next gate: Install complete|Nothing stands in the way of ready to install/));
  });

  const installer = await person("installer", "phone");
  const electrician = await person("electrician", "phone");
  const techPhone = await person("techPhone", "phone");
  await phase("H · Install days on phones", async () => {
    await tryAs(installer, "installer");
    await tryAs(electrician, "electrician");
    await tryAs(techPhone, "tech-lead");
    await go(installer, `/field`);
    // The 5-day lead time means the booked day 1 is never today: Today says so, and shows the job as next up.
    const firstDay = new Date(`${ids.firstDay}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).replace(",", "").toUpperCase();
    check(
      `Today: nothing booked today, the job next up on its booked day (${firstDay})`,
      (await has(installer, /Nothing booked for you today/)) && (await has(installer, new RegExp(`NEXT UP · ${firstDay}[\\s\\S]*INSTALL · DAY 1 OF 3 · ${firstDay}[\\s\\S]*Pat Example \\(DEMO\\)`))),
      (await text(installer)).slice(0, 300),
    );
    await shot(installer, "H-today");
    await installer.getByRole("link", { name: /Open job/ }).first().click();
    await installer.waitForURL(new RegExp(`/field/jobs/${ids.pid}`));
    await installer.waitForLoadState("load");
    await hydrated(installer);

    let sheet = await openActions(installer);
    await sheet.getByRole("button", { name: /^On my way/ }).click();
    sheet = installer.locator('[role="dialog"]').last();
    await sheet.getByRole("button", { name: "20 min" }).click();
    check("installer ETA previewed", await visible(sheet.getByText(/is on the way to your install/)));
    await sheet.getByRole("button", { name: /^Send: about 20 min/ }).click();
    await sheet.getByText(/Recorded in demo mode/).waitFor();
    await sheet.getByRole("button", { name: "Done" }).click();

    const d1 = await startDay(installer, 1);
    check("starting early is explained (the booked day isn't today)", /Starting it today records today as day 1/.test(d1.intro) || /Starts your clock/.test(d1.intro));
    check("day 1 started (ready-to-install gate passed)", /Day 1 started/.test(d1.outcome), d1.outcome);
    // Started early, the job is now today's: Today and the customer's timeline say so.
    await go(installer, `/field`);
    check("Today now shows the job as today's, day 1 under way", !(await has(installer, /Nothing booked for you today/)) && (await has(installer, /INSTALL · DAY 1 OF 3/)), (await text(installer)).slice(0, 300));
    await shot(installer, "H-today-started");
    await go(installer, `/field/jobs/${ids.pid}/day/1`);
    const day1 = await completeDay(installer);
    check("day 1: every step done by the installer", day1.every((s) => s.state !== "incomplete" && s.state !== "locked"), JSON.stringify(day1.filter((s) => s.state === "incomplete" || s.state === "locked")));
    check("day 1 shows all steps done", await waitFor(installer, /(\d+) of \1 steps done/));
    await shot(installer, "H-day1");

    // An issue and a variation, raised from the phone.
    sheet = await openActions(installer);
    await sheet.getByRole("button", { name: /^Raise an issue/ }).click();
    sheet = installer.locator('[role="dialog"]').last();
    await sheet.getByRole("button", { name: "Question", exact: true }).click();
    await sheet.getByLabel("Title").fill("DEMO: remote holder in the hallway, please");
    await sheet.getByLabel("Details (optional)").fill("DEMO: the customer wants the remote bracket by the door.");
    await sheet.getByRole("button", { name: "Low", exact: true }).click();
    await sheet.locator('input[type="file"]').setInputFiles(PHOTO);
    await sheet.getByRole("button", { name: "Raise it" }).click();
    await sheet.getByText(/Saved on the phone/).waitFor();
    await sheet.getByRole("button", { name: "Done" }).click();
    sheet = await openActions(installer);
    await sheet.getByRole("button", { name: /^Request a variation/ }).click();
    sheet = installer.locator('[role="dialog"]').last();
    await sheet.getByLabel("The change, in a few words").fill("DEMO: 2 m more trunking round the bay");
    await sheet.getByLabel("Why it's needed (the customer reads this)").fill("The pipe run round the bay window is longer than measured, so it needs 2 m more trunking to stay neat.");
    // A stray tap on the backdrop doesn't lose what's been written.
    await installer.mouse.click(195, 20);
    check("a half-written variation survives a tap on the backdrop", (await sheet.getByLabel("The change, in a few words").inputValue().catch(() => "")) === "DEMO: 2 m more trunking round the bay");
    // The installer's estimate (£150) goes to the office first; the office corrects it to £120.
    await sheet.getByLabel("Estimated price change, £ before VAT").fill("150");
    await sheet.getByRole("button", { name: "Send to the office" }).click();
    await sheet.getByText(/Don't do this work until the customer approves it/).waitFor();
    await sheet.getByRole("button", { name: "Done" }).click();
    await installer.waitForTimeout(1500);

    const e1 = await endDay(installer, 1, "Holes drilled and sealed, brackets up. Tomorrow: units on the wall and the new circuit.", {
      "What took longer than expected?": "DEMO: core drilling through the bay took 40 minutes longer.",
      "What should the survey have captured?": "DEMO: the bay window return for the pipe route.",
    });
    check("end-of-day update previewed with 2 photos", e1.picked === 2 && /There are 2 photos from today/.test(e1.preview), e1.preview.slice(-400));
    check("the issue's photo isn't offered for the customer's update", e1.offered.length >= 2 && !e1.offered.some((c) => /remote holder/.test(c)), e1.offered.join(" | "));
    check("day 1 closed, update recorded (demo mode)", /Day 1 closed/.test(e1.closed));

    // The office checks the variation from site before the customer sees it.
    await go(customer, `/p/${ids.pid}`);
    check("the customer can't see an unchecked variation", !(await has(customer, /DEMO: 2 m more trunking/)));
    await go(admin, `/ops/projects/${ids.pid}/issues`);
    check("the office sees the variation waiting for them", await waitFor(admin, /variation from site is waiting for the office/));
    const review = admin.locator("main form").filter({ has: admin.getByLabel("Price change, £ before VAT") });
    check("…with the installer's estimate to check", (await review.getByLabel("Price change, £ before VAT").inputValue()) === "150.00");
    await review.getByLabel("Price change, £ before VAT").fill("120");
    await review.getByRole("button", { name: "Send to the customer for their OK" }).click();
    check("the office sends it at the checked price", await waitFor(admin, /£120 before VAT · Waiting for the customer/));

    // The customer approves the variation and sees the day's update.
    await go(customer, `/p/${ids.pid}`);
    check("customer sees the day 1 update with photos", await waitFor(customer, /End-of-day updates\s*DAY 1/));
    const stamp = (await text(customer)).match(/DAY 1 · \w{3} \d+ \w{3}, (\d\d):(\d\d)/i);
    const minutesOff = stamp ? Math.abs(Number(stamp[1]) * 60 + Number(stamp[2]) - londonMinutes(new Date())) : NaN;
    check("the update's time is London time", minutesOff <= 10 || minutesOff >= 1430, stamp?.[0]);
    check("updates feed says 'Day 1 done' once", !(await has(customer, /Day 1 done: Day 1 done/)));
    check("customer sees the variation to decide", await has(customer, /A change needs your answer[\s\S]*DEMO: 2 m more trunking/));
    await shot(customer, "H-variation");
    // A yes is an agreement to pay: a second step, with their typed name and the exact words.
    await customer.getByRole("button", { name: /^Yes, go ahead/ }).click();
    const agree = customer.getByRole("button", { name: /^I agree to pay £[\d,.]+ more/ });
    await agree.waitFor({ timeout: 10_000 });
    check("accepting a variation asks them to agree to pay, by name", (await agree.count()) === 1 && (await customer.getByLabel("Your full name").count()) === 1);
    await customer.getByLabel("Your full name").fill(CUSTOMER.name.replace(" (DEMO)", ""));
    await shot(customer, "H-variation-agree");
    const [decided] = await Promise.all([
      customer.waitForRequest((r) => /\/variations\/[0-9a-f-]{36}$/.test(r.url()) && r.method() === "POST"),
      agree.click(),
    ]);
    ids.variationId = decided.url().match(/variations\/([0-9a-f-]{36})$/)[1];
    check("variation accepted on the portal", await waitFor(customer, /You said yes/));
    check("the customer's timeline dates the install to the day it really started", await has(customer, new RegExp(`Install\\s*(?:, (?:now|done)\\s*)?${londonDayLabel(new Date())}`)), (await text(customer)).match(/Install[^\n]*\n[^\n]*/)?.[0]);
    await go(customer, `/p/${ids.pid}/documents`);
    check("the agreed change is in the customer's documents", await waitFor(customer, /Change #\d+: DEMO: 2 m more trunking/));

    // Day 2: installer, then the electrician and the tech lead for their locked steps.
    await go(installer, `/field/jobs/${ids.pid}/day/2`);
    const d2 = await startDay(installer, 2);
    check("day 2 started (and the sheet says day 2)", /Day 2 started/.test(d2.outcome), d2.outcome);
    const day2 = await completeDay(installer);
    check("installer can't do F-gas or electrical steps", day2.some((s) => s.state === "locked"));
    await go(electrician, `/field/jobs/${ids.pid}/day/2`);
    const day2e = await completeDay(electrician, () => "DEMO-EIC-0001");
    check("electrician completes the electrical circuit", day2e.some((s) => /Electrical circuit/.test(s.title) && s.state === "completed"));
    await go(techPhone, `/field/jobs/${ids.pid}/day/2`);
    const day2t = await completeDay(techPhone);
    check("tech lead completes the F-gas flare torques", day2t.filter((s) => /Flares and torque/.test(s.title) && s.state === "completed").length === 2);
    await installer.reload({ waitUntil: "load" });
    await hydrated(installer);
    check("day 2 all done", await waitFor(installer, /(\d+) of \1 steps done/));
    await shot(installer, "H-day2");
    await endDay(installer, 2, "Both units are on the wall and the new circuit is in. Tomorrow: testing, commissioning and handover.");

    // Day 3.
    await go(installer, `/field/jobs/${ids.pid}/day/3`);
    const d3 = await startDay(installer, 3);
    check("day 3 started", /Day 3 started/.test(d3.outcome), d3.outcome);
    await completeDay(installer);
    await go(techPhone, `/field/jobs/${ids.pid}/day/3`);
    const day3t = await completeDay(techPhone);
    check("tech lead does the pressure, vacuum and release steps", day3t.filter((s) => /Strength and tightness|Vacuum and decay|Release and leak/.test(s.title) && s.state === "completed").length === 3);
    await go(electrician, `/field/jobs/${ids.pid}/day/3`);
    await completeDay(electrician, () => "DEMO-EIC-0001");
    await installer.reload({ waitUntil: "load" });
    await hydrated(installer);
    check("day 3 all done", await waitFor(installer, /(\d+) of \1 steps done/));
    await shot(installer, "H-day3");
  });

  await phase("I · Tech lead: targets, results, commissioning signed", async () => {
    await go(techPhone, `/field/jobs/${ids.pid}/commissioning`);
    const set = await setTargets(techPhone);
    check(`job targets set from the manual (${set.length})`, set.length >= 4, set.join("; "));
    check("results show the F-gas record", await has(techPhone, /F-gas label\s*R32: factory 1\.1 kg/));
    check("ready to sign", await waitFor(techPhone, /Everything is in\. Ready for your signature/));
    await techPhone.getByLabel("Notes (optional, printed on the certificate)").fill("DEMO: commissioned in heating and cooling; all readings within the manual.");
    await techPhone.getByRole("button", { name: /^Sign as/ }).click();
    check("commissioning signed", await waitFor(techPhone, /Signed off\s*Signed by/));
    await shot(techPhone, "I-commissioned");
    const cert = await techPhone.getByRole("link", { name: "Commissioning certificate" }).getAttribute("href");
    await go(techPhone, `${cert}`);
    check("commissioning certificate renders", await waitFor(techPhone, /Commissioning certificate/i, 20_000, "body") && (await has(techPhone, /DEMO-FGAS-0001/, "body")));
    await shot(techPhone, "I-certificate");
  });

  await phase("J · Handover, payment, certificates, close", async () => {
    await go(installer, `/field/jobs/${ids.pid}/handover`);
    check("walkthrough done on day 3", await has(installer, /Customer walkthrough\s*Done/));
    await installer.getByRole("button", { name: "Publish the handover pack" }).click();
    check("handover pack published", await waitFor(installer, /Published\. Publishing again makes a new version/));
    await installer.getByLabel("Your full name").fill("Pat Example");
    await installer.getByRole("button", { name: "All good" }).or(installer.getByText("All good", { exact: true })).first().click();
    const canvas = installer.locator("main canvas").last();
    await canvas.scrollIntoViewIfNeeded();
    const cb = await canvas.boundingBox();
    await installer.mouse.move(cb.x + 20, cb.y + cb.height / 2);
    await installer.mouse.down();
    for (let k = 1; k <= 10; k++) await installer.mouse.move(cb.x + 20 + (k * (cb.width - 40)) / 10, cb.y + cb.height / 2 + (k % 2 ? -20 : 20), { steps: 3 });
    await installer.mouse.up();
    await shot(installer, "J-sign");
    await installer.getByRole("button", { name: "Sign off the handover" }).click();
    check("customer signed 'all good' on the device", await waitFor(installer, /Signed by Pat Example, .*all good/));
    const packHref = await installer.getByRole("link", { name: "Open their handover pack" }).getAttribute("href");

    // Commissioning closed day 3 with the install, but the crew is still here: they end the day
    // (the customer's last update, learnings, and their clock).
    await go(installer, `/field/jobs/${ids.pid}/day/3`);
    let sheet = await openActions(installer);
    check("after commissioning, Actions offers to end day 3 (and stop the clock)", /The install is complete\. End day 3 when you leave: it sends the customer's update and stops your clock/.test(await sheet.innerText()), await sheet.innerText());
    await shot(installer, "J-wrapup-actions");
    await installer.keyboard.press("Escape");
    await sheet.waitFor({ state: "hidden" }).catch(() => {});
    const e3 = await endDay(installer, 3, "All done: both units are commissioned and handed over. Your handover pack is on your project page. Thank you for having us.", {
      "What should the survey have captured?": "DEMO: where the customer wanted the remote holder.",
    });
    check("day 3 closed after the handover, update recorded", /Day 3 closed/.test(e3.closed), e3.closed.slice(-300));
    check("the day 3 email says it's commissioned (not 'next, we commission')", /installed and commissioned, and your handover pack is on your project page/.test(e3.preview) && !/Next, we commission/.test(e3.preview), e3.preview.slice(-500));
    sheet = await openActions(installer);
    const after = await sheet.innerText();
    check("…and nothing is left running: no End day, no Stop my clock", /The install is complete\./.test(after) && !/End day|Stop my clock|Pause/.test(after), after);
    await installer.keyboard.press("Escape");

    await go(installer, packHref);
    check("handover pack renders", await waitFor(installer, /handover pack/i, 20_000, "body") && (await has(installer, /Your equipment|equipment/i, "body")));
    await shot(installer, "J-pack");

    await go(admin, `/ops/projects/${ids.pid}/money`);
    check("the balance includes the accepted variation", await has(admin, /Accepted variations\s*£120/));
    const balance = admin.locator("main form").filter({ has: admin.locator('input[name="kind"][value="balance"]') });
    await balance.getByRole("button", { name: "Issue and email" }).click();
    check("balance invoice issued", await waitFor(admin, /· Balance/));
    check("the variation isn't offered again once the balance includes it", !(await admin.locator("main form").filter({ hasText: "Which variation" }).count()));
    await go(customer, `/p/${ids.pid}/pay`);
    check("customer pay page shows the balance", await waitFor(customer, /Balance invoice · DIH-/));
    await shot(customer, "J-pay");
    await customer.getByRole("button", { name: /^Simulate card payment/ }).click();
    check("DEMO card payment recorded, all paid up", await waitFor(customer, /You're all paid up/));
    await admin.reload({ waitUntil: "load" });
    await hydrated(admin);
    check("outstanding is £0", await has(admin, /OUTSTANDING\s*£0\b/));

    await go(admin, `/ops/projects/${ids.pid}`);
    const ho = admin.locator("#handover");
    // The certificate goes in with its file and number, so "it's in your documents" is true.
    await ho.locator("summary").filter({ hasText: "Electrical certificate received" }).click();
    const certForm = ho.locator("form").filter({ has: admin.getByLabel(/^Certificate number/) });
    await certForm.locator('input[type="file"]').setInputFiles(PHOTO);
    await certForm.getByText("Uploaded").waitFor({ timeout: 30_000 });
    await certForm.getByLabel(/^Certificate number/).fill("DEMO-EIC-0001");
    await certForm.getByLabel(/^Issued by/).fill("DEMO scheme");
    await certForm.getByRole("button", { name: "Add to their documents" }).click();
    // The form goes once it's saved; what stays is the status and the link to the certificate itself.
    await ho.locator("a", { hasText: "Open it" }).waitFor({ timeout: 20_000 }).catch(() => {});
    check(
      "electrical certificate received, with its file",
      (await ho.locator("a", { hasText: "Open it" }).count()) === 1 && /Electrical certificate\s*Received/i.test(await ho.innerText()),
    );
    await ho.locator("summary").filter({ hasText: "Warranty registered" }).click();
    const warForm = ho.locator("form").filter({ has: admin.getByLabel(/^Registration reference/) });
    await warForm.getByLabel(/^Registration reference/).fill("DEMO-WR-0042");
    await warForm.getByRole("button", { name: "Add to their documents" }).click();
    check("warranty registered, with its reference", await waitFor(admin, /Warranty\s*Registered/));
    await go(tech, `/ops/projects/${ids.pid}/compliance`);
    await reviewCompliance(tech);
    check("every compliance item settled", await has(tech, /DONE\s*(\d+) of \1/));
    check("auto items name a person, not a phrase", !(await has(tech, /Approved by Recorded on the project/)));
    await go(admin, `/ops/projects/${ids.pid}`);
    check("no crew clock is left running on the job", !(await has(admin, /still running/)));
    // The question and the (accepted, done) variation are still open: closing says so before it happens.
    check("closing warns about the open issues, without blocking", (await has(admin, /Open low issue: DEMO: remote holder in the hallway, please\. It stays open after the project closes/)) && (await admin.locator("#blocking form").filter({ hasText: "Closing note" }).count()) === 1);
    await go(admin, `/ops/projects/${ids.pid}/issues`);
    for (let round = 0; round < 4; round++) {
      const open = admin.locator("main li").filter({ has: admin.getByRole("button", { name: "Resolved", exact: true }) });
      if (!(await open.count())) break;
      const card = open.first();
      await card.getByLabel(/^Note/).fill("DEMO: done on day 3, checked with the customer at handover.");
      await card.getByRole("button", { name: "Resolved", exact: true }).click();
      await admin.waitForTimeout(1500);
    }
    check("ops resolves the question and the variation with a note", await waitFor(admin, /0 open, \d+ done/));
    await go(admin, `/ops/projects/${ids.pid}`);
    check("nothing blocks closing", await has(admin, /Nothing stands in the way of closed/));
    const close = admin.locator("#blocking form").filter({ hasText: "Closing note" });
    await close.getByLabel(/Closing note/).fill("DEMO: installed, commissioned, handed over and paid.");
    await close.getByRole("button", { name: "Close project" }).click();
    check("project closed", await waitFor(admin, /This project is closed/));
    check("at a glance shows when the install really happened", await has(admin, /Install\s*Done \w{3} \d+ \w{3}/));
    await shot(admin, "J-closed");

    // The customer's side once it's all over.
    await go(customer, `/p/${ids.pid}`);
    check("the hub has moved on to aftercare", await waitFor(customer, /All wrapped up/));
    // The install stage, opened from the timeline, keeps every day's update.
    await customer.getByRole("button", { name: /^Install\b/ }).first().click();
    check("customer sees the day 3 update in the install stage", await waitFor(customer, /End-of-day updates\s*DAY 3[\s\S]*All done: both units are commissioned/));
    check("no issue photo was shared in a day's update", !(await has(customer, /End-of-day updates[\s\S]*remote holder in the hallway[\s\S]*Changes you've decided/)));
    await go(customer, `/p/${ids.pid}/documents`);
    const docs = await text(customer);
    check(
      "customer's documents: contract, commissioning certificate, handover pack and invoices",
      /Contract confirmation/i.test(docs) && /Commissioning certificate/i.test(docs) && /Handover pack/i.test(docs) && /Invoice/i.test(docs),
      docs.slice(0, 600),
    );
    check(
      "…and the electrical certificate and warranty registration the timeline says are there",
      /Electrical installation certificate/i.test(docs) && /Manufacturer warranty registration/i.test(docs),
      docs.slice(0, 900),
    );
    await shot(customer, "J-documents");
  });

  await phase("K · Pilots dashboard and CSV", async () => {
    // Every customer message of the walk, logged honestly as demo (email isn't set up here).
    await go(admin, `/ops/messages`);
    const log = await text(admin);
    const to = CUSTOMER.email.replace(/\./g, "\\.");
    const expected = [
      ["Survey booked", "Email"],
      ["Surveyor on my way", "SMS"],
      ["Survey complete", "Email"],
      ["Proposal issued", "Email"],
      ["Proposal accepted", "Email"],
      ["Invoice issued", "Email"],
      ["Payment received", "Email"],
      ["Install booked", "Email"],
      ["Kit update", "Email"],
      ["Installer on my way", "SMS"],
      ["Variation approval", "Email"],
      ["Variation accepted", "Email"],
      ["Install day update", "Email"],
      ["Handover ready", "Email"],
      ["Certificate issued", "Email"],
    ];
    const missing = expected.filter(([what, ch]) => !new RegExp(`${what} · ${ch} to ${ch === "SMS" ? "\\+?[\\d ]+" : to}`).test(log)).map(([w]) => w);
    check("the messages log has every customer message of the walk", missing.length === 0, `missing: ${missing.join(", ")}`);
    check("three end-of-day emails, one per day", (log.match(new RegExp(`Install day update · Email to ${to}`, "g")) ?? []).length === 3);
    // Each row's status is a line of its own; "Demo, not sent" is also one line as a filter option.
    const rows = (log.match(/ · (?:Email|SMS) to /g) ?? []).length;
    const demo = log.split("\n").filter((l) => l.trim() === "Demo, not sent").length - 1;
    check("…every one marked Demo, not sent (nothing pretends to have gone)", rows > 0 && demo === rows, `${rows} rows, ${demo} demo`);

    await go(admin, `/ops/pilots`);
    check("pilot is in the comparison", await has(admin, new RegExp(`Pilot ${ids.pilotNumber}\\s*DEMO Streatham semi`)));
    check("contract and revenue shown", (await has(admin, /Contract price\s*£[\d,]+/)) && (await has(admin, /Revenue \(net\)\s*£[\d,]+/)));
    check("van-stock consumables aren't 'unplanned'", await has(admin, /Unplanned material lines\s*0/));
    check("the day 1 learning is listed", await has(admin, /core drilling through the bay took 40 minutes longer/));
    await shot(admin, "K-pilots", true);
    const [csv] = await Promise.all([admin.waitForEvent("download"), admin.getByRole("link", { name: "Download CSV" }).click()]);
    const body = readFileSync(await csv.path(), "utf8");
    check("CSV downloads with a header and the pilot's row", /^﻿?pilot_number,label,project_id/.test(body) && body.includes(ids.pid));
  });

  await phase("L · Isolation and permissions", async () => {
    // A second household, with its own sign-in.
    await go(admin, `/ops/projects/new`);
    await admin.fill('input[name="name"]', CUSTOMER2.name);
    await admin.fill('input[name="email"]', CUSTOMER2.email);
    await admin.fill('input[name="addressLine"]', CUSTOMER2.address);
    await admin.fill('input[name="postcode"]', "SW16 2BE");
    await admin.fill('input[name="pilotLabel"]', "DEMO second home");
    // A slip of the finger: the first household's pilot number. Two pilots can't share one.
    await admin.fill('input[name="pilotNumber"]', ids.pilotNumber);
    await admin.getByRole("button", { name: "Set up the pilot" }).click();
    const dup = admin.locator('main [role="alert"]').filter({ hasText: `Pilot ${ids.pilotNumber} is already` });
    check("a pilot number already in use is refused, naming the household that has it", await visible(dup), await text(admin, '[role="alert"]'));
    check("…and the refusal names the household", (await dup.innerText().catch(() => "")).includes("Pat Example (DEMO)"));
    await admin.fill('input[name="pilotNumber"]', String(Number(ids.pilotNumber) + 1));
    await admin.getByRole("button", { name: "Set up the pilot" }).click();
    await admin.waitForURL(/\/ops\/projects\/[0-9a-f-]{36}/);
    ids.pid2 = admin.url().match(/projects\/([0-9a-f-]{36})/)[1];
    const other = await person("customer2", "phone");
    await go(other, `/p/${ids.pid2}`);
    await other.getByRole("button", { name: "Email me a sign-in link" }).click();
    await other.getByRole("link", { name: "Open my sign-in link" }).click();
    await other.getByRole("button", { name: /^Continue as/ }).click();
    await other.waitForURL(new RegExp(`/p/${ids.pid2}`));
    check("second customer signed in to their own home", await waitFor(other, /Hello, Robin/));
    await go(other, `/p/${ids.pid}`);
    const leak = await text(other, "body");
    check("…but the first project is a sign-in wall, with none of its data", /Sign in to see your project/.test(leak) && !leak.includes(CUSTOMER.address) && !leak.includes("Pat"));
    await shot(other, "L-other-customer");
    await go(other, `/p/${ids.pid}/proposal`);
    check("…nor its proposal", !(await text(other, "body")).includes(CUSTOMER.address));
    await go(other, `/d/${ids.contractDoc}`);
    const doc = await text(other, "body");
    check("…nor its contract document", !doc.includes(CUSTOMER.address) && !/Acceptance record/.test(doc));
    await go(other, `/p/${ids.pid}/documents`);
    check("…nor its documents list", !/Contract confirmation|Commissioning certificate|Handover pack/i.test(await text(other, "body")));
    await go(other, `/p/${ids.pid}/pay`);
    check("…nor its invoices", !/DIH-\d+|Balance invoice/.test(await text(other, "body")));
    // The control: the same media request works for the project's own customer.
    const own = await customer.request.get(`${BASE}/api/media?projectId=${ids.pid}`);
    const ownItems = own.ok() ? ((await own.json()).items ?? []) : [];
    check("the first customer can list their own shared photos (the control)", own.status() === 200 && ownItems.length > 0, `${own.status()} ${ownItems.length}`);
    const media = await other.request.get(`${BASE}/api/media?projectId=${ids.pid}`);
    check("…but the second customer can't (media API answers 404)", media.status() === 404, media.status());
    const decide = await other.request.post(`${BASE}/api/portal/${ids.pid}/variations/${ids.variationId}`, { data: { decision: "decline" }, headers: { origin: BASE } });
    check("…nor answer its variation (404)", decide.status() === 404, decide.status());

    // A subcontractor: only their own jobs, never margins, never ops.
    await go(admin, `/login`);
    await admin.getByRole("button", { name: /Load demo pilots/ }).click();
    check("admin loads the DEMO pilots (demo deployment)", await waitFor(admin, /Loaded \d+ DEMO pilots/, 60_000, "body"));
    const sub = await person("sub", "phone");
    await tryAs(sub, "external-installer");
    check("subcontractor lands in the field app", new URL(sub.url()).pathname.startsWith("/field"));
    await go(sub, `/ops/projects/${ids.pid}`);
    check("subcontractor can't open the command centre (sent to /field)", new URL(sub.url()).pathname.startsWith("/field") && !(await has(sub, /MARGIN|Margin/, "body")));
    await go(sub, `/ops/projects/${ids.pid}/proposal`);
    check("…nor the proposal builder", new URL(sub.url()).pathname.startsWith("/field") && !(await has(sub, /Gross margin|GROSS MARGIN/i, "body")));
    const subJob = await go(sub, `/field/jobs/${ids.pid}`);
    check("…nor a job they're not on", subJob.status() === 404 || (await has(sub, /not found|couldn't find|404/i, "body")), subJob.status());
    const subMedia = await sub.request.get(`${BASE}/api/media?projectId=${ids.pid}`);
    check("…nor its photos through the API (404)", subMedia.status() === 404, subMedia.status());
    const subDay = await sub.request.get(`${BASE}/api/field/jobs/${ids.pid}/photos?day=1`);
    check("…nor its day photos through the field API (404)", subDay.status() === 404, subDay.status());
    await go(sub, `/field/jobs`);
    const subJobs = sub.getByRole("link", { name: /Open job/ });
    if (await visible(subJobs, 20_000)) {
      await subJobs.first().click();
      await sub.waitForURL(/\/field\/jobs\/[0-9a-f-]{36}/);
      // The job streams in behind a skeleton: check the job itself (its runsheet or pack), not the placeholder.
      const opened = await waitFor(sub, /\d+ of \d+ steps done|Scope of work/, 20_000, "body");
      await hydrated(sub);
      check("their own job opens", opened);
      check("on their own job, no margin or cost", !(await has(sub, /margin|£[\d,]+\.\d\d cost/i, "body")));
      await shot(sub, "L-subcontractor-job");
    } else check("the subcontractor sees their assigned DEMO job", false);

    // Signed out, forged cookie.
    const anon = await person("anon", "desk");
    for (const path of ["/ops", "/field", `/ops/projects/${ids.pid}`]) {
      const r = await go(anon, `${path}`);
      check(`signed out ${path} → /login`, new URL(anon.url()).pathname === "/login" && r.ok());
    }
    const cookies = await admin.context().cookies();
    const real = cookies.find((c) => c.name === "dih_session");
    must("admin has a session cookie to tamper with", Boolean(real));
    const [payload, sig] = real.value.split(".");
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const forged = Buffer.from(JSON.stringify({ ...json, staffId: "de300000-0000-4000-8000-000000000001", roles: ["admin"], name: "Forged" }), "utf8").toString("base64url");
    await anon.context().addCookies([{ ...real, value: `${forged}.${sig}` }]);
    await go(anon, `/ops`);
    check("a forged session cookie is rejected", new URL(anon.url()).pathname === "/login");
    await anon.context().clearCookies();
    await anon.context().addCookies([{ ...real, value: `${payload}.${"0".repeat(64)}` }]);
    await go(anon, `/ops`);
    check("a bad signature is rejected", new URL(anon.url()).pathname === "/login");

    // Payments and the demo seed.
    const hook = await anon.request.post(`${BASE}/api/stripe/webhook`, {
      headers: { "stripe-signature": `t=${Math.floor(Date.now() / 1000)},v1=${"ab".repeat(32)}`, "content-type": "application/json" },
      data: JSON.stringify({ id: "evt_demo_forged", type: "checkout.session.completed", data: { object: { id: "cs_demo", payment_status: "paid", metadata: { project_id: ids.pid } } } }),
    });
    check("Stripe webhook refuses a bad signature (400, or 503 where no webhook secret is set)", hook.status() === 400 || hook.status() === 503, hook.status());
    const seedAnon = await anon.request.post(`${BASE}/api/dev/seed`);
    check("demo seed refused without an admin session (404)", seedAnon.status() === 404, seedAnon.status());
    const seedSub = await sub.request.post(`${BASE}/api/dev/seed`);
    check("demo seed refused for a subcontractor (404)", seedSub.status() === 404, seedSub.status());
    console.log("    (with demo sign-in off the route answers 404 for everyone: tests/security-routes.test.ts)");
  });
} catch (err) {
  console.error(`\nE2E stopped: ${err?.message ?? err}`);
  fails.push(err?.message ?? String(err));
  for (const [k, p] of Object.entries(pages)) await shot(p, `FAIL-${k}`, true);
  for (const [k, t] of Object.entries(trails)) if (t.length) console.error(`\n${k}, last requests:\n  ${t.slice(-15).join("\n  ")}`);
}

/** "Mon 19 Oct": a day as the app prints it, in London. */
function londonDayLabel(d) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" }).format(d).replace(",", "");
}

function londonMinutes(d) {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d).split(":");
  return Number(h) * 60 + Number(m);
}

/** RFC 4180 CSV, enough for the catalogue export. */
function parseCsv(input) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const s = input.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1);
}

await browser.close();
if (serverErrors.length) {
  console.error(`\nServer or page errors:\n  ${serverErrors.slice(0, 20).join("\n  ")}`);
  fails.push(`${serverErrors.length} server/page error(s)`);
}
console.log(`\nScreenshots: ${SHOTS}`);
if (fails.length) {
  console.error(`\n${fails.length} of ${checks} check(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${checks} pilot E2E checks passed`);
