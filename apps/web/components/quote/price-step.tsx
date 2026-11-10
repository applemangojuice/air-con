"use client";

import { useId, useMemo } from "react";
import { generateQuote, type ExcludedRoom } from "@aircon/domain";
import { gbp } from "@/lib/format";
import type { QuoteDraft } from "@/lib/quote-draft";
import { allRooms, canAddLivingRoom, roomsPhrase } from "@/lib/room-plan";
import { installDurationCopy, vatCopy, type PublicSettings } from "@/components/site/claims";
import { StepShell } from "./ui";

/**
 * The guide price: the first thing after the address. The home was filled
 * in without a question (public records for the address, the homes around
 * it, or a typical home), so this screen is the price and the two things
 * that drive it: which rooms, and how big the home is. "Priced for 3
 * bedrooms, a kitchen and a living room", each room a chip with an ✕, a +
 * for another bedroom or living room, and the size in 20 m² bands. One
 * button: Refine my quote, which asks for an email and then opens the
 * "Your home" page with everything pre-filled.
 */
export function PriceStep({
  draft,
  settings,
  step,
  pricing,
  excluded,
  onDecline,
  onInclude,
  onAddBedroom,
  onAddLivingRoom,
  onSize,
  onRefine,
  onChangeAddress,
}: {
  draft: QuoteDraft;
  settings: PublicSettings;
  step: number;
  /** Still working out the prefill: show the shell, not a number. */
  pricing: boolean;
  /** Rooms the engine can't serve at a fixed price (no outside wall). */
  excluded: ExcludedRoom[];
  onDecline: (roomId: string) => void;
  onInclude: (roomId: string) => void;
  onAddBedroom: () => void;
  onAddLivingRoom: () => void;
  onSize: (floorAreaM2: number) => void;
  onRefine: () => void;
  onChangeAddress: () => void;
}) {
  const { survey } = draft;
  const rooms = survey.rooms;
  const vat = vatCopy(settings);
  const quote = useMemo(() => (!pricing && rooms.length > 0 ? generateQuote(survey) : null), [survey, rooms.length, pricing]);
  const where = [survey.addressLine.trim(), survey.postcode].filter(Boolean).join(", ");
  const off = allRooms(draft).filter((x) => !x.included).map((x) => x.room);
  const bedroomOff = off.some((r) => r.type === "bedroom");
  const livingOff = off.some((r) => r.type === "living-room");

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
      nextDisabled={rooms.length === 0}
      nextLabel="Refine my quote"
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
            : `Heating and cooling · ${installDurationCopy(settings).toLowerCase()}${vat.short ? ` · ${vat.short}` : ""}`}
        </p>
        <p className="mt-1 text-xs text-white/75">Confirmed at your survey.</p>
      </div>

      {!pricing && (
        <section aria-labelledby="priced-for" data-testid="basics" className="rounded-2xl border border-line bg-white p-4">
          <h2 id="priced-for" className="text-sm font-semibold text-ink-900">
            Priced for {roomsPhrase(rooms)}
          </h2>

          <ul aria-label="Rooms in your price" className="mt-3 flex flex-wrap gap-1.5">
            {rooms.map((room) => (
              <li key={room.id}>
                <span className="inline-flex items-center gap-1 rounded-full bg-accent-50 py-1 pl-3 pr-1 text-xs font-semibold text-accent-700">
                  {room.name}
                  <button
                    type="button"
                    onClick={() => onDecline(room.id)}
                    aria-label={`Leave out ${room.name}`}
                    className="flex h-6 w-6 items-center justify-center rounded-full text-accent-700 transition hover:bg-accent-100"
                  >
                    <span aria-hidden>✕</span>
                  </button>
                </span>
              </li>
            ))}
            {off.map((room) => (
              <li key={room.id}>
                <button
                  type="button"
                  onClick={() => onInclude(room.id)}
                  className="rounded-full border border-dashed border-line px-3 py-1 text-xs font-semibold text-ink-500 transition hover:border-accent-500 hover:text-accent-700"
                >
                  + {room.name}
                </button>
              </li>
            ))}
            {!bedroomOff && draft.survey.property.bedrooms < 6 && (
              <li>
                <button
                  type="button"
                  onClick={onAddBedroom}
                  className="rounded-full border border-dashed border-line px-3 py-1 text-xs font-semibold text-ink-500 transition hover:border-accent-500 hover:text-accent-700"
                >
                  + Bedroom
                </button>
              </li>
            )}
            {!livingOff && canAddLivingRoom(draft) && (
              <li>
                <button
                  type="button"
                  onClick={onAddLivingRoom}
                  className="rounded-full border border-dashed border-line px-3 py-1 text-xs font-semibold text-ink-500 transition hover:border-accent-500 hover:text-accent-700"
                >
                  + Living room
                </button>
              </li>
            )}
          </ul>

          {excluded.length > 0 && (
            <p className="mt-2 text-xs leading-relaxed text-ink-500">
              {excluded.map((e) => e.name).join(", ")} can&apos;t be included: {excluded[0]!.reason.charAt(0).toLowerCase()}
              {excluded[0]!.reason.slice(1)}
            </p>
          )}

          <SizeRow value={survey.property.floorAreaM2} onChange={onSize} />
        </section>
      )}

      {!pricing && (
        <p className="text-xs leading-relaxed text-ink-500">
          A guide, not a final price. Our swift virtual survey, a video walk-round on your phone, lets us refine
          this quote properly before you decide anything.
        </p>
      )}
    </StepShell>
  );
}

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

/** The home's size as a row of pills (native radios: one tab stop, arrow keys). */
function SizeRow({ value, onChange }: { value: number | undefined; onChange: (m2: number) => void }) {
  const name = useId();
  const band = sizeBandFor(value);
  return (
    <fieldset className="mt-4 min-w-0 border-t border-line pt-3">
      <legend className="sr-only">Size of your home</legend>
      <p aria-hidden className="text-xs font-semibold text-ink-700">
        Size of your home, m²
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {SIZE_BANDS.map((b, i) => {
          const selected = i === band;
          return (
            <label
              key={b.label}
              className={`cursor-pointer rounded-full px-2.5 py-1 text-xs font-semibold transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent-500 has-[:focus-visible]:ring-offset-1 ${
                selected ? "bg-accent-700 text-white" : "bg-surface text-ink-700 hover:bg-accent-50 hover:text-accent-700"
              }`}
            >
              <input
                type="radio"
                name={name}
                checked={selected}
                onChange={() => onChange(b.value)}
                data-selected={selected || undefined}
                className="sr-only"
              />
              {b.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
