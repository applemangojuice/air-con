"use client";

import { useMemo } from "react";
import { generateQuote } from "@aircon/domain";
import { gbp } from "@/lib/format";
import type { QuoteDraft } from "@/lib/quote-draft";
import { installDurationCopy, vatCopy, type PublicSettings } from "@/components/site/claims";
import { HouseFields } from "./steps";
import { secondaryBtn, StepShell } from "./ui";

/**
 * The instant price: the first thing after the address. The house questions
 * were answered for them, from public records for the address, from the
 * homes around it, or (failing both) a typical home, and the screen says
 * which. Under the price sit the same tiles the form uses, locked, with the
 * assumed answer lit up and an Edit button on each: the result and how
 * you'd change it, in one view. Changing anything, or saving, goes through
 * the email gate first.
 */
export function PriceStep({
  draft,
  settings,
  step,
  pricing,
  onEdit,
  onSave,
  onChangeAddress,
}: {
  draft: QuoteDraft;
  settings: PublicSettings;
  step: number;
  /** Still working out the prefill: show the shell, not a number. */
  pricing: boolean;
  onEdit: () => void;
  onSave: () => void;
  onChangeAddress: () => void;
}) {
  const { survey } = draft;
  const rooms = survey.rooms;
  const vat = vatCopy(settings);
  const quote = useMemo(() => (!pricing && rooms.length > 0 ? generateQuote(survey) : null), [survey, rooms.length, pricing]);
  const where = [survey.addressLine.trim(), survey.postcode].filter(Boolean).join(", ");

  const basis =
    draft.prefillSource === "records"
      ? "Filled in from public records for this address."
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
      onNext={pricing ? undefined : onEdit}
      nextLabel="Edit my quote"
      footer={
        pricing ? null : (
          <>
            <button type="button" onClick={onSave} className={`${secondaryBtn} mt-3 w-full`}>
              Looks right, save it
            </button>
            <p className="mt-4 text-sm leading-relaxed text-ink-500">
              Editing takes about two minutes: change any answer above, add or remove rooms, add a photo or two.
              Either way, we ask for your email first so your quote is saved as you go.
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
          <div className="rounded-2xl border border-line bg-white px-4 py-3">
            <p className="text-sm font-semibold text-ink-900">What we&apos;ve assumed about your home</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-500">
              {basis} Each answer below is what your price rests on. Anything off? Press Edit.
            </p>
          </div>

          <HouseFields
            property={survey.property}
            layout={draft.layout}
            onProperty={() => undefined}
            onLayout={() => undefined}
            locked
            onEdit={onEdit}
          />
        </>
      )}
    </StepShell>
  );
}
