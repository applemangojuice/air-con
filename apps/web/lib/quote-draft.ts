import type { KitchenLivingLayout, Survey, SurveyRoom, RoomType } from "@aircon/domain";

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

export function loadDraft(): QuoteDraft | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as QuoteDraft;
    // Photo files can't survive a reload, so drop stale photo metadata that has
    // no uploaded copy, so confidence scoring stays honest.
    draft.survey.rooms.forEach((r) => (r.photos = r.photos.filter((p) => p.storagePath)));
    draft.survey.outdoor.photos = draft.survey.outdoor.photos.filter((p) => p.storagePath);
    draft.survey.electrics.photos = draft.survey.electrics.photos.filter((p) => p.storagePath);
    return draft;
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
