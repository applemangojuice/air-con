/**
 * Fetch domestic EPC certificates from the EPC register's data service and
 * write them to a CSV the importer understands (import-intel.mjs epc ...).
 * This is what lets GitHub Actions load *real* data unattended, including a
 * weekly "just the newly-issued certificates" pull for marketing.
 *
 * The service: https://get-energy-performance-data.communities.gov.uk/
 * (it replaced epc.opendatacommunities.org, which closed on 30 May 2026).
 * Register once (free), copy the API token from your account, and set
 *
 *   EPC_BEARER_TOKEN   the token (env, or apps/web/.env.local)
 *
 * It reuses the domain's certificate parser (the one the live quote lookup
 * uses), so Node strips the TypeScript at load time, hence the flag:
 *
 *   node --experimental-strip-types scripts/fetch-epc.mjs [options]
 *
 * Two ways to choose homes:
 *
 *   --postcodes "SW16 1AD,SW16 2BE"   these postcodes (or --postcodes-file
 *                                     PATH, one per line). The quick way to
 *                                     load a street or the pilot homes.
 *   --council "Lambeth,Wandsworth"    every certificate lodged in these
 *                                     councils (names as the register spells
 *                                     them), kept to --outcodes before any
 *                                     certificate is fetched.
 *
 *   --since YYYY-MM or YYYY-MM-DD     only certificates lodged on/after this
 *                                     date (the weekly "new EPCs" pull).
 *   --outcodes SW16,SW17              keep only these outcodes (council mode).
 *   --out PATH                        output CSV (default scripts/data/epc-certificates.csv).
 *   --max-certificates N              stop after N certificates (default 20000).
 *   --concurrency N                   certificate fetches at once (default 4).
 *   --base-url URL                    the API, if the service moves it.
 *   --dry-run                         print the requests it would make; fetch nothing.
 *
 * The importer keeps the newest certificate per address and upserts, so
 * re-running weekly is safe and cheap.
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { EPC_CSV_COLUMNS, epcCsvLine } from "./epc-csv.mjs";
import {
  EPC_API_BASE,
  epcCertificateUrl,
  epcFromCertificate,
  epcSearchUrl,
  formatPostcode,
  latestHitPerAddress,
  outcodeOf,
  parseEpcSearch,
} from "@aircon/domain";

/* ---------------- args ------------------------------------------------ */

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const val = (name, fallback) => {
  const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i === -1) return fallback;
  const inline = argv[i].split("=").slice(1).join("=");
  return (inline || argv[i + 1]) ?? fallback;
};
const list = (s) =>
  String(s ?? "")
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

let postcodes = list(val("postcodes", ""));
const postcodesFile = val("postcodes-file", "");
if (postcodesFile) postcodes.push(...list(readFileSync(postcodesFile, "utf8")));
postcodes = [...new Set(postcodes.map(formatPostcode))];
const councils = list(val("council", ""));
const outcodes = list(val("outcodes", "")).map((o) => o.toUpperCase());
const sinceRaw = String(val("since", ""));
const out = resolve(String(val("out", "scripts/data/epc-certificates.csv")));
const maxCertificates = Math.max(1, Number(val("max-certificates", "20000")) || 20000);
const concurrency = Math.min(10, Math.max(1, Number(val("concurrency", "4")) || 4));
const base = String(val("base-url", process.env.EPC_API_BASE || EPC_API_BASE));
const dryRun = flag("dry-run");

let since = "";
if (sinceRaw) {
  const m = sinceRaw.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
  if (!m) {
    console.error(`--since must be YYYY-MM or YYYY-MM-DD (got "${sinceRaw}")`);
    process.exit(1);
  }
  since = `${m[1]}-${m[2].padStart(2, "0")}-${(m[3] ?? "1").padStart(2, "0")}`;
}
if (postcodes.length === 0 && councils.length === 0) {
  console.error('Choose homes with --postcodes "SW16 1AD,…" (or --postcodes-file) or --council "Lambeth,…".');
  process.exit(1);
}

/* ---------------- auth (env or .env.local) --------------------------- */

if (!process.env.EPC_BEARER_TOKEN && existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const mm = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (mm && !process.env[mm[1]]) process.env[mm[1]] = mm[2].replace(/^"|"$/g, "");
  }
}
const token = process.env.EPC_BEARER_TOKEN?.trim();
if (!token && !dryRun) {
  console.error(
    "Set EPC_BEARER_TOKEN (free sign-up at https://get-energy-performance-data.communities.gov.uk/), or use --dry-run.",
  );
  process.exit(1);
}

/* ---------------- http ----------------------------------------------- */

async function getJson(url, attempt = 1) {
  if (dryRun) {
    console.log(`GET ${url}`);
    return null;
  }
  const res = await fetch(url, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` } });
  if (res.status === 401 || res.status === 403) throw new Error(`token rejected (${res.status}): check EPC_BEARER_TOKEN`);
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    return getJson(url, attempt + 1);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`EPC API ${res.status} for ${url}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/* ---------------- 1. which certificates ------------------------------ */

const hits = [];
if (postcodes.length) {
  console.log(`Searching ${postcodes.length} postcode(s)${dryRun ? " [dry run]" : ""}`);
  for (const pc of postcodes) {
    const json = await getJson(epcSearchUrl(pc, base));
    const found = parseEpcSearch(json).filter((h) => !since || (h.registeredAt ?? "") >= since);
    hits.push(...found);
    if (!dryRun) console.log(`  ${pc}: ${found.length} certificate(s)`);
  }
}
for (const council of councils) {
  let page = 1;
  let rows = 0;
  for (;;) {
    const u = new URL("/api/domestic/search", base);
    u.searchParams.append("council[]", council);
    if (since) u.searchParams.set("date_start", since);
    u.searchParams.set("page_size", "5000");
    u.searchParams.set("current_page", String(page));
    const json = await getJson(u.toString());
    if (dryRun) break;
    const found = parseEpcSearch(json).filter((h) => outcodes.length === 0 || outcodes.includes(outcodeOf(h.postcode)));
    hits.push(...found);
    rows += Array.isArray(json?.data) ? json.data.length : 0;
    process.stdout.write(`\r  ${council}: ${rows} certificates read, ${hits.length} in scope`);
    const totalPages = Number(json?.pagination?.totalPages ?? 1);
    if (!Array.isArray(json?.data) || json.data.length === 0 || page >= totalPages) break;
    page++;
  }
  if (!dryRun) process.stdout.write("\n");
}

const latest = latestHitPerAddress(hits).slice(0, maxCertificates);
if (dryRun) {
  console.log("Dry run: then one GET per certificate, e.g.");
  console.log(`GET ${epcCertificateUrl("0000-0000-0000-0000-0000", base)}`);
  process.exit(0);
}
console.log(`${latest.length} home(s), newest certificate each. Fetching certificates…`);

/* ---------------- 2. each certificate -------------------------------- */

const lines = [EPC_CSV_COLUMNS.join(",")];
let done = 0;
let missing = 0;
let next = 0;
async function worker() {
  while (next < latest.length) {
    const hit = latest[next++];
    let epc;
    try {
      epc = epcFromCertificate(await getJson(epcCertificateUrl(hit.certificateNumber, base)));
    } catch (err) {
      if (/token rejected/.test(err.message)) throw err;
      console.warn(`\n  ${hit.certificateNumber}: ${err.message}`);
    }
    if (!epc) missing++;
    // A certificate that won't load still gives the address, UPRN and rating from the search.
    lines.push(epcCsvLine({ ...hit, epc, lodgedAt: hit.registeredAt }));
    done++;
    if (done % 25 === 0 || done === latest.length) process.stdout.write(`\r  ${done}/${latest.length} certificates`);
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
process.stdout.write("\n");

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${lines.join("\n")}\n`);
console.log(`Wrote ${lines.length - 1} home(s) to ${out}${missing ? ` (${missing} without full certificate detail)` : ""}`);
console.log(
  "Next: node scripts/import-intel.mjs epc " +
    `${out.includes("apps/web/") ? out.split("apps/web/")[1] : out}` +
    (outcodes.length ? ` --outcodes ${outcodes.join(",")}` : ""),
);
