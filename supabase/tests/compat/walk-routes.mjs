/**
 * Every main screen, as an admin, over the DEMO pilots: the route walk of
 * the Supabase compatibility run (works on the local file backend too).
 *
 *   1. Signs in by break-glass (an ADMIN_EMAILS address and OPS_PASSWORD),
 *      the way an admin gets in on a real Supabase deployment.
 *   2. Loads the DEMO pilots (POST /api/dev/seed, as a signed-in admin: a
 *      demo deployment only).
 *   3. Opens every ops, field, portal and public page it can reach from the
 *      consoles, at most PER_PATTERN pages per route (/ops/projects/[id]/kit
 *      on two projects, not all of them), and fails on a 5xx, an error page,
 *      a page error in the browser or a failed request.
 *   4. Downloads the CSV exports and runs every cron with CRON_SECRET.
 *
 * Env: BASE_URL (http://localhost:3390), ADMIN_EMAIL, OPS_PASSWORD,
 * CRON_SECRET (optional: crons are skipped without it), CHROMIUM_PATH,
 * PER_PATTERN (2), MAX_PAGES (400), SHOTS_DIR (where a hydration error's
 * server HTML and hydrated DOM are saved, to diff).
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(HERE, "../../../apps/web/package.json"));
const { chromium } = require("playwright-core");

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
  if (existsSync(root)) {
    const dir = readdirSync(root).find((d) => /^chromium-\d+$/.test(d));
    if (dir && existsSync(`${root}/${dir}/chrome-linux/chrome`)) return `${root}/${dir}/chrome-linux/chrome`;
  }
  console.error("No Chromium found. Set CHROMIUM_PATH.");
  process.exit(2);
}

const BASE = (process.env.BASE_URL ?? "http://localhost:3390").replace(/\/$/, "");
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const OPS_PASSWORD = process.env.OPS_PASSWORD;
const PER_PATTERN = Number(process.env.PER_PATTERN ?? 2);
const MAX_PAGES = Number(process.env.MAX_PAGES ?? 400);
if (!ADMIN_EMAIL || !OPS_PASSWORD) {
  console.error("walk-routes: set ADMIN_EMAIL (one of ADMIN_EMAILS) and OPS_PASSWORD");
  process.exit(2);
}

const fails = [];
let checks = 0;
function check(name, ok, detail) {
  checks++;
  if (!ok) {
    fails.push(name);
    console.log(`  ✗ ${name}${detail ? `\n      ${String(detail).slice(0, 500)}` : ""}`);
  }
  return ok;
}

const browser = await chromium.launch({ executablePath: findChromium(), args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.setDefaultTimeout(30_000);
page.on("dialog", (d) => d.dismiss().catch(() => {}));
let current = "";
const problems = [];
// The last HTML document loaded: a hydration error is diagnosed by diffing it with the DOM.
let lastDoc = { url: "", html: "" };
page.on("response", (r) => {
  if (r.request().resourceType() === "document" && r.status() === 200) r.text().then((html) => (lastDoc = { url: r.url(), html }), () => {});
});
let hydrationDumps = 0;
page.on("pageerror", (e) => {
  problems.push(`page error: ${e.message.slice(0, 300)}`);
  const dir = process.env.SHOTS_DIR;
  if (dir && /error #(418|419|423|425)/.test(e.message) && hydrationDumps < 5) {
    const n = ++hydrationDumps;
    mkdirSync(dir, { recursive: true });
    setTimeout(() => {
      writeFileSync(join(dir, `routes-hydration-${n}-server.html`), `<!-- ${lastDoc.url} -->\n${lastDoc.html}`);
      page.content().then((dom) => writeFileSync(join(dir, `routes-hydration-${n}-dom.html`), dom), () => {});
    }, 300);
  }
});
page.on("response", (r) => {
  if (r.status() >= 500) problems.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`);
});
page.on("requestfailed", (r) => {
  const why = r.failure()?.errorText ?? "";
  // Navigating away aborts prefetches and media loads: not a failure of the page.
  if (!/ERR_ABORTED|NS_BINDING_ABORTED/.test(why)) problems.push(`request failed: ${r.url().replace(BASE, "")} ${why}`);
});

try {
  /* ---------------------------------------------------------------- */
  console.log("Sign in by break-glass");
  await page.goto(`${BASE}/login`, { waitUntil: "load" });
  await page.locator("summary", { hasText: "Admin break-glass" }).click();
  const form = page.locator("form").filter({ has: page.locator('input[name="password"]') });
  await form.locator('input[name="email"]').fill(ADMIN_EMAIL);
  await form.locator('input[name="password"]').fill(OPS_PASSWORD);
  await form.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => u.pathname.startsWith("/ops"), { timeout: 30_000 });
  check("break-glass admin lands on the ops console", new URL(page.url()).pathname.startsWith("/ops"), page.url());
  console.log(`  ✓ signed in as ${ADMIN_EMAIL}`);

  /* ---------------------------------------------------------------- */
  console.log("Load the DEMO pilots");
  const seed = await page.evaluate(async () => {
    const r = await fetch("/api/dev/seed", { method: "POST", credentials: "same-origin" });
    return { status: r.status, body: await r.json().catch(() => null) };
  });
  check("demo seed loads (POST /api/dev/seed as admin)", seed.status === 200 && seed.body?.ok, JSON.stringify(seed).slice(0, 400));
  const projects = seed.body?.projects ?? [];
  console.log(`  ✓ ${projects.length} DEMO pilots: ${projects.map((p) => p.stage).join(", ")}`);

  /* ---------------------------------------------------------------- */
  console.log("Walk every screen");
  const STATIC = [
    "/ops",
    "/ops/analytics",
    "/ops/calendar",
    "/ops/catalogue",
    "/ops/catalogue/compatibility",
    "/ops/catalogue/import",
    "/ops/catalogue/new",
    "/ops/collateral",
    "/ops/collateral/card",
    "/ops/collateral/letter",
    "/ops/collateral/one-pager",
    "/ops/design",
    "/ops/finance",
    "/ops/help",
    "/ops/install",
    "/ops/intel",
    "/ops/launch",
    "/ops/messages",
    "/ops/pilots",
    "/ops/procurement",
    "/ops/projects",
    "/ops/projects/new",
    "/ops/purchasing",
    "/ops/quotes",
    "/ops/review",
    "/ops/schedule",
    "/ops/settings",
    "/ops/staff",
    "/ops/status",
    "/ops/templates",
    "/field",
    "/field/help",
    "/field/jobs",
    "/field/issues",
    "/field/me",
    "/field/survey",
    "/portal",
    "/",
    "/about",
    "/areas",
    "/faq",
    "/how-it-works",
    "/privacy",
    "/terms",
    "/quote",
  ];
  const perProject = (id) => [
    `/ops/projects/${id}`,
    `/ops/projects/${id}/booking`,
    `/ops/projects/${id}/compliance`,
    `/ops/projects/${id}/design`,
    `/ops/projects/${id}/issues`,
    `/ops/projects/${id}/kit`,
    `/ops/projects/${id}/money`,
    `/ops/projects/${id}/proposal`,
    `/ops/projects/${id}/time`,
    `/p/${id}`,
    `/p/${id}/documents`,
    `/p/${id}/proposal`,
    `/p/${id}/pay`,
    `/field/jobs/${id}`,
    `/field/survey/${id}`,
  ];
  const queue = [...STATIC, ...projects.flatMap((p) => perProject(p.id))];
  const SKIP = /^\/(api|auth|_next)\/|\/export$|^\/ops\/staff\/media|^\/login/;
  const ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|DIH-[A-Z0-9-]+|demo-[a-z0-9-]+/gi;
  // The property book's /a/<uprn> pages have numeric ids: one route, like the rest.
  const pattern = (path) =>
    path.replace(ID, "[id]").replace(/^\/a\/\d+$/, "/a/[id]").replace(/\/day\/\d+/, "/day/[n]").replace(/\/areas\/[a-z0-9]+$/i, "/areas/[outcode]");
  const seen = new Set();
  const perPatternCount = new Map();
  const enqueue = (path) => {
    if (seen.has(path) || SKIP.test(path)) return;
    queue.push(path);
  };
  let visited = 0;
  const patternsSeen = new Set();
  while (queue.length && visited < MAX_PAGES) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);
    const pat = pattern(path);
    const n = perPatternCount.get(pat) ?? 0;
    // Every listed route always; a discovered one at most PER_PATTERN times.
    if (n >= PER_PATTERN && !STATIC.includes(path) && !projects.some((p) => path.includes(p.id) && perProject(p.id).includes(path))) continue;
    perPatternCount.set(pat, n + 1);
    patternsSeen.add(pat);
    visited++;
    current = path;
    problems.length = 0;
    let status = 0;
    try {
      const r = await page.goto(`${BASE}${path}`, { waitUntil: "load" });
      status = r?.status() ?? 0;
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    } catch (err) {
      check(`${path} loads`, false, err.message);
      continue;
    }
    const finalPath = new URL(page.url()).pathname;
    const body = (await page.locator("body").innerText().catch(() => "")) ?? "";
    const errorPage = /Application error|Internal Server Error|This page couldn.t load|Unhandled Runtime Error|Something went wrong/i.test(body);
    const ok = status > 0 && status < 500 && status !== 404 && !errorPage && problems.length === 0;
    check(`${path} (${status}${finalPath !== path.split("?")[0] ? ` → ${finalPath}` : ""})`, ok, [...problems, errorPage ? body.slice(0, 300) : ""].filter(Boolean).join(" | "));
    if (status === 200) {
      const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href") ?? ""));
      for (const href of hrefs) {
        if (!href.startsWith("/") || href.startsWith("//")) continue;
        const u = new URL(href, BASE);
        enqueue(u.pathname);
      }
    }
  }
  console.log(`  ✓ ${visited} pages, ${patternsSeen.size} routes`);
  check("the walk reached the project, document and staff pages", ["/ops/projects/[id]", "/d/[id]", "/ops/staff/[id]", "/ops/quotes/[id]"].every((p) => patternsSeen.has(p)), [...patternsSeen].sort().join(" "));

  /* ---------------------------------------------------------------- */
  // Postgres refuses a uuid column compared with something that isn't one
  // (22P02), where the local backend just finds nothing: a typed or stale
  // link must still be a 404, never a 500.
  console.log("Ids that don't exist, or aren't ids");
  const someProject = projects[0]?.id ?? "00000000-0000-4000-8000-000000000000";
  const BAD = ["not-an-id", "00000000-0000-4000-8000-000000000000", "1"];
  const pagePatterns = [
    "/a/:id",
    "/d/:id",
    "/q/:id",
    "/p/:id",
    "/p/:id/documents",
    "/p/:id/proposal",
    "/p/:id/pay",
    "/ops/projects/:id",
    "/ops/projects/:id/booking",
    "/ops/projects/:id/compliance",
    "/ops/projects/:id/design",
    "/ops/projects/:id/issues",
    "/ops/projects/:id/kit",
    "/ops/projects/:id/money",
    "/ops/projects/:id/proposal",
    "/ops/projects/:id/time",
    "/ops/quotes/:id",
    "/ops/staff/:id",
    "/ops/catalogue/:id",
    "/ops/catalogue/compatibility/:id",
    "/ops/install/:id",
    "/field/jobs/:id",
    "/field/jobs/:id/day/1",
    "/field/jobs/:id/commissioning",
    "/field/jobs/:id/handover",
    "/field/survey/:id",
  ];
  for (const bad of BAD) {
    for (const p of pagePatterns) {
      const path = p.replace(":id", encodeURIComponent(bad));
      const r = await page.request.get(`${BASE}${path}`, { maxRedirects: 0 });
      check(`${path} answers ${r.status()} (not a 5xx)`, r.status() < 500, (await r.text()).slice(0, 300));
    }
  }
  const apiCalls = [
    ["GET", "/api/media/:id"],
    ["POST", "/api/media/:id", {}],
    ["GET", "/api/pay/:id"],
    ["POST", "/api/pay/:id", {}],
    ["GET", "/api/proposals/:id/view"],
    ["POST", "/api/proposals/:id/accept", {}],
    ["POST", "/api/proposals/:id/decline", {}],
    ["POST", "/api/proposals/:id/changes", {}],
    ["GET", "/api/quotes/draft/:id"],
    ["GET", "/api/video-surveys/:id"],
    ["GET", "/api/intel/property/:id"],
    ["GET", "/api/field/survey/:id"],
    ["POST", "/api/field/survey/:id/start", {}],
    ["GET", "/api/field/jobs/:id/photos?day=1"],
    ["GET", "/api/field/jobs/:id/on-my-way?eta=10"],
    ["POST", "/api/field/jobs/:id/day", {}],
    ["POST", "/api/field/issues/:id", {}],
    ["POST", "/api/portal/:id/actions", { kind: "book-survey" }],
    ["GET", "/api/portal/:id/uploads"],
    ["POST", "/api/portal/:id/variations/:id", {}],
    ["GET", `/api/portal/${someProject}/uploads/:id`],
  ];
  for (const bad of BAD) {
    for (const [method, p, body] of apiCalls) {
      const path = p.replaceAll(":id", encodeURIComponent(bad));
      const r = await page.request.fetch(`${BASE}${path}`, { method, maxRedirects: 0, ...(body ? { data: JSON.stringify(body), headers: { "content-type": "application/json", origin: BASE } } : {}) });
      check(`${method} ${path} answers ${r.status()} (not a 5xx)`, r.status() < 500, (await r.text()).slice(0, 300));
    }
  }
  console.log(`  ✓ ${BAD.length * (pagePatterns.length + apiCalls.length)} requests with ids that aren't there`);

  // Postgres can't store U+0000 in text or jsonb (22P05): one pasted into the funnel must not lose the quote.
  const survey = {
    postcode: "SW16 2BE",
    addressLine: "1 Demo\u0000 Street",
    property: { type: "semi-detached", era: "1930-1950", bedrooms: 3, ownership: "owner" },
    rooms: [{ id: "r1", name: "Bed\u0000room", type: "bedroom", size: "medium", floor: "first", glazing: "medium", orientation: "south", hasExternalWall: true, photos: [] }],
    outdoor: { location: "ground-rear", photos: [] },
    electrics: { condition: "modern-spare-ways", photos: [] },
  };
  const nul = await page.request.post(`${BASE}/api/quotes`, {
    data: JSON.stringify({ survey, contact: { name: "Sam Demo", email: "demo.nul@example.com", phone: "07700 900123", timeframe: "asap" }, consents: { operational: true, marketing: false } }),
    headers: { "content-type": "application/json", origin: BASE },
  });
  const nulBody = await nul.text();
  if (check(`a quote with a NUL in its address is saved without it (${nul.status()})`, nul.status() === 200 && !/"saved":false/.test(nulBody), nulBody.slice(0, 300))) {
    console.log("  ✓ a NUL in the funnel is dropped, not a lost quote");
  }

  /* ---------------------------------------------------------------- */
  console.log("Exports");
  for (const path of ["/ops/pilots/export", "/ops/quotes/export", "/ops/catalogue/export", "/ops/intel/export"]) {
    const r = await page.request.get(`${BASE}${path}`);
    const type = r.headers()["content-type"] ?? "";
    const body = await r.text();
    check(`${path} downloads (${r.status()}, ${type.split(";")[0]})`, r.status() === 200 && /csv|text/.test(type), body.slice(0, 200));
    // The property book was loaded with more homes than one select returns (Max Rows): all of them, or say so.
    if (path === "/ops/intel/export" && process.env.EXPECT_INTEL_ROWS) {
      const rows = body.trim().split("\n").length - 1;
      check(`…with every one of the ${process.env.EXPECT_INTEL_ROWS} homes in the book (${rows})`, rows === Number(process.env.EXPECT_INTEL_ROWS), `${rows} rows`);
    }
  }

  /* ---------------------------------------------------------------- */
  if (process.env.CRON_SECRET) {
    console.log("Crons");
    for (const path of ["/api/cron/daily-ops", "/api/cron/digest", "/api/cron/follow-up", "/api/cron/outbox"]) {
      const r = await page.request.get(`${BASE}${path}`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
      const body = await r.text();
      let json = null;
      try {
        json = JSON.parse(body);
      } catch {
        /* not JSON */
      }
      // A job that honestly refuses because a provider isn't set up here (no email) is fine.
      const refusedHonestly = json?.ok === false && /not configured/.test(String(json.reason ?? ""));
      const ran = r.status() === 200 && json && (json.ok !== false || refusedHonestly) && !(json.errors?.length > 0);
      if (check(`${path} runs (${r.status()}${refusedHonestly ? `: ${json.reason}` : ""})`, ran, body.slice(0, 500))) console.log(`  ✓ ${path}: ${body.slice(0, 160)}`);
    }
  }

  const health = await page.request.get(`${BASE}/api/health`);
  check("/api/health is healthy", health.status() === 200, await health.text());
} catch (err) {
  check(`walk stopped on ${current || "set-up"}`, false, err.stack ?? err.message);
} finally {
  await browser.close();
}

console.log(`\n${checks - fails.length}/${checks} route checks passed`);
if (fails.length) {
  console.log(`FAILED (${fails.length}):\n  - ${fails.join("\n  - ")}`);
  process.exit(1);
}
