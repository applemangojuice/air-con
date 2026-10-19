"use client";

import { useId, useState } from "react";
import {
  DERIVED_COST_LINE_IDS,
  TAX_CODES,
  buildCostLines,
  effectiveTaxCode,
  markupPct,
  type CostLine,
  type OptionContext,
  type PricingInputs,
  type TaxCodeId,
} from "@aircon/domain";
import { AnnotatedImage } from "@/components/annotate/annotated-image";
import { Badge, Button, Card, Fieldset, Input, Select, Textarea } from "@/components/kit";
import { money, unitWord } from "@/lib/format";
import type { EngineReference, ProposalMedia } from "@/lib/proposal-server";
import { ListEditor, NumberField, PoundsInput } from "./fields";
import type { OptionForm, OptionPreview } from "./model";

/**
 * One option in the builder: what the customer reads (left), and, for
 * staff who may see margins, how it's priced and what it costs us.
 */

export function OptionEditor({
  form,
  preview,
  ctx,
  engine,
  media,
  canSeeMargins,
  isAdmin,
  instantPricePence,
  onChange,
  onRemove,
}: {
  form: OptionForm;
  preview: OptionPreview;
  ctx: OptionContext;
  engine: EngineReference;
  media: Record<string, ProposalMedia>;
  canSeeMargins: boolean;
  isAdmin: boolean;
  instantPricePence: number;
  onChange: (next: OptionForm) => void;
  onRemove?: () => void;
}) {
  const set = <K extends keyof OptionForm>(k: K, v: OptionForm[K]) => onChange({ ...form, [k]: v });
  const setInputs = (patch: Partial<PricingInputs>) => {
    const next: PricingInputs = { ...form.pricingInputs, ...patch };
    for (const k of Object.keys(next) as (keyof PricingInputs)[]) if (next[k] === undefined) delete next[k];
    set("pricingInputs", next);
  };
  const o = preview.option;
  const pr = o.pricing;

  return (
    <div className="space-y-6">
      {/* What the customer reads */}
      <Card>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-xl text-ink-900">What the customer reads</h3>
            <p className="mt-1 text-sm text-ink-500">From the approved design. Plain words: this is their contract.</p>
          </div>
          {onRemove && (
            <Button variant="ghost" onClick={onRemove}>
              Remove this option
            </Button>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <Input label="Option name" value={form.label} maxLength={60} onChange={(e) => set("label", e.target.value)} />
          <NumberField label="Install days" value={form.installDays} min={1} max={10} onChange={(n) => set("installDays", Math.round(n))} />
        </div>
        <div className="mt-4 space-y-4">
          <Textarea label="Summary" rows={2} maxLength={600} value={form.summary} onChange={(e) => set("summary", e.target.value)} />
          <ListEditor label="Highlights" hint="Up to 8. Only what's true of this option." value={form.highlights} onChange={(v) => set("highlights", v.slice(0, 8))} max={8} addLabel="Add a highlight" />
        </div>

        <h4 className="mt-6 text-sm font-semibold uppercase tracking-wide text-ink-500">Rooms</h4>
        <ul className="mt-3 space-y-4">
          {o.roomCards.map((card) => {
            const edit = form.roomCards.find((c) => c.roomId === card.roomId) ?? { roomId: card.roomId, unitName: card.unitName, why: card.why, highlights: card.highlights, ...(card.pipeNote ? { pipeNote: card.pipeNote } : {}) };
            const update = (patch: Partial<typeof edit>) =>
              set("roomCards", [...form.roomCards.filter((c) => c.roomId !== card.roomId), { ...edit, ...patch }]);
            const photo = card.mediaIds.map((id) => media[id]).find(Boolean);
            return (
              <li key={card.roomId} className="rounded-2xl border border-line bg-cream/60 p-4">
                <div className="grid gap-4 md:grid-cols-[180px_1fr]">
                  <div>
                    {photo ? (
                      <AnnotatedImage src={photo.url} annotations={photo.annotations} {...(photo.width && photo.height ? { width: photo.width, height: photo.height } : {})} alt={`${card.roomName} layout`} labels={false} />
                    ) : (
                      <div className="grid aspect-[4/3] place-items-center rounded-2xl border border-dashed border-line bg-white px-3 text-center text-xs text-ink-500">
                        No layout photo on the design
                      </div>
                    )}
                    <p className="mt-2 text-sm font-semibold text-ink-900">{card.roomName}</p>
                    <p className="text-xs text-ink-500">{card.mediaIds.length} photo{card.mediaIds.length === 1 ? "" : "s"} from the approved design</p>
                  </div>
                  <div className="space-y-3">
                    <Input label="Unit, in plain English" value={edit.unitName} maxLength={120} onChange={(e) => update({ unitName: e.target.value })} />
                    <Textarea label="Why this size" rows={3} maxLength={1000} value={edit.why} onChange={(e) => update({ why: e.target.value })} />
                    <ListEditor label="Highlights" value={edit.highlights} onChange={(v) => update({ highlights: v.slice(0, 8) })} max={8} addLabel="Add a highlight" />
                    <Textarea label="How the pipes run" rows={2} maxLength={600} value={edit.pipeNote ?? card.pipeNote ?? ""} onChange={(e) => update({ pipeNote: e.target.value })} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {/* Price */}
      <Card>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="font-display text-xl text-ink-900">Price</h3>
          <p className="text-sm text-ink-500">
            Customer pays <span className="font-semibold tabular-nums text-ink-900">{pr.totalPence > 0 ? money(pr.totalPence) : "not set"}</span>
            {instantPricePence > 0 && <> · online estimate {money(instantPricePence)}</>}
          </p>
        </div>
        {preview.error && (
          <p role="alert" className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
            {preview.error}
          </p>
        )}
        {canSeeMargins ? (
          <PricingControls form={form} ctx={ctx} engine={engine} isAdmin={isAdmin} setInputs={setInputs} setLabour={(l) => set("labour", l)} />
        ) : (
          <p className="text-sm text-ink-500">Pricing and costs are set by someone who can see margins.</p>
        )}
        <div className="mt-5 overflow-hidden rounded-2xl border border-line">
          <p className="border-b border-line px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-500">What the customer sees</p>
          {o.priceLines.length ? (
            <dl className="divide-y divide-line text-sm">
              {o.priceLines.map((l) => (
                <div key={l.id} className="flex justify-between gap-4 px-4 py-2.5">
                  <dt className="min-w-0 text-ink-700">{l.label}</dt>
                  <dd className="shrink-0 font-semibold tabular-nums">{money(l.amountPence)}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-4 bg-cream px-4 py-2.5">
                <dt className="font-semibold">Pilot price</dt>
                <dd className="font-semibold tabular-nums">{money(pr.totalPence)}</dd>
              </div>
            </dl>
          ) : (
            <p className="px-4 py-3 text-sm text-ink-500">Not priced yet.</p>
          )}
        </div>
      </Card>

      {canSeeMargins && <MarginPanel preview={preview} minMarginPct={ctx.settings.pricing.minMarginPct} />}
      {canSeeMargins && <CostTable form={form} preview={preview} ctx={ctx} setInputs={setInputs} />}
    </div>
  );
}

function PricingControls({
  form,
  ctx,
  engine,
  isAdmin,
  setInputs,
  setLabour,
}: {
  form: OptionForm;
  ctx: OptionContext;
  engine: EngineReference;
  isAdmin: boolean;
  setInputs: (patch: Partial<PricingInputs>) => void;
  setLabour: (l: OptionForm["labour"]) => void;
}) {
  const name = useId();
  const inputs = form.pricingInputs;
  const settings = ctx.settings;
  const discounts = settings.discounts.filter((d) => d.active);
  const code = discounts.find((d) => d.code === inputs.discountCode);
  const perJob = code && !(code.pct && code.pct > 0) && !(code.amountPence && code.amountPence > 0);
  const installOnly = ctx.contractType === "install-only";
  const taxDefault = effectiveTaxCode(settings);
  const basisRow = (basis: PricingInputs["basis"], title: string, detail: string, disabled = false) => (
    <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3.5 ${inputs.basis === basis ? "border-accent-500 bg-accent-50/50" : "border-line bg-white"} ${disabled ? "opacity-50" : ""}`}>
      <input type="radio" name={name} className="mt-1 h-4 w-4 accent-accent-600" checked={inputs.basis === basis} disabled={disabled} onChange={() => setInputs({ basis })} />
      <span>
        <span className="block text-sm font-semibold text-ink-900">{title}</span>
        <span className="block text-xs text-ink-500">{detail}</span>
      </span>
    </label>
  );
  return (
    <div className="space-y-5">
      <Fieldset legend="How it's priced">
        <div className="grid gap-2 md:grid-cols-3">
          {basisRow(
            "engine",
            engine.netPence > 0 ? `Engine list price: ${money(engine.netPence)}` : "Engine list price",
            installOnly ? "Includes equipment, so not for install-only." : `${engine.note}${form.designVariantId && ctx.design.variants.find((v) => v.id === form.designVariantId)?.tier === "premium" ? ` Plus ${settings.pricing.premiumUpliftPct}% for the premium units.` : ""}`,
            engine.netPence <= 0,
          )}
          {basisRow("cost-plus", "Cost-plus", "Our cost ÷ (1 − target margin), up to the next £10.")}
          {basisRow("manual", "Manual price", "A price you set, with a reason on record.")}
        </div>
      </Fieldset>
      {inputs.basis === "cost-plus" && (
        <NumberField
          label="Target gross margin"
          suffix="%"
          value={inputs.targetMarginPct ?? settings.pricing.minMarginPct}
          min={0}
          max={90}
          onChange={(n) => setInputs({ targetMarginPct: n })}
          hint={`The minimum in settings is ${settings.pricing.minMarginPct}%. A discount comes off after this.`}
        />
      )}
      {inputs.basis === "manual" && (
        <div className="grid gap-3 md:grid-cols-[200px_1fr]">
          <div>
            <p className="mb-1.5 text-sm font-semibold text-ink-900">Price before any VAT</p>
            <PoundsInput value={inputs.manualNetPence} onChange={(p) => setInputs({ manualNetPence: p })} ariaLabel="Manual price before any VAT" placeholder="0" />
          </div>
          <Input label="Why this price" required value={inputs.manualReason ?? ""} maxLength={500} onChange={(e) => setInputs({ manualReason: e.target.value })} />
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-[220px_1fr]">
        <Select
          label="Pilot discount"
          value={inputs.discountCode ?? ""}
          onChange={(e) => setInputs({ discountCode: e.target.value || undefined, customDiscountPence: undefined })}
          options={[
            { value: "", label: "No discount" },
            ...discounts.map((d) => ({
              value: d.code,
              label: d.pct ? `${d.code} · ${d.pct}%` : d.amountPence ? `${d.code} · ${money(d.amountPence)}` : `${d.code} · set per job`,
            })),
          ]}
        />
        {inputs.discountCode && (
          <Input
            label="Reason (internal)"
            hint={perJob ? "Required for a per-job discount." : `Default: ${code?.reason ?? ""}`}
            value={inputs.discountReason ?? ""}
            maxLength={500}
            onChange={(e) => setInputs({ discountReason: e.target.value })}
          />
        )}
      </div>
      {perJob && (
        <div className="max-w-[220px]">
          <p className="mb-1.5 text-sm font-semibold text-ink-900">Discount amount</p>
          <PoundsInput value={inputs.customDiscountPence} onChange={(p) => setInputs({ customDiscountPence: p })} ariaLabel="Discount amount" placeholder="0" />
        </div>
      )}
      <p className="text-xs text-ink-500">The customer sees their pilot price (and &ldquo;Founding pilot price&rdquo; when there&apos;s a discount), never a &ldquo;was £X&rdquo;.</p>

      <div>
        <p className="mb-1.5 text-sm font-semibold text-ink-900">Tax</p>
        {settings.tax.vatRegistered && isAdmin ? (
          <Select
            label="Tax code (admin override needs a reason in the issue panel)"
            value={inputs.taxCode ?? taxDefault}
            onChange={(e) => setInputs({ taxCode: e.target.value === taxDefault ? undefined : (e.target.value as TaxCodeId) })}
            options={(Object.keys(TAX_CODES) as TaxCodeId[]).filter((c) => c !== "outside-scope").map((c) => ({ value: c, label: TAX_CODES[c].label }))}
          />
        ) : (
          <p className="rounded-2xl bg-cream px-4 py-2.5 text-sm text-ink-700">
            {TAX_CODES[inputs.taxCode && settings.tax.vatRegistered ? inputs.taxCode : taxDefault].label}
            <span className="block text-xs text-ink-500">
              {settings.tax.vatRegistered
                ? `From settings, ${settings.tax.accountantConfirmed ? "confirmed by the accountant" : "not yet confirmed by the accountant"}.`
                : "From settings: no VAT is charged while we aren't registered."}
            </span>
          </p>
        )}
      </div>

      <Fieldset legend="Labour plan" hint="Crew on site each day, and the days each role is booked. Day rates come from settings.">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <NumberField label="Installers" value={form.labour.crewSize} min={1} max={6} onChange={(n) => setLabour({ ...form.labour, crewSize: Math.round(n) })} />
          <NumberField label="Installer days" value={form.labour.installerDays} min={0} max={20} step={0.5} onChange={(n) => setLabour({ ...form.labour, installerDays: n })} />
          <NumberField label="Electrician days" value={form.labour.electricianDays} min={0} max={10} step={0.5} onChange={(n) => setLabour({ ...form.labour, electricianDays: n })} />
          <NumberField label="Tech lead days" value={form.labour.techLeadDays} min={0} max={10} step={0.5} onChange={(n) => setLabour({ ...form.labour, techLeadDays: n })} />
        </div>
      </Fieldset>
    </div>
  );
}

function MarginPanel({ preview, minMarginPct }: { preview: OptionPreview; minMarginPct: number }) {
  const pr = preview.option.pricing;
  const priced = pr.netPence > 0;
  const incomplete = pr.unpricedCostLines > 0;
  const markup = markupPct(pr.netPence, pr.costPence);
  const tone = !priced ? "text-ink-500" : pr.belowMinMargin ? "text-red-700" : "text-emerald-800";
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-display text-xl text-ink-900">Margin</h3>
        <Badge tone="neutral">Internal: never shown to the customer</Badge>
      </div>
      {incomplete && (
        <p className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-semibold">Margin incomplete:</span> {pr.unpricedCostLines} cost line{pr.unpricedCostLines === 1 ? " has" : "s have"} no price yet, so the real margin is lower than shown. Enter the costs below: it can&apos;t be issued until they&apos;re priced, or an admin records an override.
        </p>
      )}
      {priced && pr.belowMinMargin && (
        <p className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <span className="font-semibold">Below the {minMarginPct}% minimum.</span> Change the price or discount, or an admin records an override with a reason before issue.
        </p>
      )}
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Figure label="List price (net)" value={priced ? money(pr.listNetPence) : "–"} />
        <Figure label="Discount" value={pr.discount ? `−${money(pr.discount.amountPence)}` : "None"} hint={pr.discount ? pr.discount.code : undefined} />
        <Figure label="Net price" value={priced ? money(pr.netPence) : "–"} hint={pr.taxPence > 0 ? `+ ${money(pr.taxPence)} VAT` : "No VAT added"} />
        <Figure label="Our cost" value={money(pr.costPence)} hint={incomplete ? "Incomplete" : "All lines priced"} />
        <Figure label="Gross margin" value={priced ? `${pr.grossMarginPct}%` : "–"} hint={priced ? `${pr.grossMarginPctBeforeDiscount}% before discount` : undefined} valueClass={tone} />
        <Figure label="Contribution" value={priced ? money(pr.contributionPence) : "–"} hint={markup !== null && priced ? `Markup on cost ${markup}%` : undefined} />
      </dl>
    </Card>
  );
}

function Figure({ label, value, hint, valueClass = "text-ink-900" }: { label: string; value: string; hint?: string; valueClass?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-3.5">
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className={`mt-1 text-xl font-semibold tabular-nums ${valueClass}`}>{value}</dd>
      {hint && <dd className="mt-0.5 text-xs text-ink-500">{hint}</dd>}
    </div>
  );
}


const CATEGORY_LABEL: Record<CostLine["category"], string> = {
  equipment: "Equipment",
  materials: "Materials",
  labour: "Labour",
  subcontract: "Subcontract",
  access: "Access",
  delivery: "Delivery",
  consumables: "Consumables",
  contingency: "Contingency",
  overhead: "Overhead",
};

function CostTable({
  form,
  preview,
  ctx,
  setInputs,
}: {
  form: OptionForm;
  preview: OptionPreview;
  ctx: OptionContext;
  setInputs: (patch: Partial<PricingInputs>) => void;
}) {
  const inputs = form.pricingInputs;
  const overrides = inputs.costOverrides ?? {};
  const variant = ctx.design.variants.find((v) => v.id === form.designVariantId);
  // The catalogue's own costs, to tell an override from the default.
  const baseline = new Map(
    (variant
      ? buildCostLines({
          variant,
          catalogue: ctx.catalogue,
          labour: form.labour,
          settings: ctx.settings,
          contractType: ctx.contractType,
          ...(ctx.inHouseElectrician ? { inHouseElectrician: true } : {}),
          ...(ctx.accessEquipment ? { accessEquipment: ctx.accessEquipment } : {}),
        })
      : []
    ).map((l) => [l.id, l.unitCostPence]),
  );
  const setOverride = (id: string, pence: number | undefined) => {
    const next = { ...overrides };
    if (pence === undefined || pence === baseline.get(id)) delete next[id];
    else next[id] = { unitCostPence: pence };
    setInputs({ costOverrides: Object.keys(next).length ? next : undefined });
  };
  const lines = preview.option.costLines;
  const total = lines.reduce((a, l) => a + (l.totalPence ?? 0), 0);
  const [adding, setAdding] = useState({ label: "", category: "materials" as CostLine["category"], qty: 1, unitCostPence: undefined as number | undefined });
  const extras = inputs.extras ?? [];
  const addExtra = () => {
    if (!adding.label.trim() || adding.unitCostPence === undefined) return;
    const id = `extra:${Date.now().toString(36)}`;
    const line: CostLine = {
      id,
      category: adding.category,
      label: adding.label.trim(),
      qty: adding.qty,
      unit: "each",
      unitCostPence: adding.unitCostPence,
      totalPence: Math.round(adding.qty * adding.unitCostPence),
      source: "Added on the proposal",
      verified: false,
    };
    setInputs({ extras: [...extras, line] });
    setAdding({ label: "", category: "materials", qty: 1, unitCostPence: undefined });
  };

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-baseline justify-between gap-3 px-5 pt-5 sm:px-6">
        <h3 className="font-display text-xl text-ink-900">Cost build-up</h3>
        <p className="text-sm text-ink-500">Internal. Unit costs ex VAT; type a cost where the catalogue has none.</p>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <caption className="sr-only">Cost lines for this option</caption>
          <thead>
            <tr className="border-y border-line bg-cream text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
              <th scope="col" className="px-5 py-2.5 sm:px-6">Item</th>
              <th scope="col" className="px-3 py-2.5 text-right">Qty</th>
              <th scope="col" className="px-3 py-2.5 text-right">Unit cost</th>
              <th scope="col" className="px-3 py-2.5 text-right">Total</th>
              <th scope="col" className="px-5 py-2.5 sm:px-6">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {lines.map((l) => {
              const derived = DERIVED_COST_LINE_IDS.has(l.id);
              const isExtra = l.id.startsWith("extra:");
              return (
                <tr key={l.id} className={l.totalPence === null ? "bg-amber-50/70" : ""}>
                  <td className="px-5 py-2.5 sm:px-6">
                    <span className="block font-medium text-ink-900">{l.label}</span>
                    <span className="text-xs text-ink-500">{CATEGORY_LABEL[l.category]}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-ink-700">
                    {l.qty} {unitWord(l.unit, l.qty)}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end">
                      {derived ? (
                        <span className="tabular-nums text-ink-700">{l.unitCostPence === null ? "–" : money(l.unitCostPence)}</span>
                      ) : isExtra ? (
                        <span className="tabular-nums text-ink-700">{money(l.unitCostPence ?? 0)}</span>
                      ) : (
                        <PoundsInput
                          compact
                          value={l.unitCostPence}
                          onChange={(p) => setOverride(l.id, p)}
                          placeholder="Not priced"
                          ariaLabel={`Unit cost for ${l.label}`}
                        />
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                    {l.totalPence === null ? <span className="font-medium text-amber-800">Not priced</span> : money(l.totalPence)}
                  </td>
                  <td className="px-5 py-2.5 text-xs text-ink-500 sm:px-6">
                    {l.source}
                    {isExtra && (
                      <button
                        type="button"
                        className="ml-2 font-semibold text-red-700 underline"
                        onClick={() => setInputs({ extras: extras.filter((e) => e.id !== l.id).length ? extras.filter((e) => e.id !== l.id) : undefined })}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line bg-cream">
              <th scope="row" colSpan={3} className="px-5 py-3 text-left font-semibold sm:px-6">
                Total cost{preview.option.pricing.unpricedCostLines ? ` (${preview.option.pricing.unpricedCostLines} not priced)` : ""}
              </th>
              <td className="px-3 py-3 text-right font-semibold tabular-nums">{money(total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="border-t border-line px-5 py-4 sm:px-6">
        <p className="mb-2 text-sm font-semibold text-ink-900">Add a cost</p>
        <div className="grid items-end gap-3 md:grid-cols-[1fr_160px_90px_130px_auto]">
          <Input label="What" value={adding.label} maxLength={120} placeholder="e.g. Parking permit, skip hire" onChange={(e) => setAdding({ ...adding, label: e.target.value })} />
          <Select
            label="Category"
            value={adding.category}
            onChange={(e) => setAdding({ ...adding, category: e.target.value as CostLine["category"] })}
            options={(["materials", "access", "delivery", "consumables", "subcontract", "labour", "equipment", "overhead"] as const).map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
          />
          <NumberField label="Qty" value={adding.qty} min={0} max={1000} step={0.5} onChange={(n) => setAdding({ ...adding, qty: n })} />
          <div>
            <p className="mb-1.5 text-sm font-semibold text-ink-900">Unit cost</p>
            <PoundsInput value={adding.unitCostPence} onChange={(p) => setAdding({ ...adding, unitCostPence: p })} ariaLabel="Unit cost of the new line, ex VAT" placeholder="0" />
          </div>
          <Button variant="secondary" className="min-h-12" onClick={addExtra} disabled={!adding.label.trim() || adding.unitCostPence === undefined}>
            Add
          </Button>
        </div>
      </div>
    </Card>
  );
}
