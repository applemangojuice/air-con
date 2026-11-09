"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import {
  CsvRecordStream,
  EPC_BATCH_SIZE,
  epcColumnProblems,
  epcRowFromFields,
  mapEpcColumns,
  outcodeOf,
  outcodePrefilter,
  parseOutcodes,
  type EpcColumnMap,
  type EpcRow,
} from "@/lib/epc-import";

type Phase = "idle" | "running" | "done" | "stopped" | "failed";

interface Progress {
  fileIndex: number;
  fileCount: number;
  fileName: string;
  bytesDone: number;
  bytesTotal: number;
  scanned: number;
  matched: number;
  saved: number;
  older: number;
}

const EMPTY: Progress = { fileIndex: 0, fileCount: 0, fileName: "", bytesDone: 0, bytesTotal: 0, scanned: 0, matched: 0, saved: 0, older: 0 };

class StopImport extends Error {}

/** Post one batch, retrying a dropped connection or a busy server a few times. */
async function sendBatch(rows: EpcRow[], outcodes: string, stopped: () => boolean) {
  for (let attempt = 1; ; attempt++) {
    if (stopped()) throw new StopImport();
    let res: Response;
    try {
      res = await fetch("/api/ops/intel/epc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, outcodes }),
      });
    } catch {
      if (attempt >= 4) throw new Error("Lost the connection to the website. Check your internet and press Import again: homes already saved stay saved.");
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }
    const data = (await res.json().catch(() => ({}))) as { saved?: number; older?: number; error?: string };
    if (res.ok) return { saved: data.saved ?? 0, older: data.older ?? 0 };
    if (res.status === 401) throw new Error("You've been signed out. Sign in again in another tab, then press Import again.");
    if (res.status >= 500 && attempt < 4) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }
    throw new Error(data.error ?? `The website refused a batch (error ${res.status}).`);
  }
}

export function EpcImporter({ defaultOutcodes }: { defaultOutcodes: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [outcodeText, setOutcodeText] = useState(defaultOutcodes);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<Progress>(EMPTY);
  const [message, setMessage] = useState<string | null>(null);
  const stopRef = useRef(false);

  const outcodes = parseOutcodes(outcodeText);
  const totalBytes = files.reduce((n, f) => n + f.size, 0);

  async function run() {
    stopRef.current = false;
    setMessage(null);
    setPhase("running");
    const stopped = () => stopRef.current;
    const outcodeParam = outcodes.join(",");
    // Newest year first: an older certificate for a home already saved is then skipped, not written.
    const ordered = [...files].sort((a, b) => b.name.localeCompare(a.name, "en", { numeric: true }));
    const p: Progress = { ...EMPTY, fileCount: ordered.length, bytesTotal: ordered.reduce((n, f) => n + f.size, 0) };
    let lastPaint = 0;
    const paint = (force = false) => {
      const now = Date.now();
      if (force || now - lastPaint > 250) {
        lastPaint = now;
        setProgress({ ...p });
      }
    };

    try {
      let bytesBefore = 0;
      for (const [index, file] of ordered.entries()) {
        p.fileIndex = index + 1;
        p.fileName = file.name;
        paint(true);

        const csv = new CsvRecordStream(outcodePrefilter(outcodes));
        let columns: EpcColumnMap | null = null;
        let pending: EpcRow[] = [];
        const flush = async () => {
          if (pending.length === 0) return;
          const batch = pending;
          pending = [];
          const r = await sendBatch(batch, outcodeParam, stopped);
          p.saved += r.saved;
          p.older += r.older;
          paint();
        };
        const take = async (out: { header?: string[]; records: string[][]; scanned: number }) => {
          if (out.header) {
            columns = mapEpcColumns(out.header);
            const problems = epcColumnProblems(columns);
            if (problems.length > 0) {
              throw new Error(
                `${file.name} doesn't look like EPC certificate data: ${problems.join("; ")}. Its first columns are: ${out.header.slice(0, 12).join(", ")}.`,
              );
            }
          }
          p.scanned += out.scanned;
          for (const fields of out.records) {
            const row = epcRowFromFields(fields, columns!);
            if (!row.postcode || (outcodes.length > 0 && !outcodes.includes(outcodeOf(row.postcode)))) continue;
            pending.push(row);
            p.matched++;
            if (pending.length >= EPC_BATCH_SIZE) await flush();
          }
        };

        let fileBytes = 0;
        const decoder = new TextDecoder("utf-8");
        const reader = file.stream().getReader();
        try {
          for (;;) {
            if (stopped()) throw new StopImport();
            const { value, done } = await reader.read();
            if (done) break;
            fileBytes += value.byteLength;
            await take(csv.push(decoder.decode(value, { stream: true })));
            p.bytesDone = bytesBefore + fileBytes;
            paint();
          }
        } finally {
          reader.releaseLock();
        }
        await take(csv.push(decoder.decode()));
        await take(csv.end());
        await flush();
        bytesBefore += file.size;
        p.bytesDone = bytesBefore;
        paint(true);
      }
      setPhase("done");
    } catch (err) {
      paint(true);
      if (err instanceof StopImport) {
        setPhase("stopped");
        setMessage("Stopped. Homes already saved stay saved; pressing Import again picks up safely.");
      } else {
        setPhase("failed");
        setMessage(err instanceof Error ? err.message : String(err));
      }
    }
  }

  const running = phase === "running";
  const pct = progress.bytesTotal ? Math.min(100, Math.floor((progress.bytesDone / progress.bytesTotal) * 100)) : 0;
  const n = (v: number) => v.toLocaleString("en-GB");

  return (
    <section className="mt-6 space-y-5 rounded-2xl border border-line p-5">
      <label className="block">
        <span className="text-sm font-semibold">EPC files</span>
        <input
          type="file"
          multiple
          accept=".csv,text/csv"
          disabled={running}
          className="mt-1.5 block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-accent-600 file:px-4 file:py-2 file:font-semibold file:text-white"
          onChange={(e) => {
            setFiles([...(e.target.files ?? [])]);
            setPhase("idle");
            setProgress(EMPTY);
            setMessage(null);
          }}
        />
        {files.length > 0 && (
          <span className="mt-1 block text-sm text-ink-500">
            {files.length} file{files.length === 1 ? "" : "s"}, {(totalBytes / 1e9).toFixed(1)} GB
          </span>
        )}
      </label>

      <label className="block">
        <span className="text-sm font-semibold">Postcodes to keep</span>
        <span className="block text-sm text-ink-500">
          The start of the postcode (the outcode), separated by commas. Starts as your service area.
        </span>
        <input
          className="mt-1.5 w-full rounded-xl border border-line px-3 py-2 text-sm uppercase"
          value={outcodeText}
          disabled={running}
          onChange={(e) => setOutcodeText(e.target.value)}
        />
        <span className="mt-1 block text-sm text-ink-500">
          {outcodes.length > 0 ? `Keeping ${outcodes.length}: ${outcodes.join(", ")}` : "Add at least one outcode, like SW16."}
        </span>
      </label>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={running || files.length === 0 || outcodes.length === 0}
          onClick={() => void run()}
          className="rounded-full bg-accent-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-accent-700 disabled:opacity-50"
        >
          {phase === "idle" ? "Import" : "Import again"}
        </button>
        {running && (
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

      {phase !== "idle" && (
        <div role="status" aria-live="polite" className="space-y-2">
          <div className="h-2 overflow-hidden rounded-full bg-surface">
            <div className="h-full bg-accent-600 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-sm text-ink-700">
            {phase === "done" ? (
              <>Done: all {progress.fileCount} files read.</>
            ) : (
              <>
                {pct}% · file {progress.fileIndex} of {progress.fileCount} ({progress.fileName})
              </>
            )}
          </p>
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
              <dt className="text-ink-500">Homes saved</dt>
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
        <p role="alert" className={`rounded-2xl border p-4 text-sm ${phase === "failed" ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
          {message}
        </p>
      )}

      {phase === "done" && (
        <p className="text-sm">
          <Link href="/ops/intel" className="font-semibold text-accent-700 hover:underline">
            See the book →
          </Link>{" "}
          Homes are scored as they're saved, so there's no need to press Recompute.
        </p>
      )}
    </section>
  );
}
