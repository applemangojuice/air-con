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

type Phase = "idle" | "checking" | "ready" | "running" | "paused" | "done" | "failed";

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

export function EpcImporter({ defaultOutcodes }: { defaultOutcodes: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [check, setCheck] = useState<{ found: string[]; missing: string[]; skipped: string[] } | null>(null);
  const [outcodeText, setOutcodeText] = useState(defaultOutcodes);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<Progress>(EMPTY);
  const [message, setMessage] = useState<string | null>(null);
  const [waitNote, setWaitNote] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedRun | null>(null);
  const stopRef = useRef(false);

  const outcodes = parseOutcodes(outcodeText);
  const busy = phase === "checking" || phase === "running";

  // Warn before closing the tab mid-import (it would resume, but why lose the time).
  useEffect(() => {
    if (phase !== "running") return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  // Keep the screen (and so the laptop) awake while importing, where the browser allows it.
  useEffect(() => {
    if (phase !== "running" || !("wakeLock" in navigator)) return;
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

  /** Read every file's columns before anything is sent, so a wrong file fails in seconds, not an hour in. */
  async function choose(chosen: File[]) {
    setFiles(chosen);
    setParts([]);
    setCheck(null);
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
      if (run?.outcodes) setOutcodeText(run.outcodes);
      setPhase("ready");
    } catch (err) {
      setPhase("failed");
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

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
    setMessage(null);
    setWaitNote(null);
    setPhase("running");
    const stopped = () => stopRef.current;
    const outcodeParam = outcodes.join(",");
    // Newest year first, so a home's newest certificate is sent first and its older ones
    // need not be sent at all. (After a resume this starts empty; the server still keeps
    // the newest, it just does more of the checking.)
    const newestSent = new Map<string, string>();
    const doneBytes = parts.filter((p) => state.done.includes(p.key)).reduce((n, p) => n + p.size, 0);
    const p: Progress = {
      ...EMPTY,
      partCount: parts.length,
      bytesTotal: parts.reduce((n, x) => n + x.size, 0),
      bytesDone: doneBytes,
      saved: state.totals.saved,
      older: state.totals.older,
      startedAt: Date.now(),
      bytesAtStart: doneBytes,
    };
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
            await take(csv.push(decoder.decode(value, { stream: true })));
            p.bytesDone = partStart + partBytes;
            paint();
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
        await take(csv.push(decoder.decode()));
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

  return (
    <section className="mt-6 space-y-5 rounded-2xl border border-line p-5">
      <label className="block">
        <span className="text-sm font-semibold">The EPC download</span>
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

      <label className="block">
        <span className="text-sm font-semibold">Postcodes to keep</span>
        <span className="block text-sm text-ink-500">
          The start of the postcode (the outcode), separated by commas. Starts as your service area.
        </span>
        <input
          className="mt-1.5 w-full rounded-xl border border-line px-3 py-2 text-sm uppercase"
          value={outcodeText}
          disabled={busy || phase === "paused"}
          onChange={(e) => setOutcodeText(e.target.value)}
        />
        <span className="mt-1 block text-sm text-ink-500">
          {outcodes.length > 0 ? `Keeping ${outcodes.length}: ${outcodes.join(", ")}` : "Add at least one outcode, like SW16."}
        </span>
      </label>

      {resumable && (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          This download was part-imported before: {saved!.done.length} of {parts.length || "its"} files done
          {saved!.totals.saved ? `, ${n(saved!.totals.saved)} homes saved` : ""}. Resume carries on from there.
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        {resumable ? (
          <>
            <button
              type="button"
              disabled={parts.length === 0 || outcodes.length === 0}
              onClick={() => void run(false)}
              className="rounded-full bg-accent-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-accent-700 disabled:opacity-50"
            >
              Resume
            </button>
            <button
              type="button"
              disabled={parts.length === 0 || outcodes.length === 0}
              onClick={() => void run(true)}
              className="rounded-full border border-line px-5 py-2 text-sm font-semibold text-ink-700 disabled:opacity-50"
            >
              Start again from the beginning
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy || parts.length === 0 || outcodes.length === 0}
            onClick={() => void run(true)}
            className="rounded-full bg-accent-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-accent-700 disabled:opacity-50"
          >
            {phase === "done" ? "Import again" : "Import"}
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

      {(phase === "running" || phase === "paused" || phase === "done" || (phase === "failed" && progress.partCount > 0)) && (
        <div role="status" aria-live="polite" className="space-y-2">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-semibold">
              {phase === "done" ? "Done" : `${Math.floor(pct)}%`}
            </span>
            <span className="text-ink-500">
              {gb(progress.bytesDone)} of {gb(progress.bytesTotal)} read
              {phase === "running" && duration(remaining) ? ` · ${duration(remaining)} left` : ""}
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
              <dt className="text-ink-500">In your postcodes</dt>
              <dd className="font-semibold">{n(progress.matched)}</dd>
            </div>
            <div>
              <dt className="text-ink-500">Homes saved or updated</dt>
              <dd className="font-semibold">{n(progress.saved)}</dd>
            </div>
            <div>
              <dt className="text-ink-500">Older certificates skipped</dt>
              <dd className="font-semibold">{n(progress.older)}</dd>
            </div>
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
          Homes are scored as they&apos;re saved, so there&apos;s no need to press Recompute.
        </p>
      )}
    </section>
  );
}
