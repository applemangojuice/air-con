"use client";

import { useEffect, useRef, useState } from "react";
import type { Survey } from "@aircon/domain";
import {
  clearDraft,
  loadDraft,
  newDraft,
  saveDraft,
  type Contact,
  type QuoteDraft,
} from "@/lib/quote-draft";
import { submitQuote } from "@/lib/submit-quote";
import { normalisePostcode } from "@/lib/format";
import {
  AddressStep,
  ContactStep,
  ElectricsStep,
  OutdoorStep,
  PropertyStep,
  type StepProps,
} from "./steps";
import { RoomsStep } from "./rooms-step";
import { QuoteResult, type SubmissionState } from "./result";

const FORM_STEPS = 6; // address, property, rooms, outdoor, electrics, contact
const RESULT = FORM_STEPS;

export function QuoteWizard({ initialPostcode }: { initialPostcode?: string }) {
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

  async function finish() {
    setBusy(true);
    const result = await submitQuote(draft);
    setSubmission(result);
    setBusy(false);
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
    step,
    totalSteps: FORM_STEPS,
    onNext: () => setStep(step + 1),
    onBack: step > 0 ? () => setStep(step - 1) : undefined,
  };

  switch (step) {
    case 0:
      return <AddressStep {...common} />;
    case 1:
      return <PropertyStep {...common} />;
    case 2:
      return <RoomsStep {...common} />;
    case 3:
      return <OutdoorStep {...common} />;
    case 4:
      return <ElectricsStep {...common} />;
    default:
      return <ContactStep {...common} onNext={finish} busy={busy} />;
  }
}
