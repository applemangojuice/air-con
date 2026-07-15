import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { RoomType, Survey, SurveyRoom } from "@aircon/domain";

export type Timeframe = "asap" | "1-3-months" | "researching";

export interface Contact {
  name: string;
  email: string;
  phone: string;
  timeframe: Timeframe;
}

/** Same draft shape as the web wizard; photos additionally carry a local
 *  device `uri` (stripped by the API's schema on submit). */
export interface QuoteDraft {
  survey: Survey;
  contact: Contact;
}

export function newDraft(): QuoteDraft {
  return {
    survey: {
      postcode: "",
      addressLine: "",
      property: { type: "semi-detached", era: "1930-1950", bedrooms: 3, ownership: "owner" },
      rooms: [],
      outdoor: { location: "ground-rear", photos: [] },
      electrics: { condition: "unsure", photos: [] },
    },
    contact: { name: "", email: "", phone: "", timeframe: "1-3-months" },
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
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
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

const STORAGE_KEY = "aircon.quote-draft.v1";

interface DraftContextValue {
  draft: QuoteDraft;
  hydrated: boolean;
  setSurvey: (update: Partial<Survey>) => void;
  setContact: (update: Partial<Contact>) => void;
  updateRoom: (id: string, update: Partial<SurveyRoom>) => void;
  reset: () => void;
}

const DraftContext = createContext<DraftContextValue | null>(null);

export function DraftProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<QuoteDraft>(newDraft);
  const [hydrated, setHydrated] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) setDraft(JSON.parse(raw) as QuoteDraft);
      })
      .catch(() => undefined)
      .finally(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(draft)).catch(() => undefined);
  }, [draft, hydrated]);

  const setSurvey = useCallback((update: Partial<Survey>) => {
    setDraft((d) => ({ ...d, survey: { ...d.survey, ...update } }));
  }, []);

  const setContact = useCallback((update: Partial<Contact>) => {
    setDraft((d) => ({ ...d, contact: { ...d.contact, ...update } }));
  }, []);

  const updateRoom = useCallback((id: string, update: Partial<SurveyRoom>) => {
    setDraft((d) => ({
      ...d,
      survey: {
        ...d.survey,
        rooms: d.survey.rooms.map((r) => (r.id === id ? { ...r, ...update } : r)),
      },
    }));
  }, []);

  const reset = useCallback(() => {
    setDraft(newDraft());
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined);
  }, []);

  return (
    <DraftContext.Provider value={{ draft, hydrated, setSurvey, setContact, updateRoom, reset }}>
      {children}
    </DraftContext.Provider>
  );
}

export function useDraft(): DraftContextValue {
  const ctx = useContext(DraftContext);
  if (!ctx) throw new Error("useDraft must be used inside DraftProvider");
  return ctx;
}
