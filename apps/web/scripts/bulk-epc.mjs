/**
 * Bulk EPC load: whole areas from one file instead of an API call per home.
 *
 * Reads the EPC register's bulk domestic certificates file, keeps only the
 * homes in your outcodes (the newest certificate each), and writes the slim
 * CSV import-intel.mjs reads. Streams: the national file never has to fit in
 * memory or be unzipped to disk.
 *
 *   node --experimental-strip-types scripts/bulk-epc.mjs --national --outcodes SW16,SW17
 *   node --experimental-strip-types scripts/bulk-epc.mjs --file ~/Downloads/lambeth.zip
 *   node --experimental-strip-types scripts/bulk-epc.mjs --file "https://…link from the email…"
 *
 * Sources (one of):
 *   --national       the whole England and Wales file, straight from the
 *                    service's API (/api/files/domestic/csv). Needs
 *                    EPC_BEARER_TOKEN. Several GB: fine on GitHub Actions.
 *   --file PATH|URL  a file you have: the national download, or a council
 *                    download from the website (get-energy-performance-
 *                    data.communities.gov.uk → Download data → filter by
 *                    local authority; the link arrives by email). .zip or .csv.
 *
 * Options:
 *   --outcodes SW16,SW17   keep these outcodes (default: every row in the
 *                          file; for --national, required)
 *   --since YYYY-MM-DD     only certificates lodged on/after this date
 *   --out PATH             default scripts/data/epc-certificates.csv
 *   --keep PATH            keep the downloaded file here (default: deleted)
 *
 * Then: node scripts/import-intel.mjs epc scripts/data/epc-certificates.csv
 */

import { createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readSync, closeSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { EPC_API_BASE, epcBulkRow, outcodeOf } from "@aircon/domain";
import { EPC_CSV_COLUMNS, epcCsvLine, quotesOpen, splitCsvRecord } from "./epc-csv.mjs";

/* ---------------- args ------------------------------------------------ */

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const val = (name, fallback) => {
  const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i === -1) return fallback;
  const inline = argv[i].split("=").slice(1).join("=");
  return (inline || argv[i + 1]) ?? fallback;
};

const national = flag("national");
const file = val("file", "");
const outcodes = new Set(
  String(val("outcodes", ""))
    .split(",")
    .map((o) => o.trim().toUpperCase())
    .filter(Boolean),
);
const since = String(val("since", ""));
const out = resolve(String(val("out", "scripts/data/epc-certificates.csv")));
const keep = val("keep", "");
const base = String(process.env.EPC_API_BASE || EPC_API_BASE);

if (national === Boolean(file)) {
  console.error("Choose one source: --national, or --file PATH|URL.");
  process.exit(1);
}
if (national && outcodes.size === 0) {
  console.error("--national needs --outcodes (the national file is every home in England and Wales).");
  process.exit(1);
}
if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
  console.error(`--since must be YYYY-MM-DD (got "${since}")`);
  process.exit(1);
}

if (!process.env.EPC_BEARER_TOKEN && existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

/* ---------------- 1. get the file ------------------------------------ */

async function download(url, headers = {}) {
  const dest = keep ? resolve(keep) : join(tmpdir(), `epc-bulk-${process.pid}`);
  console.log(`Downloading ${new URL(url).host}${new URL(url).pathname} …`);
  // The API answers with a redirect to a signed S3 link. Follow it by hand, without our token:
  // S3 refuses a request that carries both its signature and an Authorization header.
  let res = await fetch(url, { headers, redirect: "manual" });
  for (let hops = 0; res.status >= 300 && res.status < 400 && hops < 5; hops++) {
    const next = res.headers.get("location");
    if (!next) break;
    res = await fetch(new URL(next, url), { redirect: "manual" });
  }
  if (res.status === 401 || res.status === 403) throw new Error(`refused (${res.status}): check EPC_BEARER_TOKEN, or the link has expired`);
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const total = Number(res.headers.get("content-length")) || 0;
  let got = 0;
  let last = 0;
  const counted = Readable.fromWeb(res.body).on("data", (chunk) => {
    got += chunk.length;
    if (got - last > 50 * 1024 * 1024) {
      last = got;
      process.stdout.write(`\r  ${(got / 1e6).toFixed(0)} MB${total ? ` of ${(total / 1e6).toFixed(0)} MB` : ""}`);
    }
  });
  mkdirSync(dirname(dest), { recursive: true });
  await pipeline(counted, createWriteStream(dest));
  process.stdout.write(`\r  ${(got / 1e6).toFixed(0)} MB downloaded\n`);
  return { path: dest, temporary: !keep };
}

let source;
if (national) {
  const token = process.env.EPC_BEARER_TOKEN?.trim();
  if (!token) {
    console.error("Set EPC_BEARER_TOKEN (free sign-up at https://get-energy-performance-data.communities.gov.uk/).");
    process.exit(1);
  }
  source = await download(new URL("/api/files/domestic/csv", base).toString(), { Authorization: `Bearer ${token}` });
} else if (/^https?:\/\//i.test(file)) {
  source = await download(file);
} else {
  if (!existsSync(file)) {
    console.error(`File not found: ${resolve(file)}`);
    process.exit(1);
  }
  source = { path: resolve(file), temporary: false };
}

/* ---------------- 2. stream its CSV rows ----------------------------- */

function isZip(path) {
  const fd = openSync(path, "r");
  const buf = Buffer.alloc(4);
  readSync(fd, buf, 0, 4, 0);
  closeSync(fd);
  return buf[0] === 0x50 && buf[1] === 0x4b; // "PK"
}

/** The certificate CSVs inside a zip (not the recommendations files), in order. */
function zipMembers(path) {
  const listed = spawnSync("unzip", ["-Z1", path], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (listed.status !== 0) throw new Error(`unzip couldn't read ${path}: ${listed.stderr || "is unzip installed?"}`);
  return listed.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter((m) => /\.csv$/i.test(m) && !/recommend/i.test(m));
}

/**
 * Quick pre-check before the full parse: does the line mention one of the
 * outcodes followed by an inward code? Cheap enough for tens of millions of
 * lines; the exact check on the parsed postcode follows.
 */
const prefilter =
  outcodes.size > 0
    ? new RegExp(`(?:^|[,"])(?:${[...outcodes].map((o) => o.replace(/[^A-Z0-9]/g, "")).join("|")})\\s*\\d[A-Z]{2}(?:[",]|$)`, "i")
    : null;

const homes = new Map();
let rowsRead = 0;
let rowsKept = 0;

async function readCsvStream(stream, label) {
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let header = null;
  let pending = "";
  for await (const physical of rl) {
    const line = pending ? `${pending}\n${physical}` : physical;
    if (quotesOpen(line)) {
      pending = line;
      continue;
    }
    pending = "";
    if (!header) {
      header = splitCsvRecord(line.replace(/^﻿/, "")).map((h) => h.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_"));
      continue;
    }
    rowsRead++;
    if (rowsRead % 500_000 === 0) process.stdout.write(`\r  ${label}: ${(rowsRead / 1e6).toFixed(1)}M rows read, ${homes.size} homes kept`);
    if (prefilter && !prefilter.test(line)) continue;
    const fields = splitCsvRecord(line);
    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = (fields[i] ?? "").trim();
    const home = epcBulkRow(row);
    if (!home) continue;
    if (outcodes.size > 0 && !outcodes.has(outcodeOf(home.postcode))) continue;
    if (since && home.lodgedAt < since) continue;
    rowsKept++;
    const prev = homes.get(home.key);
    if (!prev || home.lodgedAt > prev.lodgedAt) homes.set(home.key, home);
  }
  process.stdout.write(`\r  ${label}: ${rowsRead.toLocaleString("en-GB")} rows read, ${homes.size.toLocaleString("en-GB")} homes kept\n`);
}

if (isZip(source.path)) {
  const members = zipMembers(source.path);
  if (members.length === 0) throw new Error("No certificate CSV in the zip.");
  console.log(`Reading ${members.length} file(s) from the zip${outcodes.size ? `, keeping ${[...outcodes].join(", ")}` : ""}`);
  for (const member of members) {
    const child = spawn("unzip", ["-p", source.path, member], { stdio: ["ignore", "pipe", "inherit"] });
    const done = new Promise((ok, fail) => child.on("close", (code) => (code === 0 ? ok() : fail(new Error(`unzip exited ${code} on ${member}`)))));
    await readCsvStream(child.stdout, member);
    await done;
  }
} else {
  console.log(`Reading ${source.path} (${(statSync(source.path).size / 1e6).toFixed(0)} MB)`);
  await readCsvStream(createReadStream(source.path), "csv");
}
if (source.temporary) rmSync(source.path, { force: true });

/* ---------------- 3. write the slim CSV ------------------------------ */

const lines = [EPC_CSV_COLUMNS.join(",")];
for (const h of [...homes.values()].sort((a, b) => a.postcode.localeCompare(b.postcode) || a.line1.localeCompare(b.line1, "en", { numeric: true }))) {
  lines.push(epcCsvLine(h));
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${lines.join("\n")}\n`);
console.log(`${rowsKept.toLocaleString("en-GB")} certificates in scope → ${homes.size.toLocaleString("en-GB")} homes (newest certificate each) written to ${out}`);
console.log(`Next: node scripts/import-intel.mjs epc ${out.includes("apps/web/") ? out.split("apps/web/")[1] : out}`);
