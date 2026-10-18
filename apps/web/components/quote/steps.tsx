"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { KitchenLivingLayout, Survey, SurveyGeo } from "@aircon/domain";
import { isValidUkPostcode, normalisePostcode } from "@/lib/format";
import type { Contact, QuoteDraft } from "@/lib/quote-draft";
import { MARKETING_CONSENT, OPERATIONAL_CONSENT, coverageFor, type PublicSettings } from "@/components/site/claims";
import { OutOfArea } from "./out-of-area";
import { Group, NumberRow, OptionCards, StepShell, TextField, inputCls } from "./ui";

export interface StepProps {
  draft: QuoteDraft;
  settings: PublicSettings;
  setSurvey: (update: Partial<Survey>) => void;
  setContact: (update: Partial<Contact>) => void;
  setLayout: (layout: KitchenLivingLayout) => void;
  /** A photo reached storage: record its path on the draft. */
  onPhotoUploaded: (photoId: string, storagePath: string) => void;
  /** Prefill the draft from a known property (Property Intelligence id). */
  applyIntel?: (intelId: string) => void | Promise<void>;
  step: number;
  totalSteps: number;
  onNext: () => void;
  onBack?: () => void;
  busy?: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** UK-ish phone: digits, spaces, +, brackets and dashes, 10–13 digits. */
const PHONE_RE = /^\+?[\d\s()-]{10,20}$/;
const phoneOk = (v: string) => v.trim() === "" || (PHONE_RE.test(v.trim()) && v.replace(/\D/g, "").length >= 10);

/* ------------------------------------------------------------------ */
/* Step 1: postcode, coverage, address (+ optional email)              */
/* ------------------------------------------------------------------ */

type PostcodeCheck =
  | { state: "idle" | "checking" | "offline" }
  | { state: "found"; geo: SurveyGeo }
  | { state: "not-found" };

/** Live postcode lookup via postcodes.io (free, no key). Coverage never depends on it. */
function usePostcodeCheck(postcode: string, onGeo: (geo: SurveyGeo | undefined) => void) {
  const [check, setCheck] = useState<PostcodeCheck>({ state: "idle" });
  const onGeoRef = useRef(onGeo);
  onGeoRef.current = onGeo;

  useEffect(() => {
    if (!isValidUkPostcode(postcode)) {
      setCheck({ state: "idle" });
      return;
    }
    let cancelled = false;
    setCheck({ state: "checking" });
    const timer = setTimeout(async () => {
      try {
        const controller = new AbortController();
        const abort = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(
          `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.replace(/\s+/g, ""))}`,
          { signal: controller.signal },
        );
        clearTimeout(abort);
        if (cancelled) return;
        if (res.status === 404) {
          setCheck({ state: "not-found" });
          onGeoRef.current(undefined);
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as {
          result?: { admin_district?: string; region?: string; latitude?: number; longitude?: number };
        };
        if (cancelled) return;
        const geo: SurveyGeo = {
          district: data.result?.admin_district,
          region: data.result?.region,
          latitude: data.result?.latitude,
          longitude: data.result?.longitude,
        };
        setCheck({ state: "found", geo });
        onGeoRef.current(geo);
      } catch {
        // Lookup unreachable: fall back to the postcode's format, coverage still works.
        if (!cancelled) setCheck({ state: "offline" });
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [postcode]);

  return check;
}

/** Postcode → known properties from the Property Intelligence Engine. */
function useIntelAddresses(postcode: string, enabled: boolean) {
  const [matches, setMatches] = useState<{ id: string; line1: string }[]>([]);
  useEffect(() => {
    if (!enabled || !isValidUkPostcode(postcode)) {
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
  }, [postcode, enabled]);
  return matches;
}

/** Postcode → selectable address list (getAddress.io behind /api/addresses). */
function useAddressList(postcode: string, enabled: boolean) {
  const [addresses, setAddresses] = useState<string[]>([]);
  useEffect(() => {
    if (!enabled || !isValidUkPostcode(postcode)) {
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
  }, [postcode, enabled]);
  return addresses;
}

export function AddressStep({
  draft,
  settings,
  setSurvey,
  setContact,
  applyIntel,
  step,
  totalSteps,
  onNext,
  busy,
  notice,
}: StepProps & { notice?: string | null }) {
  const { postcode, addressLine } = draft.survey;
  const email = draft.contact.email;
  const check = usePostcodeCheck(postcode, (geo) => setSurvey({ geo }));
  const formatOk = isValidUkPostcode(postcode);
  const { covered, outcode } = coverageFor(settings.serviceArea, postcode);
  const known = formatOk && check.state !== "not-found" && check.state !== "checking" && check.state !== "idle";
  const inArea = known && covered;
  const outOfArea = known && !covered;
  const intelMatches = useIntelAddresses(postcode, inArea);
  const addresses = useAddressList(postcode, inArea);
  const [manual, setManual] = useState(false);
  const district = check.state === "found" ? check.geo.district : undefined;

  // Optional here (price before personal details): empty is fine, a typo isn't.
  const emailOk = email === "" || EMAIL_RE.test(email);
  const ready = inArea && addressLine.trim().length >= 5 && emailOk;
  const showIntelPicker = intelMatches.length > 0 && !manual;
  const showPicker = !showIntelPicker && addresses.length > 0 && !manual;

  const status =
    !formatOk || check.state === "idle"
      ? ""
      : check.state === "checking"
        ? "Checking your postcode…"
        : check.state === "not-found"
          ? "We couldn't find that postcode. Check it and try again."
          : covered
            ? `Good news, we cover ${outcode}${district ? ` in ${district}` : ""}.`
            : `Sorry, we're not in ${district ?? outcode} yet.`;

  return (
    <StepShell
      step={step}
      totalSteps={totalSteps}
      title="Let's price your home"
      subtitle="Start with your postcode. Quicker than finding where you put the fan last September."
      onNext={onNext}
      nextDisabled={!ready}
      busy={busy}
      nextLabel="Continue"
    >
      {notice && (
        <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {notice}
        </p>
      )}

      <TextField label="Postcode" hint="We install in a few South London postcodes for now.">
        {(c) => (
          <input
            {...c}
            aria-describedby={[c["aria-describedby"], "postcode-status"].filter(Boolean).join(" ")}
            aria-invalid={check.state === "not-found" ? true : undefined}
            className={`${inputCls} uppercase`}
            value={postcode}
            autoComplete="postal-code"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="e.g. SW16 2BE"
            onChange={(e) => setSurvey({ postcode: e.target.value.toUpperCase() })}
            onBlur={(e) => setSurvey({ postcode: normalisePostcode(e.target.value) })}
          />
        )}
      </TextField>

      {/* One live region for the whole check: screen readers hear the outcome. */}
      <div id="postcode-status" aria-live="polite" className="-mt-4">
        {status && check.state === "checking" && <p className="text-sm text-ink-500">{status}</p>}
        {status && check.state === "not-found" && <p className="text-sm font-medium text-red-700">{status}</p>}
        {inArea && (
          <div className="rounded-2xl border border-sage-200 bg-sage-50 p-4">
            <p className="text-sm font-semibold text-sage-900">{status}</p>
            <p className="mt-1 text-sm text-sage-800">
              A few taps about your home and your price appears. No salesperson, and nobody rings you to
              &ldquo;just follow up&rdquo;.
            </p>
          </div>
        )}
        {outOfArea && <p className="sr-only">{status}</p>}
      </div>

      {outOfArea && (
        <OutOfArea
          outcode={outcode}
          district={district}
          serviceArea={settings.serviceArea}
          email={email}
          postcode={normalisePostcode(postcode)}
          addressLine={addressLine}
          draftId={draft.draftId}
        />
      )}

      {inArea && (
        <>
          {showIntelPicker ? (
            <TextField label="Your address" hint="Picking yours pre-fills the next step from public records.">
              {(c) => (
                <>
                  <select
                    {...c}
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
                      Choose your address…
                    </option>
                    {intelMatches.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.line1}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setManual(true)}
                    className="mt-1.5 min-h-10 text-sm font-semibold text-accent-700 underline-offset-2 hover:underline"
                  >
                    My address isn&apos;t listed
                  </button>
                </>
              )}
            </TextField>
          ) : showPicker ? (
            <TextField label="Your address">
              {(c) => (
                <>
                  <select
                    {...c}
                    className={inputCls}
                    value={addresses.includes(addressLine) ? addressLine : ""}
                    onChange={(e) => setSurvey({ addressLine: e.target.value })}
                  >
                    <option value="" disabled>
                      Choose your address…
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
                    className="mt-1.5 min-h-10 text-sm font-semibold text-accent-700 underline-offset-2 hover:underline"
                  >
                    My address isn&apos;t listed
                  </button>
                </>
              )}
            </TextField>
          ) : (
            <TextField label="Your address" hint="House number and street.">
              {(c) => (
                <input
                  {...c}
                  className={inputCls}
                  value={addressLine}
                  autoComplete="address-line1"
                  placeholder="e.g. 12 Example Road"
                  onChange={(e) => setSurvey({ addressLine: e.target.value })}
                />
              )}
            </TextField>
          )}

          <TextField
            label="Email"
            optional
            hint="Saves your progress so you can come back to it. Skip it and you still see your price."
            error={!emailOk ? "That email doesn't look right. Check it, or leave it blank for now." : null}
          >
            {(c) => (
              <input
                {...c}
                className={inputCls}
                type="email"
                inputMode="email"
                value={email}
                autoComplete="email"
                placeholder="you@example.com"
                onChange={(e) => setContact({ email: e.target.value.trim() })}
              />
            )}
          </TextField>
        </>
      )}
    </StepShell>
  );
}

/* ------------------------------------------------------------------ */
/* Step 2: Your house (generates the default configuration)            */
/* ------------------------------------------------------------------ */

export function HouseStep({ draft, setSurvey, setLayout, step, totalSteps, onNext, onBack }: StepProps) {
  const p = draft.survey.property;
  const set = (update: Partial<Survey["property"]>) => setSurvey({ property: { ...p, ...update } });

  return (
    <StepShell
      step={step}
      totalSteps={totalSteps}
      title="Tell us about your home"
      subtitle="These answers lay out your rooms. Your price is on the next screen."
      onNext={onNext}
      onBack={onBack}
      nextLabel="Show my price"
    >
      {draft.prefilledFromIntel && (
        <div className="rounded-2xl border border-sage-200 bg-sage-50 p-4">
          <p className="text-sm font-semibold text-sage-900">We&apos;ve filled this in from public records</p>
          <p className="mt-1 text-sm text-sage-800">
            For {draft.survey.addressLine}. Give it a once-over and fix anything that&apos;s off.
          </p>
        </div>
      )}
      <Group legend="What kind of home is it?">
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
      </Group>

      <Group legend="Roughly when was it built?">
        <OptionCards
          value={p.era}
          onChange={(era) => set({ era })}
          options={[
            { value: "pre-1930", label: "Before 1930", hint: "Victorian · Edwardian" },
            { value: "1930-1950", label: "1930s – 40s" },
            { value: "1950-2000", label: "1950s – 1990s" },
            { value: "2000+", label: "2000 or later", hint: "Modern build" },
          ]}
        />
      </Group>

      <Group legend="Bedrooms, studies and offices">
        <NumberRow value={p.bedrooms} onChange={(bedrooms) => set({ bedrooms })} max={6} maxLabel="6+" />
      </Group>

      <Group legend="Bathrooms">
        <NumberRow value={p.bathrooms ?? 1} onChange={(bathrooms) => set({ bathrooms })} max={4} maxLabel="4+" />
      </Group>

      <Group legend="Kitchen and living rooms">
        <OptionCards<KitchenLivingLayout>
          value={draft.layout}
          onChange={setLayout}
          options={[
            { value: "open-plan", label: "One open-plan kitchen and living room" },
            { value: "separate", label: "Separate kitchen and living room" },
            { value: "two-receptions", label: "Two living rooms and a kitchen" },
            { value: "other", label: "Something else" },
          ]}
        />
      </Group>

      <TextField
        label="Rough size of your home"
        optional
        hint="In square metres. It's on your EPC or the listing. We split it across your rooms."
      >
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
                set({ floorAreaM2: e.target.value && Number.isFinite(n) && n >= 10 && n <= 2000 ? n : undefined });
              }}
            />
            <span className="shrink-0 text-sm font-medium text-ink-500" aria-hidden>
              m²
            </span>
          </div>
        )}
      </TextField>
    </StepShell>
  );
}

/* ------------------------------------------------------------------ */
/* Last step: contact details and consent (name only at the very end)  */
/* ------------------------------------------------------------------ */

export interface ConsentState {
  operational: boolean;
  marketing: boolean;
}

export function DetailsStep({
  draft,
  setContact,
  setSurvey,
  step,
  totalSteps,
  onNext,
  onBack,
  busy,
  consent,
  setConsent,
  saveError,
}: StepProps & {
  consent: ConsentState;
  setConsent: (c: ConsentState) => void;
  saveError?: string | null;
}) {
  const c = draft.contact;
  const p = draft.survey.property;
  const [tried, setTried] = useState(false);
  const errors = {
    name: c.name.trim().length >= 2 ? null : "Add your name (at least two letters).",
    email: EMAIL_RE.test(c.email) ? null : "Add an email address like name@example.com.",
    phone: phoneOk(c.phone) ? null : "That number doesn't look right. Check it, or leave it blank.",
    consent: consent.operational ? null : "Tick the first box so we can save your quote and email it to you.",
  };
  const firstError = (Object.keys(errors) as (keyof typeof errors)[]).find((k) => errors[k]);
  const summaryRef = useRef<HTMLDivElement>(null);

  function submit() {
    setTried(true);
    if (firstError) {
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    onNext();
  }

  const show = (k: keyof typeof errors) => (tried ? errors[k] : null);

  return (
    <StepShell
      step={step}
      totalSteps={totalSteps}
      title="Nearly there"
      subtitle="Where should we send your quote? No phone calls unless you ask for one."
      onNext={submit}
      onBack={onBack}
      nextLabel={saveError ? "Try again" : "Save my quote"}
      busy={busy}
      busyLabel="Saving your quote…"
      footer={
        saveError ? (
          <p role="alert" className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {saveError}
          </p>
        ) : null
      }
    >
      {tried && firstError && (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 outline-none"
        >
          <p className="font-semibold">Just a couple of things before we save:</p>
          <ul className="mt-1 list-disc pl-5">
            {(Object.values(errors).filter(Boolean) as string[]).map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <TextField label="Your name" error={show("name")}>
        {(ctl) => (
          <input
            {...ctl}
            className={inputCls}
            value={c.name}
            autoComplete="name"
            onChange={(e) => setContact({ name: e.target.value })}
          />
        )}
      </TextField>
      <TextField label="Email" hint="Where your quote link goes." error={show("email")}>
        {(ctl) => (
          <input
            {...ctl}
            className={inputCls}
            type="email"
            inputMode="email"
            value={c.email}
            autoComplete="email"
            placeholder="you@example.com"
            onChange={(e) => setContact({ email: e.target.value.trim() })}
          />
        )}
      </TextField>
      <TextField
        label="Mobile number"
        optional
        hint="Only for appointment texts, like your surveyor's arrival time."
        error={show("phone")}
      >
        {(ctl) => (
          <input
            {...ctl}
            className={inputCls}
            type="tel"
            inputMode="tel"
            value={c.phone}
            autoComplete="tel"
            placeholder="07…"
            onChange={(e) => setContact({ phone: e.target.value })}
          />
        )}
      </TextField>
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
          value={c.timeframe}
          onChange={(timeframe) => setContact({ timeframe })}
          options={[
            { value: "asap", label: "As soon as I can" },
            { value: "1-3-months", label: "In 1–3 months" },
            { value: "researching", label: "Just researching" },
          ]}
        />
      </Group>

      <fieldset className="min-w-0 rounded-2xl border border-line bg-white px-4 py-2">
        <legend className="px-1 text-sm font-semibold text-ink-900">Keeping in touch</legend>
        <ConsentBox
          checked={consent.operational}
          onChange={(operational) => setConsent({ ...consent, operational })}
          label={OPERATIONAL_CONSENT.label}
          hint={OPERATIONAL_CONSENT.hint}
          error={show("consent")}
          required
        />
        <ConsentBox
          checked={consent.marketing}
          onChange={(marketing) => setConsent({ ...consent, marketing })}
          label={MARKETING_CONSENT.label}
          hint={MARKETING_CONSENT.hint}
        />
        <p className="pb-2 pt-1 text-xs leading-relaxed text-ink-500">
          How we use your details:{" "}
          <Link href="/privacy" target="_blank" rel="noopener" className="font-medium text-ink-700 underline underline-offset-2">
            privacy notice<span className="sr-only"> (opens in a new tab)</span>
          </Link>
          . How surveys, proposals and installs work:{" "}
          <Link href="/terms" target="_blank" rel="noopener" className="font-medium text-ink-700 underline underline-offset-2">
            terms<span className="sr-only"> (opens in a new tab)</span>
          </Link>
          . Saving a quote doesn&apos;t commit you to anything.
        </p>
      </fieldset>
    </StepShell>
  );
}

function ConsentBox({
  checked,
  onChange,
  label,
  hint,
  error,
  required,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
  error?: string | null;
  required?: boolean;
}) {
  const id = useId();
  return (
    <div className="border-b border-line last:border-0">
      <label htmlFor={id} className="flex min-h-12 cursor-pointer items-start gap-3 py-3">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
          aria-invalid={error ? true : undefined}
          aria-required={required || undefined}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-accent-700"
        />
        <span className="text-sm">
          <span className="font-semibold text-ink-900">
            {label}
            {!required && <span className="font-normal text-ink-500"> (optional)</span>}
          </span>
          <span id={`${id}-hint`} className="mt-0.5 block text-xs leading-relaxed text-ink-500">
            {hint}
          </span>
        </span>
      </label>
      {error && (
        <p id={`${id}-error`} className="-mt-1 mb-2 ml-8 text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
