"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CATALOGUE_KIND_LABEL } from "@aircon/domain";
import { applyCsvAction, previewCsvAction } from "@/app/ops/catalogue/actions";
import { Badge, Button, Card, Textarea } from "@/components/kit";
import type { CsvPreview } from "@/lib/catalogue-server";

/**
 * CSV import in two steps: check (row-level errors, what's new and what
 * changes, nothing written), then apply the valid rows. Rows with errors
 * are never written.
 */

const MAX_BYTES = 2 * 1024 * 1024;
const SHOW = 40;

export function CsvImport() {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const reset = () => {
    setPreview(null);
    setDone(null);
    setErrors([]);
  };

  const onFile = async (file: File | undefined) => {
    reset();
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setErrors(["That file is over 2 MB. Split it and import in parts."]);
      return;
    }
    setFileName(file.name);
    setCsv(await file.text());
  };

  const check = () => {
    reset();
    start(async () => {
      try {
        const r = await previewCsvAction(csv);
        if (!r.ok) return setErrors(r.errors);
        setPreview(r.value);
      } catch {
        setErrors(["Couldn't reach the server. Try again when you have signal."]);
      }
    });
  };

  const apply = () => {
    start(async () => {
      try {
        const r = await applyCsvAction(csv);
        if (!r.ok) return setErrors(r.errors);
        setDone(`Imported ${r.value.written} row${r.value.written === 1 ? "" : "s"}${r.value.skipped ? `; ${r.value.skipped} were already up to date` : ""}${r.value.errors.length ? `; ${r.value.errors.length} problem${r.value.errors.length === 1 ? "" : "s"} left out` : ""}.`);
        setPreview(null);
        router.refresh();
      } catch {
        setErrors(["Couldn't reach the server. Nothing was imported; try again."]);
      }
    });
  };

  const toWrite = preview ? preview.counts.new + preview.counts.update : 0;

  return (
    <div className="space-y-5">
      <Card>
        <h2 className="font-display text-xl text-ink-900">1. Choose the file</h2>
        <p className="mt-1 text-sm text-ink-500">
          Start from an export so the columns match. Columns you leave out keep what's stored, so a supplier price list only needs id, kind, label and the cost columns. Costs are pounds ex VAT; a blank cost means “not priced”.
        </p>
        <label className="mt-4 flex min-h-12 cursor-pointer flex-wrap items-center gap-3 rounded-2xl border border-dashed border-line bg-surface/50 px-4 py-3 text-sm hover:border-ink-300">
          <span className="inline-flex min-h-10 items-center rounded-full border border-line bg-white px-4 font-semibold text-ink-900">Choose a CSV file</span>
          <span className="text-ink-500">{fileName ?? "No file chosen"}</span>
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold text-ink-700">Or paste the CSV</summary>
          <Textarea
            className="mt-2"
            label="CSV text"
            rows={6}
            value={csv}
            onChange={(e) => {
              reset();
              setFileName(null);
              setCsv(e.target.value);
            }}
          />
        </details>
        <div className="mt-4">
          <Button onClick={check} disabled={!csv.trim()} busy={pending && !preview} busyLabel="Checking…">
            Check the file
          </Button>
        </div>
      </Card>

      <div aria-live="polite" className="space-y-3">
        {errors.length > 0 && !preview && (
          <ul role="alert" className="space-y-1 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        {done && <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{done}</p>}
      </div>

      {preview && (
        <Card>
          <h2 className="font-display text-xl text-ink-900">2. Check what will change</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge tone="info">{preview.counts.new} new</Badge>
            <Badge tone="accent">{preview.counts.update} changed</Badge>
            <Badge>{preview.counts.same} already up to date</Badge>
            {preview.errors.length > 0 && <Badge tone="danger">{preview.errors.length} problems</Badge>}
          </div>
          {preview.errors.length > 0 && (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <p className="font-semibold">These rows won't be imported until they're fixed:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {preview.errors.slice(0, SHOW).map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
              {preview.errors.length > SHOW && <p className="mt-2">…and {preview.errors.length - SHOW} more.</p>}
            </div>
          )}
          {toWrite > 0 && (
            <ul className="mt-4 divide-y divide-line rounded-2xl border border-line">
              {preview.rows
                .filter((r) => r.change !== "same")
                .slice(0, SHOW)
                .map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="font-medium text-ink-900">{r.label}</span> <span className="text-ink-500">· {CATALOGUE_KIND_LABEL[r.kind]} · {r.id}</span>
                    </span>
                    <Badge tone={r.change === "new" ? "info" : "accent"}>{r.change === "new" ? "New" : "Changed"}</Badge>
                  </li>
                ))}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={apply} disabled={toWrite === 0} busy={pending} busyLabel="Importing…">
              {toWrite === 0 ? "Nothing to import" : `Import ${toWrite} row${toWrite === 1 ? "" : "s"}`}
            </Button>
            <Button variant="ghost" onClick={reset}>
              Start again
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
