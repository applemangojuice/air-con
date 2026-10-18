"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { CompatibilityRule } from "@aircon/domain";
import { deleteRuleAction, saveRuleAction } from "@/app/ops/catalogue/actions";
import { Button, Card, Fieldset, Input, Textarea } from "@/components/kit";

/**
 * One multi-split rule: the outdoor model, how many rooms, which indoor
 * models (one per line, * for a wildcard) or series, capacity and pipe
 * limits, and where it came from. Verified needs the manufacturer's table.
 */

interface Draft {
  id: string;
  outdoorModel: string;
  manufacturer: string;
  maxIndoorUnits: string;
  series: string;
  models: string;
  minKw: string;
  maxKw: string;
  totalPipe: string;
  perRoomPipe: string;
  sourceUrl: string;
  sourceTitle: string;
  confidence: "verified" | "provisional";
  notes: string;
}

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

function draftOf(r: CompatibilityRule | null): Draft {
  return {
    id: r?.id ?? "",
    outdoorModel: s(r?.outdoorModel),
    manufacturer: s(r?.manufacturer),
    maxIndoorUnits: s(r?.maxIndoorUnits ?? 2),
    series: (r?.connectableIndoorSeries ?? []).join("\n"),
    models: (r?.connectableIndoorModels ?? []).join("\n"),
    minKw: s(r?.minConnectedKw),
    maxKw: s(r?.maxConnectedKw),
    totalPipe: s(r?.maxTotalPipeM),
    perRoomPipe: s(r?.maxPipePerRoomM),
    sourceUrl: s(r?.source?.url),
    sourceTitle: s(r?.source?.title),
    confidence: r?.confidence ?? "provisional",
    notes: s(r?.notes),
  };
}

export function RuleForm({ rule, outdoorModels }: { rule: CompatibilityRule | null; outdoorModels: { model: string; manufacturer?: string }[] }) {
  const router = useRouter();
  const creating = rule === null;
  const [d, setD] = useState<Draft>(() => draftOf(rule));
  const [errors, setErrors] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setSaved(false);
    setD((p) => {
      const next = { ...p, [k]: v };
      if (creating && k === "outdoorModel") {
        next.id = `compat-${String(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
        const known = outdoorModels.find((o) => o.model.toLowerCase() === String(v).toLowerCase());
        if (known?.manufacturer && !p.manufacturer) next.manufacturer = known.manufacturer;
      }
      return next;
    });
  };

  const save = () => {
    const fe: Record<string, string> = {};
    const num = (key: string, raw: string): number | null => {
      const t = raw.trim();
      if (!t) return null;
      const n = Number(t);
      if (!Number.isFinite(n) || n <= 0) {
        fe[key] = "A positive number, or blank if unknown.";
        return null;
      }
      return n;
    };
    const lines = (t: string) => t.split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean);
    const out = {
      id: d.id.trim(),
      outdoorModel: d.outdoorModel.trim(),
      ...(d.manufacturer.trim() ? { manufacturer: d.manufacturer.trim() } : {}),
      maxIndoorUnits: Math.round(num("maxIndoorUnits", d.maxIndoorUnits) ?? 0),
      connectableIndoorSeries: lines(d.series),
      connectableIndoorModels: lines(d.models),
      minConnectedKw: num("minKw", d.minKw),
      maxConnectedKw: num("maxKw", d.maxKw),
      maxTotalPipeM: num("totalPipe", d.totalPipe),
      maxPipePerRoomM: num("perRoomPipe", d.perRoomPipe),
      source: d.sourceUrl.trim() ? { url: d.sourceUrl.trim(), ...(d.sourceTitle.trim() ? { title: d.sourceTitle.trim() } : {}) } : null,
      confidence: d.confidence,
      ...(d.notes.trim() ? { notes: d.notes.trim() } : {}),
    };
    setFieldErrors(fe);
    if (Object.keys(fe).length) {
      setErrors(["Some fields need fixing first: they're marked below."]);
      return;
    }
    setErrors([]);
    start(async () => {
      try {
        const r = await saveRuleAction(out, creating ? "create" : "update");
        if (!r.ok) return setErrors(r.errors);
        setSaved(true);
        if (creating) router.push(`/ops/catalogue/compatibility/${encodeURIComponent(r.value.id)}`);
        else router.refresh();
      } catch {
        setErrors(["Couldn't reach the server. Nothing was saved; try again when you have signal."]);
      }
    });
  };

  const remove = () => {
    if (!rule) return;
    if (!confirmDelete) return setConfirmDelete(true);
    start(async () => {
      try {
        const r = await deleteRuleAction(rule.id);
        if (!r.ok) return setErrors(r.errors);
        router.push("/ops/catalogue/compatibility");
      } catch {
        setErrors(["Couldn't reach the server. Nothing was deleted; try again."]);
      }
    });
  };

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {d.confidence === "provisional" && (
        <p role="note" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Provisional rule: designs can use it, but a technical lead must tick that they've checked the manufacturer's combination table before approving one.
        </p>
      )}
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Input label="Outdoor model" required list="outdoor-models" value={d.outdoorModel} onChange={(e) => set("outdoorModel", e.target.value)} hint="The model code exactly as in the catalogue." />
            <datalist id="outdoor-models">
              {outdoorModels.map((o) => (
                <option key={o.model} value={o.model} />
              ))}
            </datalist>
          </div>
          <Input label="Brand" value={d.manufacturer} onChange={(e) => set("manufacturer", e.target.value)} />
          <Input label="Rule id" required value={d.id} readOnly={!creating} onChange={(e) => set("id", e.target.value)} hint={creating ? "Filled in from the model; change it if you like." : "Ids don't change."} />
          <Input label="Most indoor units" required inputMode="numeric" value={d.maxIndoorUnits} onChange={(e) => set("maxIndoorUnits", e.target.value)} error={fieldErrors.maxIndoorUnits} />
        </div>
      </Card>
      <Card>
        <h2 className="mb-1 font-display text-xl text-ink-900">Which indoor units connect</h2>
        <p className="mb-4 text-sm text-ink-500">From the manufacturer's combination table. A model or a series is enough; anything not listed is refused.</p>
        <div className="grid gap-4 lg:grid-cols-2">
          <Textarea label="Indoor models" rows={8} value={d.models} onChange={(e) => set("models", e.target.value)} hint="One per line. Use * as a wildcard: CS-TZ*CKEW." />
          <Textarea label="Indoor series" rows={8} value={d.series} onChange={(e) => set("series", e.target.value)} hint="One per line, matched exactly against the catalogue's series name." />
        </div>
      </Card>
      <Card>
        <h2 className="mb-4 font-display text-xl text-ink-900">Limits</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Input label="Min connected (kW)" inputMode="decimal" value={d.minKw} onChange={(e) => set("minKw", e.target.value)} error={fieldErrors.minKw} />
          <Input label="Max connected (kW)" inputMode="decimal" value={d.maxKw} onChange={(e) => set("maxKw", e.target.value)} error={fieldErrors.maxKw} />
          <Input label="Total pipe (m)" inputMode="decimal" value={d.totalPipe} onChange={(e) => set("totalPipe", e.target.value)} error={fieldErrors.totalPipe} />
          <Input label="Pipe per room (m)" inputMode="decimal" value={d.perRoomPipe} onChange={(e) => set("perRoomPipe", e.target.value)} error={fieldErrors.perRoomPipe} />
        </div>
        <p className="mt-3 text-sm text-ink-500">Blank means not known: the check then warns instead of passing silently.</p>
      </Card>
      <Card>
        <Fieldset legend="How sure is this rule?">
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ["verified", "Verified", "Copied from the manufacturer's official combination table."],
                ["provisional", "Provisional", "Worked out from capacities, retailer bundles or secondary sources."],
              ] as const
            ).map(([v, label, hint]) => (
              <label key={v} className={`flex min-h-12 cursor-pointer items-start gap-3 rounded-2xl border p-3 ${d.confidence === v ? "border-accent-500 bg-accent-50" : "border-line bg-white"}`}>
                <input type="radio" name="confidence" value={v} checked={d.confidence === v} onChange={() => set("confidence", v)} className="mt-1 h-5 w-5 accent-accent-600" />
                <span>
                  <span className="block font-semibold text-ink-900">{label}</span>
                  <span className="block text-sm text-ink-500">{hint}</span>
                </span>
              </label>
            ))}
          </div>
        </Fieldset>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Input label="Source link" type="url" value={d.sourceUrl} onChange={(e) => set("sourceUrl", e.target.value)} required={d.confidence === "verified"} />
          <Input label="Source title" value={d.sourceTitle} onChange={(e) => set("sourceTitle", e.target.value)} />
        </div>
        <Textarea className="mt-4" label="Notes" rows={4} value={d.notes} onChange={(e) => set("notes", e.target.value)} hint="How the list was put together, and what still needs checking." />
      </Card>
      <div className="sticky bottom-0 z-10 -mx-4 border-t border-line bg-cream/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border">
        <div aria-live="polite">
          {errors.length > 0 && (
            <ul role="alert" className="mb-3 space-y-1 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          {saved && <p className="mb-2 text-sm font-medium text-emerald-800">Saved.</p>}
          {confirmDelete && <p className="mb-2 text-sm font-medium text-red-700">Delete this rule? New multi-splits on {rule?.outdoorModel} will be blocked until there's a rule again. Press Delete again to confirm.</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" busy={pending} busyLabel="Saving…">
            {creating ? "Add rule" : "Save rule"}
          </Button>
          {rule && (
            <Button variant={confirmDelete ? "danger" : "ghost"} className="ml-auto" onClick={remove} disabled={pending}>
              {confirmDelete ? "Delete" : "Delete rule"}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
