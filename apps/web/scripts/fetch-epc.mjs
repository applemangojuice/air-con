/**
 * Fetch domestic EPC certificates from the EPC Open Data API and write them to
 * a CSV the importer already understands (import-intel.mjs epc ...). This is
 * what lets GitHub Actions load *real* data unattended — including a weekly
 * "just the newly-issued certificates" pull for marketing.
 *
 * Register once (free) at https://epc.opendatacommunities.org/ to get an API
 * key tied to your email. Auth is HTTP Basic: base64(email:apiKey).
 *
 * Env (or apps/web/.env.local):
 *   EPC_API_EMAIL   the email you registered with
 *   EPC_API_KEY     your API key
 *   (or EPC_API_TOKEN = a pre-computed base64 of "email:key")
 *
 * Usage (from apps/web):
 *   node scripts/fetch-epc.mjs --local-authority E09000022,E09000032 \
 *        --since 2026-06 --out scripts/data/epc-certificates.csv
 *
 *   --local-authority  comma-separated ONS codes. Default: the SW16/SW17
 *                      boroughs (Lambeth, Wandsworth, Merton, Croydon).
 *   --since YYYY-MM    only certificates lodged on/after this month (the
 *                      "new EPCs" incremental). Omit for everything.
 *   --out PATH         output CSV (default scripts/data/epc-certificates.csv).
 *   --size N           page size, max 5000 (default 5000).
 *   --max-pages N      safety cap per authority (default 500).
 *   --base-url URL     override the API base if the contract moves.
 *   --dry-run          print the requests it would make; fetch nothing.
 *
 * The importer filters to your target outcodes (--outcodes SW16,SW17) and keeps
 * the newest certificate per address, so re-running weekly is safe and cheap.
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

/* ---------------- args ------------------------------------------------ */

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const val = (name, fallback) => {
  const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i === -1) return fallback;
  const inline = argv[i].split("=").slice(1).join("=");
  return (inline || argv[i + 1]) ?? fallback;
};

// The four boroughs covering SW16/SW17 and their fringes (ONS codes).
const DEFAULT_LAS = "E09000022,E09000032,E09000024,E09000008"; // Lambeth, Wandsworth, Merton, Croydon
const localAuthorities = String(val("local-authority", DEFAULT_LAS))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const since = val("since", ""); // YYYY-MM
const out = resolve(String(val("out", "scripts/data/epc-certificates.csv")));
const size = Math.min(5000, Math.max(1, Number(val("size", "5000")) || 5000));
const maxPages = Math.max(1, Number(val("max-pages", "500")) || 500);
const baseUrl = String(val("base-url", "https://epc.opendatacommunities.org/api/v1/domestic/search"));
const dryRun = flag("dry-run");

let fromMonth = "";
let fromYear = "";
if (since) {
  const m = since.match(/^(\d{4})-(\d{1,2})$/);
  if (!m) {
    console.error(`--since must be YYYY-MM (got "${since}")`);
    process.exit(1);
  }
  fromYear = m[1];
  fromMonth = String(Number(m[2]));
}

/* ---------------- auth (env or .env.local) --------------------------- */

if (!process.env.EPC_API_KEY && !process.env.EPC_API_TOKEN && existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const mm = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (mm && !process.env[mm[1]]) process.env[mm[1]] = mm[2].replace(/^"|"$/g, "");
  }
}
function authHeader() {
  if (process.env.EPC_API_TOKEN) return `Basic ${process.env.EPC_API_TOKEN}`;
  const email = process.env.EPC_API_EMAIL;
  const key = process.env.EPC_API_KEY;
  if (!email || !key) return null;
  return `Basic ${Buffer.from(`${email}:${key}`).toString("base64")}`;
}

/* ---------------- fetch one authority, following pagination ---------- */

function buildUrl(la, searchAfter) {
  const u = new URL(baseUrl);
  u.searchParams.set("local-authority", la);
  u.searchParams.set("size", String(size));
  if (fromMonth && fromYear) {
    u.searchParams.set("from-month", fromMonth);
    u.searchParams.set("from-year", fromYear);
  }
  if (searchAfter) u.searchParams.set("search-after", searchAfter);
  return u.toString();
}

async function fetchAuthority(la, auth, onRows) {
  let searchAfter = "";
  let page = 0;
  let header = null;
  let rows = 0;
  for (; page < maxPages; page++) {
    const url = buildUrl(la, searchAfter);
    if (dryRun) {
      console.log(`GET ${url}`);
      if (page === 0) break; // one line per authority is enough to eyeball
      continue;
    }
    const res = await fetch(url, { headers: { Accept: "text/csv", Authorization: auth } });
    if (res.status === 401 || res.status === 403) {
      throw new Error(`auth rejected (${res.status}) — check EPC_API_EMAIL / EPC_API_KEY`);
    }
    if (!res.ok) throw new Error(`EPC API ${res.status} for ${la}: ${(await res.text()).slice(0, 200)}`);

    const body = (await res.text()).trim();
    const next = res.headers.get("X-Next-Search-After");
    if (!body) break;

    // Each page is a full CSV with a header line. Keep the header once; the
    // header line never contains a newline, so slicing at the first one is safe.
    const nl = body.indexOf("\n");
    const pageHeader = nl === -1 ? body : body.slice(0, nl);
    const dataText = nl === -1 ? "" : body.slice(nl + 1).trim();
    if (!header) header = pageHeader;
    if (dataText) {
      const count = dataText.split("\n").length;
      rows += count;
      onRows(dataText);
      process.stdout.write(`\r  ${la}: ${rows} rows`);
    }
    if (!dataText || !next || next === searchAfter) break;
    searchAfter = next;
  }
  if (!dryRun) process.stdout.write("\n");
  return { header, rows };
}

/* ---------------- run ------------------------------------------------- */

const auth = authHeader();
if (!auth && !dryRun) {
  console.error("Set EPC_API_EMAIL + EPC_API_KEY (or EPC_API_TOKEN), or use --dry-run.");
  process.exit(1);
}

console.log(
  `Fetching EPC certificates for ${localAuthorities.length} authority(ies)` +
    (since ? ` lodged since ${since}` : "") +
    (dryRun ? " [dry run]" : ""),
);

let header = null;
const dataChunks = [];
for (const la of localAuthorities) {
  const result = await fetchAuthority(la, auth, (dataText) => dataChunks.push(dataText));
  if (result.header && !header) header = result.header;
}

if (dryRun) {
  console.log("Dry run: no data written.");
  process.exit(0);
}

if (!header) {
  console.error("No data returned. Nothing written. (Check the authority codes and --since.)");
  process.exit(1);
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${header}\n${dataChunks.join("\n")}\n`);
const total = dataChunks.reduce((n, c) => n + c.split("\n").length, 0);
console.log(`Wrote ${total} certificate rows to ${out}`);
console.log(
  "Next: node scripts/import-intel.mjs epc " +
    `${out.includes("apps/web/") ? out.split("apps/web/")[1] : out} --outcodes SW16,SW17`,
);
