"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buildDefaultConfig, type KitchenLivingLayout, type NeighbourGuess, type Survey } from "@aircon/domain";
import { fetchKnownAddresses, matchHouse } from "@/lib/address-lookup";
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
import { REMINDER_NOTICE_VERSION } from "@/lib/follow-up-notice";
import { track } from "@/lib/analytics-client";
import { isValidUkPostcode, normalisePostcode } from "@/lib/format";
import { coverageFor, type PublicSettings } from "@/components/site/claims";
import { AddressStep, DetailsStep, HouseStep, RefineGateStep, type ConsentState, type GateIntent, type StepProps } from "./steps";
import { PriceStep } from "./price-step";
import { RoomsStep } from "./rooms-step";
import { FirmUpStep } from "./firm-up-step";
import { DemoResult } from "./result";
import { JourneyStrip } from "./journey-strip";

/**
 * Price first. The address comes in (from the home page, or the address
 * screen), the home is filled in from what we know, and the price is the
 * next thing they see. Going further costs an email: then the numbered
 * refine form (home → rooms → photos → save), or straight to saving.
 *
 *   address? → PRICE → email gate → house → rooms → firm up → details
 *                                 ↘ (save) ─────────────────→ details
 */
const STEP = { address: 0, price: 1, gate: 2, house: 3, rooms: 4, firmUp: 5, details: 6 } as const;
const REFINE_STEPS = 4; // house, rooms, firm up, details
/** How long we wait for records before pricing a typical home instead. */
const PREFILL_TIMEOUT_MS = 6000;

export function QuoteWizard({
  initialPostcode,
  initialAddress,
  initialIntel,
  settings,
}: {
  initialPostcode?: string;
  /** The house (number, name or full line) typed on the marketing page. */
  initialAddress?: string;
  initialIntel?: string;
  settings: PublicSettings;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<QuoteDraft>(() => newDraft(initialPostcode ? normalisePostcode(initialPostcode) : ""));
  const [step, setStep] = useState<number>(STEP.address);
  const [intent, setIntent] = useState<GateIntent>("refine");
  const [ready, setReady] = useState(false);
  const [pricing, setPricing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Consent is given fresh on the last step, never restored from storage.
  const [consent, setConsent] = useState<ConsentState>({ operational: false, marketing: false });
  const restored = useRef(false);
  const finished = useRef(false);
  const pricingRun = useRef(0);

  // First load: an address from the marketing page is priced straight away;
  // otherwise a saved draft goes back to the screen it was on (a refresh, or
  // a tab the phone discarded, loses nothing); otherwise the address screen.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const fromLink = initialPostcode ? normalisePostcode(initialPostcode) : null;
    if (fromLink && (initialAddress || initialIntel)) {
      const fresh: QuoteDraft = {
        ...newDraft(fromLink),
        survey: { ...newDraft(fromLink).survey, addressLine: initialAddress ?? "" },
        ...(initialIntel ? { intelId: initialIntel } : {}),
      };
      // Drop the query so a refresh restores the saved draft instead of starting again.
      window.history.replaceState(null, "", "/quote");
      setReady(true);
      void showInstantPrice(fresh);
      return;
    }
    const saved = loadDraft();
    if (saved) {
      const postcode = fromLink ?? saved.survey.postcode;
      const samePostcode = !fromLink || fromLink.replace(/\s/g, "") === saved.survey.postcode.replace(/\s/g, "");
      setDraft({ ...saved, survey: { ...saved.survey, postcode } });
      const s = saved.step ?? STEP.address;
      const priced = saved.configured && saved.survey.rooms.length > 0;
      if (samePostcode && priced && coverageFor(settings.serviceArea, postcode).covered && s >= STEP.price && s <= STEP.details) {
        // The gate itself isn't a place to come back to: the price is.
        setStep(s === STEP.gate ? STEP.price : s);
      }
    }
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ready && !finished.current && !pricing) saveDraft({ ...draft, step });
  }, [draft, step, ready, pricing]);

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

  /** Property Intelligence prefill from the address screen's picker. */
  async function applyIntel(intelId: string) {
    const record = await fetchRecord(intelId);
    if (record) setDraft((d) => withRecord(d, intelId, record));
  }

  // Exclusions and outdoor options derive deterministically from the house
  // answers, recomputed live so the rooms screen always matches them.
  const config = useMemo(() => configFor(draft), [draft]);

  /**
   * The instant price. Coverage first (outside our area, the address screen
   * says so). Then the home is filled in: public records for the address
   * when we hold them, the homes around it when we don't, a typical home
   * when the lookups fail or take too long. Then rooms, and the price.
   */
  async function showInstantPrice(base: QuoteDraft) {
    const postcode = normalisePostcode(base.survey.postcode);
    let d: QuoteDraft = { ...base, survey: { ...base.survey, postcode } };
    setNotice(null);
    if (!coverageFor(settings.serviceArea, postcode).covered) {
      setDraft(d);
      setStep(STEP.address);
      return;
    }
    const run = ++pricingRun.current;
    setDraft(d);
    setPricing(true);
    setStep(STEP.price);
    d = await Promise.race([prefill(d), new Promise<QuoteDraft>((resolve) => setTimeout(() => resolve(d), PREFILL_TIMEOUT_MS))]);
    if (run !== pricingRun.current) return; // they changed the address meanwhile
    // Photos already taken for a room of the same name are kept across re-pricing.
    const priced = configure(d);
    setDraft(priced);
    setPricing(false);
    track("quote_start", { prefill: priced.prefillSource ?? "typical", fromLink: Boolean(initialAddress || initialIntel) });
  }

  /** Save-early: the enquiry exists in the database from the email gate on. */
  async function saveServerDraft(current: QuoteDraft): Promise<string | undefined> {
    try {
      const res = await fetch("/api/quotes/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: current.contact.email, survey: current.survey, ...reminderFields(current) }),
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
      body: JSON.stringify({ survey: current.survey, email: current.contact.email || undefined, ...reminderFields(current) }),
    }).catch(() => undefined);
  }

  /** Address screen → the price. */
  function nextFromAddress() {
    void showInstantPrice(draft);
  }

  /** Price screen → the email gate, remembering where they're headed. */
  function openGate(which: GateIntent) {
    setIntent(which);
    track("quote_gate", { intent: which });
    setStep(STEP.gate);
  }

  /** The email gate → refine (house) or save (details). The server draft starts here. */
  async function nextFromGate() {
    // The reminder box sits under the email: leaving it is their answer (ticked unless they unticked it).
    let current: QuoteDraft = { ...draft, reminder: draft.reminder !== false };
    setNotice(null);
    if (current.draftId) {
      syncServerDraft(current);
    } else {
      setBusy(true);
      const id = await saveServerDraft(current);
      setBusy(false);
      if (id) current = { ...current, draftId: id };
    }
    setDraft(current);
    track("quote_refine", { intent, draftSaved: Boolean(current.draftId) });
    setStep(intent === "refine" ? STEP.house : STEP.details);
  }

  function nextFromHouse() {
    // (Re)generate the default rooms from the house answers, apply the
    // auto-chosen outdoor position and install pattern, then show the price.
    const updated = configure(draft);
    setDraft(updated);
    syncServerDraft(updated);
    track("quote_step", { step: "house", to: "rooms" });
    setStep(STEP.rooms);
  }

  function nextFromRooms() {
    syncServerDraft(draft);
    track("quote_step", { step: "rooms", to: "firm-up", rooms: draft.survey.rooms.length });
    setStep(STEP.firmUp);
  }

  function nextFromFirmUp() {
    syncServerDraft(draft);
    const photos =
      draft.survey.outdoor.photos.length +
      draft.survey.electrics.photos.length +
      draft.survey.rooms.reduce((n, r) => n + r.photos.length, 0);
    track("quote_step", { step: "firm-up", to: "details", photos });
    setStep(STEP.details);
  }

  async function finish() {
    if (!consent.operational) return;
    setBusy(true);
    setSaveError(null);
    const result = await submitQuote(draft, { marketing: consent.marketing });
    // How far they got, never what they typed or what it cost (the privacy notice's analytics list).
    track("quote_submit", { status: result.status, rooms: draft.survey.rooms.length });
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
      setStep(STEP.address);
      return;
    }
    track("quote_save_failed", {});
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
    setIntent("refine");
    setStep(STEP.address);
  }

  if (demo) {
    return <DemoResult draft={draft} settings={settings} onStartOver={startOver} />;
  }

  // The numbered form is the refine path only; saving straight away has one screen left.
  const inRefineForm = intent === "refine" && step >= STEP.house;
  const common: StepProps = {
    draft,
    settings,
    setSurvey,
    setContact,
    setLayout,
    onPhotoUploaded,
    applyIntel,
    step,
    ...(inRefineForm ? { totalSteps: REFINE_STEPS, progressStep: step - STEP.house } : {}),
    onNext: () => setStep(step + 1),
    onBack: step > STEP.address ? () => setStep(step - 1) : undefined,
    busy,
  };
  const setReminder = (reminder: boolean) => setDraft((d) => ({ ...d, reminder }));

  const stepView = (() => {
    switch (step) {
      case STEP.address:
        return <AddressStep {...common} onNext={nextFromAddress} notice={notice} busy={pricing} />;
      case STEP.price:
        return (
          <PriceStep
            draft={draft}
            settings={settings}
            step={step}
            pricing={pricing}
            excluded={config.excluded}
            onRefine={() => openGate("refine")}
            onSave={() => openGate("save")}
            onChangeAddress={() => {
              pricingRun.current++; // abandon a lookup still running
              setPricing(false);
              setStep(STEP.address);
            }}
          />
        );
      case STEP.gate:
        return <RefineGateStep {...common} intent={intent} onNext={nextFromGate} onBack={() => setStep(STEP.price)} setReminder={setReminder} />;
      case STEP.house:
        return <HouseStep {...common} onNext={nextFromHouse} onBack={() => setStep(STEP.price)} />;
      case STEP.rooms:
        return <RoomsStep {...common} onNext={nextFromRooms} excluded={config.excluded} outdoorOptions={config.outdoorOptions} />;
      case STEP.firmUp:
        return <FirmUpStep {...common} onNext={nextFromFirmUp} />;
      default:
        return (
          <DetailsStep
            {...common}
            onNext={finish}
            onBack={() => setStep(intent === "save" ? STEP.price : STEP.firmUp)}
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
      {step > STEP.address && (
        <div className="mx-auto w-full max-w-xl px-4 pt-6 sm:px-0">
          <JourneyStrip current="price" />
        </div>
      )}
      {stepView}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Filling the home in                                                 */
/* ------------------------------------------------------------------ */

interface IntelRecord {
  addressLine: string;
  postcode: string;
  prefill: {
    type?: Survey["property"]["type"];
    era?: Survey["property"]["era"];
    bedrooms?: number;
    floorAreaM2?: number;
  };
}

async function fetchRecord(intelId: string): Promise<IntelRecord | null> {
  try {
    const res = await fetch(`/api/intel/property/${intelId}`);
    return res.ok ? ((await res.json()) as IntelRecord) : null;
  } catch {
    return null;
  }
}

async function fetchNeighbourGuess(postcode: string): Promise<NeighbourGuess | null> {
  try {
    const res = await fetch(`/api/intel/guess?postcode=${encodeURIComponent(postcode)}`);
    if (!res.ok) return null;
    return ((await res.json()) as { guess: NeighbourGuess | null }).guess;
  } catch {
    return null;
  }
}

/** The draft with the house answers pre-filled from public records for this address. */
function withRecord(d: QuoteDraft, intelId: string, record: IntelRecord): QuoteDraft {
  const known = Boolean(record.prefill.type || record.prefill.bedrooms);
  return {
    ...d,
    intelId,
    prefilledFromIntel: known,
    ...(known ? { prefillSource: "records" as const } : {}),
    survey: {
      ...d.survey,
      postcode: record.postcode,
      addressLine: record.addressLine,
      property: {
        ...d.survey.property,
        ...(record.prefill.type ? { type: record.prefill.type } : {}),
        ...(record.prefill.era ? { era: record.prefill.era } : {}),
        ...(record.prefill.bedrooms ? { bedrooms: record.prefill.bedrooms } : {}),
        ...(record.prefill.floorAreaM2 ? { floorAreaM2: record.prefill.floorAreaM2 } : {}),
      },
    },
  };
}

/** The draft with the house answers guessed from the homes at the same postcode. */
function withNeighbours(d: QuoteDraft, guess: NeighbourGuess): QuoteDraft {
  return {
    ...d,
    prefilledFromIntel: false,
    prefillSource: "neighbours",
    survey: {
      ...d.survey,
      property: {
        ...d.survey.property,
        ...(guess.type ? { type: guess.type } : {}),
        ...(guess.era ? { era: guess.era } : {}),
        ...(guess.bedrooms ? { bedrooms: guess.bedrooms } : {}),
        ...(guess.floorAreaM2 ? { floorAreaM2: guess.floorAreaM2 } : {}),
      },
    },
  };
}

/**
 * Fill the home in before asking a single question: the record for the
 * exact address (matching a bare house number to the street we know), else
 * the neighbours' homes, else leave the typical-home defaults. Every lookup
 * is a bonus; the price works without any of them.
 */
async function prefill(d: QuoteDraft): Promise<QuoteDraft> {
  const { postcode } = d.survey;
  let intelId = d.intelId;
  let addressLine = d.survey.addressLine;
  if (!intelId && isValidUkPostcode(postcode) && addressLine.trim()) {
    const match = matchHouse(addressLine, await fetchKnownAddresses(postcode));
    if (match) {
      addressLine = match.line1;
      intelId = match.intelId;
    }
  }
  const base: QuoteDraft = { ...d, survey: { ...d.survey, addressLine } };
  if (intelId) {
    const record = await fetchRecord(intelId);
    if (record && (record.prefill.type || record.prefill.bedrooms)) return withRecord(base, intelId, record);
  }
  const guess = await fetchNeighbourGuess(postcode);
  return guess?.type ? withNeighbours(base, guess) : base;
}

function configFor(d: QuoteDraft) {
  const p = d.survey.property;
  return buildDefaultConfig({
    type: p.type,
    era: p.era,
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms ?? 1,
    layout: d.layout,
    floorAreaM2: p.floorAreaM2,
  });
}

/** Rooms, outdoor position and install pattern from the house answers; photos already taken for a room of the same name are kept. */
function configure(d: QuoteDraft): QuoteDraft {
  const config = configFor(d);
  const previous = new Map(d.survey.rooms.map((r) => [r.name, r.photos]));
  return {
    ...d,
    configured: true,
    survey: {
      ...d.survey,
      archetypeId: config.archetypeId,
      permutationId: config.permutationId,
      rooms: config.rooms.map((r) => ({ ...r, photos: previous.get(r.name) ?? r.photos })),
      outdoor: { ...d.survey.outdoor, location: config.outdoorDefault },
    },
  };
}

/**
 * The reminder choice for a draft save, only once they've answered it at
 * the email gate (a draft from before the box existed has no answer, so
 * it's never reminded).
 */
function reminderFields(d: QuoteDraft): { reminder?: boolean; reminderNotice?: string } {
  return d.reminder === undefined ? {} : { reminder: d.reminder, reminderNotice: REMINDER_NOTICE_VERSION };
}
