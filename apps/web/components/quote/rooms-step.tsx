"use client";

import { useMemo, useState } from "react";
import {
  generateQuote,
  permutationForLocation,
  type ExcludedRoom,
  type OutdoorLocation,
  type RoomType,
  type SurveyRoom,
} from "@aircon/domain";
import { gbp } from "@/lib/format";
import { ROOM_TYPE_LABEL, newRoom } from "@/lib/quote-draft";
import { installDurationCopy, vatCopy } from "@/components/site/claims";
import { PhotoInput } from "./photo-input";
import { Group, OptionCards, StepShell, TextField, inputCls } from "./ui";
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
  "ground-rear": "Back wall or garden",
  "ground-side": "Side wall or passage",
};

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

/** Why the outdoor position is fixed online when there's only one option. */
const OUTDOOR_LOCKED_REASON: Record<string, string> = {
  terraced:
    "Terraced homes usually route to the rear. We don't price pipework across the front online, and front walls can need planning permission.",
  flat: "Flats route to the rear only. We don't install on roofs or balconies.",
  default:
    "This is the usual spot for your type of home. Your surveyor agrees the best position with you at the survey.",
};

/**
 * The price-first review screen: rooms were generated from the house answers,
 * and the price sits at the top and updates with every change.
 */
export function RoomsStep({
  draft,
  settings,
  setSurvey,
  onPhotoUploaded,
  step,
  totalSteps,
  onNext,
  onBack,
  excluded,
  outdoorOptions,
}: StepProps & { excluded: ExcludedRoom[]; outdoorOptions: OutdoorLocation[] }) {
  const rooms = draft.survey.rooms;
  const [editingId, setEditingId] = useState<string | null>(null);
  const vat = vatCopy(settings);

  const quote = useMemo(
    () => (rooms.length > 0 ? generateQuote(draft.survey) : null),
    [draft.survey, rooms.length],
  );

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
      subtitle="We've laid out your rooms from your answers. Remove any you don't need and the price updates as you go. The hallway can fend for itself."
      onNext={onNext}
      onBack={onBack}
      nextDisabled={rooms.length === 0}
      nextLabel="Looks right, continue"
    >
      {/* The price, always visible while they edit */}
      <div className="ink-gradient sticky top-2 z-10 rounded-sm p-5 text-white shadow-lg">
        <p className="text-xs font-semibold uppercase tracking-wide text-white/75">Your price</p>
        <p className="mt-1 text-4xl font-display" aria-live="polite" aria-atomic>
          <span className="sr-only">Your price is now </span>
          {quote ? gbp(quote.totalGbp) : "–"}
        </p>
        <p className="mt-1 text-xs text-white/75">
          {rooms.length} room{rooms.length === 1 ? "" : "s"} · heating and cooling · {installDurationCopy(settings).toLowerCase()}
          {vat.short ? ` · ${vat.short}` : ""}
        </p>
        <p className="mt-1 text-xs text-white/75">Confirmed at your home survey.</p>
      </div>

      {/* What we've already filled in, one compact line, changeable */}
      <div className="flex items-center gap-3 rounded-sm border border-line bg-white px-4 py-2.5 text-xs text-ink-700">
        <p className="min-w-0 flex-1">
          <span className="font-semibold text-ink-500">Priced for: </span>
          <span className="font-medium">
            {TYPE_LABEL[draft.survey.property.type] ?? draft.survey.property.type}
            {" · "}
            {ERA_LABEL[draft.survey.property.era] ?? draft.survey.property.era}
            {" · "}
            {draft.survey.property.bedrooms} bed{draft.survey.property.bedrooms === 1 ? "" : "s"}
            {draft.survey.property.floorAreaM2 ? ` · ~${draft.survey.property.floorAreaM2} m²` : ""}
          </span>
          {draft.prefilledFromIntel && <span className="text-ink-500"> (from public records)</span>}
        </p>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="min-h-9 shrink-0 rounded-sm border border-line px-3 font-semibold text-accent-700 transition hover:bg-accent-50"
          >
            Change
          </button>
        )}
      </div>

      {/* Generated rooms */}
      <section aria-label="Rooms">
        <ul className="space-y-3">
          {rooms.map((room) => {
            const open = editingId === room.id;
            const panelId = `room-${room.id}`;
            return (
              <li key={room.id} className="overflow-hidden rounded-sm border border-line">
                <div className="flex w-full items-center justify-between gap-2 bg-white px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{room.name}</span>
                    <span className="mt-0.5 block text-xs text-ink-500">
                      {ROOM_TYPE_LABEL[room.type]} · {sizeLabel(room.size)}
                      {room.areaM2 ? ` · ~${room.areaM2} m²` : ""}
                      {room.photos.length > 0 ? ` · ${room.photos.length} photo${room.photos.length === 1 ? "" : "s"}` : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => setEditingId(open ? null : room.id)}
                    className="min-h-10 rounded-sm px-3 text-sm font-semibold text-accent-700 hover:bg-accent-50"
                  >
                    {open ? "Done" : "Edit"}
                    <span className="sr-only"> {room.name}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${room.name}`}
                    onClick={() => removeRoom(room.id)}
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-line text-sm font-semibold text-ink-700 hover:bg-surface"
                  >
                    <span aria-hidden>✕</span>
                  </button>
                </div>

                {open && (
                  <div id={panelId} className="space-y-5 border-t border-line bg-surface px-4 py-5">
                    <TextField label="Room name">
                      {(c) => (
                        <input
                          {...c}
                          className={inputCls}
                          data-no-submit=""
                          value={room.name}
                          maxLength={60}
                          onChange={(e) => updateRoom(room.id, { name: e.target.value })}
                        />
                      )}
                    </TextField>
                    <Group legend="How big is it?">
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
                    </Group>
                    <Group legend="Which floor?">
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
                    </Group>
                    <Group legend="How sunny is it?" hint="South- or west-facing rooms with big windows need a little more capacity.">
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
                    </Group>
                    <PhotoInput
                      kind="room"
                      label="Photo of the room"
                      hint="Optional. The wall you'd like the unit on helps most."
                      photos={room.photos}
                      onChange={(photos) => updateRoom(room.id, { photos })}
                      onUploaded={onPhotoUploaded}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {rooms.length === 0 && (
          <p className="rounded-sm border border-dashed border-line bg-white px-4 py-6 text-center text-sm text-ink-700">
            No rooms yet. Add the rooms you&apos;d like heated and cooled below.
          </p>
        )}
      </section>

      {/* Rooms we can't serve */}
      {excluded.length > 0 && (
        <div className="rounded-sm border border-line bg-surface p-4">
          <p className="text-sm font-semibold text-ink-700">
            Not included: {excluded.map((e) => e.name).join(", ")}
          </p>
          <p className="mt-1 text-xs text-ink-500">{excluded[0]!.reason}</p>
        </div>
      )}

      {/* Outdoor unit: auto-chosen, ground level only */}
      {outdoorOptions.length > 1 ? (
        <Group
          legend="Where the outdoor unit goes"
          hint="Ground level only: we don't install on roofs or balconies. Your surveyor confirms the spot with you."
        >
          <OptionCards
            value={draft.survey.outdoor.location}
            // The install pattern follows the spot they pick, so its price and checks never describe the other one.
            onChange={(location) =>
              setSurvey({
                outdoor: { ...draft.survey.outdoor, location },
                permutationId: permutationForLocation(draft.survey.archetypeId, location)?.id,
              })
            }
            options={outdoorOptions.map((o) => ({ value: o, label: OUTDOOR_LABEL[o] ?? o }))}
          />
        </Group>
      ) : (
        <LockedOutdoor
          label={OUTDOOR_LABEL[draft.survey.outdoor.location] ?? "Back wall or garden"}
          reason={OUTDOOR_LOCKED_REASON[draft.survey.property.type] ?? OUTDOOR_LOCKED_REASON.default!}
        />
      )}

      {/* Add more */}
      <Group legend="Add another room">
        <div className="flex flex-wrap gap-2">
          {ADDABLE_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => addRoom(type)}
              className="min-h-10 rounded-sm border border-line bg-white px-4 py-2 text-sm font-medium text-ink-700 transition hover:border-accent-500 hover:text-accent-700"
            >
              + {ROOM_TYPE_LABEL[type]}
            </button>
          ))}
        </div>
      </Group>
    </StepShell>
  );
}

function sizeLabel(size: SurveyRoom["size"]): string {
  return { small: "Small", medium: "Medium", large: "Large", xl: "Very large" }[size];
}

/** Single possible outdoor position: show it fixed, explain why on tap. */
function LockedOutdoor({ label, reason }: { label: string; reason: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <p className="mb-1.5 text-sm font-semibold text-ink-900">Where the outdoor unit goes</p>
      <div className="rounded-sm border border-line bg-white px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium">{label}</p>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="min-h-10 shrink-0 text-sm font-semibold text-accent-700 underline-offset-2 hover:underline"
          >
            {open ? "Got it" : "Why this spot?"}
          </button>
        </div>
        {open && <p className="mt-2 text-sm text-ink-700">{reason}</p>}
      </div>
    </div>
  );
}
