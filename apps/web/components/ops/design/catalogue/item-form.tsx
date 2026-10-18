"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { CATALOGUE_KIND_LABEL, CATALOGUE_KINDS, SPEC_FIELDS, type CatalogueItem, type EquipmentSpecs } from "@aircon/domain";
import { saveCatalogueItemAction, setCatalogueItemActiveAction } from "@/app/ops/catalogue/actions";
import { Button, Card, Checkbox, Fieldset, Input, Select, Textarea } from "@/components/kit";

/**
 * Every CatalogueItem field, edited in plain units: cost in pounds ex VAT
 * (blank means "not priced", never £0), specs in their own units, sources
 * as links. The server validates again; its sentences are shown as they
 * come back.
 */

type SpecKey = keyof EquipmentSpecs;

interface Draft {
  id: string;
  kind: CatalogueItem["kind"];
  manufacturer: string;
  series: string;
  model: string;
  label: string;
  tier: "" | "standard" | "premium";
  multiSplitCapable: boolean;
  ports: string;
  pairedWith: string;
  unit: string;
  category: string;
  customerBlurb: string;
  cost: string;
  costSupplier: string;
  costUrl: string;
  costObservedAt: string;
  costVatIncluded: boolean;
  costNote: string;
  supplier: string;
  status: CatalogueItem["status"];
  confidence: CatalogueItem["confidence"];
  verifiedAt: string;
  sources: { url: string; title: string }[];
  warranty: string;
  notes: string;
  active: boolean;
  specs: Record<SpecKey, string>;
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

function draftOf(item: CatalogueItem | null, kind: CatalogueItem["kind"]): Draft {
  const specs = {} as Record<SpecKey, string>;
  for (const f of SPEC_FIELDS) {
    const v = item?.specs?.[f.key];
    specs[f.key] = f.kind === "dimensions" ? (v && typeof v === "object" ? `${(v as { w: number }).w}x${(v as { h: number }).h}x${(v as { d: number }).d}` : "") : str(v);
  }
  return {
    id: item?.id ?? "",
    kind: item?.kind ?? kind,
    manufacturer: str(item?.manufacturer),
    series: str(item?.series),
    model: str(item?.model),
    label: str(item?.label),
    tier: item?.tier ?? "",
    multiSplitCapable: item?.multiSplitCapable ?? false,
    ports: str(item?.ports),
    pairedWith: str(item?.pairedWith),
    unit: str(item?.unit),
    category: str(item?.category),
    customerBlurb: str(item?.customerBlurb),
    cost: item?.costPence === null || item?.costPence === undefined ? "" : (item.costPence / 100).toFixed(2),
    costSupplier: str(item?.costSource?.supplier),
    costUrl: str(item?.costSource?.url),
    costObservedAt: str(item?.costSource?.observedAt),
    costVatIncluded: item?.costSource?.vatIncluded ?? false,
    costNote: str(item?.costSource?.note),
    supplier: str(item?.supplier),
    status: item?.status ?? "available",
    confidence: item?.confidence ?? "provisional",
    verifiedAt: str(item?.verifiedAt),
    sources: (item?.sources ?? []).map((s) => ({ url: s.url, title: s.title ?? "" })),
    warranty: str(item?.warranty),
    notes: str(item?.notes),
    active: item?.active ?? true,
    specs,
  };
}

/** Draft → the item the server validates. Returns field errors for anything that isn't a number where one is needed. */
function toItem(d: Draft): { item: Record<string, unknown>; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const number = (key: string, raw: string): number | null => {
    const t = raw.trim().replace(/,/g, "");
    if (!t) return null;
    const n = Number(t);
    if (!Number.isFinite(n)) {
      errors[key] = "Enter a number, or leave it blank if unknown.";
      return null;
    }
    return n;
  };
  const equipment = d.kind === "indoor" || d.kind === "outdoor";
  const specs: Record<string, unknown> = {};
  for (const f of SPEC_FIELDS) {
    const raw = d.specs[f.key] ?? "";
    if (f.kind === "dimensions") {
      const t = raw.trim();
      if (!t) {
        if (equipment) specs[f.key] = null;
        continue;
      }
      const m = /^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)$/i.exec(t);
      if (!m) errors[`spec.${f.key}`] = "Width x height x depth in mm, like 870x295x229.";
      else specs[f.key] = { w: Number(m[1]), h: Number(m[2]), d: Number(m[3]) };
    } else if (f.kind === "number") {
      const n = number(`spec.${f.key}`, raw);
      if (n !== null || equipment) specs[f.key] = n;
    } else if (raw.trim() || equipment) specs[f.key] = raw.trim() || null;
  }
  const cost = number("cost", d.cost.replace(/£/g, ""));
  if (cost !== null && cost < 0) errors.cost = "A cost can't be negative.";
  const ports = number("ports", d.ports);
  const opt = (s: string) => (s.trim() ? s.trim() : undefined);
  const costSource = {
    ...(opt(d.costUrl) ? { url: opt(d.costUrl) } : {}),
    ...(opt(d.costSupplier) ? { supplier: opt(d.costSupplier) } : {}),
    ...(opt(d.costObservedAt) ? { observedAt: opt(d.costObservedAt) } : {}),
    ...(cost !== null ? { vatIncluded: d.costVatIncluded } : {}),
    ...(opt(d.costNote) ? { note: opt(d.costNote) } : {}),
  };
  const item: Record<string, unknown> = {
    id: d.id.trim(),
    kind: d.kind,
    ...(opt(d.manufacturer) ? { manufacturer: opt(d.manufacturer) } : {}),
    ...(opt(d.series) ? { series: opt(d.series) } : {}),
    ...(opt(d.model) ? { model: opt(d.model) } : {}),
    label: d.label.trim(),
    ...(d.tier ? { tier: d.tier } : {}),
    ...(equipment ? { multiSplitCapable: d.multiSplitCapable, ports: ports === null ? null : Math.round(ports), pairedWith: opt(d.pairedWith) ?? null } : {}),
    ...(Object.keys(specs).length ? { specs } : {}),
    ...(opt(d.unit) ? { unit: opt(d.unit) } : {}),
    ...(opt(d.category) ? { category: opt(d.category) } : {}),
    ...(opt(d.customerBlurb) ? { customerBlurb: opt(d.customerBlurb) } : {}),
    costPence: cost === null ? null : Math.round(cost * 100),
    ...(Object.keys(costSource).length ? { costSource } : {}),
    ...(opt(d.supplier) ? { supplier: opt(d.supplier) } : {}),
    status: d.status,
    confidence: d.confidence,
    ...(opt(d.verifiedAt) ? { verifiedAt: opt(d.verifiedAt) } : {}),
    sources: d.sources.filter((s) => s.url.trim()).map((s) => (s.title.trim() ? { url: s.url.trim(), title: s.title.trim() } : { url: s.url.trim() })),
    ...(equipment ? { warranty: opt(d.warranty) ?? null } : opt(d.warranty) ? { warranty: opt(d.warranty) } : {}),
    ...(opt(d.notes) ? { notes: opt(d.notes) } : {}),
    active: d.active,
  };
  return { item, errors };
}

function slug(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function ItemForm({
  item,
  defaultKind = "material",
  today,
  pairOptions,
}: {
  item: CatalogueItem | null;
  defaultKind?: CatalogueItem["kind"];
  today: string;
  /** Ids the "paired with" field can point at (the other kind of unit). */
  pairOptions: { id: string; label: string }[];
}) {
  const router = useRouter();
  const creating = item === null;
  const [d, setD] = useState<Draft>(() => draftOf(item, defaultKind));
  const [idTouched, setIdTouched] = useState(!creating);
  const [pending, start] = useTransition();
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const equipment = d.kind === "indoor" || d.kind === "outdoor";
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setSaved(null);
    setD((prev) => {
      const next = { ...prev, [key]: value };
      if (creating && !idTouched && (key === "label" || key === "model" || key === "manufacturer")) {
        next.id = slug([next.manufacturer, next.model || next.label].filter(Boolean).join(" "));
      }
      return next;
    });
  };
  const setSpec = (key: SpecKey, value: string) => {
    setSaved(null);
    setD((prev) => ({ ...prev, specs: { ...prev.specs, [key]: value } }));
  };
  const original = useMemo(() => JSON.stringify(draftOf(item, defaultKind)), [item, defaultKind]);
  const dirty = JSON.stringify(d) !== original;

  const save = () => {
    const { item: out, errors } = toItem(d);
    setFieldErrors(errors);
    setServerErrors([]);
    if (Object.keys(errors).length) {
      setServerErrors(["Some fields need fixing first: they're marked below."]);
      return;
    }
    start(async () => {
      try {
        const r = await saveCatalogueItemAction(out, creating ? "create" : "update");
        if (!r.ok) {
          setServerErrors(r.errors);
          return;
        }
        setSaved(creating ? "Added to the catalogue." : "Saved.");
        if (creating) router.push(`/ops/catalogue/${encodeURIComponent(r.value.id)}`);
        else router.refresh();
      } catch {
        setServerErrors(["Couldn't reach the server. Nothing was saved; your changes are still here, so try again when you have signal."]);
      }
    });
  };

  const toggleActive = () => {
    if (!item) return;
    start(async () => {
      try {
        const r = await setCatalogueItemActiveAction(item.id, !item.active);
        if (!r.ok) setServerErrors(r.errors);
        else router.refresh();
      } catch {
        setServerErrors(["Couldn't reach the server. Try again when you have signal."]);
      }
    });
  };

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      noValidate
    >
      <Card>
        <h2 className="mb-4 font-display text-xl text-ink-900">What it is</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Kind"
            value={d.kind}
            onChange={(e) => set("kind", e.target.value as CatalogueItem["kind"])}
            disabled={!creating}
            options={CATALOGUE_KINDS.map((k) => ({ value: k, label: CATALOGUE_KIND_LABEL[k] }))}
          />
          <Input label="Label" required value={d.label} onChange={(e) => set("label", e.target.value)} hint="What staff see in pickers, e.g. “Panasonic TZ 3.5 kW”." />
          <Input label="Manufacturer" value={d.manufacturer} onChange={(e) => set("manufacturer", e.target.value)} />
          <Input label="Model code" required={equipment} value={d.model} onChange={(e) => set("model", e.target.value)} hint={equipment ? "Exactly as on the datasheet: compatibility rules match on it." : undefined} />
          <Input label="Series" value={d.series} onChange={(e) => set("series", e.target.value)} />
          <Select
            label="Tier"
            value={d.tier}
            onChange={(e) => set("tier", e.target.value as Draft["tier"])}
            options={[
              { value: "", label: "Not tiered" },
              { value: "standard", label: "Standard" },
              { value: "premium", label: "Premium (the Quiet option)" },
            ]}
          />
          <Input
            label="Catalogue id"
            required
            value={d.id}
            readOnly={!creating}
            onChange={(e) => {
              setIdTouched(true);
              set("id", e.target.value);
            }}
            hint={creating ? "Letters, numbers, dots and dashes. Can't be changed later." : "Ids never change: designs and orders point at them."}
          />
          <Input label="Category" value={d.category} onChange={(e) => set("category", e.target.value)} hint="e.g. pipe, cable, electrical, condensate, mounting, sealing." />
          <Input label="Unit" value={d.unit} onChange={(e) => set("unit", e.target.value)} hint="How it's bought: each, per m, 5 m coil, 50 m drum. Bills of materials count in this unit." />
        </div>
        {equipment && (
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Input label="Ports (rooms it can serve)" inputMode="numeric" value={d.ports} onChange={(e) => set("ports", e.target.value)} error={fieldErrors.ports} />
            <div className="sm:col-span-2">
              <Input label="Paired with (single split)" list="pair-options" value={d.pairedWith} onChange={(e) => set("pairedWith", e.target.value)} hint="The catalogue id of its single-split partner. Designs only pair what's listed here." />
              <datalist id="pair-options">
                {pairOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </datalist>
            </div>
            <Checkbox className="sm:col-span-3" label="Works on a multi-split" checked={d.multiSplitCapable} onChange={(e) => set("multiSplitCapable", e.target.checked)} />
          </div>
        )}
      </Card>

      {d.kind === "indoor" && (
        <Card>
          <h2 className="mb-1 font-display text-xl text-ink-900">For customers</h2>
          <p className="mb-4 text-sm text-ink-500">One plain-English line the proposal shows next to this unit. Facts, not hype.</p>
          <Textarea label="Customer line" rows={2} value={d.customerBlurb} onChange={(e) => set("customerBlurb", e.target.value)} hint="e.g. “As quiet as 19 dB(A) on its lowest setting, with Wi-Fi app control built in.”" />
        </Card>
      )}

      {(equipment || Object.values(d.specs).some((v) => v)) && (
        <Card>
          <h2 className="mb-1 font-display text-xl text-ink-900">Specification</h2>
          <p className="mb-4 text-sm text-ink-500">Leave a figure blank when the datasheet hasn't confirmed it: blank is honest, a guess isn't.</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SPEC_FIELDS.map((f) => (
              <Input
                key={f.key}
                label={`${f.label}${f.unit ? ` (${f.unit})` : ""}`}
                inputMode={f.kind === "number" ? "decimal" : undefined}
                value={d.specs[f.key]}
                onChange={(e) => setSpec(f.key, e.target.value)}
                error={fieldErrors[`spec.${f.key}`]}
                hint={f.key === "soundPowerDb" ? "Needed for the MCS 020 noise check." : f.key === "prechargedPipeM" ? "Needed to work out the extra refrigerant." : undefined}
              />
            ))}
          </div>
        </Card>
      )}

      <Card>
        <h2 className="mb-1 font-display text-xl text-ink-900">Buy cost</h2>
        <p className="mb-4 text-sm text-ink-500">What we pay, in pounds ex VAT. Blank means not priced yet, never free.</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Input label="Cost (£ ex VAT)" inputMode="decimal" value={d.cost} onChange={(e) => set("cost", e.target.value)} error={fieldErrors.cost} placeholder="Not priced" />
          <Input label="Supplier" value={d.costSupplier} onChange={(e) => set("costSupplier", e.target.value)} />
          <Input label="Price seen on" type="date" value={d.costObservedAt} onChange={(e) => set("costObservedAt", e.target.value)} max={today} />
          <Input className="sm:col-span-2" label="Link to the price" type="url" value={d.costUrl} onChange={(e) => set("costUrl", e.target.value)} />
          <Input label="Usual supplier" value={d.supplier} onChange={(e) => set("supplier", e.target.value)} hint="Who purchase orders go to." />
          <Textarea className="sm:col-span-2 lg:col-span-3" label="Note on the price" rows={2} value={d.costNote} onChange={(e) => set("costNote", e.target.value)} hint="Trade or retail? Quoted, or read off a page? Any minimum order?" />
        </div>
        {d.cost.trim() !== "" && (
          <Checkbox className="mt-2" label="The price I saw included VAT (I've entered it ex VAT)" checked={d.costVatIncluded} onChange={(e) => set("costVatIncluded", e.target.checked)} />
        )}
        {d.cost.trim() !== "" && !d.costSupplier.trim() && !d.costUrl.trim() && (
          <p className="mt-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">Add where this price came from, so the margin on every proposal can be traced.</p>
        )}
      </Card>

      <Card>
        <h2 className="mb-4 font-display text-xl text-ink-900">How sure we are</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Select
            label="Availability"
            value={d.status}
            onChange={(e) => set("status", e.target.value as Draft["status"])}
            options={[
              { value: "available", label: "Available" },
              { value: "uncertain", label: "Uncertain (confirm before ordering)" },
              { value: "discontinued", label: "Discontinued (can't be designed with)" },
            ]}
          />
          <Select
            label="Confidence"
            value={d.confidence}
            onChange={(e) => set("confidence", e.target.value as Draft["confidence"])}
            options={[
              { value: "verified", label: "Verified (checked against the manufacturer)" },
              { value: "provisional", label: "Provisional (needs checking)" },
              { value: "stale", label: "Stale (was verified, check again)" },
            ]}
            hint="Provisional items can be designed with; customers see them labelled."
          />
          <div>
            <Input label="Last verified" type="date" value={d.verifiedAt} onChange={(e) => set("verifiedAt", e.target.value)} max={today} hint="Over 90 days ago shows as stale." />
            <button type="button" className="mt-1 text-sm font-semibold text-accent-700 underline-offset-2 hover:underline" onClick={() => set("verifiedAt", today)}>
              Checked today
            </button>
          </div>
        </div>
        <Fieldset legend="Sources" hint="The manufacturer page or PDF the figures came from. A verified item needs at least one." className="mt-5">
          <ul className="space-y-3">
            {d.sources.map((s, i) => (
              <li key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <Input
                  label={`Link ${i + 1}`}
                  type="url"
                  value={s.url}
                  onChange={(e) => set("sources", d.sources.map((x, k) => (k === i ? { ...x, url: e.target.value } : x)))}
                />
                <Input
                  label="Title"
                  value={s.title}
                  onChange={(e) => set("sources", d.sources.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)))}
                />
                <Button variant="ghost" onClick={() => set("sources", d.sources.filter((_, k) => k !== i))} aria-label={`Remove source ${i + 1}`}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          <Button variant="secondary" className="mt-3" onClick={() => set("sources", [...d.sources, { url: "", title: "" }])}>
            Add a source
          </Button>
        </Fieldset>
      </Card>

      <Card>
        <div className="grid gap-4 lg:grid-cols-2">
          <Textarea label="Warranty" rows={4} value={d.warranty} onChange={(e) => set("warranty", e.target.value)} hint="The manufacturer's terms as you have them in writing." />
          <Textarea label="Notes" rows={4} value={d.notes} onChange={(e) => set("notes", e.target.value)} hint="Where figures came from, what still needs checking." />
        </div>
      </Card>

      <div className="sticky bottom-0 z-10 -mx-4 border-t border-line bg-cream/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border">
        <div aria-live="polite">
          {serverErrors.length > 0 && (
            <ul role="alert" className="mb-3 space-y-1 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {serverErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          {saved && !dirty && <p className="mb-2 text-sm font-medium text-emerald-800">{saved}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" busy={pending} busyLabel="Saving…" disabled={!creating && !dirty}>
            {creating ? "Add to catalogue" : "Save changes"}
          </Button>
          {!creating && dirty && <span className="text-sm text-ink-500">Unsaved changes</span>}
          {item && (
            <Button variant="ghost" className="ml-auto" onClick={toggleActive} disabled={pending}>
              {item.active ? "Retire this item" : "Bring it back into use"}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
