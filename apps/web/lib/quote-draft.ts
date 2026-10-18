import type { KitchenLivingLayout, RoomType, Survey, SurveyPhoto, SurveyRoom } from "@aircon/domain";

export type Timeframe = "asap" | "1-3-months" | "researching";

export interface Contact {
  name: string;
  email: string;
  phone: string;
  timeframe: Timeframe;
}

/** Everything the wizard collects. `survey` feeds the pricing engine directly. */
export interface QuoteDraft {
  survey: Survey;
  contact: Contact;
  /** Kitchen/living arrangement, drives the generated default rooms. */
  layout: KitchenLivingLayout;
  /** Server row id once the address+email step has saved the draft. */
  draftId?: string;
  /** Property Intelligence id when the customer picked a known address. */
  intelId?: string;
  /** True when the house answers were pre-filled from public records. */
  prefilledFromIntel?: boolean;
  /** Set once the customer has generated a default configuration. */
  configured: boolean;
  /**
   * The funnel step they were on, so a refresh (or a tab the phone threw
   * away) puts them back where they were. Consent ticks are never stored:
   * they're given fresh each time.
   */
  step?: number;
}

export function newDraft(postcode = ""): QuoteDraft {
  return {
    survey: {
      postcode,
      addressLine: "",
      property: {
        type: "semi-detached",
        era: "1930-1950",
        bedrooms: 3,
        bathrooms: 1,
        ownership: "owner",
      },
      rooms: [],
      outdoor: { location: "ground-rear", photos: [] },
      electrics: { condition: "unsure", photos: [] },
    },
    contact: { name: "", email: "", phone: "", timeframe: "1-3-months" },
    layout: "separate",
    configured: false,
  };
}

export const ROOM_TYPE_LABEL: Record<RoomType, string> = {
  bedroom: "Bedroom",
  "living-room": "Living room",
  "kitchen-diner": "Kitchen / diner",
  "home-office": "Home office",
  "loft-room": "Loft room",
  conservatory: "Conservatory",
  other: "Other room",
};

export function newRoom(type: RoomType, existing: SurveyRoom[]): SurveyRoom {
  const count = existing.filter((r) => r.type === type).length;
  const name = count > 0 ? `${ROOM_TYPE_LABEL[type]} ${count + 1}` : ROOM_TYPE_LABEL[type];
  return {
    id: crypto.randomUUID(),
    name,
    type,
    size: type === "living-room" || type === "kitchen-diner" ? "large" : "medium",
    floor: type === "bedroom" ? "first" : type === "loft-room" ? "loft" : "ground",
    glazing: "medium",
    orientation: "unsure",
    hasExternalWall: true,
    photos: [],
  };
}

const STORAGE_KEY = "aircon.quote-draft.v2";

const uploaded = (p: SurveyPhoto | null | undefined): p is SurveyPhoto =>
  Boolean(p) && typeof p!.storagePath === "string" && p!.storagePath.length > 0;

/**
 * The survey the server may score: photos without an uploaded copy are
 * dropped, so a failed upload can never raise the confidence band.
 */
export function withUploadedPhotosOnly(survey: Survey): Survey {
  const keep = (photos: SurveyPhoto[] | undefined) => (Array.isArray(photos) ? photos.filter(uploaded) : []);
  return {
    ...survey,
    rooms: survey.rooms.map((r) => ({ ...r, photos: keep(r.photos) })),
    outdoor: { ...survey.outdoor, photos: keep(survey.outdoor.photos) },
    electrics: { ...survey.electrics, photos: keep(survey.electrics.photos) },
  };
}

/** Apply `fn` to every photo in the survey (rooms, outdoor, electrics). */
export function mapSurveyPhotos(survey: Survey, fn: (p: SurveyPhoto) => SurveyPhoto): Survey {
  return {
    ...survey,
    rooms: survey.rooms.map((r) => ({ ...r, photos: r.photos.map(fn) })),
    outdoor: { ...survey.outdoor, photos: survey.outdoor.photos.map(fn) },
    electrics: { ...survey.electrics, photos: survey.electrics.photos.map(fn) },
  };
}

/**
 * A stored draft made safe to use: missing fields take the defaults (older
 * drafts predate some of them), and photo metadata with no uploaded copy is
 * dropped, because the file itself can't survive a reload and confidence
 * scoring must only count photos we actually have.
 */
export function normaliseDraft(raw: unknown): QuoteDraft | null {
  if (typeof raw !== "object" || raw === null) return null;
  const stored = raw as Partial<QuoteDraft>;
  if (typeof stored.survey !== "object" || stored.survey === null) return null;
  const base = newDraft();
  const s = stored.survey as Partial<Survey>;
  const survey: Survey = withUploadedPhotosOnly({
    ...base.survey,
    ...s,
    postcode: typeof s.postcode === "string" ? s.postcode : "",
    addressLine: typeof s.addressLine === "string" ? s.addressLine : "",
    property: { ...base.survey.property, ...(s.property ?? {}) },
    rooms: Array.isArray(s.rooms) ? s.rooms.filter((r) => r && typeof r.id === "string") : [],
    outdoor: { ...base.survey.outdoor, ...(s.outdoor ?? {}) },
    electrics: { ...base.survey.electrics, ...(s.electrics ?? {}) },
  });
  const { step, ...rest } = stored;
  return {
    ...base,
    ...rest,
    survey,
    contact: { ...base.contact, ...(stored.contact ?? {}) },
    configured: stored.configured === true,
    ...(typeof step === "number" && Number.isInteger(step) && step >= 0 ? { step } : {}),
  };
}

export function loadDraft(): QuoteDraft | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normaliseDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveDraft(draft: QuoteDraft): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // storage full / private mode; the wizard still works in memory
  }
}

export function clearDraft(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}
