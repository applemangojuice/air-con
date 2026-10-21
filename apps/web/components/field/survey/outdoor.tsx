"use client";

import { useState } from "react";
import { ACCESS_EQUIPMENT_HEIGHT_M, SURVEY_LABELS, ladderLimitM, ladderRefused, needsHeightAccess, surveyChecks, type OutdoorPosition } from "@aircon/domain";
import { Callout, ChoiceGroup, FieldCard, NumberField, TextArea, TextField, Tick, choices } from "./controls";
import { setOpt, useSurvey, withPosition } from "./context";
import { NextButton } from "./sections";
import { PhotoStrip } from "./photo-strip";

/**
 * Outdoor unit positions: the candidates (the customer's guess is the
 * first, unchosen), each with a photo to draw on, the distance to the
 * nearest neighbouring window (the noise check needs it), the base, height,
 * access and where defrost water goes. Mark the one (or ones) to use.
 */

export function OutdoorSection() {
  const { data, update, go, completeness, self } = useSurvey();
  const checks = surveyChecks(data);
  const noneChosen = completeness.missing.some((m) => m.sectionId === "outdoor" && !m.positionId);
  const add = () => {
    const taken = new Set(data.outdoor.positions.map((p) => p.id));
    let n = data.outdoor.positions.length + 1;
    while (taken.has(`outdoor-${n}`)) n++;
    const position: OutdoorPosition = {
      id: `outdoor-${n}`,
      label: `Position ${n}`,
      location: "ground-rear",
      base: "ground-feet",
      accessEquipment: "none",
      chosen: data.outdoor.positions.every((p) => !p.chosen),
    };
    update((m) => ({ ...m, outdoor: { ...m.outdoor, positions: [...m.outdoor.positions, position] } }));
    go({ s: "outdoor", o: position.id });
  };
  const guess = self?.outdoor?.location;
  return (
    <div className="space-y-4">
      {guess && guess !== "unsure" && (
        <p className="text-sm text-ink-500">Customer suggested: {SURVEY_LABELS.outdoorLocation[guess].toLowerCase()}.</p>
      )}
      {noneChosen && <Callout tone="warn">Choose the position you&apos;ll use (agree it with the customer).</Callout>}
      {data.outdoor.positions.length === 0 && (
        <div className="rounded-2xl border border-dashed border-line bg-white/60 px-5 py-8 text-center">
          <p className="font-semibold text-ink-900">No positions yet</p>
          <p className="mt-1 text-sm text-ink-500">Add each place the outdoor unit could go, then choose one.</p>
        </div>
      )}
      <ul className="space-y-3">
        {data.outdoor.positions.map((p) => {
          const mine = checks.filter((c) => c.positionId === p.id);
          const left = mine.filter((c) => !c.done).length;
          return (
            <li key={p.id}>
              <button type="button" onClick={() => go({ s: "outdoor", o: p.id })} className="flex w-full items-center gap-3 rounded-2xl border border-line bg-white p-4 text-left">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-lg font-semibold text-ink-900">{p.label || "Outdoor position"}</span>
                  <span className="block text-sm text-ink-500">
                    {SURVEY_LABELS.outdoorLocation[p.location]} · {SURVEY_LABELS.base[p.base].toLowerCase()}
                  </span>
                </span>
                {p.chosen ? (
                  left ? (
                    <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900">Chosen · {left} to do</span>
                  ) : (
                    <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">Chosen · done</span>
                  )
                ) : (
                  <span className="shrink-0 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-ink-700">Option</span>
                )}
                <span aria-hidden className="text-xl text-ink-500">
                  ›
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={add}
        disabled={data.outdoor.positions.length >= 10}
        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-dashed border-ink-300 bg-white text-base font-semibold text-ink-900 hover:bg-surface disabled:opacity-40"
      >
        <span aria-hidden>+</span> Add a position
      </button>
      <NextButton from="outdoor" />
    </div>
  );
}

export function PositionEditor({ positionId }: { positionId: string }) {
  const { data, update, isMissing, media, queue, addPhotos, detachPhoto, annotate, go } = useSurvey();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const p = data.outdoor.positions.find((x) => x.id === positionId);
  if (!p) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-white/60 px-5 py-8 text-center">
        <p className="font-semibold text-ink-900">That position isn&apos;t in this survey</p>
        <button type="button" onClick={() => go({ s: "outdoor" })} className="mt-4 min-h-12 rounded-full bg-ink-900 px-5 font-semibold text-white">
          Back to outdoor
        </button>
      </div>
    );
  }
  const at = { positionId: p.id };
  const miss = (field: string) => p.chosen && isMissing("outdoor", field, at);
  const set = (fn: (x: OutdoorPosition) => OutdoorPosition) => update((m) => withPosition(m, p.id, fn));
  const high = (p.heightM ?? 0) >= ACCESS_EQUIPMENT_HEIGHT_M;
  const limit = ladderLimitM(data);
  const aboveLadder = needsHeightAccess(p, limit);
  const close = p.distanceToNeighbourWindowM !== undefined && p.distanceToNeighbourWindowM < 3;
  return (
    <div className="space-y-4">
      <FieldCard>
        <Tick
          field="chosen"
          label="Use this position"
          hint="Agree it with the customer. You can choose more than one for separate systems."
          checked={p.chosen}
          onChange={(chosen) => set((x) => ({ ...x, chosen }))}
        />
        <TextField field="positionLabel" label="Name it" placeholder="e.g. Rear patio, by the kitchen door" value={p.label} onChange={(v) => set((x) => ({ ...x, label: v.slice(0, 120) }))} maxLength={120} />
        <ChoiceGroup
          field="location"
          legend="Where is it?"
          value={p.location}
          options={choices(SURVEY_LABELS.outdoorLocation, ["ground-rear", "ground-side", "wall-bracket", "flat-roof", "balcony"])}
          onChange={(location) => set((x) => ({ ...x, location }))}
        />
      </FieldCard>

      <FieldCard title="Photo">
        <PhotoStrip
          legend="Photo of the spot"
          hint="Take it wide enough to show the route to the house. Then tap it to draw the unit and the pipe route."
          field="photo"
          single
          mediaIds={p.mediaId ? [p.mediaId] : []}
          media={media}
          pending={queue.items.filter((q) => q.target.kind === "outdoor" && q.target.positionId === p.id)}
          tags={["outdoor-location", "access", "drainage"]}
          missing={miss("photo")}
          onAdd={(files, tag) => addPhotos(files, tag, { kind: "outdoor", positionId: p.id })}
          onRemove={(id) => detachPhoto(id, { kind: "outdoor", positionId: p.id })}
          onRetry={queue.retry}
          onRemovePending={(id) => void queue.remove(id)}
          onAnnotate={(id) => annotate(id, `${p.label || "Outdoor position"} · outdoor unit`, "outdoor-unit")}
        />
      </FieldCard>

      <FieldCard title="Noise">
        <NumberField
          field="distanceToNeighbourWindowM"
          label="Distance to the nearest neighbour's window"
          hint="To a point 1 m out from the centre of the nearest window or glazed door of a habitable room next door (not a bathroom or landing): MCS 020(a)'s assessment position. The noise calculation needs it."
          unit="m"
          value={p.distanceToNeighbourWindowM}
          onChange={(v) => set((x) => setOpt(x, "distanceToNeighbourWindowM", v))}
          min={0}
          max={500}
          missing={miss("distanceToNeighbourWindowM")}
        />
        <ChoiceGroup
          field="reflectingSurfaces"
          legend="Hard surfaces within 1 m of the unit (the ground counts)"
          hint="Walls, fences and the ground reflect sound back towards the neighbour: the noise calculation needs the count."
          value={p.reflectingSurfaces}
          options={choices(SURVEY_LABELS.reflectingSurfaces)}
          onChange={(reflectingSurfaces) => set((x) => ({ ...x, reflectingSurfaces }))}
          columns={1}
          missing={miss("reflectingSurfaces")}
        />
        {close && <Callout tone="warn">Under 3 m to a neighbour&apos;s window often fails the MCS 020(a) noise check. Note any screening, and look for a better spot.</Callout>}
      </FieldCard>

      <FieldCard title="Mounting and access">
        <ChoiceGroup field="base" legend="Base" value={p.base} options={choices(SURVEY_LABELS.base)} onChange={(base) => set((x) => ({ ...x, base }))} />
        <NumberField
          field="heightM"
          label="Height to the bracket (or the unit's base) off the ground"
          hint="0 on the ground. On a flat roof, the roof's height. On a balcony, leave it blank."
          unit="m"
          value={p.heightM}
          onChange={(v) => set((x) => setOpt(x, "heightM", v))}
          min={0}
          max={30}
          suggestions={[0, 1.5, 3]}
          missing={miss("heightM")}
        />
        <ChoiceGroup
          field="accessEquipment"
          legend="Access equipment needed"
          hint={
            aboveLadder
              ? `Above ${limit} m a ladder isn't the access for installing it: pick a tower, podium steps, a scaffold or a MEWP. Its hire goes on the proposal.`
              : high
                ? "It's high: the crew needs at least a ladder."
                : undefined
          }
          value={p.accessEquipment}
          options={choices(SURVEY_LABELS.accessEquipment)}
          onChange={(accessEquipment) => set((x) => ({ ...x, accessEquipment }))}
          columns={3}
          missing={miss("accessEquipment")}
        />
        {p.chosen && ladderRefused(p, limit) && p.accessEquipment === "ladder" && (
          <Callout tone="warn">A ladder isn&apos;t accepted for a bracket {p.heightM} m up (the limit is {limit} m): a two-handed lift of a heavy unit isn&apos;t ladder work.</Callout>
        )}
      </FieldCard>

      <FieldCard title="Defrost water">
        <p className="-mt-2 text-sm text-ink-500">In heating mode the unit sheds water (and ice in winter). It needs somewhere to go that won&apos;t freeze on a path.</p>
        <div className="flex flex-wrap gap-2">
          {["Gravel soakaway under the unit", "Drain pipe to the gully", "Onto soil or a flower bed"].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => set((x) => ({ ...x, defrostDrainage: s }))}
              className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${p.defrostDrainage === s ? "border-accent-600 bg-accent-50 text-accent-700" : "border-line bg-white text-ink-700"}`}
            >
              {s}
            </button>
          ))}
        </div>
        <TextField
          field="defrostDrainage"
          label="Where defrost water will drain"
          value={p.defrostDrainage}
          onChange={(v) => set((x) => setOpt(x, "defrostDrainage", v))}
          maxLength={500}
          missing={miss("defrostDrainage")}
        />
      </FieldCard>

      <FieldCard>
        <TextArea field="positionNote" label="Notes" placeholder="e.g. neighbour's fence 0.5 m away, needs a riser" value={p.note} onChange={(v) => set((x) => setOpt(x, "note", v))} rows={2} />
        {confirmRemove ? (
          <div role="alertdialog" aria-label="Remove position" className="space-y-2 rounded-2xl border border-red-200 bg-red-50 p-3">
            <p className="text-sm font-semibold text-red-900">Remove {p.label || "this position"} from the survey?</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setConfirmRemove(false)} className="min-h-12 rounded-full border border-line bg-white font-semibold text-ink-900">
                Keep it
              </button>
              <button
                type="button"
                onClick={() => {
                  update((m) => ({ ...m, outdoor: { ...m.outdoor, positions: m.outdoor.positions.filter((x) => x.id !== p.id) } }));
                  go({ s: "outdoor" });
                }}
                className="min-h-12 rounded-full bg-red-700 font-semibold text-white"
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmRemove(true)}
            className="min-h-12 w-full rounded-full border border-red-200 bg-white font-semibold text-red-700 hover:bg-red-50"
          >
            Remove this position
          </button>
        )}
      </FieldCard>

      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <button
          type="button"
          onClick={() => go({ s: "electrics" })}
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-accent-700 px-6 text-base font-semibold text-white shadow-sm hover:bg-accent-800 sm:w-auto"
        >
          Next: Electrics <span aria-hidden>→</span>
        </button>
        <button
          type="button"
          onClick={() => go({ s: "outdoor" })}
          className="inline-flex min-h-12 w-full items-center justify-center rounded-full border border-line bg-white px-6 text-base font-semibold text-ink-900 hover:bg-surface sm:w-auto"
        >
          All positions
        </button>
      </div>
    </div>
  );
}
