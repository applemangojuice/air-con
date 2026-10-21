"use client";

import { useMemo } from "react";
import { generateQuote, type ElectricsCondition } from "@aircon/domain";
import { BAND_COPY } from "@/components/site/claims";
import { PhotoInput } from "./photo-input";
import { Group, OptionCards, StepShell } from "./ui";
import type { StepProps } from "./steps";

/**
 * Optional "firm up your price" step: a photo of where the outdoor unit could
 * go, the fuse board, and the rooms' walls. These are what lift the
 * confidence band to "high" (the web funnel couldn't reach it before). It
 * never claims the price is locked: the home survey confirms it either way.
 */
export function FirmUpStep({
  draft,
  setSurvey,
  onPhotoUploaded,
  step,
  totalSteps,
  onNext,
  onBack,
}: StepProps) {
  const { survey } = draft;
  const confidence = useMemo(() => generateQuote(survey).confidence, [survey]);
  const band = BAND_COPY[confidence.band];
  const added =
    survey.outdoor.photos.length +
    survey.electrics.photos.length +
    survey.rooms.reduce((n, r) => n + r.photos.length, 0) +
    (survey.electrics.condition !== "unsure" ? 1 : 0);

  return (
    <StepShell
      step={step}
      totalSteps={totalSteps}
      title="Firm up your price"
      badge="Optional"
      subtitle="A few photos help your surveyor arrive prepared and mean fewer surprises when we confirm your price. Not at home? Skip this: your surveyor checks it all anyway."
      onNext={onNext}
      onBack={onBack}
      nextLabel={added > 0 ? "Continue" : "Skip for now"}
    >
      {/* Live confidence meter */}
      <div className="rounded-sm border border-line bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-ink-900">Price confidence</p>
          <p aria-live="polite" className={`rounded-sm border px-2.5 py-0.5 text-xs font-semibold ${band.tone}`}>
            {band.label} · {confidence.score}/100
          </p>
        </div>
        <div
          role="meter"
          aria-label="Price confidence"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={confidence.score}
          aria-valuetext={`${band.label}, ${confidence.score} out of 100`}
          className="mt-3 h-2 overflow-hidden rounded-full bg-line"
        >
          <div
            className={`h-full rounded-full transition-all duration-500 ${confidence.band === "high" ? "bg-sage-500" : "bg-accent-500"}`}
            style={{ width: `${confidence.score}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-ink-500">
          {confidence.band === "high"
            ? "That's a clear picture. Your home survey confirms the price."
            : "Each photo adds to it. Room photos count most."}
        </p>
      </div>

      <PhotoInput
        kind="outdoor-location"
        label="Where the outdoor unit could go"
        hint="Stand back and take the wall and the ground in front of it."
        photos={survey.outdoor.photos}
        onChange={(photos) => setSurvey({ outdoor: { ...survey.outdoor, photos } })}
        onUploaded={onPhotoUploaded}
      />

      <Group
        legend="Your fuse board"
        hint="Usually under the stairs, in a hallway cupboard or by the front door."
      >
        <OptionCards<ElectricsCondition>
          value={survey.electrics.condition}
          onChange={(condition) => setSurvey({ electrics: { ...survey.electrics, condition } })}
          options={[
            { value: "modern-spare-ways", label: "Modern, with spare slots", hint: "Switches, with gaps or blanks" },
            { value: "modern-full", label: "Modern, but full", hint: "A row of switches, no gaps" },
            { value: "older-fuse-box", label: "Older, with fuses", hint: "Pull-out fuses or a wooden back" },
            { value: "unsure", label: "Not sure" },
          ]}
        />
      </Group>

      <PhotoInput
        kind="fuse-board"
        label="Photo of the fuse board"
        hint="A photo of the front is plenty. Please don't take the cover off: some older boards contain asbestos."
        photos={survey.electrics.photos}
        onChange={(photos) => setSurvey({ electrics: { ...survey.electrics, photos } })}
        onUploaded={onPhotoUploaded}
      />

      {survey.rooms.length > 0 && (
        <section aria-labelledby="room-photos" className="space-y-5">
          <div>
            <h2 id="room-photos" className="text-sm font-semibold text-ink-900">
              The wall you&apos;d like each unit on
            </h2>
            <p className="mt-0.5 text-xs text-ink-500">One photo per room, taken from across the room.</p>
          </div>
          {survey.rooms.map((room) => (
            <PhotoInput
              key={room.id}
              kind="room"
              label={room.name}
              photos={room.photos}
              onChange={(photos) =>
                setSurvey({ rooms: survey.rooms.map((r) => (r.id === room.id ? { ...r, photos } : r)) })
              }
              onUploaded={onPhotoUploaded}
            />
          ))}
        </section>
      )}
    </StepShell>
  );
}
