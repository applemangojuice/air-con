"use client";

import type { Survey } from "@aircon/domain";
import { isValidUkPostcode, normalisePostcode } from "@/lib/format";
import type { Contact, QuoteDraft, Timeframe } from "@/lib/quote-draft";
import { PhotoInput } from "./photo-input";
import { Field, OptionCards, StepShell, inputCls } from "./ui";

export interface StepProps {
  draft: QuoteDraft;
  setSurvey: (update: Partial<Survey>) => void;
  setContact: (update: Partial<Contact>) => void;
  step: number;
  totalSteps: number;
  onNext: () => void;
  onBack?: () => void;
}

/* ------------------------------------------------------------------ */
/* Step 1 — Address                                                    */
/* ------------------------------------------------------------------ */

export function AddressStep({ draft, setSurvey, step, totalSteps, onNext }: StepProps) {
  const { postcode, addressLine } = draft.survey;
  const postcodeOk = isValidUkPostcode(postcode);
  const ready = postcodeOk && addressLine.trim().length >= 5;

  return (
    <StepShell
      step={step}
      totalSteps={totalSteps}
      title="Where's the installation?"
      subtitle="We price every home individually — your address lets us check access, property type and local install patterns."
      onNext={onNext}
      nextDisabled={!ready}
    >
      <Field label="Postcode">
        <input
          className={inputCls}
          value={postcode}
          autoComplete="postal-code"
          placeholder="e.g. SW1A 1AA"
          onChange={(e) => setSurvey({ postcode: e.target.value.toUpperCase() })}
          onBlur={(e) => setSurvey({ postcode: normalisePostcode(e.target.value) })}
        />
      </Field>
      <Field label="First line of address" hint="House number and street.">
        <input
          className={inputCls}
          value={addressLine}
          autoComplete="address-line1"
          placeholder="e.g. 42 Maple Avenue"
          onChange={(e) => setSurvey({ addressLine: e.target.value })}
        />
      </Field>

      {postcodeOk && (
        <div className="rounded-2xl border border-air-100 bg-air-50 p-4">
          <p className="text-sm font-semibold text-air-700">
            Good news — we cover {normalisePostcode(postcode)}.
          </p>
          <p className="mt-1 text-sm text-ink-500">
            Answer a few questions about your home and rooms, add photos, and
            you&apos;ll get a guaranteed fixed price at the end — most people
            finish in about 10 minutes.
          </p>
        </div>
      )}
    </StepShell>
  );
}

/* ------------------------------------------------------------------ */
/* Step 2 — Property                                                   */
/* ------------------------------------------------------------------ */

export function PropertyStep({ draft, setSurvey, step, totalSteps, onNext, onBack }: StepProps) {
  const p = draft.survey.property;
  const set = (update: Partial<Survey["property"]>) =>
    setSurvey({ property: { ...p, ...update } });

  return (
    <StepShell
      step={step}
      totalSteps={totalSteps}
      title="Tell us about your home"
      subtitle="Property type and age drive how we route pipework and where the outdoor unit can go."
      onNext={onNext}
      onBack={onBack}
    >
      <Field label="Property type">
        <OptionCards
          columns={3}
          value={p.type}
          onChange={(type) => set({ type })}
          options={[
            { value: "detached", label: "Detached" },
            { value: "semi-detached", label: "Semi-detached" },
            { value: "terraced", label: "Terraced" },
            { value: "flat", label: "Flat" },
            { value: "bungalow", label: "Bungalow" },
          ]}
        />
      </Field>
      <Field label="Roughly when was it built?">
        <OptionCards
          value={p.era}
          onChange={(era) => set({ era })}
          options={[
            { value: "pre-1930", label: "Before 1930", hint: "Solid walls" },
            { value: "1930-1979", label: "1930 – 1979", hint: "Early cavity walls" },
            { value: "1980-1999", label: "1980 – 1999", hint: "Insulated cavity" },
            { value: "2000+", label: "2000 or later", hint: "Modern build" },
          ]}
        />
      </Field>
      <Field label="Bedrooms">
        <OptionCards
          columns={3}
          value={p.bedrooms}
          onChange={(bedrooms) => set({ bedrooms })}
          options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: n, label: n === 6 ? "6+" : String(n) }))}
        />
      </Field>
      <Field label="Do you own the property?">
        <OptionCards
          value={p.ownership}
          onChange={(ownership) => set({ ownership })}
          options={[
            { value: "owner", label: "Yes, I own it" },
            { value: "renting", label: "No, renting", hint: "You'll need landlord consent" },
          ]}
        />
      </Field>
    </StepShell>
  );
}

/* ------------------------------------------------------------------ */
/* Step 4 — Outdoor unit                                               */
/* ------------------------------------------------------------------ */

export function OutdoorStep({ draft, setSurvey, step, totalSteps, onNext, onBack }: StepProps) {
  const outdoor = draft.survey.outdoor;

  return (
    <StepShell
      step={step}
      totalSteps={totalSteps}
      title="Where could the outdoor unit go?"
      subtitle="Every system needs one outdoor unit (about the size of a suitcase). It hums quietly — roughly as loud as a fridge."
      onNext={onNext}
      onBack={onBack}
    >
      <Field label="Best location">
        <OptionCards
          value={outdoor.location}
          onChange={(location) => setSurvey({ outdoor: { ...outdoor, location } })}
          options={[
            { value: "ground-rear", label: "Back garden / patio", hint: "On the ground" },
            { value: "ground-side", label: "Side passage", hint: "On the ground" },
            { value: "wall-bracket", label: "On an outside wall", hint: "Bracket-mounted" },
            { value: "flat-roof", label: "Flat roof" },
            { value: "balcony", label: "Balcony" },
            { value: "unsure", label: "Not sure", hint: "We'll advise" },
          ]}
        />
      </Field>
      <PhotoInput
        kind="outdoor-location"
        label="Photo of the spot (and how we'd get to it)"
        photos={outdoor.photos}
        onChange={(photos) => setSurvey({ outdoor: { ...outdoor, photos } })}
      />
      <p className="text-sm text-ink-300">
        Photos firm up your price. Without them we may need a quick video call
        before your installation date is confirmed.
      </p>
    </StepShell>
  );
}

/* ------------------------------------------------------------------ */
/* Step 5 — Electrics                                                  */
/* ------------------------------------------------------------------ */

export function ElectricsStep({ draft, setSurvey, step, totalSteps, onNext, onBack }: StepProps) {
  const electrics = draft.survey.electrics;

  return (
    <StepShell
      step={step}
      totalSteps={totalSteps}
      title="A quick look at your electrics"
      subtitle="Air conditioning needs its own circuit from your fuse board (consumer unit) — usually found in the hallway, garage or under the stairs."
      onNext={onNext}
      onBack={onBack}
    >
      <Field label="Which best describes your fuse board?">
        <OptionCards
          value={electrics.condition}
          onChange={(condition) => setSurvey({ electrics: { ...electrics, condition } })}
          options={[
            { value: "modern-spare-ways", label: "Modern, with spare switches", hint: "Empty slots visible" },
            { value: "modern-full", label: "Modern, but full", hint: "No empty slots" },
            { value: "older-fuse-box", label: "Older fuse box", hint: "Rewireable fuses" },
            { value: "unsure", label: "Not sure", hint: "The photo is enough" },
          ]}
        />
      </Field>
      <PhotoInput
        kind="fuse-board"
        label="Photo of your fuse board (door open if possible)"
        photos={electrics.photos}
        onChange={(photos) => setSurvey({ electrics: { ...electrics, photos } })}
      />
    </StepShell>
  );
}

/* ------------------------------------------------------------------ */
/* Step 6 — Contact                                                    */
/* ------------------------------------------------------------------ */

export function ContactStep({
  draft,
  setContact,
  step,
  totalSteps,
  onNext,
  onBack,
  busy,
}: StepProps & { busy: boolean }) {
  const c = draft.contact;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email);
  const ready = c.name.trim().length >= 2 && emailOk;

  return (
    <StepShell
      step={step}
      totalSteps={totalSteps}
      title="Where should we send your quote?"
      subtitle="Your fixed price appears on the next screen — we'll also email you a copy so you can come back to it."
      onNext={onNext}
      onBack={onBack}
      nextLabel="Show my fixed price"
      nextDisabled={!ready}
      busy={busy}
    >
      <Field label="Your name">
        <input
          className={inputCls}
          value={c.name}
          autoComplete="name"
          onChange={(e) => setContact({ name: e.target.value })}
        />
      </Field>
      <Field label="Email">
        <input
          className={inputCls}
          type="email"
          value={c.email}
          autoComplete="email"
          onChange={(e) => setContact({ email: e.target.value })}
        />
      </Field>
      <Field label="Phone (optional)" hint="Only used if we need to check an install detail.">
        <input
          className={inputCls}
          type="tel"
          value={c.phone}
          autoComplete="tel"
          onChange={(e) => setContact({ phone: e.target.value })}
        />
      </Field>
      <Field label="When are you looking to install?">
        <OptionCards<Timeframe>
          columns={3}
          value={c.timeframe}
          onChange={(timeframe) => setContact({ timeframe })}
          options={[
            { value: "asap", label: "ASAP" },
            { value: "1-3-months", label: "1–3 months" },
            { value: "researching", label: "Just researching" },
          ]}
        />
      </Field>
      <p className="text-xs text-ink-300">
        No spam, no pushy calls — we&apos;ll email your quote and that&apos;s it
        unless you book.
      </p>
    </StepShell>
  );
}
