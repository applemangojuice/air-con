/**
 * The handover, over and over: the moment the crew publishes the family's
 * pack and hands them the phone to sign, repeated on one job so a race on
 * that screen shows up as a number (passes out of runs), not a rare flake.
 *
 * Each round puts the job back as phase I of the pilot walk left it
 * (commissioning signed, pack not published, not signed off), opens the
 * handover screen on the installer's phone, publishes (every third round
 * with a double tap), checks the sign-off opens straight away, and has the
 * family sign "All good". Every request, response and console line of a
 * round is kept and printed if the round fails, with what the refresh after
 * each mutation brought back.
 *
 * Start from the pilot walk's data:
 *
 *   E2E_UNTIL=I E2E_IDS_FILE=/tmp/ids.json node scripts/e2e-pilot.mjs
 *   IDS_FILE=/tmp/ids.json LOOPS=30 node scripts/e2e-handover-loop.mjs
 *
 * Putting the job back writes the project row directly (test-only): through
 * the Supabase REST API with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 * (the compat stack: supabase/tests/compat/run-handover-loop.sh, which also
 * slows the stack down), or into LOCAL_DATA_DIR's projects.json on the local
 * file backend. Env: BASE_URL, IDS_FILE, LOOPS (30), CHROMIUM_PATH,
 * SHOTS_DIR. Exit code 0 only if every round passed.
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
  if (existsSync(root)) {
    const dir = readdirSync(root).find((d) => /^chromium-\d+$/.test(d));
    if (dir && existsSync(`${root}/${dir}/chrome-linux/chrome`)) return `${root}/${dir}/chrome-linux/chrome`;
  }
  console.error("No Chromium found. Set CHROMIUM_PATH to a Chrome/Chromium binary.");
  process.exit(2);
}

const BASE = (process.env.BASE_URL ?? "http://localhost:3330").replace(/\/$/, "");
const LOOPS = Number(process.env.LOOPS ?? 30);
const SHOTS = process.env.SHOTS_DIR ?? mkdtempSync(join(tmpdir(), "e2e-handover-"));
mkdirSync(SHOTS, { recursive: true });
if (!process.env.IDS_FILE) {
  console.error("IDS_FILE is required: the ids the pilot walk wrote (E2E_UNTIL=I E2E_IDS_FILE=…).");
  process.exit(2);
}
const ids = JSON.parse(readFileSync(process.env.IDS_FILE, "utf8"));
const PID = ids.pid;
const SIGNER = String(ids.customer?.name ?? "Pat Example (DEMO)").replace(" (DEMO)", "");

/* ------------------------------------------------------------------ */
/* Putting the job back (test-only)                                    */
/* ------------------------------------------------------------------ */

/** The columns a publish or a sign-off changes; the row is put back to these. */
const COLUMNS = ["project", "current_stage", "completed", "next_action", "next_action_at"];

function restRow() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const headers = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };
  const at = `${url}/rest/v1/projects?id=eq.${PID}`;
  return {
    async read() {
      const r = await fetch(`${at}&select=${COLUMNS.join(",")}`, { headers });
      const rows = await r.json();
      if (!r.ok || rows.length !== 1) throw new Error(`snapshot: ${r.status} ${JSON.stringify(rows).slice(0, 200)}`);
      return rows[0];
    },
    async write(row) {
      const r = await fetch(at, { method: "PATCH", headers: { ...headers, prefer: "return=minimal" }, body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }) });
      if (!r.ok) throw new Error(`restore: ${r.status} ${await r.text()}`);
    },
  };
}

function fileRow() {
  const dir = process.env.LOCAL_DATA_DIR;
  if (!dir) return null;
  const file = join(dir, "projects.json");
  const rows = () => JSON.parse(readFileSync(file, "utf8"));
  return {
    async read() {
      const row = rows().find((r) => r.id === PID);
      if (!row) throw new Error(`snapshot: project ${PID} isn't in ${file}`);
      return Object.fromEntries(COLUMNS.map((c) => [c, row[c] ?? null]));
    },
    async write(saved) {
      const all = rows().map((r) => (r.id === PID ? { ...r, ...saved, updated_at: new Date().toISOString() } : r));
      // One row per line, written atomically, as the local store writes it (it rereads on a new mtime).
      const tmp = `${file}.~loop-${process.pid}`;
      writeFileSync(tmp, `[\n${all.map((r) => JSON.stringify(r)).join(",\n")}\n]\n`);
      renameSync(tmp, file);
    },
  };
}

const store = restRow() ?? fileRow();
if (!store) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (Supabase-shaped) or LOCAL_DATA_DIR (file backend) to put the job back between rounds.");
  process.exit(2);
}
const snapshot = await store.read();
if (snapshot.project?.handover?.status !== "commissioned" || snapshot.project?.handover?.packDocumentId) {
  console.error(`The job isn't where phase I leaves it (handover ${snapshot.project?.handover?.status}, pack ${snapshot.project?.handover?.packDocumentId ?? "none"}).`);
  process.exit(2);
}

/* ------------------------------------------------------------------ */
/* The phone                                                           */
/* ------------------------------------------------------------------ */

const browser = await chromium.launch({ executablePath: findChromium(), args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await context.newPage();
page.setDefaultTimeout(20_000);
page.on("dialog", (d) => d.accept().catch(() => {}));
// Every RSC response as the page itself reads it (teed, so its streaming is untouched): how many
// network chunks, when each landed, and whether it knows the pack is published / the sign-off made.
await context.addInitScript(() => {
  const log = (window.__rsc = []);
  const orig = window.fetch;
  window.fetch = async (input, init) => {
    const res = await orig(input, init);
    const h = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (h.get("rsc") !== "1" || !res.body || h.get("next-router-prefetch")) return res;
    const url = String(input instanceof Request ? input.url : input).replace(location.origin, "");
    const entry = { url, at: performance.now(), chunks: [], done: false, error: null, pack: null, signoff: false };
    log.push(entry);
    const [mine, theirs] = res.body.tee();
    (async () => {
      const reader = mine.getReader();
      const dec = new TextDecoder();
      let text = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          entry.chunks.push([Math.round(performance.now() - entry.at), value.length]);
          text += dec.decode(value, { stream: true });
        }
        entry.done = true;
      } catch (e) {
        entry.error = String(e);
      }
      entry.pack = text.match(/"packDocumentId":"([0-9a-f-]{36})"/)?.[1] ?? null;
      entry.signoff = /"signoff":\{/.test(text);
      entry.bytes = text.length;
    })();
    return new Response(theirs, { status: res.status, statusText: res.statusText, headers: res.headers });
  };
});

let trail = [];
const t0 = () => new Date().toISOString().slice(11, 23);
const note = (line) => trail.push(`${t0()} ${line}`);
const short = (u) => u.replace(BASE, "").replace(PID, "<pid>");
page.on("request", (r) => {
  if (r.method() !== "GET" || r.headers()["rsc"]) note(`→ ${r.method()} ${short(r.url())}${r.headers()["next-router-prefetch"] ? " [prefetch]" : r.headers()["rsc"] ? " [rsc]" : ""}`);
});
page.on("response", (r) => {
  const req = r.request();
  if (req.method() === "GET" && !req.headers()["rsc"]) return;
  note(`← ${r.status()} ${short(r.url())}`);
});
// Chromium reports every streamed RSC response as ERR_ABORTED once React has read it: not a failure, so not noted.
page.on("requestfailed", (r) => (r.headers()["rsc"] && r.failure()?.errorText === "net::ERR_ABORTED" ? undefined : note(`✗ ${r.method()} ${short(r.url())} ${r.failure()?.errorText}`)));
page.on("console", (m) => note(`console ${m.type()}: ${m.text().slice(0, 300)}`));
page.on("pageerror", (e) => note(`PAGE ERROR: ${e.message.slice(0, 300)}`));

async function hydrated() {
  await page
    .waitForFunction(() => [...document.querySelectorAll("main button, main input:not([type=hidden])")].every((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber") || k.startsWith("__reactProps"))), undefined, { timeout: 20_000 })
    .catch(() => {});
}
async function go(path) {
  await page.goto(`${BASE}${path}`, { waitUntil: "load" });
  await hydrated();
}
const text = async (sel = "main") => ((await page.locator(sel).first().innerText().catch(() => "")) ?? "").replace(/\n{2,}/g, "\n");
async function waitFor(re, timeout = 20_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (re.test(await text())) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

await go("/login");
await page.locator("form").filter({ has: page.locator('input[name="role"][value="installer"]') }).getByRole("button").click();
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 });

/* ------------------------------------------------------------------ */
/* Rounds                                                              */
/* ------------------------------------------------------------------ */

const results = [];
for (let n = 1; n <= LOOPS; n++) {
  trail = [];
  const fails = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(`${name}${detail ? `: ${String(detail).slice(0, 300)}` : ""}`);
    return ok;
  };
  const started = Date.now();
  const doubleTap = n % 3 === 0;
  let publishes = 0;
  const countPublish = (r) => {
    if (r.method() === "POST" && /\/api\/field\/jobs\/[^/]+\/handover$/.test(r.url()) && /"publish"/.test(r.postData() ?? "")) publishes++;
  };
  page.on("request", countPublish);
  try {
    await store.write(snapshot);
    await go(`/field/jobs/${PID}/handover`);
    check("walkthrough done", await waitFor(/Customer walkthrough\s*Done/), (await text()).slice(0, 200));
    const publish = page.getByRole("button", { name: "Publish the handover pack" });
    await publish.waitFor();
    if (doubleTap) {
      // Two taps in the same moment, before the screen can redraw: a thumb that bounces.
      await publish.evaluate((b) => {
        b.click();
        b.click();
      });
    } else await publish.click();
    const tapped = Date.now();
    const shown = await waitFor(/Published\. Publishing again makes a new version/);
    check("the screen says the pack is published", shown, (await text()).slice(0, 400));
    const name = page.getByLabel("Your full name");
    check("the sign-off opens straight after publishing", await name.isEnabled().catch(() => false));
    const openedMs = Date.now() - tapped;
    if (shown) {
      await name.fill(SIGNER);
      await page.getByRole("button", { name: "All good" }).first().click();
      const canvas = page.locator("main canvas").last();
      await canvas.scrollIntoViewIfNeeded();
      const cb = await canvas.boundingBox();
      await page.mouse.move(cb.x + 20, cb.y + cb.height / 2);
      await page.mouse.down();
      for (let k = 1; k <= 10; k++) await page.mouse.move(cb.x + 20 + (k * (cb.width - 40)) / 10, cb.y + cb.height / 2 + (k % 2 ? -20 : 20), { steps: 3 });
      await page.mouse.up();
      await page.getByRole("button", { name: "Sign off the handover" }).click();
      check("the screen says they signed, all good", await waitFor(new RegExp(`Signed by ${SIGNER}, .*all good`)), (await text()).slice(0, 400));
      check("their pack opens from the screen", (await page.getByRole("link", { name: "Open their handover pack" }).count()) === 1);
    }
    // Not a check, a measure: is the background re-read (CatchUpRunner) still on its way? A stalled
    // in-place refresh never lands; the screen above must not have needed it.
    const caughtUp = await page
      .waitForFunction(() => !document.documentElement.hasAttribute("data-catching-up"), undefined, { timeout: 10_000 })
      .then(() => true, () => false);
    // The phone isn't stuck: the next tap (a link in the field app's tabs) still opens its screen.
    await page.getByRole("navigation", { name: "Field" }).getByRole("link", { name: "Issues" }).click();
    const moved = await page.waitForURL(/\/field\/issues$/, { timeout: 20_000 }).then(() => true, () => false);
    check("the next screen opens after the handover", moved && (await waitFor(/issue|snag|Nothing/i)), `${page.url()} ${(await text()).slice(0, 200)}`);
    // The server agrees, whatever the screen said.
    const after = await store.read();
    check("the server has the pack and the sign-off", Boolean(after.project?.handover?.packDocumentId) && after.project?.handover?.status === "handed-over", JSON.stringify(after.project?.handover).slice(0, 200));
    if (doubleTap) check("a double tap publishes once", publishes === 1, `${publishes} publish requests`);
    results.push({ n, ok: fails.length === 0, ms: Date.now() - started, openedMs, doubleTap, caughtUp });
  } catch (err) {
    fails.push(`stopped: ${err?.message?.split("\n")[0] ?? err}`);
    results.push({ n, ok: false, ms: Date.now() - started, doubleTap });
  }
  page.off("request", countPublish);
  const r = results.at(-1);
  console.log(`  ${r.ok ? "✓" : "✗"} round ${n}${doubleTap ? " (double tap)" : ""}: ${r.ms} ms${r.openedMs !== undefined ? `, sign-off open ${r.openedMs} ms after the tap` : ""}${r.caughtUp === false ? " (its background refresh never landed)" : ""}`);
  if (!r.ok) {
    for (const f of fails) console.log(`      ${f}`);
    await page.screenshot({ path: join(SHOTS, `round-${n}-FAIL.png`), fullPage: true }).catch(() => {});
    console.log(`      requests this round:\n        ${trail.slice(-60).join("\n        ")}`);
    const rsc = await page.evaluate(() => window.__rsc ?? []).catch(() => []);
    console.log(`      RSC responses on this page (as the page read them):`);
    for (const e of rsc) console.log(`        ${e.url.replace(PID, "<pid>")}: ${e.done ? "complete" : e.error ? `error ${e.error}` : "STILL STREAMING"}, ${e.chunks.length} chunk(s) ${JSON.stringify(e.chunks)}, ${e.bytes ?? "?"} bytes, pack ${e.pack ?? "absent"}, signoff ${e.signoff ? "present" : "absent"}`);
  }
}

await store.write(snapshot).catch(() => {});
await browser.close();
const passed = results.filter((r) => r.ok).length;
const opened = results.map((r) => r.openedMs).filter((x) => x !== undefined).sort((a, b) => a - b);
const stalled = results.filter((r) => r.caughtUp === false).length;
console.log(
  `\nHandover loop: ${passed} of ${LOOPS} rounds passed${opened.length ? ` (sign-off open after the tap: median ${opened[Math.floor(opened.length / 2)]} ms, slowest ${opened.at(-1)} ms)` : ""}; ${stalled} round(s) where the background refresh never landed. Screenshots: ${SHOTS}`,
);
process.exit(passed === LOOPS ? 0 : 1);
