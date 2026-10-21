"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { TAX_CODES, financeOffered, schedule2Missing, type DiscountCode, type FinanceArrangement, type PilotSettings, type TaxCodeId } from "@aircon/domain";
import { Badge } from "@/components/kit/badge";
import { Button } from "@/components/kit/button";
import { ActionForm, SubmitButton } from "@/components/ops/command/action-form";
import type { ActionResult } from "@/components/ops/command/types";

/**
 * The settings document, grouped the way the business thinks about it. The
 * whole document is edited in the browser and saved in one go; the server
 * validates every field. Missing pre-contract details are listed live at
 * the top, because proposals can't be issued without them.
 */

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CONTROL =
  "mt-1.5 block w-full min-h-11 rounded-xl border border-line bg-white px-3 text-base font-normal text-ink-900 outline-none placeholder:text-ink-500 focus:border-accent-500 focus:ring-2 focus:ring-accent-100";

const pounds = (pence: number | undefined) => (pence === undefined ? "" : String(pence / 100));
const toPence = (v: string) => Math.round((Number(v) || 0) * 100);

function Group({ id, title, intro, children, badge }: { id: string; title: string; intro?: ReactNode; children: ReactNode; badge?: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24 rounded-2xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-h`} className="font-display text-xl text-ink-900">
          {title}
        </h2>
        {badge}
      </div>
      {intro && <p className="mt-1 text-sm text-ink-500">{intro}</p>}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Text({
  label,
  value,
  onChange,
  hint,
  required,
  type = "text",
  wide,
  area,
  placeholder,
  ...rest
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  hint?: ReactNode;
  required?: boolean;
  type?: string;
  wide?: boolean;
  area?: boolean;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number | string;
  maxLength?: number;
}) {
  const id = useId();
  const missing = required && String(value).trim() === "";
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <label htmlFor={id} className="block text-sm font-semibold text-ink-900">
        {label}
        {required && <span className="ml-1 font-normal text-ink-500">(required)</span>}
      </label>
      {area ? (
        <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={3} placeholder={placeholder} aria-invalid={missing || undefined} aria-describedby={hint ? `${id}-h` : undefined} className={`${CONTROL} py-2 leading-relaxed aria-invalid:border-amber-500`} maxLength={rest.maxLength} />
      ) : (
        <input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-invalid={missing || undefined} aria-describedby={hint ? `${id}-h` : undefined} className={`${CONTROL} aria-invalid:border-amber-500`} {...rest} />
      )}
      {hint && (
        <p id={`${id}-h`} className="mt-1 text-xs text-ink-500">
          {hint}
        </p>
      )}
    </div>
  );
}

function Toggle({ label, hint, checked, onChange, wide }: { label: string; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void; wide?: boolean }) {
  const id = useId();
  return (
    <label htmlFor={id} className={`flex min-h-12 cursor-pointer items-start gap-3 py-1 ${wide ? "sm:col-span-2" : ""}`}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-accent-600" />
      <span className="text-base text-ink-900">
        {label}
        {hint && <span className="block text-sm text-ink-500">{hint}</span>}
      </span>
    </label>
  );
}

const REVIEW = <Badge tone="warn">Needs solicitor review</Badge>;

export function SettingsEditor({
  initial,
  loadedAt,
  action,
  demoReset,
}: {
  initial: PilotSettings;
  loadedAt: string;
  action: (fd: FormData) => Promise<ActionResult>;
  demoReset: boolean;
}) {
  const [s, setS] = useState<PilotSettings>(initial);
  const [outcodes, setOutcodes] = useState(initial.serviceArea.outcodes.join(", "));
  const [slots, setSlots] = useState(initial.scheduling.surveySlotTimes.join(", "));
  const [dirty, setDirty] = useState(false);
  const missing = schedule2Missing(s);

  // Unsaved changes survive a mis-tap on Back or a refresh prompt, not silently vanish.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const patch = <K extends keyof PilotSettings>(key: K, value: Partial<PilotSettings[K]>) => {
    setDirty(true);
    setS((cur) => ({ ...cur, [key]: { ...(cur[key] as object), ...(value as object) } }) as PilotSettings);
  };
  const company = (v: Partial<PilotSettings["company"]>) => patch("company", v);
  const sub = <G extends "fgasCompanyCert" | "insurance" | "bank">(group: G, v: Partial<NonNullable<PilotSettings["company"][G]>>) =>
    company({ [group]: { ...((s.company[group] ?? {}) as object), ...v } } as Partial<PilotSettings["company"]>);
  const setDiscounts = (fn: (d: DiscountCode[]) => DiscountCode[]) => {
    setDirty(true);
    setS((cur) => ({ ...cur, discounts: fn(cur.discounts) }));
  };

  function payload(): string {
    const full: PilotSettings = {
      ...s,
      serviceArea: { outcodes: outcodes.split(/[\s,;]+/).map((o) => o.trim().toUpperCase()).filter(Boolean) },
      scheduling: { ...s.scheduling, surveySlotTimes: slots.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean).map((t) => (/^\d:\d\d$/.test(t) ? `0${t}` : t)) },
    };
    return JSON.stringify(full);
  }

  const c = s.company;
  return (
    <ActionForm
      action={async (fd) => {
        fd.set("payload", payload());
        fd.set("loadedAt", loadedAt);
        const r = await action(fd);
        if (r.ok) setDirty(false);
        return r;
      }}
    >
      {missing.length > 0 ? (
        <div role="status" className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-900">
          <p className="font-semibold">Proposals can&apos;t be issued yet</p>
          <p className="mt-1 text-sm">
            The pre-contract information every customer must get before they accept (Consumer Contracts Regulations, Schedule 2) is missing: <strong>{missing.join(", ")}</strong>. Fill these in below and save.
          </p>
        </div>
      ) : (
        <p className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">All the pre-contract (Schedule 2) details are in.</p>
      )}

      <nav aria-label="Settings sections" className="-mx-4 mb-6 overflow-x-auto px-4">
        <ul className="flex min-w-max gap-1.5 lg:min-w-0 lg:flex-wrap">
          {[
            ["company", "Company"],
            ["tax", "Tax and VAT"],
            ["pricing", "Pricing"],
            ["discounts", "Discounts"],
            ["payments", "Payments"],
            ["scheduling", "Scheduling"],
            ["area", "Service area"],
            ["warranty", "Warranty"],
            ["safety", "Safety"],
            ["legal", "Legal"],
            ["comms", "Messages"],
            ["other", "Finance and features"],
          ].map(([href, label]) => (
            <li key={href}>
              <a href={`#${href}`} className="inline-flex min-h-9 items-center rounded-full border border-line bg-white px-3 text-xs font-semibold text-ink-700 hover:border-ink-300">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="space-y-6">
        <Group id="company" title="Company and pre-contract details" intro="These go in every proposal email and contract. Required ones block proposals until they're filled in.">
          <Text label="Legal name" value={c.legalName} onChange={(v) => company({ legalName: v })} required />
          <Text label="Trading name" value={c.tradingName} onChange={(v) => company({ tradingName: v })} required />
          <Text label="Company number" value={c.companyNumber ?? ""} onChange={(v) => company({ companyNumber: v })} />
          <Text label="VAT number" value={c.vatNumber ?? ""} onChange={(v) => company({ vatNumber: v })} hint="Only once registered." />
          <Text label="Phone" value={c.phone} onChange={(v) => company({ phone: v })} required hint="On every message and document." />
          <Text label="Email" type="email" value={c.email} onChange={(v) => company({ email: v })} required />
          <Text label="Geographic address" value={c.geographicAddress} onChange={(v) => company({ geographicAddress: v })} required wide area hint="Where we're established: a real street address, not a PO box. It goes in the cancellation instructions." />
          <Text label="Registered office" value={c.registeredAddress ?? ""} onChange={(v) => company({ registeredAddress: v })} wide />
          <Text label="Complaints process" value={c.complaintsProcess} onChange={(v) => company({ complaintsProcess: v })} required wide area hint="How a customer complains and what happens next, in plain words." />
          <Text label="Dispute resolution (ADR)" value={c.adr ?? ""} onChange={(v) => company({ adr: v })} wide area hint="The out-of-court scheme you're signed up to and how to reach it. Leave blank if there isn't one." />
          <Text label="Workmanship guarantee" value={c.workmanshipGuarantee ?? ""} onChange={(v) => company({ workmanshipGuarantee: v })} wide area hint="Its conditions and how to claim." />
          <Text label="Review page link" type="url" value={c.reviewUrl ?? ""} onChange={(v) => company({ reviewUrl: v })} wide placeholder="https://" hint="Your page on an independent review site. The review request is only sent while this is set." />
          <Text label="F-gas company certificate: body" value={c.fgasCompanyCert?.body ?? ""} onChange={(v) => sub("fgasCompanyCert", { body: v })} placeholder="e.g. REFCOM" />
          <Text label="F-gas certificate number" value={c.fgasCompanyCert?.number ?? ""} onChange={(v) => sub("fgasCompanyCert", { number: v })} />
          <Text label="F-gas certificate expires" type="date" value={c.fgasCompanyCert?.expiresOn ?? ""} onChange={(v) => sub("fgasCompanyCert", { expiresOn: v })} />
          <div className="hidden sm:block" />
          <Text label="Insurer" value={c.insurance?.provider ?? ""} onChange={(v) => sub("insurance", { provider: v })} />
          <Text label="Policy number" value={c.insurance?.policy ?? ""} onChange={(v) => sub("insurance", { policy: v })} />
          <Text label="Insurance expires" type="date" value={c.insurance?.expiresOn ?? ""} onChange={(v) => sub("insurance", { expiresOn: v })} />
          <div className="hidden sm:block" />
          <Text label="Bank account name" value={c.bank?.accountName ?? ""} onChange={(v) => sub("bank", { accountName: v })} hint="Shown on invoices for bank transfers." />
          <Text label="Sort code" value={c.bank?.sortCode ?? ""} onChange={(v) => sub("bank", { sortCode: v })} placeholder="12-34-56" />
          <Text label="Account number" value={c.bank?.accountNumber ?? ""} onChange={(v) => sub("bank", { accountNumber: v })} placeholder="8 digits" />
        </Group>

        <Group id="tax" title="Tax and VAT" intro="Working summaries, not tax advice: your accountant confirms the code in use.">
          <Toggle label="We're VAT registered" checked={s.tax.vatRegistered} onChange={(v) => patch("tax", { vatRegistered: v })} wide />
          <div>
            <label className="block text-sm font-semibold text-ink-900">
              Default tax code
              <select value={s.tax.defaultTaxCode} onChange={(e) => patch("tax", { defaultTaxCode: e.target.value as TaxCodeId })} className={CONTROL}>
                {(Object.keys(TAX_CODES) as TaxCodeId[]).map((k) => (
                  <option key={k} value={k}>
                    {TAX_CODES[k].label}
                  </option>
                ))}
              </select>
            </label>
            <p className="mt-1 text-xs text-ink-500">{TAX_CODES[s.tax.defaultTaxCode].note}</p>
          </div>
          <Toggle label="Accountant has confirmed this" hint="Until then a VAT-registered proposal needs an admin override to issue." checked={s.tax.accountantConfirmed} onChange={(v) => patch("tax", { accountantConfirmed: v })} />
          <Text label="Rationale" value={s.tax.rationale} onChange={(v) => patch("tax", { rationale: v })} wide area hint="Why this treatment, in a sentence or two. Kept with every proposal." />
        </Group>

        <Group id="pricing" title="Pricing">
          <Text label="Minimum margin (%)" type="number" min={0} max={100} value={s.pricing.minMarginPct} onChange={(v) => patch("pricing", { minMarginPct: Number(v) })} hint="Proposals below it need an admin override." />
          <Text label="Contingency (%)" type="number" min={0} max={100} value={s.pricing.contingencyPct} onChange={(v) => patch("pricing", { contingencyPct: Number(v) })} />
          <Text label="Overhead per job (£)" type="number" min={0} step="0.01" value={pounds(s.pricing.overheadPerJobPence)} onChange={(v) => patch("pricing", { overheadPerJobPence: toPence(v) })} />
          <Text label="Proposal valid for (days)" type="number" min={1} max={365} value={s.pricing.quoteValidityDays} onChange={(v) => patch("pricing", { quoteValidityDays: Number(v) })} />
          <Text label="Premium option uplift (%)" type="number" min={0} max={100} value={s.pricing.premiumUpliftPct} onChange={(v) => patch("pricing", { premiumUpliftPct: Number(v) })} />
          <Toggle label="A technical lead must sign off the design" hint="Keep this on for the pilots." checked={s.pricing.requireEngineerSignoff} onChange={(v) => patch("pricing", { requireEngineerSignoff: v })} />
          <Text label="Installer (£ per day)" type="number" min={0} step="0.01" value={pounds(s.pricing.labourRates.installerDayPence)} onChange={(v) => patch("pricing", { labourRates: { ...s.pricing.labourRates, installerDayPence: toPence(v) } })} />
          <Text label="Electrician (£ per day)" type="number" min={0} step="0.01" value={pounds(s.pricing.labourRates.electricianDayPence)} onChange={(v) => patch("pricing", { labourRates: { ...s.pricing.labourRates, electricianDayPence: toPence(v) } })} />
          <Text label="Technical lead (£ per day)" type="number" min={0} step="0.01" value={pounds(s.pricing.labourRates.techLeadDayPence)} onChange={(v) => patch("pricing", { labourRates: { ...s.pricing.labourRates, techLeadDayPence: toPence(v) } })} />
          <Text label="Surveyor (£ per hour)" type="number" min={0} step="0.01" value={pounds(s.pricing.labourRates.surveyorHourPence)} onChange={(v) => patch("pricing", { labourRates: { ...s.pricing.labourRates, surveyorHourPence: toPence(v) } })} />
        </Group>

        <section id="discounts" aria-labelledby="discounts-h" className="scroll-mt-24 rounded-2xl border border-line bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="discounts-h" className="font-display text-xl text-ink-900">
              Discounts
            </h2>
            <Button variant="secondary" onClick={() => setDiscounts((d) => [...d, { code: `PILOT${d.length + 1}`, label: "Pilot discount", pct: 10, reason: "", active: true }])}>
              Add a discount
            </Button>
          </div>
          <p className="mt-1 text-sm text-ink-500">Always taken off the real list price, and shown to the customer as its own line.</p>
          <ul className="mt-4 space-y-3">
            {s.discounts.map((d, i) => (
              <li key={i} className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-[8rem_1fr_7rem_7rem]">
                <Text label="Code" value={d.code} onChange={(v) => setDiscounts((all) => all.map((x, j) => (j === i ? { ...x, code: v.toUpperCase() } : x)))} />
                <Text label="Label" value={d.label} onChange={(v) => setDiscounts((all) => all.map((x, j) => (j === i ? { ...x, label: v } : x)))} />
                <Text
                  label="Percent"
                  type="number"
                  min={0}
                  max={100}
                  value={d.pct ?? ""}
                  onChange={(v) =>
                    setDiscounts((all) =>
                      all.map((x, j) => {
                        if (j !== i) return x;
                        const { pct: _p, ...rest } = x;
                        return v === "" ? rest : { ...rest, pct: Number(v) };
                      }),
                    )
                  }
                />
                <Text
                  label="Or £ off"
                  type="number"
                  min={0}
                  step="0.01"
                  value={pounds(d.amountPence)}
                  onChange={(v) =>
                    setDiscounts((all) =>
                      all.map((x, j) => {
                        if (j !== i) return x;
                        const { amountPence: _a, ...rest } = x;
                        return v === "" ? rest : { ...rest, amountPence: toPence(v) };
                      }),
                    )
                  }
                />
                <div className="sm:col-span-3">
                  <Text label="Reason" value={d.reason} onChange={(v) => setDiscounts((all) => all.map((x, j) => (j === i ? { ...x, reason: v } : x)))} />
                </div>
                <div className="flex items-end justify-between gap-2 sm:flex-col sm:items-stretch sm:justify-end">
                  <Toggle label="Active" checked={d.active} onChange={(v) => setDiscounts((all) => all.map((x, j) => (j === i ? { ...x, active: v } : x)))} />
                  <button type="button" onClick={() => setDiscounts((all) => all.filter((_, j) => j !== i))} className="min-h-10 rounded-full px-3 text-sm font-semibold text-red-700 hover:bg-red-50">
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <Group id="payments" title="Payments">
          <Text label="Deposit (%)" type="number" min={0} max={100} value={s.payments.depositPct} onChange={(v) => patch("payments", { depositPct: Number(v) })} hint="0 means no deposit. Proposals already issued, and contracts already made, keep the payment terms they went out on." />
          <div>
            <label className="block text-sm font-semibold text-ink-900">
              Deposit due
              <select value={s.payments.depositTiming} onChange={(e) => patch("payments", { depositTiming: e.target.value as PilotSettings["payments"]["depositTiming"] })} className={CONTROL}>
                <option value="on-acceptance">On acceptance (before booking)</option>
                <option value="before-kit-order">Before the kit is ordered</option>
              </select>
            </label>
          </div>
          <Text label="Balance due (days after handover)" type="number" min={0} max={90} value={s.payments.balanceDueDays} onChange={(v) => patch("payments", { balanceDueDays: Number(v) })} />
          <fieldset>
            <legend className="text-sm font-semibold text-ink-900">Ways to pay</legend>
            {(["bank-transfer", "card"] as const).map((m) => (
              <Toggle
                key={m}
                label={m === "card" ? "Card (Stripe)" : "Bank transfer"}
                checked={s.payments.methods.includes(m)}
                onChange={(v) => patch("payments", { methods: v ? [...new Set([...s.payments.methods, m])] : s.payments.methods.filter((x) => x !== m) })}
              />
            ))}
          </fieldset>
          <Text label="Invoice prefix" value={s.payments.invoicePrefix} onChange={(v) => patch("payments", { invoicePrefix: v.toUpperCase() })} maxLength={8} />
          <Text label="Next invoice number" type="number" min={1} value={s.payments.nextInvoiceNumber} onChange={(v) => patch("payments", { nextInvoiceNumber: Number(v) })} hint="Numbers are never reused; only raise this, never lower it." />
        </Group>

        <Group id="scheduling" title="Scheduling">
          <Text label="Install block (days)" type="number" min={1} max={10} value={s.scheduling.installBlockDays} onChange={(v) => patch("scheduling", { installBlockDays: Number(v) })} />
          <Text label="Survey length (minutes)" type="number" min={15} max={480} value={s.scheduling.surveyDurationMinutes} onChange={(v) => patch("scheduling", { surveyDurationMinutes: Number(v) })} />
          <Text label="Survey slot times" value={slots} onChange={(v) => { setDirty(true); setSlots(v); }} hint="London time, comma separated, e.g. 10:00, 13:00, 16:00." />
          <Text label="Survey fee (£)" type="number" min={0} value={s.scheduling.surveyFeeGbp} onChange={(v) => patch("scheduling", { surveyFeeGbp: Math.round(Number(v)) })} hint="0 for free surveys." />
          <Text label="Cancellation period (days)" type="number" min={14} max={60} value={s.scheduling.cancellationDays} onChange={(v) => patch("scheduling", { cancellationDays: Number(v) })} hint="14 is the legal minimum." />
          <Text
            label="We finish within (weeks of acceptance)"
            type="number"
            min={3}
            max={52}
            value={s.scheduling.installWithinWeeks}
            onChange={(v) => patch("scheduling", { installWithinWeeks: Math.round(Number(v)) })}
            hint="The time we promise to finish by (Schedule 2), in every proposal from now on. Allow for the cancellation period and the kit."
          />
          <fieldset className="sm:col-span-2">
            <legend className="text-sm font-semibold text-ink-900">Working days</legend>
            <div className="mt-1 flex flex-wrap gap-x-4">
              {DAYS.map((d, i) => (
                <label key={d} className="flex min-h-11 items-center gap-2 text-base text-ink-900">
                  <input
                    type="checkbox"
                    checked={s.scheduling.workingDays.includes(i + 1)}
                    onChange={(e) =>
                      patch("scheduling", {
                        workingDays: e.currentTarget.checked ? [...new Set([...s.scheduling.workingDays, i + 1])].sort() : s.scheduling.workingDays.filter((x) => x !== i + 1),
                      })
                    }
                    className="h-5 w-5 accent-accent-600"
                  />
                  {d}
                </label>
              ))}
            </div>
          </fieldset>
        </Group>

        <Group id="area" title="Service area" intro="Postcode districts we cover. The website and the New pilot form check against these.">
          <Text label="Outcodes" value={outcodes} onChange={(v) => { setDirty(true); setOutcodes(v); }} wide area hint="Separated by commas or spaces, e.g. SW16, CR0, SE19." />
          <Toggle label="Service-level promises are switched on" hint="Leave off until the credits are worked out in code." checked={s.sla.enabled} onChange={(v) => patch("sla", { enabled: v })} wide />
        </Group>

        <Group id="warranty" title="Warranty" intro="Nothing about warranty years appears anywhere until it's set here.">
          <Text
            label="Workmanship guarantee (years)"
            type="number"
            min={0}
            max={25}
            value={s.warranty.workmanshipYears ?? ""}
            onChange={(v) => patch("warranty", { workmanshipYears: v === "" ? null : Math.round(Number(v)) })}
            hint="0 means none offered; blank means not decided."
          />
          <Text label="Manufacturer warranty summary" value={s.warranty.manufacturerSummary ?? ""} onChange={(v) => patch("warranty", { manufacturerSummary: v })} wide area />
        </Group>

        <Group id="safety" title="Safety" intro="Working at height on outdoor brackets. Hire prices are used only when the catalogue has no priced item; blank means not known, and a proposal that needs it can't go until a price is typed.">
          <Text
            label="Ladder limit to the bracket (m)"
            type="number"
            min={1}
            max={10}
            step="0.1"
            value={s.safety.ladderMaxBracketM}
            onChange={(v) => patch("safety", { ladderMaxBracketM: Number(v) })}
            hint="Above it, the survey won't take a ladder as the access for installing an outdoor unit: a tower, podium, scaffold or MEWP. 2.5 m (first-floor bracket height) by default; applies to surveys started afterwards."
          />
          {(["tower", "podium", "scaffold", "mewp"] as const).map((k) => (
            <Text
              key={k}
              label={`${k === "mewp" ? "MEWP" : k === "podium" ? "Podium steps" : k[0]!.toUpperCase() + k.slice(1)} hire (£ per job, ex VAT)`}
              type="number"
              min={0}
              step="0.01"
              value={s.safety.accessHirePence[k] === null ? "" : pounds(s.safety.accessHirePence[k] ?? undefined)}
              onChange={(v) => patch("safety", { accessHirePence: { ...s.safety.accessHirePence, [k]: v === "" ? null : toPence(v) } })}
            />
          ))}
        </Group>

        <Group id="legal" title="Legal" badge={!s.legal.termsReviewed || !s.legal.cancellationReviewed ? REVIEW : <Badge tone="success">Reviewed</Badge>}>
          <Text label="Terms version" value={s.legal.termsVersion} onChange={(v) => patch("legal", { termsVersion: v })} hint="Recorded on every acceptance." />
          <div className="hidden sm:block" />
          <Toggle label="A solicitor has reviewed the terms" checked={s.legal.termsReviewed} onChange={(v) => patch("legal", { termsReviewed: v })} />
          <Toggle label="A solicitor has reviewed the cancellation wording" checked={s.legal.cancellationReviewed} onChange={(v) => patch("legal", { cancellationReviewed: v })} />
        </Group>

        <Group id="comms" title="Messages">
          <Text label="SMS sender name" value={s.comms.smsSenderId} onChange={(v) => patch("comms", { smsSenderId: v })} maxLength={11} hint="Up to 11 letters or digits. Texts are one-way, so every one gives our phone number." />
          <div className="text-sm text-ink-700">
            <p className="font-semibold text-ink-900">Messages turned off</p>
            <p className="mt-1">{s.comms.disabledEvents.length ? s.comms.disabledEvents.join(", ") : "None."}</p>
            <a href="/ops/messages?tab=templates" className="mt-1 inline-flex min-h-10 items-center font-semibold text-accent-700 underline">
              Turn messages on or off
            </a>
          </div>
        </Group>

        <Group
          id="finance"
          title="Finance"
          badge={financeOffered(s) ? <Badge tone="warn">Shown on quotes</Badge> : <Badge>Off</Badge>}
          intro="A credit promotion is regulated (FSMA s21): finance appears on quotes only once every detail below is filled in, and only in the lender's own words. We never work out an APR or a monthly figure. Have the lender approve the wording before you fill it in."
        >
          <Text label="Lender or broker providing the credit" value={s.finance.firmName ?? ""} onChange={(v) => patch("finance", { firmName: v })} maxLength={120} placeholder="As the FCA register names them" />
          <Text label="Their FCA firm reference number" value={s.finance.frn ?? ""} onChange={(v) => patch("finance", { frn: v.replace(/\s+/g, "") })} maxLength={7} placeholder="6 or 7 digits" />
          <div>
            <label className="block text-sm font-semibold text-ink-900">
              How we may promote it
              <select value={s.finance.arrangement ?? ""} onChange={(e) => patch("finance", { arrangement: (e.target.value || undefined) as FinanceArrangement | undefined })} className={CONTROL}>
                <option value="">Not set</option>
                <option value="authorised">We&apos;re FCA authorised for credit broking</option>
                <option value="appointed-rep">We&apos;re an appointed representative for credit broking</option>
                <option value="s21-approved">An authorised firm approved this promotion (s21)</option>
              </select>
            </label>
          </div>
          <Text
            label={s.finance.arrangement === "s21-approved" ? "Approval reference and date" : s.finance.arrangement === "appointed-rep" ? "Our FCA register reference" : "Our FCA firm reference number"}
            value={s.finance.approvalRef ?? ""}
            onChange={(v) => patch("finance", { approvalRef: v })}
            maxLength={120}
          />
          <Text
            label="Representative example, exactly as the lender supplied it"
            value={s.finance.representativeExample ?? ""}
            onChange={(v) => patch("finance", { representativeExample: v })}
            wide
            area
            maxLength={1500}
            hint="Printed word for word on the quote, with who provides the credit and our status beside it."
          />
        </Group>

        <Group id="other" title="Features">
          <Toggle label="Show the prototype navigation" hint="For demos only." checked={s.features.showPrototypeNav} onChange={(v) => patch("features", { showPrototypeNav: v })} />
        </Group>
      </div>

      <div className="sticky bottom-0 z-20 -mx-4 mt-6 border-t border-line bg-cream/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-700" aria-live="polite">
            {dirty ? "You have unsaved changes." : "Everything's saved."}
          </p>
          <SubmitButton size="lg">Save settings</SubmitButton>
        </div>
      </div>
      {demoReset && <DemoReset />}
    </ActionForm>
  );
}

/** Development and demo deployments only: rebuild the DEMO pilots. */
function DemoReset() {
  const [state, setState] = useState<{ status: "idle" | "busy" | "done" | "error"; message?: string }>({ status: "idle" });
  async function run() {
    if (!window.confirm("Delete and rebuild the DEMO pilots? Real projects aren't touched.")) return;
    setState({ status: "busy" });
    try {
      const res = await fetch("/api/dev/seed", { method: "POST", credentials: "same-origin" });
      const data = (await res.json().catch(() => ({}))) as { error?: string; projects?: unknown[] };
      if (!res.ok) throw new Error(data.error ?? `Refused (${res.status})`);
      setState({ status: "done", message: `Rebuilt ${data.projects?.length ?? 0} DEMO pilots.` });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "That didn't work." });
    }
  }
  return (
    <section className="mt-8 rounded-2xl border border-dashed border-amber-300 bg-amber-50/60 p-5" aria-labelledby="demo-h">
      <h2 id="demo-h" className="font-semibold text-amber-900">
        Demo data
      </h2>
      <p className="mt-1 text-sm text-amber-900">This deployment allows demo sign-in. Reset the five fictional DEMO pilots to their starting state. Real projects are never touched.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={run} busy={state.status === "busy"} busyLabel="Rebuilding…">
          Reset demo data
        </Button>
        <span aria-live="polite" className={`text-sm ${state.status === "error" ? "text-red-700" : "text-amber-900"}`}>
          {state.message}
        </span>
      </div>
    </section>
  );
}
