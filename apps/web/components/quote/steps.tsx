"use client";

import { useEffect, useState } from "react";
import type { KitchenLivingLayout, Survey, SurveyGeo } from "@aircon/domain";
import { isValidUkPostcode, normalisePostcode } from "@/lib/format";
import type { Contact, QuoteDraft } from "@/lib/quote-draft";
import { Field, NumberRow, OptionCards, StepShell, inputCls } from "./ui";

export interface StepProps {
  draft: QuoteDraft;
  setSurvey: (update: Partial<Survey>) => void;
  setContact: (update: Partial<Contact>) => void;
  setLayout: (layout: KitchenLivingLayout) => void;
  /** Prefill the draft from a known property (Property Intelligence id). */
  applyIntel?: (intelId: string) => void | Promise<void>;
  step: number;
  totalSteps: number;
  onNext: () => void;
  onBack?: () => void;
  busy?: boolean;
}

/* ------------------------------------------------------------------ */
/* Step 1: Address + email (saves the enquiry immediately)             */
/* ------------------------------------------------------------------ */

type PostcodeCheck =
  | { state: "idle" | "checking" | "offline" }
  | { state: "found"; geo: SurveyGeo }
  | { state: "not-found" };

/** Live postcode lookup via postcodes.io (free, no key, ~50ms). */
function usePostcodeCheck(postcode: string, onGeo: (geo: SurveyGeo | undefined) => void) {
  const [check, setCheck] = useState<PostcodeCheck>({ state: "idle" });

  useEffect(() => {
    if (!isValidUkPostcode(postcode)) {
      setCheck({ state: "idle" });
      return;
    }
    let cancelled = false;
    setCheck({ state: "checking" });
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.replace(/\s+/g, ""))}`,
        );
        if (cancelled) return;
        if (res.status === 404) {
          setCheck({ state: "not-found" });
          onGeo(undefined);
          return;
        }
        const data = (await res.json()) as {
          result?: {
            admin_district?: string;
            region?: string;
            latitude?: number;
            longitude?: number;
          };
        };
        if (cancelled) return;
        const geo: SurveyGeo = {
          district: data.result?.admin_district,
          region: data.result?.region,
          latitude: data.result?.latitude,
          longitude: data.result?.longitude,
        };
        setCheck({ state: "found", geo });
        onGeo(geo);
      } catch {
        // Lookup unreachable, fall back to format-only validation.
        if (!cancelled) setCheck({ state: "offline" });
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postcode]);

  return check;
}

/** Postcode → known properties from the Property Intelligence Engine. */
function useIntelAddresses(postcode: string) {
  const [matches, setMatches] = useState<{ id: string; line1: string }[]>([]);
  useEffect(() => {
    if (!isValidUkPostcode(postcode)) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/intel/addresses?postcode=${encodeURIComponent(postcode)}`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { matches: { id: string; line1: string }[] };
        if (!cancelled) setMatches(data.matches);
      } catch {
        if (!cancelled) setMatches([]);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [postcode]);
  return matches;
}

/** Postcode → selectable address list (getAddress.io behind /api/addresses). */
function useAddressList(postcode: string) {
  const [addresses, setAddresses] = useState<string[]>([]);
  useEffect(() => {
    if (!isValidUkPostcode(postcode)) {
      setAddresses([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/addresses?postcode=${encodeURIComponent(postcode)}`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { configured: boolean; addresses: string[] };
        if (!cancelled) setAddresses(data.configured ? data.addresses : []);
      } catch {
        if (!cancelled) setAddresses([]);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [postcode]);
  return addresses;
}

export function AddressStep({
  draft,
  setSurvey,
  setContact,
  applyIntel,
  step,
  totalSteps,
  onNext,
  busy,
}: StepProps) {
  const { postcode, addressLine } = draft.survey;
  const email = draft.contact.email;
  const check = usePostcodeCheck(postcode, (geo) => setSurvey({ geo }));
  const intelMatches = useIntelAddresses(postcode);
  const addresses = useAddressList(postcode);
  const [manual, setManual] = useState(false);

  const postcodeOk = isValidUkPostcode(postcode) && check.state !== "not-found";
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const ready = postcodeOk && addressLine.trim().length >= 5 && emailOk;
  const showIntelPicker = intelMatches.length > 0 && !manual;
  const showPicker = !showIntelPicker && addresses.length > 0 && !manual;

  return (
    <StepShell
      step={step}
      totalSteps={totalSteps}
      title="Let's price your home"
      subtitle="Just your address and email to start. Quicker than finding where you put the fan last September."
      onNext={onNext}
      nextDisabled={!ready}
      busy={busy}
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
      {check.state === "not-found" && (
        <p className="text-sm text-red-600">
          We couldn&apos;t find that postcode. Double-check it and try again.
        </p>
      )}

      {postcodeOk && (
        <Field label="Your address">
          {showIntelPicker ? (
            <>
              <select
                className={inputCls}
                value={intelMatches.find((m) => m.line1 === addressLine)?.id ?? ""}
                onChange={(e) => {
                  const match = intelMatches.find((m) => m.id === e.target.value);
                  if (!match) return;
                  setSurvey({ addressLine: match.line1 });
                  void applyIntel?.(match.id);
                }}
              >
                <option value="" disabled>
                  Tap your address…
                </option>
                {intelMatches.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.line1}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-ink-300">
                We already know the homes on your street, so picking yours
                pre-fills the next step.
              </p>
              <button
                type="button"
                onClick={() => setManual(true)}
                className="mt-1 text-xs font-medium text-accent-700 hover:underline"
              >
                My address isn&apos;t listed
              </button>
            </>
          ) : showPicker ? (
            <>
              <select
                className={inputCls}
                value={addresses.includes(addressLine) ? addressLine : ""}
                onChange={(e) => setSurvey({ addressLine: e.target.value })}
              >
                <option value="" disabled>
                  Select your address…
                </option>
                {addresses.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setManual(true)}
                className="mt-1.5 text-xs font-medium text-accent-700 hover:underline"
              >
                My address isn&apos;t listed
              </button>
            </>
          ) : (
            <input
              className={inputCls}
              value={addressLine}
              autoComplete="address-line1"
              placeholder="House number and street"
              onChange={(e) => setSurvey({ addressLine: e.target.value })}
            />
          )}
        </Field>
      )}

      <Field label="Email" hint="So you can come back to your quote. We'll never call you.">
        <input
          className={inputCls}
          type="email"
          value={email}
          autoComplete="email"
          placeholder="you@example.com"
          onChange={(e) => setContact({ email: e.target.value })}
        />
      </Field>

      {postcodeOk && check.state === "found" && check.geo.district && (
        <div className="rounded-2xl border border-accent-100 bg-accent-50 p-4">
          <p className="text-sm font-semibold text-accent-700">
            Good news, we cover {check.geo.district}.
          </p>
          <p className="mt-1 text-sm text-ink-500">
            A few taps about your house and your price pops up. No
            salesperson, no waiting, and nobody rings you &ldquo;just to
            follow up&rdquo;.
          </p>
        </div>
      )}
    </StepShell>
  );
}

/* ------------------------------------------------------------------ */
/* Step 2: Your house (generates the default configuration)            */
/* ------------------------------------------------------------------ */

export function HouseStep({
  draft,
  setSurvey,
  setLayout,
  step,
  totalSteps,
  onNext,
  onBack,
}: StepProps) {
  const p = draft.survey.property;
  const set = (update: Partial<Survey["property"]>) =>
    setSurvey({ property: { ...p, ...update } });

  return (
    <StepShell
      step={step}
      totalSteps={totalSteps}
      title="Tell us about your house"
      subtitle="These few answers build your home's layout. Your price is on the next screen. Told you it was quick."
      onNext={onNext}
      onBack={onBack}
      nextLabel="Show my price"
    >
      {draft.prefilledFromIntel && (
        <div className="rounded-2xl border border-sage-200 bg-sage-50 p-4">
          <p className="text-sm font-semibold text-sage-900">
            We&apos;ve filled this in for you ✨
          </p>
          <p className="mt-1 text-sm text-sage-800">
            These answers come from public records for {draft.survey.addressLine}. Give them a
            once-over and fix anything that&apos;s off.
          </p>
        </div>
      )}
      <Field label="What kind of home is it?">
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
            { value: "pre-1930", label: "Before 1930", hint: "Georgian · Victorian · Edwardian" },
            { value: "1930-1950", label: "1930s – 40s" },
            { value: "1950-2000", label: "1950s – 1990s" },
            { value: "2000+", label: "2000 or later", hint: "Modern build" },
          ]}
        />
      </Field>

      <Field label="Bedrooms / studies / offices">
        <NumberRow
          value={p.bedrooms}
          onChange={(bedrooms) => set({ bedrooms })}
          max={6}
          maxLabel="6+"
        />
      </Field>

      <Field label="Bathrooms">
        <NumberRow
          value={p.bathrooms ?? 1}
          onChange={(bathrooms) => set({ bathrooms })}
          max={4}
          maxLabel="4+"
        />
      </Field>

      <Field label="Kitchen & living rooms">
        <OptionCards<KitchenLivingLayout>
          value={draft.layout}
          onChange={setLayout}
          options={[
            { value: "open-plan", label: "One open-plan kitchen & living room" },
            { value: "separate", label: "Separate kitchen and living room" },
            { value: "two-receptions", label: "Two living rooms + kitchen" },
            { value: "other", label: "Something else" },
          ]}
        />
      </Field>

      <Field
        label="Rough size of your home (optional)"
        hint="In square metres, it's on your EPC or listing. We'll split it across your rooms."
      >
        <div className="flex items-center gap-2">
          <input
            className={inputCls}
            type="number"
            inputMode="numeric"
            min={30}
            max={1000}
            placeholder="e.g. 95"
            value={p.floorAreaM2 ?? ""}
            onChange={(e) =>
              set({ floorAreaM2: e.target.value ? Number(e.target.value) : undefined })
            }
          />
          <span className="shrink-0 text-sm font-medium text-ink-500">m²</span>
        </div>
      </Field>
    </StepShell>
  );
}

/* ------------------------------------------------------------------ */
/* Step 4: Final details (name only at the very end)                   */
/* ------------------------------------------------------------------ */

export function DetailsStep({
  draft,
  setContact,
  setSurvey,
  step,
  totalSteps,
  onNext,
  onBack,
  busy,
}: StepProps) {
  const c = draft.contact;
  const p = draft.survey.property;
  const ready = c.name.trim().length >= 2;

  return (
    <StepShell
      step={step}
      totalSteps={totalSteps}
      title="Nearly there"
      subtitle="Your name locks the quote to you. We'll email your permanent quote link. No phone calls, ever."
      onNext={onNext}
      onBack={onBack}
      nextLabel="Get my full quote"
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
      <Field label="Do you own the property?">
        <OptionCards
          value={p.ownership}
          onChange={(ownership) => setSurvey({ property: { ...p, ownership } })}
          options={[
            { value: "owner", label: "Yes, I own it" },
            { value: "renting", label: "No, renting", hint: "You'll need landlord consent" },
          ]}
        />
      </Field>
      <Field label="When are you looking to install?">
        <OptionCards
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
        We will never call you. Everything arrives by email, and only about
        this quote. We hate cold calls even more than you do.
      </p>
    </StepShell>
  );
}
