"use client";

import { useId, useMemo } from "react";
import { generateQuote, type Survey } from "@aircon/domain";
import { gbp } from "@/lib/format";
import type { QuoteDraft } from "@/lib/quote-draft";
import { installDurationCopy, vatCopy, type PublicSettings } from "@/components/site/claims";
import { TYPE_OPTIONS } from "./steps";
import { StepShell } from "./ui";

type Property = Survey["property"];

/**
 * The guide price: the first thing after the address. The home was filled
 * in without a question, from public records for the address, from the
 * homes around it, or (failing both) a typical home, and the screen says
 * which. Under the price, one small card holds the four basics the guide
 * rests on (home type, bedrooms, bathrooms, size in 20 m² bands) as pills
 * they can tap, and the price follows. Era and layout are prefilled too but
 * live only on the full form. One button: Refine my quote, which asks for
 * an email and then opens that form with everything pre-populated.
 */
export function PriceStep({
  draft,
  settings,
  step,
  pricing,
  onAdjust,
  onRefine,
  onChangeAddress,
}: {
  draft: QuoteDraft;
  settings: PublicSettings;
  step: number;
  /** Still working out the prefill: show the shell, not a number. */
  pricing: boolean;
  /** A basic changed on the card: re-lay the rooms and re-price. */
  onAdjust: (update: Partial<Property>) => void;
  onRefine: () => void;
  onChangeAddress: () => void;
}) {
  const { survey } = draft;
  const rooms = survey.rooms;
  const vat = vatCopy(settings);
  const quote = useMemo(() => (!pricing && rooms.length > 0 ? generateQuote(survey) : null), [survey, rooms.length, pricing]);
  const where = [survey.addressLine.trim(), survey.postcode].filter(Boolean).join(", ");

  const basis =
    draft.prefillSource === "records"
      ? "We started from public records for this address."
      : draft.prefillSource === "neighbours"
        ? "We started from the homes around you: we hold no record for this address yet."
        : "We started from a typical home: we hold no records at this postcode yet.";

  return (
    <StepShell
      step={step}
      title={pricing ? "Working out your guide price…" : "Your guide price"}
      subtitle={
        <>
          For {where}.{" "}
          <button
            type="button"
            onClick={onChangeAddress}
            className="font-semibold text-accent-700 underline-offset-2 hover:underline"
          >
            Not your address?
          </button>
        </>
      }
      onNext={pricing ? undefined : onRefine}
      nextLabel="Refine my quote"
      footer={
        pricing ? null : (
          <p className="mt-4 text-xs leading-relaxed text-ink-500">
            Refining takes about two minutes: your home room by room, with what we know already filled in. We ask
            for your email first, so your quote is saved as you go.
          </p>
        )
      }
    >
      {/* The guide price, or its shell while we look the home up */}
      <div className="ink-gradient rounded-3xl p-5 text-white shadow-lg" aria-busy={pricing || undefined}>
        <p className="text-xs font-semibold uppercase tracking-wide text-white/75">Guide price</p>
        <p className="mt-1 text-4xl font-display" aria-live="polite" aria-atomic>
          {pricing ? (
            <span className="inline-block h-9 w-36 animate-pulse rounded-lg bg-white/20 align-middle" aria-label="Working it out" />
          ) : (
            <>
              <span className="sr-only">Your guide price is </span>
              {quote ? gbp(quote.totalGbp) : "–"}
            </>
          )}
        </p>
        <p className="mt-1 text-xs text-white/75">
          {pricing
            ? "Looking your home up…"
            : `${rooms.length} room${rooms.length === 1 ? "" : "s"} · heating and cooling · ${installDurationCopy(settings).toLowerCase()}${vat.short ? ` · ${vat.short}` : ""}`}
        </p>
        <p className="mt-1 text-xs text-white/75">Confirmed at your survey.</p>
      </div>

      {!pricing && (
        <>
          <BasicsCard property={survey.property} onAdjust={onAdjust} basis={basis} />

          {/* Discreet, and the honest version of "fixed": the survey refines it. */}
          <p className="text-xs leading-relaxed text-ink-500">
            A guide, not a final price. Our swift virtual survey, a video walk-round on your phone, lets us refine
            this quote properly before you decide anything.
          </p>
        </>
      )}
    </StepShell>
  );
}

/* ------------------------------------------------------------------ */
/* The basics card                                                     */
/* ------------------------------------------------------------------ */

const COUNTS = [1, 2, 3, 4] as const;

/** Floor area in 20 m² bands; picking one sets the band's middle. */
const SIZE_BANDS: { label: string; min: number; max: number; value: number }[] = [
  { label: "under 60", min: 0, max: 60, value: 50 },
  { label: "60–80", min: 60, max: 80, value: 70 },
  { label: "80–100", min: 80, max: 100, value: 90 },
  { label: "100–120", min: 100, max: 120, value: 110 },
  { label: "120–140", min: 120, max: 140, value: 130 },
  { label: "140+", min: 140, max: Infinity, value: 150 },
];

/** Which band an area falls in, if we know it. */
export function sizeBandFor(areaM2: number | undefined): number | undefined {
  if (!areaM2) return undefined;
  const i = SIZE_BANDS.findIndex((b) => areaM2 >= b.min && areaM2 < b.max);
  return i === -1 ? undefined : i;
}

/**
 * The four basics the guide price rests on, each a row of pills: tap one
 * and the price follows. Everything else about the home (era, layout, the
 * rooms themselves) waits for the full form after the email gate.
 */
function BasicsCard({
  property: p,
  onAdjust,
  basis,
}: {
  property: Property;
  onAdjust: (update: Partial<Property>) => void;
  basis: string;
}) {
  const beds = Math.min(4, Math.max(1, p.bedrooms));
  const baths = Math.min(4, Math.max(1, p.bathrooms ?? 1));
  const band = sizeBandFor(p.floorAreaM2);
  return (
    <section aria-labelledby="basics" data-testid="basics" className="rounded-2xl border border-line bg-white p-3">
      <h2 id="basics" className="text-sm font-semibold text-ink-900">
        Priced for
      </h2>
      <p className="mt-0.5 text-xs text-ink-500">Tap to adjust: the guide price updates.</p>
      <div className="mt-2.5 space-y-2.5">
        <PillRow
          legend="Home"
          options={TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label === "Semi-detached" ? "Semi" : o.label }))}
          value={p.type}
          onChange={(type) => onAdjust({ type })}
        />
        <PillRow
          legend="Bedrooms"
          options={COUNTS.map((n) => ({ value: n, label: n === 4 ? "4+" : String(n) }))}
          value={beds}
          // 4+ keeps a larger count we already hold (six bedrooms from the records stay six).
          onChange={(n) => onAdjust({ bedrooms: n === 4 && p.bedrooms > 4 ? p.bedrooms : n })}
        />
        <PillRow
          legend="Bathrooms"
          options={COUNTS.map((n) => ({ value: n, label: n === 4 ? "4+" : String(n) }))}
          value={baths}
          onChange={(n) => onAdjust({ bathrooms: n === 4 && (p.bathrooms ?? 1) > 4 ? p.bathrooms : n })}
        />
        <PillRow
          legend="Size, m²"
          options={SIZE_BANDS.map((b, i) => ({ value: i, label: b.label }))}
          value={band}
          onChange={(i) => onAdjust({ floorAreaM2: SIZE_BANDS[i]!.value })}
        />
      </div>
      <p className="mt-2.5 text-xs leading-relaxed text-ink-500">{basis}</p>
    </section>
  );
}

/** A row of pills as native radios: one tab stop, arrow keys, announced as "2 of 4". */
function PillRow<T extends string | number>({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: { value: T; label: string }[];
  value: T | undefined;
  onChange: (value: T) => void;
}) {
  const name = useId();
  return (
    <fieldset className="flex min-w-0 items-start gap-2">
      <legend className="sr-only">{legend}</legend>
      <span aria-hidden className="w-[4.5rem] shrink-0 pt-1 text-xs text-ink-500">
        {legend}
      </span>
      <div className="flex min-w-0 flex-wrap gap-1">
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <label
              key={String(o.value)}
              className={`cursor-pointer rounded-full px-2.5 py-1 text-xs font-semibold transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent-500 has-[:focus-visible]:ring-offset-1 ${
                selected ? "bg-accent-700 text-white" : "bg-surface text-ink-700 hover:bg-accent-50 hover:text-accent-700"
              }`}
            >
              <input
                type="radio"
                name={name}
                checked={selected}
                onChange={() => onChange(o.value)}
                data-selected={selected || undefined}
                className="sr-only"
              />
              {o.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

