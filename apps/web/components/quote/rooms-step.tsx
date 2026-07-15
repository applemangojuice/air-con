"use client";

import { useMemo, useState } from "react";
import {
  generateQuote,
  type ExcludedRoom,
  type OutdoorLocation,
  type RoomType,
  type SurveyRoom,
} from "@aircon/domain";
import { gbp } from "@/lib/format";
import { ROOM_TYPE_LABEL, newRoom } from "@/lib/quote-draft";
import { PhotoInput } from "./photo-input";
import { Field, OptionCards, StepShell, inputCls } from "./ui";
import type { StepProps } from "./steps";

const ADDABLE_TYPES: RoomType[] = [
  "bedroom",
  "living-room",
  "kitchen-diner",
  "home-office",
  "loft-room",
  "conservatory",
  "other",
];

const OUTDOOR_LABEL: Partial<Record<OutdoorLocation, string>> = {
  "ground-rear": "Back wall / garden",
  "ground-side": "Side wall / passage",
};

/**
 * The price-first review screen: rooms were generated from the house answers,
 * the indicative price sits at the top and updates with every toggle.
 */
export function RoomsStep({
  draft,
  setSurvey,
  step,
  totalSteps,
  onNext,
  onBack,
  excluded,
  outdoorOptions,
}: StepProps & { excluded: ExcludedRoom[]; outdoorOptions: OutdoorLocation[] }) {
  const rooms = draft.survey.rooms;
  const [editingId, setEditingId] = useState<string | null>(null);

  const quote = useMemo(
    () => (rooms.length > 0 ? generateQuote(draft.survey) : null),
    [draft.survey, rooms.length],
  );
  const monthly = quote?.finance[quote.finance.length - 1];

  function updateRoom(id: string, update: Partial<SurveyRoom>) {
    setSurvey({ rooms: rooms.map((r) => (r.id === id ? { ...r, ...update } : r)) });
  }

  function removeRoom(id: string) {
    setSurvey({ rooms: rooms.filter((r) => r.id !== id) });
    if (editingId === id) setEditingId(null);
  }

  function addRoom(type: RoomType) {
    const room = newRoom(type, rooms);
    setSurvey({ rooms: [...rooms, room] });
    setEditingId(room.id);
  }

  return (
    <StepShell
      step={step}
      totalSteps={totalSteps}
      title="Your home, your price"
      subtitle="We've laid out your rooms from your answers. Untick any you don't want cooled and the price updates instantly."
      onNext={onNext}
      onBack={onBack}
      nextDisabled={rooms.length === 0}
      nextLabel="Looks right, continue"
    >
      {/* The price, immediately and always visible */}
      <div className="ink-gradient sticky top-2 z-10 rounded-3xl p-5 text-white shadow-lg">
        <p className="text-xs font-semibold uppercase tracking-wide text-white/60">
          Indicative fixed price
        </p>
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <p className="text-4xl font-display">
            {quote ? gbp(quote.totalGbp) : "-"}
          </p>
          {monthly && (
            <p className="text-sm text-white/70">
              or {gbp(monthly.monthlyGbp)}/mo
            </p>
          )}
        </div>
        <p className="mt-1 text-xs text-white/60">
          {rooms.length} room{rooms.length === 1 ? "" : "s"} · installed · VAT included
        </p>
      </div>

      {/* Generated rooms */}
      <ul className="space-y-3">
        {rooms.map((room) => (
          <li key={room.id} className="overflow-hidden rounded-2xl border border-line">
            <div className="flex w-full items-center justify-between gap-3 bg-white px-4 py-3.5">
              <button
                type="button"
                onClick={() => setEditingId(editingId === room.id ? null : room.id)}
                className="flex-1 text-left"
              >
                <span className="block font-semibold">{room.name}</span>
                <span className="mt-0.5 block text-xs text-ink-300">
                  {ROOM_TYPE_LABEL[room.type]} · {sizeLabel(room.size)}
                  {room.areaM2 ? ` · ~${room.areaM2} m²` : ""}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setEditingId(editingId === room.id ? null : room.id)}
                className="text-sm font-medium text-accent-600"
              >
                {editingId === room.id ? "Done" : "Edit"}
              </button>
              <button
                type="button"
                aria-label={`Remove ${room.name}`}
                onClick={() => removeRoom(room.id)}
                className="rounded-full border border-line px-2.5 py-1 text-xs font-medium text-ink-500 hover:bg-surface"
              >
                ✕
              </button>
            </div>

            {editingId === room.id && (
              <div className="space-y-5 border-t border-line bg-surface px-4 py-5">
                <Field label="Room name">
                  <input
                    className={inputCls}
                    value={room.name}
                    onChange={(e) => updateRoom(room.id, { name: e.target.value })}
                  />
                </Field>
                <Field label="How big is it?">
                  <OptionCards
                    value={room.size}
                    onChange={(size) => updateRoom(room.id, { size, areaM2: undefined })}
                    options={[
                      { value: "small", label: "Small", hint: "Box room, up to ~10 m²" },
                      { value: "medium", label: "Medium", hint: "Double bedroom, ~10–16 m²" },
                      { value: "large", label: "Large", hint: "Main living room, ~16–24 m²" },
                      { value: "xl", label: "Very large", hint: "Open plan, 24 m²+" },
                    ]}
                  />
                </Field>
                <Field label="Which floor?">
                  <OptionCards
                    value={room.floor}
                    onChange={(floor) => updateRoom(room.id, { floor })}
                    options={[
                      { value: "ground", label: "Ground floor" },
                      { value: "first", label: "First floor" },
                      { value: "second-plus", label: "Second or higher" },
                      { value: "loft", label: "Loft" },
                    ]}
                  />
                </Field>
                <Field label="How sunny is it?" hint="South- or west-facing rooms with big windows need a touch more cooling.">
                  <OptionCards
                    columns={3}
                    value={room.glazing}
                    onChange={(glazing) => updateRoom(room.id, { glazing })}
                    options={[
                      { value: "low", label: "Shady" },
                      { value: "medium", label: "Average" },
                      { value: "high", label: "Very sunny" },
                    ]}
                  />
                </Field>
                <PhotoInput
                  kind="room"
                  label="Photo of the room (optional, firms up your price)"
                  photos={room.photos}
                  onChange={(photos) => updateRoom(room.id, { photos })}
                />
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* Rooms we can't serve */}
      {excluded.length > 0 && (
        <div className="rounded-2xl border border-line bg-surface p-4">
          <p className="text-sm font-semibold text-ink-700">
            Not included: {excluded.map((e) => e.name).join(", ")}
          </p>
          <p className="mt-1 text-xs text-ink-500">{excluded[0]!.reason}</p>
        </div>
      )}

      {/* Outdoor unit: auto-chosen, ground level only */}
      <Field
        label="Outdoor unit position"
        hint="Chosen for your house type. Ground level only, we don't install on roofs or balconies."
      >
        {outdoorOptions.length > 1 ? (
          <OptionCards
            value={draft.survey.outdoor.location}
            onChange={(location) =>
              setSurvey({ outdoor: { ...draft.survey.outdoor, location } })
            }
            options={outdoorOptions.map((o) => ({
              value: o,
              label: OUTDOOR_LABEL[o] ?? o,
            }))}
          />
        ) : (
          <p className="rounded-2xl border border-line bg-white px-4 py-3 text-sm font-medium">
            {OUTDOOR_LABEL[draft.survey.outdoor.location] ?? "Back wall / garden"}
          </p>
        )}
      </Field>

      {/* Add more */}
      <div>
        <span className="mb-2 block text-sm font-semibold text-ink-900">Add another room</span>
        <div className="flex flex-wrap gap-2">
          {ADDABLE_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => addRoom(type)}
              className="rounded-full border border-line bg-white px-4 py-2 text-sm font-medium text-ink-700 transition hover:border-accent-400 hover:text-accent-700"
            >
              + {ROOM_TYPE_LABEL[type]}
            </button>
          ))}
        </div>
      </div>
    </StepShell>
  );
}

function sizeLabel(size: SurveyRoom["size"]): string {
  return { small: "Small", medium: "Medium", large: "Large", xl: "Very large" }[size];
}
