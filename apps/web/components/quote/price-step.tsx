"use client";

import { useMemo, type ReactNode } from "react";
import { generateQuote } from "@aircon/domain";
import { gbp } from "@/lib/format";
import type { QuoteDraft } from "@/lib/quote-draft";
import { installDurationCopy, vatCopy, type PublicSettings } from "@/components/site/claims";
import { TYPE_OPTIONS } from "./steps";
import { secondaryBtn, StepShell } from "./ui";

/**
 * The instant price: the first thing after the address. The house questions
 * were answered for them, from public records for the address, from the
 * homes around it, or (failing both) a typical home, and the screen says
 * which. Under the price, one small card shows the answers it rests on
 * (home type, bedrooms, bathrooms, size) as pills with the assumed one lit,
 * and one Edit button. Era and layout are prefilled too but live only on
 * the full form: the survey confirms them, and they'd crowd the card.
 * Changing anything, or saving, goes through the email gate first.
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

      {!pricing && <AssumptionsCard property={survey.property} basis={basis} onEdit={onEdit} />}
    </StepShell>
  );
}

/** 1, 2, 3, 4+: the compact count row. */
const COUNTS = [1, 2, 3, 4] as const;

/**
 * What the price rests on, in one small card: a row of pills per question
 * with the assumed answer lit. Nothing here is interactive except Edit;
 * the pills are the summary, and the form (after the email gate) is where
 * answers change.
 */
function AssumptionsCard({
  property: p,
  basis,
  onEdit,
}: {
  property: QuoteDraft["survey"]["property"];
  basis: string;
  onEdit: () => void;
}) {
  const count = (n: number | undefined, fallback: number) => Math.min(4, Math.max(1, n ?? fallback));
  return (
    <section aria-labelledby="assumptions" data-testid="assumptions" className="rounded-2xl border border-line bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="assumptions" className="text-sm font-semibold text-ink-900">
          Priced for
        </h2>
        <button
          type="button"
          onClick={onEdit}
          className="min-h-8 shrink-0 rounded-full border border-line bg-white px-3 text-xs font-semibold text-accent-700 transition hover:bg-accent-50"
        >
          Edit
        </button>
      </div>
      <dl className="mt-2 space-y-2">
        <Row label="Home">
          {TYPE_OPTIONS.map((o) => (
            <Pill key={o.value} selected={o.value === p.type}>
              {o.label === "Semi-detached" ? "Semi" : o.label}
            </Pill>
          ))}
        </Row>
        <Row label="Bedrooms">
          {COUNTS.map((n) => (
            <Pill key={n} selected={count(p.bedrooms, 3) === n}>
              {n === 4 ? "4+" : n}
            </Pill>
          ))}
        </Row>
        <Row label="Bathrooms">
          {COUNTS.map((n) => (
            <Pill key={n} selected={count(p.bathrooms, 1) === n}>
              {n === 4 ? "4+" : n}
            </Pill>
          ))}
        </Row>
        <Row label="Size">
          {p.floorAreaM2 ? (
            <Pill selected>about {p.floorAreaM2} m²</Pill>
          ) : (
            <span className="text-xs text-ink-500">not known, so a typical size</span>
          )}
        </Row>
      </dl>
      <p className="mt-2.5 text-xs leading-relaxed text-ink-500">{basis}</p>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <dt className="w-[4.5rem] shrink-0 text-xs text-ink-500">{label}</dt>
      <dd className="flex min-w-0 flex-wrap gap-1">{children}</dd>
    </div>
  );
}

function Pill({ selected = false, children }: { selected?: boolean; children: ReactNode }) {
  return (
    <span
      data-selected={selected || undefined}
      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${selected ? "bg-accent-700 text-white" : "bg-surface text-ink-500"}`}
    >
      {children}
    </span>
  );
}
