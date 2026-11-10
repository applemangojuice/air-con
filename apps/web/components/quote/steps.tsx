"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { KitchenLivingLayout, Survey, SurveyGeo } from "@aircon/domain";
import { fetchKnownAddresses, type KnownAddress } from "@/lib/address-lookup";
import { isValidUkPostcode, normalisePostcode } from "@/lib/format";
import type { Contact, QuoteDraft } from "@/lib/quote-draft";
import { QUOTE_EMAIL_NOTICE, QUOTE_EMAIL_OPT_OUT } from "@/lib/follow-up-notice";
import { coverageFor, type PublicSettings } from "@/components/site/claims";
import { PostcodeSuggestions, usePostcodeSuggestions } from "@/components/site/postcode-suggestions";
import { OutOfArea } from "./out-of-area";
import { postcodeOutcome } from "./postcode-outcome";
import { StepShell, TextField, inputCls } from "./ui";

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
  /** Which screen this is; the heading takes focus when it changes. */
  step: number;
  /** The numbered form's length, only while they're in it (the price screen and the email gate aren't numbered). */
  totalSteps?: number;
  /** Position in that numbered form. */
  progressStep?: number;
  onNext: () => void;
  onBack?: () => void;
  busy?: boolean;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

/** Postcode → the addresses we know there (records first, then the licensed list). */
function useKnownAddresses(postcode: string, enabled: boolean) {
  const [known, setKnown] = useState<KnownAddress[]>([]);
  useEffect(() => {
    if (!enabled || !isValidUkPostcode(postcode)) {
      setKnown([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const list = await fetchKnownAddresses(postcode, controller.signal);
      if (!controller.signal.aborted) setKnown(list);
    }, 400);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [postcode, enabled]);
  return known;
}

/**
 * Where's your home: postcode, coverage, address. Shown only when the
 * marketing page didn't already give us an address (a direct visit, or an
 * address outside our area). No email here: the price comes first, and the
 * email is asked for when they go on to refine or save it.
 */
export function AddressStep({
  draft,
  settings,
  setSurvey,
  applyIntel,
  step,
  onNext,
  busy,
  notice,
}: StepProps & { notice?: string | null }) {
  const { postcode, addressLine } = draft.survey;
  const postcodeSuggestions = usePostcodeSuggestions(postcode);
  const check = usePostcodeCheck(postcode, (geo) => setSurvey({ geo }));
  const formatOk = isValidUkPostcode(postcode);
  const { covered, outcode } = coverageFor(settings.serviceArea, postcode);
  const { inArea, outOfArea, unverified, unknown } = postcodeOutcome(formatOk, check.state, covered);
  const known = useKnownAddresses(postcode, inArea);
  const [manual, setManual] = useState(false);
  const district = check.state === "found" ? check.geo.district : undefined;

  const ready = inArea && addressLine.trim().length >= 5;
  const showPicker = known.length > 0 && !manual;
  const pickedKey = known.find((k) => k.line1 === addressLine)?.line1 ?? "";

  const status =
    !formatOk || check.state === "idle"
      ? ""
      : check.state === "checking"
        ? "Checking your postcode…"
        : unknown
          ? "We couldn't find that postcode. Check it and try again."
          : unverified
            ? `We cover ${outcode}. We couldn't look your exact postcode up (new ones take a while to reach the lists), so if it's right, carry on.`
            : covered
            ? `Good news, we cover ${outcode}${district ? ` in ${district}` : ""}.`
            : `Sorry, we're not in ${district ?? outcode} yet.`;

  return (
    <StepShell
      step={step}
      title="Where's your home?"
      subtitle="Your postcode and house, and your price is on the next screen. No email needed to see it."
      onNext={outOfArea ? undefined : onNext}
      nextDisabled={!ready}
      busy={busy}
      busyLabel="Working out your price…"
      nextLabel="Show my price"
    >
      {notice && (
        <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {notice}
        </p>
      )}

      <TextField label="Postcode" hint="We install in a handful of London postcodes for now.">
        {(c) => (
          <input
            {...c}
            aria-describedby={[c["aria-describedby"], "postcode-status"].filter(Boolean).join(" ")}
            aria-invalid={unknown ? true : undefined}
            className={`${inputCls} uppercase`}
            value={postcode}
            autoComplete="postal-code"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="e.g. SW16 2BE"
            list={postcodeSuggestions.length > 0 ? "quote-postcode-suggestions" : undefined}
            onChange={(e) => setSurvey({ postcode: e.target.value.toUpperCase() })}
            onBlur={(e) => setSurvey({ postcode: normalisePostcode(e.target.value) })}
          />
        )}
      </TextField>

      <PostcodeSuggestions id="quote-postcode-suggestions" suggestions={postcodeSuggestions} />

      {/* One live region for the whole check: screen readers hear the outcome. */}
      <div id="postcode-status" aria-live="polite" className="-mt-4">
        {status && check.state === "checking" && <p className="text-sm text-ink-500">{status}</p>}
        {status && unknown && <p className="text-sm font-medium text-red-700">{status}</p>}
        {inArea && (
          <div className={`rounded-2xl border p-4 ${unverified ? "border-amber-200 bg-amber-50" : "border-sage-200 bg-sage-50"}`}>
            <p className={`text-sm font-semibold ${unverified ? "text-amber-900" : "text-sage-900"}`}>{status}</p>
            <p className={`mt-1 text-sm ${unverified ? "text-amber-900" : "text-sage-800"}`}>
              Tell us which house and your price appears. No salesperson, and nobody rings you to &ldquo;just follow
              up&rdquo;.
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
          email={draft.contact.email}
          postcode={normalisePostcode(postcode)}
          addressLine={addressLine}
          draftId={draft.draftId}
        />
      )}

      {inArea &&
        (showPicker ? (
          <TextField label="Your address" hint="If we hold public records for your home, picking it fills in your details.">
            {(c) => (
              <>
                <select
                  {...c}
                  className={inputCls}
                  value={pickedKey}
                  onChange={(e) => {
                    const match = known.find((k) => k.line1 === e.target.value);
                    if (!match) return;
                    setSurvey({ addressLine: match.line1 });
                    if (match.intelId) void applyIntel?.(match.intelId);
                  }}
                >
                  <option value="" disabled>
                    Choose your address…
                  </option>
                  {known.map((k) => (
                    <option key={k.line1} value={k.line1}>
                      {k.line1}
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
        ))}
    </StepShell>
  );
}

/* ------------------------------------------------------------------ */
/* The email gate: before refining the guide price                      */
/* ------------------------------------------------------------------ */

/**
 * The point where we ask for an email: once they've seen their guide price
 * and want to refine it. Looking costs nothing; from here the quote is
 * saved as they go, and a link to it is emailed if they stop. The address
 * is confirmed here too, because the marketing page may only have given us
 * a house number.
 *
 * Emails, at the legal minimum (lib/follow-up-notice.ts): one line saying
 * what we'll send, and one unticked box to refuse the reminder and news.
 * No tick is needed for emails about the quote they asked for.
 *
 * Coming back with the email and postcode of an unfinished quote: we email
 * that quote's link instead of starting a second one, and say so here.
 */
export function RefineGateStep({
  draft,
  setSurvey,
  setContact,
  step,
  onNext,
  onBack,
  busy,
  setReminder,
  resumeSent,
  onStartFresh,
}: StepProps & { setReminder: (reminder: boolean) => void; resumeSent?: boolean; onStartFresh?: () => void }) {
  const { addressLine } = draft.survey;
  const email = draft.contact.email;
  const emailOk = EMAIL_RE.test(email);
  const addressOk = addressLine.trim().length >= 5;
  const [tried, setTried] = useState(false);
  const optOutId = useId();

  if (resumeSent) {
    return (
      <StepShell
        step={step}
        title="Welcome back"
        subtitle="You already have a quote on the go for this postcode, with your answers saved."
        onNext={onStartFresh}
        onBack={onBack}
        busy={busy}
        busyLabel="Starting…"
        nextLabel="Start a new quote here instead"
      >
        <div role="status" className="rounded-2xl border border-sage-200 bg-sage-50 p-4">
          <p className="text-sm font-semibold text-sage-900">We&apos;ve emailed you a link</p>
          <p className="mt-1 text-sm text-sage-800">
            Check {email} for a link that picks up exactly where you left off, on this phone or any other.
          </p>
        </div>
      </StepShell>
    );
  }

  return (
    <StepShell
      step={step}
      title="Refine your quote"
      subtitle="Your email first, so your quote is saved as you go. Then your rooms, with what we know already filled in."
      onNext={() => {
        setTried(true);
        if (emailOk && addressOk) onNext();
      }}
      onBack={onBack}
      busy={busy}
      busyLabel="Saving…"
      nextLabel="Continue"
    >
      <TextField
        label="Your address"
        hint="House number and street."
        error={tried && !addressOk ? "Add your house number and street." : null}
      >
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
      <TextField
        label="Email"
        hint={QUOTE_EMAIL_NOTICE}
        error={tried && !emailOk ? "Add an email address like name@example.com." : null}
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
      {/* The one box: unticked, and ticking it refuses the reminder and the news (lib/follow-up-notice). */}
      <label htmlFor={optOutId} className="-mt-4 flex min-h-10 cursor-pointer items-center gap-2.5 text-xs text-ink-500">
        <input
          id={optOutId}
          type="checkbox"
          checked={draft.reminder === false}
          onChange={(e) => setReminder(!e.target.checked)}
          className="h-4 w-4 shrink-0 accent-accent-700"
        />
        {QUOTE_EMAIL_OPT_OUT.label}
      </label>
    </StepShell>
  );
}

/** Kitchen and living rooms, in the customer's words. */
export const LAYOUT_OPTIONS: { value: KitchenLivingLayout; label: string }[] = [
  { value: "open-plan", label: "One kitchen and living area" },
  { value: "separate", label: "Separate kitchen area and living room" },
  { value: "two-receptions", label: "Two living rooms and a kitchen area" },
  { value: "other", label: "Something else" },
];
