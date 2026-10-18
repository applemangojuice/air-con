"use client";

import { useState } from "react";
import {
  ROOM_SIZE_BANDS,
  SURVEY_LABELS,
  measuredRoomArea,
  roomSizeForArea,
  roomSizeLabel,
  surveyChecks,
  type MeasuredRoom,
  type RoomType,
} from "@aircon/domain";
import { Callout, ChoiceGroup, FieldCard, NumberField, TextArea, TextField, YesNo, CompassPicker, choices } from "./controls";
import { setOpt, useSurvey, withRoom } from "./context";
import { NextButton } from "./sections";
import { PhotoStrip } from "./photo-strip";

/**
 * Rooms: the list (include or leave out, add one, see what's left in each)
 * and one room at a time, measured properly. The customer's own answers sit
 * beside each question as hints, so the surveyor confirms or corrects.
 */

const round1 = (n: number) => Math.round(n * 10) / 10;

function roomProgress(checks: ReturnType<typeof surveyChecks>, roomId: string) {
  const mine = checks.filter((c) => c.roomId === roomId);
  return { done: mine.filter((c) => c.done).length, total: mine.length };
}

export function RoomsSection() {
  const { data, update, go, completeness } = useSurvey();
  const checks = surveyChecks(data);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<RoomType>("bedroom");
  const noRooms = completeness.missing.some((m) => m.sectionId === "rooms" && !m.roomId);

  const add = () => {
    const taken = new Set(data.rooms.map((r) => r.id));
    let n = data.rooms.length + 1;
    while (taken.has(`room-${n}`)) n++;
    const room: MeasuredRoom = {
      id: `room-${n}`,
      name: name.trim() || SURVEY_LABELS.roomType[type],
      type,
      floor: type === "bedroom" || type === "home-office" ? "first" : type === "loft-room" ? "loft" : "ground",
      include: true,
      glazing: "medium",
      orientation: "unsure",
      hasExternalWall: true,
      condensate: "tbc",
      mediaIds: [],
    };
    update((m) => ({ ...m, rooms: [...m.rooms, room] }));
    setAdding(false);
    setName("");
    go({ s: "rooms", r: room.id });
  };

  return (
    <div className="space-y-4">
      {noRooms && <Callout tone="warn">Include at least one room to survey.</Callout>}
      {data.rooms.length === 0 && !adding && (
        <div className="rounded-2xl border border-dashed border-line bg-white/60 px-5 py-8 text-center">
          <p className="font-semibold text-ink-900">No rooms yet</p>
          <p className="mt-1 text-sm text-ink-500">The customer didn&apos;t list any. Add each room they want a unit in.</p>
        </div>
      )}
      <ul className="space-y-3">
        {data.rooms.map((r) => {
          const p = roomProgress(checks, r.id);
          const done = r.include && p.total > 0 && p.done === p.total;
          return (
            <li key={r.id} className={`rounded-2xl border bg-white ${r.include ? "border-line" : "border-dashed border-line bg-white/60"}`}>
              <button type="button" onClick={() => go({ s: "rooms", r: r.id })} className="flex w-full items-center gap-3 rounded-t-2xl px-4 pt-4 text-left">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-lg font-semibold text-ink-900">{r.name}</span>
                  <span className="block text-sm text-ink-500">
                    {SURVEY_LABELS.roomType[r.type]} · {SURVEY_LABELS.floor[r.floor]}
                    {measuredRoomArea(r) !== undefined ? ` · ${measuredRoomArea(r)} m²` : ""}
                  </span>
                </span>
                {r.include ? (
                  done ? (
                    <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">Done</span>
                  ) : (
                    <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900">
                      {p.total - p.done} to do
                    </span>
                  )
                ) : (
                  <span className="shrink-0 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-ink-700">Left out</span>
                )}
                <span aria-hidden className="text-xl text-ink-500">
                  ›
                </span>
              </button>
              <label className="flex min-h-14 cursor-pointer items-center justify-between gap-3 px-4 pb-2 pt-1">
                <span className="text-sm text-ink-700">Survey this room</span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={r.include}
                  onChange={(e) => update((m) => withRoom(m, r.id, (x) => ({ ...x, include: e.target.checked })))}
                  aria-label={`Survey ${r.name}`}
                  className="h-6 w-11 cursor-pointer appearance-none rounded-full bg-ink-300 transition before:block before:h-5 before:w-5 before:translate-x-0.5 before:rounded-full before:bg-white before:shadow before:transition checked:bg-accent-600 checked:before:translate-x-[1.375rem]"
                />
              </label>
            </li>
          );
        })}
      </ul>

      {adding ? (
        <FieldCard title="Add a room">
          <TextField field="newRoomName" label="Name" placeholder="e.g. Back bedroom" value={name} onChange={setName} maxLength={80} />
          <ChoiceGroup field="newRoomType" legend="Type" value={type} options={choices(SURVEY_LABELS.roomType)} onChange={setType} />
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setAdding(false)} className="min-h-12 rounded-full border border-line bg-white font-semibold text-ink-900">
              Cancel
            </button>
            <button type="button" onClick={add} className="min-h-12 rounded-full bg-accent-600 font-semibold text-white hover:bg-accent-700">
              Add room
            </button>
          </div>
        </FieldCard>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={data.rooms.length >= 30}
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-dashed border-ink-300 bg-white text-base font-semibold text-ink-900 hover:bg-surface disabled:opacity-40"
        >
          <span aria-hidden>+</span> Add a room
        </button>
      )}
      <NextButton from="rooms" />
    </div>
  );
}

export function RoomEditor({ roomId }: { roomId: string }) {
  const { data, update, isMissing, media, queue, addPhotos, detachPhoto, annotate, self, go } = useSurvey();
  const room = data.rooms.find((r) => r.id === roomId);
  const [direct, setDirect] = useState(() => (room ? room.areaM2 !== undefined && room.lengthM === undefined : false));
  if (!room) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-white/60 px-5 py-8 text-center">
        <p className="font-semibold text-ink-900">That room isn&apos;t in this survey</p>
        <button type="button" onClick={() => go({ s: "rooms" })} className="mt-4 min-h-12 rounded-full bg-ink-900 px-5 font-semibold text-white">
          Back to rooms
        </button>
      </div>
    );
  }
  const at = { roomId: room.id };
  const miss = (field: string) => room.include && isMissing("rooms", field, at);
  const set = (fn: (r: MeasuredRoom) => MeasuredRoom) => update((m) => withRoom(m, room.id, fn));
  const self_ = room.selfSurveyRoomId ? self?.rooms.find((r) => r.id === room.selfSurveyRoomId) : undefined;
  const area = measuredRoomArea(room);
  const index = data.rooms.findIndex((r) => r.id === room.id);
  const nextRoom = data.rooms.slice(index + 1).find((r) => r.include);

  /** Length or width changed: the area follows, so the engines read a real number. */
  const setDims = (patch: { lengthM?: number; widthM?: number }, which: "lengthM" | "widthM") =>
    set((r) => {
      let next = setOpt(r, which, patch[which]);
      const a = measuredRoomArea({ lengthM: next.lengthM, widthM: next.widthM });
      next = setOpt(next, "areaM2", a);
      return next;
    });

  return (
    <div className="space-y-4">
      {!room.include && (
        <Callout tone="info">
          This room is left out, so nothing here is required.{" "}
          <button type="button" className="font-semibold underline" onClick={() => set((r) => ({ ...r, include: true }))}>
            Survey it after all
          </button>
        </Callout>
      )}

      <FieldCard>
        <TextField field="roomName" label="Room name" value={room.name} onChange={(v) => set((r) => ({ ...r, name: v.slice(0, 80) }))} maxLength={80} />
        <ChoiceGroup field="roomType" legend="Type" value={room.type} options={choices(SURVEY_LABELS.roomType)} onChange={(type) => set((r) => ({ ...r, type }))} />
        <ChoiceGroup
          field="floor"
          legend="Floor"
          hint={self_ && self_.floor !== room.floor ? `Customer said: ${SURVEY_LABELS.floor[self_.floor].toLowerCase()}.` : undefined}
          value={room.floor}
          options={choices(SURVEY_LABELS.floor)}
          onChange={(floor) => set((r) => ({ ...r, floor }))}
        />
      </FieldCard>

      <FieldCard title="Where the unit goes">
        <PhotoStrip
          legend="Photos of the unit wall"
          hint="Stand back so the whole wall is in. Then tap the photo to draw the unit, the core hole and the pipe route."
          mediaIds={room.mediaIds}
          media={media}
          pending={queue.items.filter((p) => p.target.kind === "room" && p.target.roomId === room.id)}
          tags={["indoor-wall", "room-overview", "pipe-route", "obstruction", "external-wall"]}
          missing={miss("photos")}
          onAdd={(files, tag) => addPhotos(files, tag, { kind: "room", roomId: room.id })}
          onRemove={(id) => detachPhoto(id, { kind: "room", roomId: room.id })}
          onRetry={queue.retry}
          onRemovePending={(id) => void queue.remove(id)}
          onAnnotate={(id) => annotate(id, `${room.name} · ${media[id]?.tag === "indoor-wall" ? "unit wall" : "photo"}`, "indoor-unit")}
        />
        <ChoiceGroup
          field="priority"
          legend="What matters most in this room?"
          value={room.priority}
          options={[
            { value: "quiet", label: "Quiet" },
            { value: "discreet", label: "Discreet" },
            { value: "fast-cooling", label: "Fast cooling" },
            { value: "heating", label: "Heating" },
          ]}
          onChange={(priority) => set((r) => ({ ...r, priority }))}
        />
      </FieldCard>

      <FieldCard title="Size">
        {self_ && (
          <p className="-mt-2 text-sm text-ink-500">
            Customer said: {self_.areaM2 ? `${self_.areaM2} m²` : roomSizeLabel(self_.size).toLowerCase()}.
          </p>
        )}
        {!direct ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <NumberField field="lengthM" label="Length" unit="m" value={room.lengthM} onChange={(v) => setDims({ lengthM: v }, "lengthM")} min={0} max={50} missing={miss("lengthM")} />
              <NumberField field="widthM" label="Width" unit="m" value={room.widthM} onChange={(v) => setDims({ widthM: v }, "widthM")} min={0} max={50} />
            </div>
            <p aria-live="polite" className="text-base text-ink-900">
              {area !== undefined ? (
                <>
                  Floor area <span className="font-semibold tabular-nums">{area} m²</span>
                  <span className="text-ink-500"> · {ROOM_SIZE_BANDS[roomSizeForArea(area)].label.toLowerCase()}</span>
                </>
              ) : (
                <span className="text-ink-500">Enter both to work out the floor area.</span>
              )}
            </p>
            <button
              type="button"
              className="min-h-11 text-sm font-semibold text-accent-700 underline underline-offset-2"
              onClick={() => {
                setDirect(true);
                set((r) => setOpt(setOpt(r, "lengthM", undefined), "widthM", undefined));
              }}
            >
              Odd shape? Enter the area instead
            </button>
          </>
        ) : (
          <>
            <NumberField
              field="lengthM"
              label="Floor area"
              hint="For L-shaped or odd rooms: add up the rectangles."
              unit="m²"
              value={room.areaM2}
              onChange={(v) => set((r) => setOpt(r, "areaM2", v === undefined ? undefined : round1(v)))}
              min={0}
              max={500}
              missing={miss("lengthM")}
            />
            <button type="button" className="min-h-11 text-sm font-semibold text-accent-700 underline underline-offset-2" onClick={() => setDirect(false)}>
              Measure length × width instead
            </button>
          </>
        )}
        <NumberField
          field="ceilingHeightM"
          label="Ceiling height"
          unit="m"
          value={room.ceilingHeightM}
          onChange={(v) => set((r) => setOpt(r, "ceilingHeightM", v))}
          min={0}
          max={10}
          suggestions={[2.3, 2.4, 2.5, 2.7]}
          missing={miss("ceilingHeightM")}
        />
      </FieldCard>

      <FieldCard title="Windows and sun">
        <ChoiceGroup field="glazing" legend="How much glass?" value={room.glazing} options={choices(SURVEY_LABELS.glazing)} onChange={(glazing) => set((r) => ({ ...r, glazing }))} columns={3} />
        <CompassPicker value={room.orientation} onChange={(orientation) => set((r) => ({ ...r, orientation }))} missing={miss("orientation")} />
        <ChoiceGroup
          field="occupancy"
          legend="How busy is the room?"
          value={room.occupancy}
          options={[
            { value: "low", label: "Quiet" },
            { value: "normal", label: "Normal" },
            { value: "high", label: "Busy" },
          ]}
          onChange={(occupancy) => set((r) => ({ ...r, occupancy }))}
          columns={3}
        />
        <TextField
          field="gainsNote"
          label="Heat from anything else?"
          placeholder="e.g. gaming PC, roof light, kitchen appliances"
          value={room.gainsNote}
          onChange={(v) => set((r) => setOpt(r, "gainsNote", v))}
          maxLength={500}
        />
      </FieldCard>

      <FieldCard title="Walls">
        <YesNo
          field="hasExternalWall"
          legend="Does the room have an outside wall?"
          hint={self_ && self_.hasExternalWall !== room.hasExternalWall ? `Customer said: ${self_.hasExternalWall ? "yes" : "no"}.` : undefined}
          value={room.hasExternalWall}
          onChange={(hasExternalWall) => set((r) => ({ ...r, hasExternalWall }))}
        />
        <ChoiceGroup
          field="roomWall"
          legend="Wall the unit fixes to"
          value={room.wallConstruction}
          options={choices(SURVEY_LABELS.wallConstruction)}
          onChange={(wallConstruction) => set((r) => ({ ...r, wallConstruction }))}
        />
      </FieldCard>

      <FieldCard title="Pipes to the outdoor unit">
        <NumberField
          field="pipeRunM"
          label="Pipe run"
          hint="From the indoor unit to the outdoor unit, along the route. Your measurement."
          unit="m"
          value={room.pipeRunM}
          onChange={(v) => set((r) => setOpt(r, "pipeRunM", v))}
          min={0}
          max={100}
          missing={miss("pipeRunM")}
        />
        <NumberField
          field="heightDropM"
          label="Height difference"
          hint="Indoor unit above the outdoor unit. Use a minus if the outdoor unit is higher (e.g. -2)."
          unit="m"
          value={room.heightDropM}
          onChange={(v) => set((r) => setOpt(r, "heightDropM", v))}
          min={-30}
          max={30}
          allowNegative
          suggestions={[0, 2.5, 5]}
          missing={miss("heightDropM")}
        />
        <ChoiceGroup
          field="route"
          legend="Route"
          value={room.route}
          options={choices(SURVEY_LABELS.route)}
          onChange={(route) => set((r) => ({ ...r, route }))}
          columns={1}
          missing={miss("route")}
        />
        {!room.hasExternalWall && room.route === "through-wall" && (
          <Callout tone="warn">No outside wall, so the pipes can&apos;t go straight through. Pick the real route.</Callout>
        )}
        <TextArea field="routeNote" label="Route notes" placeholder="e.g. up through the airing cupboard into the loft" value={room.routeNote} onChange={(v) => set((r) => setOpt(r, "routeNote", v))} rows={2} />
      </FieldCard>

      <FieldCard title="Condensate">
        <ChoiceGroup
          field="condensate"
          legend="How will the condensate drain?"
          hint="Gravity needs a steady fall to an outside wall or a drain. Otherwise a small pump."
          value={room.condensate === "tbc" ? undefined : room.condensate}
          options={[
            { value: "gravity", label: "Gravity" },
            { value: "pump", label: "Pump" },
          ]}
          onChange={(condensate) => set((r) => ({ ...r, condensate }))}
          missing={miss("condensate")}
        />
        <TextField field="condensateNote" label="Where it drains" placeholder="e.g. to the rainwater gully below" value={room.condensateNote} onChange={(v) => set((r) => setOpt(r, "condensateNote", v))} maxLength={500} />
      </FieldCard>

      <FieldCard>
        <TextArea field="obstacles" label="Obstacles" placeholder="e.g. curtain pole, radiator under the window, wardrobe" value={room.obstacles} onChange={(v) => set((r) => setOpt(r, "obstacles", v))} rows={2} />
      </FieldCard>

      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        {nextRoom ? (
          <button
            type="button"
            onClick={() => go({ s: "rooms", r: nextRoom.id })}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-accent-600 px-6 text-base font-semibold text-white shadow-sm hover:bg-accent-700 sm:w-auto"
          >
            Next room: {nextRoom.name} <span aria-hidden>→</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => go({ s: "outdoor" })}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-accent-600 px-6 text-base font-semibold text-white shadow-sm hover:bg-accent-700 sm:w-auto"
          >
            Next: Outdoor <span aria-hidden>→</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => go({ s: "rooms" })}
          className="inline-flex min-h-12 w-full items-center justify-center rounded-full border border-line bg-white px-6 text-base font-semibold text-ink-900 hover:bg-surface sm:w-auto"
        >
          All rooms
        </button>
      </div>
    </div>
  );
}
