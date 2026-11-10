"use client";

import { useId, useMemo, useState } from "react";
import {
  generateQuote,
  permutationForLocation,
  type ExcludedRoom,
  type KitchenLivingLayout,
  type OutdoorLocation,
  type RoomType,
  type Survey,
  type SurveyRoom,
} from "@aircon/domain";
import { gbp } from "@/lib/format";
import { ROOM_TYPE_LABEL, type Contact, type QuoteDraft } from "@/lib/quote-draft";
import { allRooms } from "@/lib/room-plan";
import { installDurationCopy, vatCopy, type PublicSettings } from "@/components/site/claims";
import { LAYOUT_OPTIONS } from "./steps";
import { Group, NumberRow, OptionCards, StepShell, TextField, inputCls } from "./ui";

const ADDABLE_TYPES: RoomType[] = ["bedroom", "living-room", "kitchen-diner", "home-office", "loft-room", "conservatory", "other"];

const OUTDOOR_LABEL: Partial<Record<OutdoorLocation, string>> = {
  "ground-rear": "Back wall or garden",
  "ground-side": "Side wall or passage",
};

/** Why the outdoor position is fixed online when there's only one option. */
const OUTDOOR_LOCKED_REASON: Record<string, string> = {
  terraced:
    "Terraced homes usually route to the rear. We don't price pipework across the front online, and front walls can need planning permission.",
  flat: "Flats route to the rear only. We don't install on roofs or balconies.",
  default: "This is the usual spot for your type of home. Your surveyor agrees the best position with you at the survey.",
};

const SIZE_LABEL: Record<SurveyRoom["size"], string> = { small: "Small", medium: "Medium", large: "Large", xl: "Very large" };

/**
 * "Your home": the whole refine form on one page, after the email gate.
 * At the top, the rooms to air-condition, ticked as we laid them out (untick
 * one and it leaves the price), with the rooms we can't do right under
 * them. Then the few answers that shape the rooms (bedrooms, kitchen and
 * living rooms, size, where the outdoor unit goes) and the two we need
 * before a survey (do you own it, when). Everything else, from the build
 * era to the fuse board, is prefilled or left to the survey.
 *
 * "Next: confirm your price" saves the quote and opens its page, where the
 * virtual survey is booked. The quote has been saved as they go since the
 * email gate, so nothing here is a "save" step.
 */
export function HomeStep({
  draft,
  settings,
  step,
  busy,
  saveError,
  excluded,
  outdoorOptions,
  setSurvey,
  setContact,
  onRooms,
  onProperty,
  onLayout,
  onToggleRoom,
  onAddRoom,
  onNext,
  onBack,
}: {
  draft: QuoteDraft;
  settings: PublicSettings;
  step: number;
  busy: boolean;
  saveError: string | null;
  excluded: ExcludedRoom[];
  outdoorOptions: OutdoorLocation[];
  setSurvey: (update: Partial<Survey>) => void;
  setContact: (update: Partial<Contact>) => void;
  /** Edit the included rooms in place (a room's size, floor, name). */
  onRooms: (rooms: SurveyRoom[]) => void;
  /** A house answer that re-lays the rooms (bedrooms, size). */
  onProperty: (update: Partial<Survey["property"]>) => void;
  onLayout: (layout: KitchenLivingLayout) => void;
  onToggleRoom: (roomId: string, include: boolean) => void;
  onAddRoom: (type: RoomType) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const { survey } = draft;
  const p = survey.property;
  const [editingId, setEditingId] = useState<string | null>(null);
  const vat = vatCopy(settings);
  const quote = useMemo(() => (survey.rooms.length > 0 ? generateQuote(survey) : null), [survey]);
  const list = allRooms(draft);

  const updateRoom = (id: string, update: Partial<SurveyRoom>) =>
    onRooms(survey.rooms.map((r) => (r.id === id ? { ...r, ...update } : r)));

  return (
    <StepShell
      step={step}
      title="Your home"
      subtitle="We've filled in what we know. Untick any room you'd rather leave out, and put right anything that's off."
      onNext={onNext}
      onBack={onBack}
      nextDisabled={survey.rooms.length === 0}
      busy={busy}
      busyLabel="Saving your quote…"
      nextLabel="Next: confirm your price"
      footer={
        saveError ? (
          <p role="alert" className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {saveError}
          </p>
        ) : null
      }
    >
      {/* The price, always in view while they change things */}
      <div className="ink-gradient sticky top-2 z-10 rounded-3xl p-5 text-white shadow-lg">
        <p className="text-xs font-semibold uppercase tracking-wide text-white/75">Guide price</p>
        <p className="mt-1 text-4xl font-display" aria-live="polite" aria-atomic>
          <span className="sr-only">Your guide price is now </span>
          {quote ? gbp(quote.totalGbp) : "–"}
        </p>
        <p className="mt-1 text-xs text-white/75">
          {survey.rooms.length} room{survey.rooms.length === 1 ? "" : "s"} · heating and cooling ·{" "}
          {installDurationCopy(settings).toLowerCase()}
          {vat.short ? ` · ${vat.short}` : ""}
        </p>
        <p className="mt-1 text-xs text-white/75">Confirmed at your survey.</p>
      </div>

      {/* Rooms to air-condition, with what we can't do right under them */}
      <section aria-labelledby="rooms-heading" data-testid="rooms">
        <h2 id="rooms-heading" className="text-sm font-semibold text-ink-900">
          Rooms to air-condition
        </h2>
        <ul className="mt-2 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
          {list.map(({ room, included }) => (
            <RoomRow
              key={room.id}
              room={room}
              included={included}
              open={included && editingId === room.id}
              onToggle={(on) => {
                if (!on && editingId === room.id) setEditingId(null);
                onToggleRoom(room.id, on);
              }}
              onEdit={() => setEditingId(editingId === room.id ? null : room.id)}
              onChange={(update) => updateRoom(room.id, update)}
            />
          ))}
        </ul>
        {excluded.length > 0 && (
          <div className="mt-2 rounded-2xl border border-line bg-surface px-4 py-3">
            <p className="text-sm font-semibold text-ink-700">Not included: {excluded.map((e) => e.name).join(", ")}</p>
            <p className="mt-0.5 text-xs text-ink-500">{excluded[0]!.reason}</p>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Add another room">
          {ADDABLE_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => onAddRoom(type)}
              className="min-h-9 rounded-full border border-dashed border-line bg-white px-3 text-xs font-semibold text-ink-700 transition hover:border-accent-500 hover:text-accent-700"
            >
              + {ROOM_TYPE_LABEL[type]}
            </button>
          ))}
        </div>
      </section>

      <Group legend="Bedrooms, studies and offices">
        <NumberRow value={p.bedrooms} onChange={(bedrooms) => onProperty({ bedrooms })} max={6} maxLabel="6+" />
      </Group>

      <Group legend="Kitchen and living rooms">
        <OptionCards<KitchenLivingLayout> value={draft.layout} onChange={onLayout} options={LAYOUT_OPTIONS} />
      </Group>

      <TextField label="Rough size of your home" optional hint="In square metres. We split it across your rooms.">
        {(c) => (
          <div className="flex items-center gap-2">
            <input
              {...c}
              className={inputCls}
              type="number"
              inputMode="numeric"
              min={30}
              max={1000}
              placeholder="e.g. 95"
              value={p.floorAreaM2 ?? ""}
              onChange={(e) => {
                const n = Number(e.target.value);
                onProperty({ floorAreaM2: e.target.value && Number.isFinite(n) && n >= 10 && n <= 2000 ? n : undefined });
              }}
            />
            <span className="shrink-0 text-sm font-medium text-ink-500" aria-hidden>
              m²
            </span>
          </div>
        )}
      </TextField>

      {outdoorOptions.length > 1 ? (
        <Group legend="Where the outdoor unit goes" hint="Ground level only. Your surveyor confirms the spot with you.">
          <OptionCards
            value={survey.outdoor.location}
            // The install pattern follows the spot they pick, so its price and checks never describe the other one.
            onChange={(location) =>
              setSurvey({
                outdoor: { ...survey.outdoor, location },
                permutationId: permutationForLocation(survey.archetypeId, location)?.id,
              })
            }
            options={outdoorOptions.map((o) => ({ value: o, label: OUTDOOR_LABEL[o] ?? o }))}
          />
        </Group>
      ) : (
        <LockedOutdoor
          label={OUTDOOR_LABEL[survey.outdoor.location] ?? "Back wall or garden"}
          reason={OUTDOOR_LOCKED_REASON[p.type] ?? OUTDOOR_LOCKED_REASON.default!}
        />
      )}

      <Group legend="Do you own the home?">
        <OptionCards
          value={p.ownership}
          onChange={(ownership) => setSurvey({ property: { ...p, ownership } })}
          options={[
            { value: "owner", label: "Yes, I own it" },
            { value: "renting", label: "No, I rent", hint: "You'll need your landlord's written consent" },
          ]}
        />
      </Group>

      <Group legend="When are you hoping to install?">
        <OptionCards
          columns={3}
          value={draft.contact.timeframe}
          onChange={(timeframe) => setContact({ timeframe })}
          options={[
            { value: "asap", label: "As soon as I can" },
            { value: "1-3-months", label: "In 1–3 months" },
            { value: "researching", label: "Just researching" },
          ]}
        />
      </Group>
    </StepShell>
  );
}

/** One room on the list: a tick to include it, its details, and Edit when it's in. */
function RoomRow({
  room,
  included,
  open,
  onToggle,
  onEdit,
  onChange,
}: {
  room: SurveyRoom;
  included: boolean;
  open: boolean;
  onToggle: (include: boolean) => void;
  onEdit: () => void;
  onChange: (update: Partial<SurveyRoom>) => void;
}) {
  const id = useId();
  return (
    <li>
      <div className="flex items-center gap-3 px-4 py-3">
        <input
          id={id}
          type="checkbox"
          checked={included}
          onChange={(e) => onToggle(e.target.checked)}
          className="h-5 w-5 shrink-0 accent-accent-700"
        />
        <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
          <span className={`block truncate text-sm font-semibold ${included ? "text-ink-900" : "text-ink-500 line-through"}`}>
            {room.name}
          </span>
          <span className="mt-0.5 block text-xs text-ink-500">
            {included
              ? `${ROOM_TYPE_LABEL[room.type]} · ${SIZE_LABEL[room.size]}${room.areaM2 ? ` · ~${room.areaM2} m²` : ""}`
              : "Left out of your price"}
          </span>
        </label>
        {included && (
          <button
            type="button"
            aria-expanded={open}
            onClick={onEdit}
            className="min-h-9 shrink-0 rounded-full px-3 text-xs font-semibold text-accent-700 hover:bg-accent-50"
          >
            {open ? "Done" : "Edit"}
            <span className="sr-only"> {room.name}</span>
          </button>
        )}
      </div>
      {open && (
        <div className="space-y-5 border-t border-line bg-surface px-4 py-5">
          <TextField label="Room name">
            {(c) => (
              <input
                {...c}
                className={inputCls}
                data-no-submit=""
                value={room.name}
                maxLength={60}
                onChange={(e) => onChange({ name: e.target.value })}
              />
            )}
          </TextField>
          <Group legend="How big is it?">
            <OptionCards
              value={room.size}
              onChange={(size) => onChange({ size, areaM2: undefined })}
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
              onChange={(floor) => onChange({ floor })}
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
              onChange={(glazing) => onChange({ glazing })}
              options={[
                { value: "low", label: "Shady" },
                { value: "medium", label: "Average" },
                { value: "high", label: "Very sunny" },
              ]}
            />
          </Group>
        </div>
      )}
    </li>
  );
}

/** Single possible outdoor position: show it fixed, explain why on tap. */
function LockedOutdoor({ label, reason }: { label: string; reason: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <p className="mb-1.5 text-sm font-semibold text-ink-900">Where the outdoor unit goes</p>
      <div className="rounded-2xl border border-line bg-white px-4 py-3">
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
