"use client";

import { useState } from "react";
import type { RoomType, SurveyRoom } from "@aircon/domain";
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

export function RoomsStep({ draft, setSurvey, step, totalSteps, onNext, onBack }: StepProps) {
  const rooms = draft.survey.rooms;
  const [editingId, setEditingId] = useState<string | null>(null);

  function addRoom(type: RoomType) {
    const room = newRoom(type, rooms);
    setSurvey({ rooms: [...rooms, room] });
    setEditingId(room.id);
  }

  function updateRoom(id: string, update: Partial<SurveyRoom>) {
    setSurvey({ rooms: rooms.map((r) => (r.id === id ? { ...r, ...update } : r)) });
  }

  function removeRoom(id: string) {
    setSurvey({ rooms: rooms.filter((r) => r.id !== id) });
    if (editingId === id) setEditingId(null);
  }

  return (
    <StepShell
      step={step}
      totalSteps={totalSteps}
      title="Which rooms should we cool?"
      subtitle="Add every room you'd like a unit in. You can always drop rooms later — the price updates instantly."
      onNext={onNext}
      onBack={onBack}
      nextDisabled={rooms.length === 0}
      nextLabel={rooms.length > 0 ? `Continue with ${rooms.length} room${rooms.length > 1 ? "s" : ""}` : "Add a room first"}
    >
      {rooms.length > 0 && (
        <ul className="space-y-3">
          {rooms.map((room) => (
            <li key={room.id} className="overflow-hidden rounded-2xl border border-line">
              <button
                type="button"
                onClick={() => setEditingId(editingId === room.id ? null : room.id)}
                className="flex w-full items-center justify-between gap-3 bg-white px-4 py-3.5 text-left"
              >
                <span>
                  <span className="block font-semibold">{room.name}</span>
                  <span className="mt-0.5 block text-xs text-ink-300">
                    {ROOM_TYPE_LABEL[room.type]} · {sizeLabel(room.size)} ·{" "}
                    {room.photos.length > 0
                      ? `${room.photos.length} photo${room.photos.length > 1 ? "s" : ""}`
                      : "no photos yet"}
                  </span>
                </span>
                <span className="text-sm font-medium text-air-600">
                  {editingId === room.id ? "Done" : "Edit"}
                </span>
              </button>

              {editingId === room.id && (
                <div className="space-y-5 border-t border-line bg-mist px-4 py-5">
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
                      onChange={(size) => updateRoom(room.id, { size })}
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
                  <Field label="How much window glass?">
                    <OptionCards
                      columns={3}
                      value={room.glazing}
                      onChange={(glazing) => updateRoom(room.id, { glazing })}
                      options={[
                        { value: "low", label: "A little", hint: "One small window" },
                        { value: "medium", label: "Average", hint: "Normal windows" },
                        { value: "high", label: "Lots", hint: "Big / multiple windows" },
                      ]}
                    />
                  </Field>
                  <Field
                    label="Which way do the windows face?"
                    hint="South- and west-facing rooms get more sun, so they need a touch more cooling."
                  >
                    <OptionCards
                      columns={3}
                      value={room.orientation}
                      onChange={(orientation) => updateRoom(room.id, { orientation })}
                      options={[
                        { value: "north", label: "North" },
                        { value: "east", label: "East" },
                        { value: "south", label: "South" },
                        { value: "west", label: "West" },
                        { value: "unsure", label: "Not sure" },
                      ]}
                    />
                  </Field>
                  <Field label="Does the room have an outside wall?">
                    <OptionCards
                      value={room.hasExternalWall}
                      onChange={(hasExternalWall) => updateRoom(room.id, { hasExternalWall })}
                      options={[
                        { value: true, label: "Yes", hint: "Easiest pipe route" },
                        { value: false, label: "No", hint: "We'll route internally" },
                      ]}
                    />
                  </Field>
                  <PhotoInput
                    kind="room"
                    label="Photo of the room — include the wall you'd want the unit on"
                    photos={room.photos}
                    onChange={(photos) => updateRoom(room.id, { photos })}
                  />
                  <button
                    type="button"
                    onClick={() => removeRoom(room.id)}
                    className="text-sm font-medium text-red-600 hover:underline"
                  >
                    Remove this room
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div>
        <span className="mb-2 block text-sm font-semibold text-ink-900">
          {rooms.length === 0 ? "Add your first room" : "Add another room"}
        </span>
        <div className="flex flex-wrap gap-2">
          {ADDABLE_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => addRoom(type)}
              className="rounded-full border border-line bg-white px-4 py-2 text-sm font-medium text-ink-700 transition hover:border-air-400 hover:text-air-700"
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
