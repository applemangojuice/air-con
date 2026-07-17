"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildDefaultConfig,
  generateQuote,
  type KitchenLivingLayout,
  type Survey,
} from "@aircon/domain";
import {
  clearDraft,
  loadDraft,
  newDraft,
  saveDraft,
  type Contact,
  type QuoteDraft,
} from "@/lib/quote-draft";
import { submitQuote } from "@/lib/submit-quote";
import { track } from "@/lib/analytics-client";
import { normalisePostcode } from "@/lib/format";
import { AddressStep, DetailsStep, HouseStep, type StepProps } from "./steps";
import { RoomsStep } from "./rooms-step";
import { QuoteResult, type SubmissionState } from "./result";
import { TimelineStrip } from "@/components/project/timeline";

// address+email → house → rooms(+price) → details
const FORM_STEPS = 4;
const RESULT = FORM_STEPS;

export function QuoteWizard({
  initialPostcode,
  initialIntel,
}: {
  initialPostcode?: string;
  initialIntel?: string;
}) {
  const [draft, setDraft] = useState<QuoteDraft>(() =>
    newDraft(initialPostcode ? normalisePostcode(initialPostcode) : ""),
  );
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [submission, setSubmission] = useState<SubmissionState | null>(null);
  const restored = useRef(false);

  // Restore a saved draft once, on the client.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const saved = loadDraft();
    if (saved) {
      setDraft((current) => ({
        ...saved,
        survey: {
          ...saved.survey,
          // A postcode arriving from the homepage wins over the saved one.
          postcode: initialPostcode
            ? normalisePostcode(initialPostcode)
            : saved.survey.postcode,
        },
      }));
    }
  }, [initialPostcode]);

  useEffect(() => {
    saveDraft(draft);
  }, [draft]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

  const setSurvey = (update: Partial<Survey>) =>
    setDraft((d) => ({ ...d, survey: { ...d.survey, ...update } }));
  const setContact = (update: Partial<Contact>) =>
    setDraft((d) => ({ ...d, contact: { ...d.contact, ...update } }));
  const setLayout = (layout: KitchenLivingLayout) =>
    setDraft((d) => ({ ...d, layout }));

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

  /** Save-early: the enquiry exists in the database from the first step. */
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
      body: JSON.stringify({ survey: current.survey }),
    }).catch(() => undefined);
  }

  async function nextFromAddress() {
    if (draft.draftId) {
      setStep(1);
      return;
    }
    setBusy(true);
    const id = await saveServerDraft(draft);
    setBusy(false);
    track("quote_start", { postcode: draft.survey.postcode, draftSaved: Boolean(id) });
    if (id) setDraft((d) => ({ ...d, draftId: id }));
    setStep(1);
  }

  function nextFromHouse() {
    // (Re)generate the default rooms from the house answers, apply the
    // auto-chosen outdoor position and install pattern, then show the price.
    const updated: QuoteDraft = {
      ...draft,
      configured: true,
      survey: {
        ...draft.survey,
        archetypeId: config.archetypeId,
        permutationId: config.permutationId,
        rooms: config.rooms,
        outdoor: { ...draft.survey.outdoor, location: config.outdoorDefault },
      },
    };
    setDraft(updated);
    syncServerDraft(updated);
    setStep(2);
  }

  function nextFromRooms() {
    syncServerDraft(draft);
    setStep(3);
  }

  async function finish() {
    setBusy(true);
    const result = await submitQuote(draft);
    setSubmission(result);
    setBusy(false);
    const quote = generateQuote(draft.survey);
    track("quote_submit", {
      status: result.status,
      totalGbp: quote.totalGbp,
      rooms: draft.survey.rooms.length,
      postcode: draft.survey.postcode,
    });
    if (result.status === "error") track("quote_save_failed", { postcode: draft.survey.postcode });
    setStep(RESULT);
  }

  function startOver() {
    clearDraft();
    setDraft(newDraft());
    setSubmission(null);
    setStep(0);
  }

  if (step === RESULT) {
    return <QuoteResult draft={draft} submission={submission} onStartOver={startOver} />;
  }

  const common: StepProps = {
    draft,
    setSurvey,
    setContact,
    setLayout,
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
        return <AddressStep {...common} onNext={nextFromAddress} />;
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
      default:
        return <DetailsStep {...common} onNext={finish} />;
    }
  })();

  return (
    <>
      {/* Address in → the whole journey appears: quote, dot dot dot. */}
      {step > 0 && (
        <div className="mx-auto w-full max-w-xl px-4 pt-6 sm:px-0">
          <TimelineStrip current="quote" />
        </div>
      )}
      {stepView}
    </>
  );
}
