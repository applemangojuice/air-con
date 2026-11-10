"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { KitchenLivingLayout, NeighbourGuess, RoomType, Survey } from "@aircon/domain";
import { fetchKnownAddresses, matchHouse } from "@/lib/address-lookup";
import {
  clearDraft,
  loadDraft,
  mapSurveyPhotos,
  newDraft,
  newRoom,
  saveDraft,
  type Contact,
  type QuoteDraft,
} from "@/lib/quote-draft";
import { addBedroom, addLivingRoom, configFor, configure, declineRoom, declinedFromSaved, includeRoom } from "@/lib/room-plan";
import { submitQuote } from "@/lib/submit-quote";
import { REMINDER_NOTICE_VERSION } from "@/lib/follow-up-notice";
import { track } from "@/lib/analytics-client";
import { isValidUkPostcode, normalisePostcode } from "@/lib/format";
import { coverageFor, type PublicSettings } from "@/components/site/claims";
import { AddressStep, RefineGateStep, type StepProps } from "./steps";
import { PriceStep } from "./price-step";
import { HomeStep } from "./home-step";
import { DemoResult } from "./result";
import { JourneyStrip } from "./journey-strip";

/**
 * Price first, and as few questions as possible. The address comes in
 * (from the home page, or the address screen), the home is filled in from
 * what we know, and the guide price is the next thing they see, with the
 * rooms and size adjustable right there. Going further costs an email, and
 * from then on the quote is saved as they go (a few seconds after each
 * change), so leaving is safe: the reminder, ten minutes after they stop,
 * links straight back. "Your home" is the one refine page; its button saves
 * the quote and opens its page, where the virtual survey is booked.
 *
 *   address? → PRICE → email gate → your home → /q/[id] (book the virtual survey)
 */
const STEP = { address: 0, price: 1, gate: 2, home: 3 } as const;
/** How long we wait for records before pricing a typical home instead. */
const PREFILL_TIMEOUT_MS = 6000;
/** Saving as they go: this long after the last change. */
const SYNC_AFTER_MS = 2500;

export function QuoteWizard({
  initialPostcode,
  initialAddress,
  initialIntel,
  initialResume,
  settings,
}: {
  initialPostcode?: string;
  /** The house (number, name or full line) chosen on the marketing page. */
  initialAddress?: string;
  initialIntel?: string;
  /** An unfinished quote's id, from a reminder or "pick up" email. */
  initialResume?: string;
  settings: PublicSettings;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<QuoteDraft>(() => newDraft(initialPostcode ? normalisePostcode(initialPostcode) : ""));
  const [step, setStep] = useState<number>(STEP.address);
  const [ready, setReady] = useState(false);
  const [pricing, setPricing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState(false);
  const [resumeSent, setResumeSent] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const restored = useRef(false);
  const finished = useRef(false);
  const pricingRun = useRef(0);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSynced = useRef<string>("");

  // First load: a resume link reloads its saved answers; an address from the
  // marketing page is priced straight away; otherwise a draft saved on this
  // device goes back to the screen it was on; otherwise the address screen.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (initialResume) {
      window.history.replaceState(null, "", "/quote");
      void resume(initialResume);
      return;
    }
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
      const priced = saved.configured && saved.survey.rooms.length + (saved.declinedRooms?.length ?? 0) > 0;
      if (samePostcode && priced && coverageFor(settings.serviceArea, postcode).covered && s >= STEP.price && s <= STEP.home) {
        // The gate itself isn't a place to come back to: the price is (or their rooms, once they're saving).
        setStep(s === STEP.gate ? STEP.price : s === STEP.home && !saved.draftId ? STEP.price : s);
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

  // Saved as they go: once there's a server draft, every change reaches it a
  // few seconds later, so the reminder knows when they stopped and a resume
  // link opens exactly this.
  useEffect(() => {
    if (!ready || finished.current || !draft.draftId) return;
    const snapshot = JSON.stringify([draft.survey, draft.layout, draft.contact.email, draft.reminder]);
    if (snapshot === lastSynced.current) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      lastSynced.current = snapshot;
      syncServerDraft(draft);
    }, SYNC_AFTER_MS);
    return () => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, ready]);

  const setSurvey = (update: Partial<Survey>) => setDraft((d) => ({ ...d, survey: { ...d.survey, ...update } }));
  const setContact = (update: Partial<Contact>) => setDraft((d) => ({ ...d, contact: { ...d.contact, ...update } }));

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
  // answers, recomputed live so every screen matches them.
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
    const priced = configure({ ...d, declinedRooms: [] });
    setDraft(priced);
    setPricing(false);
    track("quote_start", { prefill: priced.prefillSource ?? "typical", fromLink: Boolean(initialAddress || initialIntel) });
  }

  /** A resume link: their saved answers, on whatever device they opened it. */
  async function resume(id: string) {
    try {
      const res = await fetch(`/api/quotes/draft/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as {
        id: string;
        email: string;
        survey: Survey;
        layout?: KitchenLivingLayout;
        prefillSource?: QuoteDraft["prefillSource"];
        reminder?: boolean;
      };
      const base = newDraft(data.survey.postcode);
      const d: QuoteDraft = {
        ...base,
        draftId: data.id,
        survey: { ...base.survey, ...data.survey },
        contact: { ...base.contact, email: data.email },
        layout: data.layout ?? base.layout,
        configured: true,
        ...(data.prefillSource ? { prefillSource: data.prefillSource } : {}),
        ...(typeof data.reminder === "boolean" ? { reminder: data.reminder } : {}),
      };
      const withOff = { ...d, declinedRooms: declinedFromSaved(d) };
      lastSynced.current = JSON.stringify([withOff.survey, withOff.layout, withOff.contact.email, withOff.reminder]);
      setDraft(withOff);
      setStep(STEP.home);
      track("quote_resume", { ok: true });
    } catch {
      setNotice("That link has run out, or the quote it was for is already saved: your quote email has its permanent link. Or start again here.");
      track("quote_resume", { ok: false });
    }
    setReady(true);
  }

  /** Save-early: the enquiry exists in the database from the email gate on. */
  async function saveServerDraft(current: QuoteDraft, fresh = false): Promise<{ id?: string; resumeSent?: boolean }> {
    try {
      const res = await fetch("/api/quotes/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: current.contact.email,
          survey: current.survey,
          ...funnelFields(current),
          ...reminderFields(current),
          ...(fresh ? { fresh: true } : {}),
        }),
      });
      if (!res.ok) return {};
      return (await res.json()) as { id?: string; resumeSent?: boolean };
    } catch {
      return {};
    }
  }

  function syncServerDraft(current: QuoteDraft) {
    if (!current.draftId) return;
    fetch(`/api/quotes/draft/${current.draftId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      // Email travels too: a corrected address must reach the server draft,
      // or the follow-up email goes to the typo.
      body: JSON.stringify({ survey: current.survey, email: current.contact.email || undefined, ...funnelFields(current), ...reminderFields(current) }),
    }).catch(() => undefined);
  }

  /** Address screen → the price. */
  function nextFromAddress() {
    void showInstantPrice(draft);
  }

  /** Price screen → the email gate. */
  function openGate() {
    track("quote_gate", {});
    setResumeSent(false);
    setStep(STEP.gate);
  }

  /** The email gate → "Your home". The server draft starts here (or they're sent the one they already have). */
  async function nextFromGate(fresh = false) {
    // The opt-out sits under the email: leaving it unticked is their answer.
    let current: QuoteDraft = { ...draft, reminder: draft.reminder !== false };
    setNotice(null);
    if (current.draftId) {
      syncServerDraft(current);
    } else {
      setBusy(true);
      const saved = await saveServerDraft(current, fresh);
      setBusy(false);
      if (saved.resumeSent) {
        setDraft(current);
        setResumeSent(true);
        track("quote_refine", { resumeSent: true });
        return;
      }
      if (saved.id) current = { ...current, draftId: saved.id };
    }
    lastSynced.current = JSON.stringify([current.survey, current.layout, current.contact.email, current.reminder]);
    setDraft(current);
    setResumeSent(false);
    track("quote_refine", { draftSaved: Boolean(current.draftId) });
    setStep(STEP.home);
  }

  /** "Next: confirm your price": save the quote and open its page, where the virtual survey is booked. */
  async function finish() {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    setBusy(true);
    setSaveError(null);
    const result = await submitQuote(draft, { marketing: draft.reminder !== false });
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
    setSaveError(null);
    setNotice(null);
    setDemo(false);
    setStep(STEP.address);
  }

  if (demo) {
    return <DemoResult draft={draft} settings={settings} onStartOver={startOver} />;
  }

  const track1 = (what: string) => track("quote_adjust", { what });
  const common: StepProps = {
    draft,
    settings,
    setSurvey,
    setContact,
    setLayout: (layout) => setDraft((d) => configure({ ...d, layout })),
    onPhotoUploaded,
    applyIntel,
    step,
    onNext: () => setStep(step + 1),
    onBack: step > STEP.address ? () => setStep(step - 1) : undefined,
    busy,
  };

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
            onDecline={(id) => (setDraft((d) => declineRoom(d, id)), track1("decline"))}
            onInclude={(id) => (setDraft((d) => includeRoom(d, id)), track1("include"))}
            onAddBedroom={() => (setDraft((d) => addBedroom(d)), track1("bedroom"))}
            onAddLivingRoom={() => (setDraft((d) => addLivingRoom(d)), track1("living-room"))}
            onSize={(floorAreaM2) => (setDraft((d) => configure({ ...d, survey: { ...d.survey, property: { ...d.survey.property, floorAreaM2 } } })), track1("size"))}
            onRefine={openGate}
            onChangeAddress={() => {
              pricingRun.current++; // abandon a lookup still running
              setPricing(false);
              setStep(STEP.address);
            }}
          />
        );
      case STEP.gate:
        return (
          <RefineGateStep
            {...common}
            onNext={() => void nextFromGate()}
            onBack={() => {
              setResumeSent(false);
              setStep(STEP.price);
            }}
            setReminder={(reminder) => setDraft((d) => ({ ...d, reminder }))}
            resumeSent={resumeSent}
            onStartFresh={() => void nextFromGate(true)}
          />
        );
      default:
        return (
          <HomeStep
            draft={draft}
            settings={settings}
            step={step}
            busy={busy}
            saveError={saveError}
            excluded={config.excluded}
            outdoorOptions={config.outdoorOptions}
            setSurvey={setSurvey}
            setContact={setContact}
            onRooms={(rooms) => setSurvey({ rooms })}
            onProperty={(update) => setDraft((d) => configure({ ...d, survey: { ...d.survey, property: { ...d.survey.property, ...update } } }))}
            onLayout={(layout) => setDraft((d) => configure({ ...d, layout }))}
            onToggleRoom={(id, on) => setDraft((d) => (on ? includeRoom(d, id) : declineRoom(d, id)))}
            onAddRoom={(type: RoomType) => setDraft((d) => ({ ...d, survey: { ...d.survey, rooms: [...d.survey.rooms, newRoom(type, [...d.survey.rooms, ...(d.declinedRooms ?? [])])] } }))}
            onNext={() => void finish()}
            onBack={() => setStep(STEP.price)}
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

/** The funnel state the server keeps with the draft, so a resume link restores it exactly. */
function funnelFields(d: QuoteDraft): { layout: KitchenLivingLayout; prefillSource?: QuoteDraft["prefillSource"] } {
  return { layout: d.layout, ...(d.prefillSource ? { prefillSource: d.prefillSource } : {}) };
}

/**
 * The reminder answer for a draft save, once they've passed the email gate
 * (undefined before: such a draft is never reminded).
 */
function reminderFields(d: QuoteDraft): { reminder?: boolean; reminderNotice?: string } {
  return d.reminder === undefined ? {} : { reminder: d.reminder, reminderNotice: REMINDER_NOTICE_VERSION };
}
