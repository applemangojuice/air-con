"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  CsvRecordStream,
  EPC_BATCH_SIZE,
  epcCandidate,
  epcColumnProblems,
  epcRowFromFields,
  mapEpcColumns,
  outcodeOf,
  outcodePrefilter,
  parseOutcodes,
  splitCsvRecord,
  type EpcColumnMap,
  type EpcField,
  type EpcRow,
} from "@/lib/epc-import";
import { listZipEntries, openZipEntry, readZipEntryFirstLine, zipEntryProblem } from "@/lib/zip-reader";
import {
  FREE_PLAN_BYTES,
  LONDON_AREAS,
  LondonTally,
  areaOf,
  formatBytes,
  type DistrictCount,
} from "@/lib/epc-scan";

/* ------------------------------------------------------------------ */
/* What gets read: the CSVs inside a zip, or CSV files chosen directly */
/* ------------------------------------------------------------------ */

interface Part {
  /** Stable across visits, for resuming: "<zip name>/<entry name>" or the CSV's name. */
  key: string;
  label: string;
  /** Bytes of the chosen file this part occupies (compressed, for a zip). */
  size: number;
  open: (onRead: (bytes: number) => void) => Promise<ReadableStream<Uint8Array>>;
  firstLine: () => Promise<string>;
}

async function firstLineOf(file: Blob): Promise<string> {
  const text = await file.slice(0, 1_000_000).text();
  const nl = text.indexOf("\n");
  return (nl >= 0 ? text.slice(0, nl) : text).replace(/\r$/, "");
}

function counted(stream: ReadableStream<Uint8Array>, onRead: (bytes: number) => void): ReadableStream<Uint8Array> {
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        onRead(chunk.byteLength);
        controller.enqueue(chunk);
      },
    }),
  );
}

const yearOrder = (a: Part, b: Part) => b.label.localeCompare(a.label, "en", { numeric: true });

async function partsFrom(files: File[]): Promise<Part[]> {
  const parts: Part[] = [];
  for (const file of files) {
    if (/\.zip$/i.test(file.name)) {
      const entries = await listZipEntries(file);
      for (const entry of entries) {
        const base = entry.name.split("/").pop() ?? entry.name;
        // Only the CSVs: skip folders, readme/licence files and macOS's __MACOSX copies.
        if (!/\.csv$/i.test(base) || entry.name.includes("__MACOSX") || base.startsWith("._")) continue;
        const problem = zipEntryProblem(entry);
        if (problem) throw new Error(problem);
        parts.push({
          key: `${file.name}/${entry.name}`,
          label: base,
          size: entry.compressedSize,
          open: (onRead) => openZipEntry(file, entry, onRead),
          firstLine: () => readZipEntryFirstLine(file, entry),
        });
      }
    } else {
      parts.push({
        key: file.name,
        label: file.name,
        size: file.size,
        open: async (onRead) => counted(file.stream() as ReadableStream<Uint8Array>, onRead),
        firstLine: () => firstLineOf(file),
      });
    }
  }
  if (parts.length === 0) throw new Error("There are no CSV files in what you chose.");
  return parts.sort(yearOrder); // newest year first: older certificates are then skipped, not written
}

/* ------------------------------------------------------------------ */
/* Resume: what's been sent, kept in this browser                      */
/* ------------------------------------------------------------------ */

interface SavedRun {
  outcodes: string;
  done: string[];
  /** The part in progress and how many of its matching rows are dealt with (saved, or not needed). */
  partial?: { key: string; handled: number };
  totals: { saved: number; older: number };
}

const runKey = (files: File[]) =>
  `epc-import:${files
    .map((f) => `${f.name}:${f.size}:${f.lastModified}`)
    .sort()
    .join("|")}`;

function loadRun(key: string): SavedRun | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as SavedRun) : null;
  } catch {
    return null;
  }
}
function saveRun(key: string, run: SavedRun) {
  try {
    localStorage.setItem(key, JSON.stringify(run));
  } catch {
    // Private browsing or full storage: the import still runs, it just can't resume.
  }
}
function clearRun(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // nothing to clear
  }
}

/* ------------------------------------------------------------------ */
/* Sending                                                             */
/* ------------------------------------------------------------------ */

class StopImport extends Error {}
class PauseImport extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Post one batch. A dropped connection, a busy server or a timeout is retried
 * for as long as it takes (waiting up to 30 seconds between tries), so a
 * wobbly connection slows the import down but never loses its place.
 */
async function sendBatch(
  rows: EpcRow[],
  outcodes: string,
  stopped: () => boolean,
  onWait: (note: string | null) => void,
): Promise<{ saved: number; older: number }> {
  for (let attempt = 1; ; attempt++) {
    if (stopped()) throw new StopImport();
    let res: Response | null = null;
    try {
      res = await fetch("/api/ops/intel/epc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, outcodes }),
      });
    } catch {
      res = null;
    }
    if (res?.ok) {
      onWait(null);
      const data = (await res.json().catch(() => ({}))) as { saved?: number; older?: number };
      return { saved: data.saved ?? 0, older: data.older ?? 0 };
    }
    if (res?.status === 401) {
      throw new PauseImport("You've been signed out. Sign in again in another tab, then press Resume: it carries on from here.");
    }
    if (res?.status === 403) throw new Error("Your account isn't allowed to import data (admins only).");
    const retryable = !res || res.status >= 500 || res.status === 408 || res.status === 429;
    if (!retryable) {
      const data = (await res!.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `The website refused a batch (error ${res!.status}).`);
    }
    const wait = Math.min(30, 2 ** Math.min(attempt, 5));
    onWait(
      `${res ? `The website is busy (error ${res.status})` : "Can't reach the website"}. Trying again in ${wait} seconds (attempt ${attempt}). Your place is kept.`,
    );
    for (let s = 0; s < wait * 4; s++) {
      if (stopped()) throw new StopImport();
      await sleep(250);
    }
  }
}

/* ------------------------------------------------------------------ */
/* The page                                                            */
/* ------------------------------------------------------------------ */

type Phase = "idle" | "checking" | "ready" | "counting" | "counted" | "running" | "paused" | "done" | "failed";

interface Progress {
  partIndex: number;
  partCount: number;
  partLabel: string;
  bytesDone: number;
  bytesTotal: number;
  scanned: number;
  matched: number;
  saved: number;
  older: number;
  startedAt: number;
  bytesAtStart: number;
}

const EMPTY: Progress = {
  partIndex: 0,
  partCount: 0,
  partLabel: "",
  bytesDone: 0,
  bytesTotal: 0,
  scanned: 0,
  matched: 0,
  saved: 0,
  older: 0,
  startedAt: 0,
  bytesAtStart: 0,
};

const FIELD_LABEL: Partial<Record<EpcField, string>> = {
  postcode: "postcode",
  address1: "address",
  uprn: "property ID (UPRN)",
  lodged: "certificate date",
  currentRating: "energy rating",
  propertyType: "property type",
  floorArea: "floor area",
};

function duration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 90) return "under 2 minutes";
  const m = Math.round(seconds / 60);
  return m < 90 ? `about ${m} minutes` : `about ${(m / 60).toFixed(1)} hours`;
}

/** The count, kept in this browser per download: which files are counted, and the tally so far. */
interface SavedCount {
  done: string[];
  tally: ReturnType<LondonTally["toJSON"]>;
  complete: boolean;
}
const countKey = (files: File[]) => runKey(files).replace(/^epc-import:/, "epc-count:");
function loadCount(key: string): SavedCount | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as SavedCount) : null;
  } catch {
    return null;
  }
}
function saveCount(key: string, value: SavedCount) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // No room or private browsing: counting still works, it just can't pick up after a stop.
  }
}

/** Read one part start to finish, handing each piece of text to `take`. */
async function readPart(
  part: Part,
  stopped: () => boolean,
  onBytes: (partBytes: number) => void,
  take: (text: string) => Promise<void> | void,
) {
  let partBytes = 0;
  const reader = (
    await part.open((n) => {
      partBytes += n;
    })
  ).getReader();
  const decoder = new TextDecoder("utf-8");
  try {
    for (;;) {
      if (stopped()) throw new StopImport();
      const { value, done } = await reader.read();
      if (done) break;
      await take(decoder.decode(value, { stream: true }));
      onBytes(partBytes);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  await take(decoder.decode());
}

export function EpcImporter({ defaultOutcodes, bookSize }: { defaultOutcodes: string; bookSize: number | null }) {
  const serviceArea = parseOutcodes(defaultOutcodes);
  const [files, setFiles] = useState<File[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [check, setCheck] = useState<{ found: string[]; missing: string[]; skipped: string[] } | null>(null);
  const [districts, setDistricts] = useState<DistrictCount[] | null>(null);
  const [countSoFar, setCountSoFar] = useState<SavedCount | null>(null);
  const [ticked, setTicked] = useState<string[]>(serviceArea);
  // Which area sections start open (those with ticks when the list appears); after that they stay as the admin leaves them.
  const [openAtStart, setOpenAtStart] = useState<Set<string>>(new Set());
  const showDistricts = (list: DistrictCount[], ticks: string[]) => {
    setDistricts(list);
    setTicked(ticks);
    setOpenAtStart(new Set(ticks.map(areaOf)));
  };
  const [phase, setPhase] = useState<Phase>("idle");
  const [mode, setMode] = useState<"count" | "save">("count");
  const [progress, setProgress] = useState<Progress>(EMPTY);
  const [message, setMessage] = useState<string | null>(null);
  const [waitNote, setWaitNote] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedRun | null>(null);
  const stopRef = useRef(false);

  const outcodes = [...ticked].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const busy = phase === "checking" || phase === "counting" || phase === "running";

  // Warn before closing the tab mid-way (it would resume, but why lose the time).
  useEffect(() => {
    if (phase !== "running" && phase !== "counting") return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  // Keep the screen (and so the laptop) awake while working, where the browser allows it.
  useEffect(() => {
    if ((phase !== "running" && phase !== "counting") || !("wakeLock" in navigator)) return;
    let lock: { release: () => Promise<void> } | null = null;
    const take = async () => {
      try {
        lock = await (navigator as unknown as { wakeLock: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock.request("screen");
      } catch {
        lock = null;
      }
    };
    const again = () => {
      if (document.visibilityState === "visible") void take();
    };
    void take();
    document.addEventListener("visibilitychange", again);
    return () => {
      document.removeEventListener("visibilitychange", again);
      void lock?.release().catch(() => {});
    };
  }, [phase]);

  /** Read every file's columns before anything else, so a wrong file fails in seconds, not an hour in. */
  async function choose(chosen: File[]) {
    setFiles(chosen);
    setParts([]);
    setCheck(null);
    setDistricts(null);
    setCountSoFar(null);
    setProgress(EMPTY);
    setMessage(null);
    setWaitNote(null);
    if (chosen.length === 0) {
      setPhase("idle");
      return;
    }
    setPhase("checking");
    try {
      const all = await partsFrom(chosen);
      // The download also holds files that aren't certificates (recommendations-YEAR.csv: improvement
      // suggestions, no addresses). Skip those, but refuse when nothing chosen is certificate data.
      const found: Part[] = [];
      const skipped: string[] = [];
      let firstProblem = "";
      let union: EpcColumnMap = {};
      for (const part of all) {
        const header = splitCsvRecord(await part.firstLine());
        const map = mapEpcColumns(header);
        const problems = epcColumnProblems(map);
        if (problems.length > 0) {
          skipped.push(part.label);
          firstProblem ||= `${part.label} doesn't look like EPC certificate data: ${problems.join("; ")}. Its first columns are: ${header.slice(0, 12).join(", ")}.`;
          continue;
        }
        found.push(part);
        union = { ...union, ...map };
      }
      if (found.length === 0) throw new Error(firstProblem);
      const labels = Object.entries(FIELD_LABEL) as [EpcField, string][];
      setCheck({
        found: labels.filter(([f]) => union[f] !== undefined).map(([, l]) => l),
        missing: labels.filter(([f]) => union[f] === undefined).map(([, l]) => l),
        skipped: skipped.sort((a, b) => a.localeCompare(b, "en", { numeric: true })),
      });
      setParts(found);

      const run = loadRun(runKey(chosen));
      setSaved(run);
      const counted = loadCount(countKey(chosen));
      setCountSoFar(counted);
      if (counted?.complete) {
        const list = LondonTally.fromJSON(counted.tally).districts();
        const seen = new Set(list.map((d) => d.outcode));
        showDistricts(list, run?.outcodes ? parseOutcodes(run.outcodes) : serviceArea.filter((o) => seen.has(o)));
        setPhase("counted");
      } else {
        if (run?.outcodes) setTicked(parseOutcodes(run.outcodes));
        setPhase("ready");
      }
    } catch (err) {
      setPhase("failed");
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  function startProgress(doneKeys: string[]) {
    const doneBytes = parts.filter((x) => doneKeys.includes(x.key)).reduce((n, x) => n + x.size, 0);
    return {
      ...EMPTY,
      partCount: parts.length,
      bytesTotal: parts.reduce((n, x) => n + x.size, 0),
      bytesDone: doneBytes,
      startedAt: Date.now(),
      bytesAtStart: doneBytes,
    };
  }

  /** Step 2: count homes per London district, saving nothing. */
  async function count(fresh: boolean) {
    const key = countKey(files);
    const prior = fresh ? null : loadCount(key);
    const state: SavedCount = prior && !prior.complete ? prior : { done: [], tally: new LondonTally().toJSON(), complete: false };
    const total = LondonTally.fromJSON(state.tally);
    stopRef.current = false;
    setMode("count");
    setMessage(null);
    setPhase("counting");
    const stopped = () => stopRef.current;
    const p: Progress = startProgress(state.done);
    let lastPaint = 0;
    const paint = (force = false) => {
      const now = Date.now();
      if (force || now - lastPaint > 250) {
        lastPaint = now;
        setProgress({ ...p });
      }
    };
    try {
      for (const [index, part] of parts.entries()) {
        p.partIndex = index + 1;
        p.partLabel = part.label;
        if (state.done.includes(part.key)) continue;
        paint(true);
        const partTally = new LondonTally();
        const columns = mapEpcColumns(splitCsvRecord(await part.firstLine()));
        // Every row passes through here and is counted, never kept: nothing builds up in memory.
        const csv = new CsvRecordStream((raw) => {
          if (partTally.addRow(raw, columns)) p.matched++;
          return false;
        });
        const partStart = p.bytesDone;
        await readPart(
          part,
          stopped,
          (b) => {
            p.bytesDone = partStart + b;
            paint();
          },
          (text) => {
            p.scanned += csv.push(text).scanned;
          },
        );
        p.scanned += csv.end().scanned;
        total.merge(partTally);
        state.done.push(part.key);
        state.tally = total.toJSON();
        saveCount(key, state);
        p.bytesDone = partStart + part.size;
        paint(true);
      }
      state.complete = true;
      saveCount(key, state);
      const list = total.districts();
      setCountSoFar(state);
      const seen = new Set(list.map((d) => d.outcode));
      showDistricts(list, ticked.filter((o) => seen.has(o)));
      setPhase("counted");
    } catch (err) {
      paint(true);
      setCountSoFar(loadCount(key));
      if (err instanceof StopImport) {
        setPhase("ready");
        setMessage("Counting stopped. Press Resume counting to carry on from the file it was on.");
      } else {
        setPhase("failed");
        setMessage(err instanceof Error ? err.message : String(err));
      }
    }
  }

  /** Step 3: save the ticked districts' homes to the database. */
  async function run(fresh: boolean) {
    const key = runKey(files);
    if (fresh) clearRun(key);
    const prior = fresh ? null : loadRun(key);
    const state: SavedRun = prior && prior.outcodes === outcodes.join(", ")
      ? prior
      : { outcodes: outcodes.join(", "), done: [], totals: { saved: 0, older: 0 } };
    saveRun(key, state);
    setSaved(state);

    stopRef.current = false;
    setMode("save");
    setMessage(null);
    setWaitNote(null);
    setPhase("running");
    const stopped = () => stopRef.current;
    const outcodeParam = outcodes.join(",");
    // Newest year first, so a home's newest certificate is sent first and its older ones
    // need not be sent at all. (After a resume this starts empty; the server still keeps
    // the newest, it just does more of the checking.)
    const newestSent = new Map<string, string>();
    const p: Progress = { ...startProgress(state.done), saved: state.totals.saved, older: state.totals.older };
    let lastPaint = 0;
    const paint = (force = false) => {
      const now = Date.now();
      if (force || now - lastPaint > 250) {
        lastPaint = now;
        setProgress({ ...p });
      }
    };

    try {
      for (const [index, part] of parts.entries()) {
        p.partIndex = index + 1;
        p.partLabel = part.label;
        if (state.done.includes(part.key)) continue;
        paint(true);

        // Matching rows of this part already dealt with before a stop: read past them, don't resend.
        const resumeAfter = state.partial?.key === part.key ? state.partial.handled : 0;
        let matchedInPart = 0;
        const csv = new CsvRecordStream(outcodePrefilter(outcodes));
        let columns: EpcColumnMap | null = null;
        let pending: EpcRow[] = [];
        const flush = async () => {
          if (pending.length === 0) return;
          const batch = pending;
          const handled = matchedInPart;
          const r = await sendBatch(batch, outcodeParam, stopped, setWaitNote);
          pending = [];
          p.saved += r.saved;
          p.older += r.older;
          state.partial = { key: part.key, handled };
          state.totals = { saved: p.saved, older: p.older };
          saveRun(key, state);
          paint();
        };
        const take = async (out: { header?: string[]; records: string[][]; scanned: number }) => {
          if (out.header) {
            columns = mapEpcColumns(out.header);
            const problems = epcColumnProblems(columns);
            if (problems.length > 0) throw new Error(`${part.label}: ${problems.join("; ")}.`);
          }
          p.scanned += out.scanned;
          for (const fields of out.records) {
            const row = epcRowFromFields(fields, columns!);
            if (!row.postcode || !outcodes.includes(outcodeOf(row.postcode))) continue;
            p.matched++;
            matchedInPart++;
            if (matchedInPart <= resumeAfter) continue;
            const candidate = epcCandidate(row, outcodes);
            if (!candidate) continue;
            const sentLodged = newestSent.get(candidate.intel.id);
            if (sentLodged !== undefined && sentLodged >= candidate.lodged) {
              p.older++;
              continue;
            }
            newestSent.set(candidate.intel.id, candidate.lodged);
            pending.push(row);
            if (pending.length >= EPC_BATCH_SIZE) await flush();
          }
        };

        const partStart = p.bytesDone;
        await readPart(
          part,
          stopped,
          (b) => {
            p.bytesDone = partStart + b;
            paint();
          },
          (text) => take(csv.push(text)),
        );
        await take(csv.end());
        await flush();

        state.done.push(part.key);
        delete state.partial;
        saveRun(key, state);
        p.bytesDone = partStart + part.size;
        paint(true);
      }
      setPhase("done");
      clearRun(key);
      setSaved(null);
    } catch (err) {
      paint(true);
      setWaitNote(null);
      setSaved(loadRun(key));
      if (err instanceof StopImport) {
        setPhase("paused");
        setMessage("Stopped. Everything sent so far is saved. Press Resume to carry on from here, even after closing the browser.");
      } else if (err instanceof PauseImport) {
        setPhase("paused");
        setMessage(err.message);
      } else {
        setPhase("failed");
        setMessage(
          `${err instanceof Error ? err.message : String(err)} Everything sent before this is saved; Resume carries on from the same place.`,
        );
      }
    }
  }

  const pct = progress.bytesTotal ? Math.min(100, (progress.bytesDone / progress.bytesTotal) * 100) : 0;
  const elapsed = (Date.now() - progress.startedAt) / 1000;
  const rate = elapsed > 5 ? (progress.bytesDone - progress.bytesAtStart) / elapsed : 0;
  const remaining = rate > 0 ? (progress.bytesTotal - progress.bytesDone) / rate : NaN;
  const n = (v: number) => v.toLocaleString("en-GB");
  const gb = (b: number) => `${(b / 1e9).toFixed(b < 1e9 ? 2 : 1)} GB`;
  const resumable = saved && (saved.done.length > 0 || saved.partial) && phase !== "running";
  const totalBytes = files.reduce((t, f) => t + f.size, 0);
  const countResumable = countSoFar && !countSoFar.complete && countSoFar.done.length > 0 && phase !== "counting";

  const tickedSet = new Set(ticked);
  const tickedRows = (districts ?? []).filter((d) => tickedSet.has(d.outcode));
  const tickedHomes = tickedRows.reduce((t, d) => t + d.homes, 0);
  const tickedBytes = tickedRows.reduce((t, d) => t + d.bytes, 0);
  const byArea = LONDON_AREAS.map((a) => ({ ...a, rows: (districts ?? []).filter((d) => areaOf(d.outcode) === a.area) })).filter(
    (a) => a.rows.length > 0,
  );
  const setTick = (outcode: string, on: boolean) =>
    setTicked((t) => (on ? [...new Set([...t, outcode])] : t.filter((o) => o !== outcode)));
  const setTicks = (list: string[], on: boolean) =>
    setTicked((t) => (on ? [...new Set([...t, ...list])] : t.filter((o) => !list.includes(o))));
  const showProgress =
    phase === "counting" || phase === "running" || phase === "paused" || phase === "done" || (phase === "failed" && progress.partCount > 0) ||
    (phase === "ready" && progress.partCount > 0);
  const lockTicks = busy || phase === "paused";

  return (
    <section className="mt-6 space-y-5 rounded-2xl border border-line p-5">
      <label className="block">
        <span className="text-sm font-semibold">1. The EPC download</span>
        <span className="block text-sm text-ink-500">
          The zip as you downloaded it (no need to unzip it), or the CSV files if you&apos;ve unzipped them.
        </span>
        <input
          type="file"
          multiple
          accept=".zip,.csv,application/zip,text/csv"
          disabled={busy}
          className="mt-2 block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-accent-600 file:px-4 file:py-2 file:font-semibold file:text-white"
          onChange={(e) => void choose([...(e.target.files ?? [])])}
        />
        {files.length > 0 && (
          <span className="mt-1 block text-sm text-ink-500">
            {files.length === 1 ? files[0].name : `${files.length} files`}, {gb(totalBytes)}
          </span>
        )}
      </label>

      {phase === "checking" && (
        <p role="status" className="text-sm text-ink-600">
          Checking the files: reading each one&apos;s columns…
        </p>
      )}

      {check && parts.length > 0 && (
        <div className="rounded-2xl border border-sage-200 bg-sage-50 p-4 text-sm text-sage-900">
          <p className="font-semibold">
            Ready: {parts.length} file{parts.length === 1 ? "" : "s"} of EPC certificates
            {parts.length > 1 ? ` (${parts[parts.length - 1].label} to ${parts[0].label})` : ""}.
          </p>
          <p className="mt-1">Found the {check.found.join(", ")}.</p>
          {check.skipped.length > 0 && (
            <p className="mt-1">
              Skipping {check.skipped.length} other file{check.skipped.length === 1 ? "" : "s"} with no addresses
              ({check.skipped.length > 2 ? `${check.skipped[0]} to ${check.skipped[check.skipped.length - 1]}` : check.skipped.join(", ")}).
            </p>
          )}
          {check.missing.length > 0 && (
            <p className="mt-1">
              Not in these files: {check.missing.join(", ")}. The import works without them
              {check.missing.includes("property ID (UPRN)") ? "; homes are matched by their address instead" : ""}.
            </p>
          )}
        </div>
      )}

      {parts.length > 0 && !districts && (
        <div className="space-y-2">
          <p className="text-sm font-semibold">2. Count the homes in each London postcode</p>
          <p className="text-sm text-ink-500">
            Reads every certificate once (a few minutes) and saves nothing. You then tick which postcodes to save.
          </p>
          <div className="flex flex-wrap gap-3">
            {countResumable ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void count(false)}
                  className="rounded-full bg-accent-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-accent-700 disabled:opacity-50"
                >
                  Resume counting ({countSoFar!.done.length} of {parts.length} files done)
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void count(true)}
                  className="rounded-full border border-line px-5 py-2 text-sm font-semibold text-ink-700 disabled:opacity-50"
                >
                  Count from the beginning
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void count(true)}
                className="rounded-full bg-accent-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-accent-700 disabled:opacity-50"
              >
                Count the homes
              </button>
            )}
            {phase === "counting" && (
              <button
                type="button"
                onClick={() => {
                  stopRef.current = true;
                }}
                className="rounded-full border border-line px-5 py-2 text-sm font-semibold text-ink-700"
              >
                Stop
              </button>
            )}
          </div>
        </div>
      )}

      {districts && (
        <div className="space-y-3">
          <p className="text-sm font-semibold">2. Tick the postcodes to save</p>
          <div
            className={`rounded-2xl border p-4 text-sm ${tickedBytes > FREE_PLAN_BYTES * 0.6 ? "border-amber-200 bg-amber-50 text-amber-900" : "border-line bg-surface text-ink-800"}`}
          >
            <p className="font-semibold">
              Ticked: {outcodes.length} postcode{outcodes.length === 1 ? "" : "s"}, about {n(tickedHomes)} homes, about{" "}
              {formatBytes(tickedBytes)} of database space.
            </p>
            <p className="mt-1">
              {bookSize !== null ? `Your book has ${n(bookSize)} homes now. ` : ""}
              Supabase&apos;s free plan has {formatBytes(FREE_PLAN_BYTES)} for everything
              {tickedBytes > FREE_PLAN_BYTES * 0.6
                ? ": this is more than the free plan comfortably holds. Tick fewer postcodes, or move to Pro (8 GB) first."
                : ", so this fits."}
            </p>
            <p className="mt-1 text-ink-500">
              Home counts are estimates (within a few percent); certificate counts are exact. Homes already in the book are
              updated, not added twice.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <button
              type="button"
              disabled={lockTicks}
              onClick={() => setTicked(serviceArea.filter((o) => districts.some((d) => d.outcode === o)))}
              className="rounded-full border border-line px-3 py-1.5 font-semibold text-ink-700 disabled:opacity-50"
            >
              Just my service area
            </button>
            <button
              type="button"
              disabled={lockTicks}
              onClick={() => setTicked(districts.map((d) => d.outcode))}
              className="rounded-full border border-line px-3 py-1.5 font-semibold text-ink-700 disabled:opacity-50"
            >
              All of London
            </button>
            <button
              type="button"
              disabled={lockTicks}
              onClick={() => setTicked([])}
              className="rounded-full border border-line px-3 py-1.5 font-semibold text-ink-700 disabled:opacity-50"
            >
              Clear
            </button>
          </div>
          <div className="divide-y divide-line rounded-2xl border border-line">
            {byArea.map((a) => {
              const list = a.rows.map((r) => r.outcode);
              const on = list.filter((o) => tickedSet.has(o)).length;
              const homes = a.rows.reduce((t, r) => t + r.homes, 0);
              return (
                <details key={a.area} open={openAtStart.has(a.area)} className="group">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                    <input
                      type="checkbox"
                      aria-label={`All of ${a.area}`}
                      disabled={lockTicks}
                      checked={on === list.length}
                      ref={(el) => {
                        if (el) el.indeterminate = on > 0 && on < list.length;
                      }}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setTicks(list, e.target.checked)}
                    />
                    <span className="font-semibold">
                      {a.area} · {a.name}
                    </span>
                    <span className="text-ink-500">
                      {list.length} postcode{list.length === 1 ? "" : "s"}, about {n(homes)} homes
                      {a.outer ? " (also reaches beyond Greater London)" : ""}
                    </span>
                    {on > 0 && <span className="text-accent-700">{on} ticked</span>}
                  </summary>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-ink-500">
                        <th className="w-10 px-4 py-1" />
                        <th className="py-1 font-medium">Postcode</th>
                        <th className="py-1 text-right font-medium">Homes</th>
                        <th className="py-1 text-right font-medium">Certificates</th>
                        <th className="px-4 py-1 text-right font-medium">Space</th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.rows.map((r) => (
                        <tr key={r.outcode} className="border-t border-line/60">
                          <td className="px-4 py-1">
                            <input
                              type="checkbox"
                              aria-label={r.outcode}
                              disabled={lockTicks}
                              checked={tickedSet.has(r.outcode)}
                              onChange={(e) => setTick(r.outcode, e.target.checked)}
                            />
                          </td>
                          <td className="py-1 font-medium">{r.outcode}</td>
                          <td className="py-1 text-right tabular-nums">{n(r.homes)}</td>
                          <td className="py-1 text-right tabular-nums text-ink-500">{n(r.certificates)}</td>
                          <td className="px-4 py-1 text-right tabular-nums text-ink-500">{formatBytes(r.bytes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              );
            })}
          </div>

          <p className="pt-2 text-sm font-semibold">3. Save them to the database</p>
          {resumable && (
            <p className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Saving was part-done before: {saved!.done.length} of {parts.length} files done
              {saved!.totals.saved ? `, ${n(saved!.totals.saved)} homes saved` : ""} for {saved!.outcodes}. Resume carries on
              from there.
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            {resumable ? (
              <>
                <button
                  type="button"
                  disabled={outcodes.length === 0}
                  onClick={() => void run(false)}
                  className="rounded-full bg-accent-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-accent-700 disabled:opacity-50"
                >
                  Resume saving
                </button>
                <button
                  type="button"
                  disabled={outcodes.length === 0}
                  onClick={() => void run(true)}
                  className="rounded-full border border-line px-5 py-2 text-sm font-semibold text-ink-700 disabled:opacity-50"
                >
                  Save the ticked postcodes from the beginning
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={busy || outcodes.length === 0}
                onClick={() => void run(true)}
                className="rounded-full bg-accent-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-accent-700 disabled:opacity-50"
              >
                {outcodes.length === 0
                  ? "Tick at least one postcode"
                  : `Save ${outcodes.length} postcode${outcodes.length === 1 ? "" : "s"} (about ${n(tickedHomes)} homes)`}
              </button>
            )}
            {phase === "running" && (
              <button
                type="button"
                onClick={() => {
                  stopRef.current = true;
                }}
                className="rounded-full border border-line px-5 py-2 text-sm font-semibold text-ink-700"
              >
                Stop
              </button>
            )}
          </div>
        </div>
      )}

      {showProgress && (
        <div role="status" aria-live="polite" className="space-y-2">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-semibold">
              {phase === "done" ? "Done" : `${mode === "count" ? "Counting" : "Saving"}: ${Math.floor(pct)}%`}
            </span>
            <span className="text-ink-500">
              {gb(progress.bytesDone)} of {gb(progress.bytesTotal)} read
              {(phase === "running" || phase === "counting") && duration(remaining) ? ` · ${duration(remaining)} left` : ""}
            </span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-surface" aria-hidden>
            <div className="h-full rounded-full bg-accent-600 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-sm text-ink-700">
            {phase === "done"
              ? `All ${progress.partCount} files read.`
              : `File ${progress.partIndex} of ${progress.partCount}: ${progress.partLabel}`}
          </p>
          {waitNote && <p className="text-sm text-amber-800">{waitNote}</p>}
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-ink-500">Certificates read</dt>
              <dd className="font-semibold">{n(progress.scanned)}</dd>
            </div>
            <div>
              <dt className="text-ink-500">{mode === "count" ? "In London" : "In your postcodes"}</dt>
              <dd className="font-semibold">{n(progress.matched)}</dd>
            </div>
            {mode === "save" && (
              <>
                <div>
                  <dt className="text-ink-500">Homes saved or updated</dt>
                  <dd className="font-semibold">{n(progress.saved)}</dd>
                </div>
                <div>
                  <dt className="text-ink-500">Older certificates skipped</dt>
                  <dd className="font-semibold">{n(progress.older)}</dd>
                </div>
              </>
            )}
          </dl>
        </div>
      )}

      {message && (
        <p
          role="alert"
          className={`rounded-2xl border p-4 text-sm ${phase === "failed" ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}
        >
          {message}
        </p>
      )}

      {phase === "done" && (
        <p className="text-sm">
          <Link href="/ops/intel" className="font-semibold text-accent-700 hover:underline">
            See the book →
          </Link>{" "}
          Homes are scored as they&apos;re saved, so there&apos;s no need to press Recompute. To add more postcodes later,
          choose the same zip again: the counts are remembered.
        </p>
      )}
    </section>
  );
}
