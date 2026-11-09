"use client";

import { useMemo } from "react";
import { generateQuote, type ExcludedRoom } from "@aircon/domain";
import { gbp } from "@/lib/format";
import { ROOM_TYPE_LABEL, type QuoteDraft } from "@/lib/quote-draft";
import { installDurationCopy, vatCopy, type PublicSettings } from "@/components/site/claims";
import { secondaryBtn, StepShell } from "./ui";

const TYPE_LABEL: Record<string, string> = {
  detached: "Detached",
  "semi-detached": "Semi-detached",
  terraced: "Terraced",
  flat: "Flat",
  bungalow: "Bungalow",
};

const ERA_LABEL: Record<string, string> = {
  "pre-1930": "before 1930",
  "1930-1950": "1930s–40s",
  "1950-2000": "1950s–90s",
  "2000+": "2000+",
};

const SIZE_LABEL = { small: "Small", medium: "Medium", large: "Large", xl: "Very large" } as const;

/**
 * The instant price: the first thing after the address. Rooms and house
 * details were filled in without a single question, from public records
 * for the address, from the homes around it, or (failing both) a typical
 * home, and the screen says which. Looking costs nothing. Going further,
 * to refine it or save it, is where we ask for an email.
 */
export function PriceStep({
  draft,
  settings,
  step,
  pricing,
  excluded,
  onRefine,
  onSave,
  onChangeAddress,
}: {
  draft: QuoteDraft;
  settings: PublicSettings;
  step: number;
  /** Still working out the prefill: show the shell, not a number. */
  pricing: boolean;
  excluded: ExcludedRoom[];
  onRefine: () => void;
  onSave: () => void;
  onChangeAddress: () => void;
}) {
  const { survey } = draft;
  const rooms = survey.rooms;
  const vat = vatCopy(settings);
  const quote = useMemo(() => (!pricing && rooms.length > 0 ? generateQuote(survey) : null), [survey, rooms.length, pricing]);
  const p = survey.property;
  const where = [survey.addressLine.trim(), survey.postcode].filter(Boolean).join(", ");

  const basis =
    draft.prefillSource === "records"
      ? "From public records for this address."
      : draft.prefillSource === "neighbours"
        ? "Our best guess from the homes around you: we hold no record for this address yet."
        : "A typical home at this postcode: we hold no records here yet.";

  return (
    <StepShell
      step={step}
      title={pricing ? "Working out your price…" : "Here's your price"}
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
          <>
            <button type="button" onClick={onSave} className={`${secondaryBtn} mt-3 w-full`}>
              Looks right, save it
            </button>
            <p className="mt-4 text-sm leading-relaxed text-ink-500">
              Refining takes about two minutes: add or remove rooms, fix the details, add a photo or two. Either way,
              we ask for your email first so your quote is saved as you go.
            </p>
          </>
        )
      }
    >
      {/* The price, or its shell while we look the home up */}
      <div className="ink-gradient rounded-3xl p-5 text-white shadow-lg" aria-busy={pricing || undefined}>
        <p className="text-xs font-semibold uppercase tracking-wide text-white/75">Your price</p>
        <p className="mt-1 text-4xl font-display" aria-live="polite" aria-atomic>
          {pricing ? (
            <span className="inline-block h-9 w-36 animate-pulse rounded-lg bg-white/20 align-middle" aria-label="Working it out" />
          ) : (
            <>
              <span className="sr-only">Your price is </span>
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
          {/* What it rests on, said plainly */}
          <div className="rounded-2xl border border-line bg-white px-4 py-3 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Priced for</p>
            <p className="mt-1 font-medium text-ink-900">
              {TYPE_LABEL[p.type] ?? p.type} · built {ERA_LABEL[p.era] ?? p.era} · {p.bedrooms} bed
              {p.bedrooms === 1 ? "" : "s"}
              {p.floorAreaM2 ? ` · ~${p.floorAreaM2} m²` : ""}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-ink-500">{basis} Anything off? Refine it below.</p>
          </div>

          <section aria-label="Rooms included">
            <p className="mb-1.5 text-sm font-semibold text-ink-900">Rooms included</p>
            <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
              {rooms.map((room) => (
                <li key={room.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="font-medium">{room.name}</span>
                  <span className="text-right text-xs text-ink-500">
                    {ROOM_TYPE_LABEL[room.type]} · {SIZE_LABEL[room.size]}
                  </span>
                </li>
              ))}
            </ul>
            {excluded.length > 0 && (
              <p className="mt-2 text-xs text-ink-500">
                Not included: {excluded.map((e) => e.name).join(", ")}. {excluded[0]!.reason}
              </p>
            )}
          </section>
        </>
      )}
    </StepShell>
  );
}
