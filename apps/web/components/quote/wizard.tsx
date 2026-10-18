"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  buildDefaultConfig,
  generateQuote,
  type KitchenLivingLayout,
  type Survey,
} from "@aircon/domain";
import {
  clearDraft,
  loadDraft,
  mapSurveyPhotos,
  newDraft,
  saveDraft,
  type Contact,
  type QuoteDraft,
} from "@/lib/quote-draft";
import { submitQuote } from "@/lib/submit-quote";
import { track } from "@/lib/analytics-client";
import { normalisePostcode } from "@/lib/format";
import { coverageFor, type PublicSettings } from "@/components/site/claims";
import { AddressStep, DetailsStep, HouseStep, type ConsentState, type StepProps } from "./steps";
import { RoomsStep } from "./rooms-step";
import { FirmUpStep } from "./firm-up-step";
import { DemoResult } from "./result";
import { JourneyStrip } from "./journey-strip";

// postcode+address → house → rooms (price) → firm up (optional photos) → details
const FORM_STEPS = 5;
const LAST_STEP = FORM_STEPS - 1;

export function QuoteWizard({
  initialPostcode,
  initialIntel,
  settings,
}: {
  initialPostcode?: string;
  initialIntel?: string;
  settings: PublicSettings;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<QuoteDraft>(() =>
    newDraft(initialPostcode ? normalisePostcode(initialPostcode) : ""),
  );
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Consent is given fresh on the last step, never restored from storage.
  const [consent, setConsent] = useState<ConsentState>({ operational: false, marketing: false });
  const restored = useRef(false);
  const finished = useRef(false);

  // Restore a saved draft once, on the client, and put them back on the step
  // they were on (a refresh, or a tab the phone discarded, loses nothing).
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const saved = loadDraft();
    if (saved) {
      const fromLink = initialPostcode ? normalisePostcode(initialPostcode) : null;
      const postcode = fromLink ?? saved.survey.postcode;
      const samePostcode = !fromLink || fromLink.replace(/\s/g, "") === saved.survey.postcode.replace(/\s/g, "");
      setDraft({ ...saved, survey: { ...saved.survey, postcode } });
      const s = saved.step ?? 0;
      const resumable =
        samePostcode &&
        coverageFor(settings.serviceArea, postcode).covered &&
        saved.survey.addressLine.trim().length >= 5;
      if (resumable && s >= 1 && s <= LAST_STEP) {
        setStep(s >= 2 && (!saved.configured || saved.survey.rooms.length === 0) ? 1 : s);
      }
    }
    setReady(true);
  }, [initialPostcode, settings.serviceArea]);

  useEffect(() => {
    if (ready && !finished.current) saveDraft({ ...draft, step });
  }, [draft, step, ready]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

  const setSurvey = (update: Partial<Survey>) => setDraft((d) => ({ ...d, survey: { ...d.survey, ...update } }));
  const setContact = (update: Partial<Contact>) => setDraft((d) => ({ ...d, contact: { ...d.contact, ...update } }));
  const setLayout = (layout: KitchenLivingLayout) => setDraft((d) => ({ ...d, layout }));

  /** A photo reached storage: record its path wherever it sits in the survey. */
  const onPhotoUploaded = useCallback((photoId: string, storagePath: string) => {
    setDraft((d) => ({
      ...d,
      survey: mapSurveyPhotos(d.survey, (p) => (p.id === photoId ? { ...p, storagePath } : p)),
    }));
  }, []);

  /**
   * Property Intelligence prefill: the customer picked a known address (or
   * arrived from their letter's link), so pre-answer the house questions
   * from public records. The flow doesn't change, they just confirm.
   */
  async function applyIntel(intelId: string) {
    try {
      const res = await fetch(`/api/intel/property/${intelId}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        addressLine: string;
        postcode: string;
        prefill: {
          type?: Survey["property"]["type"];
          era?: Survey["property"]["era"];
          bedrooms?: number;
          floorAreaM2?: number;
        };
      };
      setDraft((d) => ({
        ...d,
        intelId,
        prefilledFromIntel: Boolean(data.prefill.type || data.prefill.bedrooms),
        survey: {
          ...d.survey,
          postcode: data.postcode,
          addressLine: data.addressLine,
          property: {
            ...d.survey.property,
            ...(data.prefill.type ? { type: data.prefill.type } : {}),
            ...(data.prefill.era ? { era: data.prefill.era } : {}),
            ...(data.prefill.bedrooms ? { bedrooms: data.prefill.bedrooms } : {}),
            ...(data.prefill.floorAreaM2 ? { floorAreaM2: data.prefill.floorAreaM2 } : {}),
          },
        },
      }));
    } catch {
      // Prefill is a bonus; the funnel works without it.
    }
  }

  // Arriving from a per-address page: load that property's profile once.
  useEffect(() => {
    if (initialIntel) void applyIntel(initialIntel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialIntel]);

  // Exclusions and outdoor options derive deterministically from the house
  // answers, recomputed live so the rooms screen always matches them.
  const config = useMemo(() => {
    const p = draft.survey.property;
    return buildDefaultConfig({
      type: p.type,
      era: p.era,
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms ?? 1,
      layout: draft.layout,
      floorAreaM2: p.floorAreaM2,
    });
  }, [draft.survey.property, draft.layout]);

  /** Save-early: the enquiry exists in the database from the first step (only with an email). */
  async function saveServerDraft(current: QuoteDraft): Promise<string | undefined> {
    try {
      const res = await fetch("/api/quotes/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: current.contact.email, survey: current.survey }),
      });
      if (!res.ok) return undefined;
      const data = (await res.json()) as { demo: boolean; id?: string };
      return data.id;
    } catch {
      return undefined;
    }
  }

  function syncServerDraft(current: QuoteDraft) {
    if (!current.draftId) return;
    fetch(`/api/quotes/draft/${current.draftId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      // Email travels too: a corrected address must reach the server draft,
      // or the follow-up email goes to the typo.
      body: JSON.stringify({ survey: current.survey, email: current.contact.email || undefined }),
    }).catch(() => undefined);
  }

  async function nextFromAddress() {
    // Enter submits without blurring, so normalise the postcode here rather
    // than relying on the field's onBlur having fired.
    const normalised: QuoteDraft = {
      ...draft,
      survey: { ...draft.survey, postcode: normalisePostcode(draft.survey.postcode) },
    };
    if (!coverageFor(settings.serviceArea, normalised.survey.postcode).covered) return;
    setDraft(normalised);
    setNotice(null);
    if (normalised.draftId) {
      // Returning visitor: still counts as entering the funnel, and the sync
      // carries any corrected email.
      track("quote_start", { postcode: normalised.survey.postcode, resumed: true });
      syncServerDraft(normalised);
      setStep(1);
      return;
    }
    if (!normalised.contact.email) {
      // No email given (price before details): local draft only.
      track("quote_start", { postcode: normalised.survey.postcode, draftSaved: false });
      setStep(1);
      return;
    }
    setBusy(true);
    const id = await saveServerDraft(normalised);
    setBusy(false);
    track("quote_start", { postcode: normalised.survey.postcode, draftSaved: Boolean(id) });
    if (id) setDraft((d) => ({ ...d, draftId: id }));
    setStep(1);
  }

  function nextFromHouse() {
    // (Re)generate the default rooms from the house answers, apply the
    // auto-chosen outdoor position and install pattern, then show the price.
    // Photos already taken for a room of the same name are kept.
    const previous = new Map(draft.survey.rooms.map((r) => [r.name, r.photos]));
    const updated: QuoteDraft = {
      ...draft,
      configured: true,
      survey: {
        ...draft.survey,
        archetypeId: config.archetypeId,
        permutationId: config.permutationId,
        rooms: config.rooms.map((r) => ({ ...r, photos: previous.get(r.name) ?? r.photos })),
        outdoor: { ...draft.survey.outdoor, location: config.outdoorDefault },
      },
    };
    setDraft(updated);
    syncServerDraft(updated);
    track("quote_step", { step: "house", to: "rooms" });
    setStep(2);
  }

  function nextFromRooms() {
    syncServerDraft(draft);
    track("quote_step", { step: "rooms", to: "firm-up", rooms: draft.survey.rooms.length });
    setStep(3);
  }

  function nextFromFirmUp() {
    syncServerDraft(draft);
    const photos =
      draft.survey.outdoor.photos.length +
      draft.survey.electrics.photos.length +
      draft.survey.rooms.reduce((n, r) => n + r.photos.length, 0);
    track("quote_step", { step: "firm-up", to: "details", photos });
    setStep(4);
  }

  async function finish() {
    if (!consent.operational) return;
    setBusy(true);
    setSaveError(null);
    const result = await submitQuote(draft, { marketing: consent.marketing });
    const quote = generateQuote(draft.survey);
    track("quote_submit", {
      status: result.status,
      totalGbp: quote.totalGbp,
      rooms: draft.survey.rooms.length,
      postcode: draft.survey.postcode,
      marketing: consent.marketing,
    });
    if (result.status === "saved") {
      // The quote now lives at its permanent link, which survives a refresh.
      finished.current = true;
      clearDraft();
      router.replace(`/q/${result.id}?saved=1${result.emailed ? "&emailed=1" : ""}`);
      return; // stay busy while the page changes
    }
    setBusy(false);
    if (result.status === "demo") {
      finished.current = true;
      clearDraft();
      setDemo(true);
      return;
    }
    if (result.status === "out-of-area") {
      setNotice(
        `We don't install in ${result.outcode || "that postcode"} at the moment, so we couldn't save this quote. Check the postcode, or leave your email and we'll tell you when we get there.`,
      );
      setStep(0);
      return;
    }
    track("quote_save_failed", { postcode: draft.survey.postcode });
    setSaveError(
      result.message ??
        `We couldn't save your quote just now. Your answers are kept on this device, so check your signal and try again. If it keeps happening, email ${settings.company.email}.`,
    );
  }

  function startOver() {
    finished.current = false;
    clearDraft();
    setDraft(newDraft());
    setConsent({ operational: false, marketing: false });
    setSaveError(null);
    setNotice(null);
    setDemo(false);
    setStep(0);
  }

  if (demo) {
    return <DemoResult draft={draft} settings={settings} onStartOver={startOver} />;
  }

  const common: StepProps = {
    draft,
    settings,
    setSurvey,
    setContact,
    setLayout,
    onPhotoUploaded,
    applyIntel,
    step,
    totalSteps: FORM_STEPS,
    onNext: () => setStep(step + 1),
    onBack: step > 0 ? () => setStep(step - 1) : undefined,
    busy,
  };

  const stepView = (() => {
    switch (step) {
      case 0:
        return <AddressStep {...common} onNext={nextFromAddress} notice={notice} />;
      case 1:
        return <HouseStep {...common} onNext={nextFromHouse} />;
      case 2:
        return (
          <RoomsStep
            {...common}
            onNext={nextFromRooms}
            excluded={config.excluded}
            outdoorOptions={config.outdoorOptions}
          />
        );
      case 3:
        return <FirmUpStep {...common} onNext={nextFromFirmUp} />;
      default:
        return (
          <DetailsStep
            {...common}
            onNext={finish}
            consent={consent}
            setConsent={setConsent}
            saveError={saveError}
          />
        );
    }
  })();

  return (
    <>
      {/* Address in → the whole journey appears: price first, then the rest. */}
      {step > 0 && (
        <div className="mx-auto w-full max-w-xl px-4 pt-6 sm:px-0">
          <JourneyStrip current="price" />
        </div>
      )}
      {stepView}
    </>
  );
}
