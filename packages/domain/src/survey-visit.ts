import type {
  FloorLevel,
  GlazingLevel,
  Orientation,
  OutdoorLocation,
  PropertyEra,
  PropertyType,
  RoomType,
  Survey,
} from "./types.ts";

/**
 * The measured survey: what the surveyor records on site, on a phone.
 *
 * It starts prefilled from the customer's own survey (confirm and correct,
 * never a blank form), and it's versioned: a submitted survey is a snapshot
 * the design, proposal and pilot metrics all point back to. The self-survey
 * diff compares the two, which is how we learn how good the funnel is.
 *
 * Foundation ships the types and the planning checklist; F2 owns the logic.
 */

export type WallConstruction =
  | "solid-brick"
  | "cavity"
  | "timber-frame"
  | "stone"
  | "concrete"
  | "plasterboard"
  | "unknown";

/* ------------------------------------------------------------------ */
/* Planning: permitted development checklist                           */
/* ------------------------------------------------------------------ */

export type PdCheckId =
  | "heating-use"
  | "not-listed"
  | "not-conservation-front"
  | "volume-ok"
  | "unit-count-ok"
  | "noise-ok"
  | "siting-minimises-impact"
  | "article4-checked";

/**
 * England, GPDO Schedule 2 Part 14 Class G (air source heat pumps on houses),
 * as amended from 29 May 2025. A working summary for the surveyor, not legal
 * advice: verify against the current Class G text before Pilot 1. The survey
 * records the answers and the technical lead approves the assessment; the
 * system never concludes "no planning needed" by itself, and any "no" or
 * "unsure" sends the job down the planning application route.
 */
export const PD_CHECKS: { id: PdCheckId; label: string; help: string }[] = [
  {
    id: "heating-use",
    label: "It will be used for heating, not just cooling",
    help: "Permitted development covers heat pumps that heat the home. A unit meant only for cooling needs a planning application.",
  },
  {
    id: "not-listed",
    label: "The house isn't a listed building, or in the grounds of one",
    help: "Listed buildings (and anything within their curtilage) need listed building consent and usually planning permission.",
  },
  {
    id: "not-conservation-front",
    label: "On designated land, the outdoor unit isn't on a wall or roof facing the road",
    help: "In a conservation area, national park, AONB (National Landscape) or World Heritage Site, the unit can't go on a wall or roof that fronts a highway.",
  },
  {
    id: "volume-ok",
    label: "The outdoor unit is 1.5 m³ or smaller",
    help: "For houses, the outdoor unit's volume, including any housing, must not exceed 1.5 cubic metres. Check the spec sheet dimensions.",
  },
  {
    id: "unit-count-ok",
    label: "The number of outdoor units is within the limit",
    help: "Up to two air source heat pumps on a detached house; one on any other house. More than that needs a planning application.",
  },
  {
    id: "noise-ok",
    label: "Noise at the neighbour's window is 42 dB(A) or less",
    help: "Calculated with the MCS 020 method, at the assessment position of the nearest neighbouring habitable room window.",
  },
  {
    id: "siting-minimises-impact",
    label: "Sited to minimise its effect on how the area looks and on the neighbours",
    help: "A condition of permitted development, so far as practicable. Not on a pitched roof. It must also be removed once it's no longer needed.",
  },
  {
    id: "article4-checked",
    label: "Checked there's no Article 4 direction covering the property",
    help: "Some councils remove permitted development rights in particular streets. Check the council's Article 4 map, or ask its planning team.",
  },
];

/* ------------------------------------------------------------------ */
/* The record                                                          */
/* ------------------------------------------------------------------ */

export interface MeasuredRoom {
  id: string;
  name: string;
  type: RoomType;
  floor: FloorLevel;
  include: boolean;
  lengthM?: number;
  widthM?: number;
  areaM2?: number;
  ceilingHeightM?: number;
  glazing: GlazingLevel;
  orientation: Orientation;
  occupancy?: "low" | "normal" | "high";
  gainsNote?: string;
  hasExternalWall: boolean;
  wallConstruction?: WallConstruction;
  pipeRunM?: number;
  heightDropM?: number;
  route?: "through-wall" | "external-trunking" | "internal-concealed" | "via-loft" | "other";
  routeNote?: string;
  condensate: "gravity" | "pump" | "tbc";
  condensateNote?: string;
  obstacles?: string;
  priority?: "quiet" | "discreet" | "fast-cooling" | "heating";
  mediaIds: string[];
  selfSurveyRoomId?: string;
}

export interface OutdoorPosition {
  id: string;
  label: string;
  location: OutdoorLocation;
  mediaId?: string;
  distanceToNeighbourWindowM?: number;
  base: "ground-feet" | "wall-bracket" | "slab" | "roof-frame" | "other";
  heightM?: number;
  accessEquipment: "none" | "ladder" | "tower" | "scaffold";
  defrostDrainage?: string;
  chosen: boolean;
  note?: string;
}

export interface MeasuredSurvey {
  version: 1;
  site: {
    confirmedAddress: boolean;
    decisionMaker?: string;
    ownerConfirmed: boolean;
    tenure: "owner" | "leaseholder" | "tenant" | "unknown";
    accessNotes?: string;
    parkingNotes?: string;
    petsKids?: string;
    siteContactPhone?: string;
  };
  wishes: {
    priorities: ("quiet" | "discreet" | "heating" | "cooling" | "smart-control" | "budget")[];
    heatingUse: "main" | "supplementary" | "cooling-only-intent" | "unsure";
    timing?: string;
    notes?: string;
  };
  house: {
    type: PropertyType;
    era: PropertyEra;
    wallConstruction: WallConstruction;
    storeys: number;
    loftAccess: boolean;
    listedOrConservation: "no" | "yes" | "unknown";
    asbestosRisk: "none-suspected" | "possible" | "suspected" | "not-assessed";
    asbestosNote?: string;
    notes?: string;
  };
  rooms: MeasuredRoom[];
  outdoor: { positions: OutdoorPosition[] };
  electrics: {
    boardType: "modern-rcbo" | "modern-rcd" | "older-fuse-box" | "unknown";
    spareWays?: number;
    earthing?: "TN-C-S" | "TN-S" | "TT" | "unknown";
    cableRouteM?: number;
    cableRouteNote?: string;
    asbestosFlashGuard: "no" | "possible" | "yes" | "n/a";
    mediaIds: string[];
    notes?: string;
  };
  permissions: { pd: Partial<Record<PdCheckId, "yes" | "no" | "unsure">>; notes?: string };
  risks: { workingAtHeight: boolean; structuralConcern: boolean; concealedServicesConcern: boolean; notes?: string };
  assumptions: string[];
  unknowns: string[];
}

export interface SurveyRecord {
  id: string;
  projectId: string;
  version: number;
  status: "draft" | "submitted";
  data: MeasuredSurvey;
  surveyor?: { staffId: string; name: string };
  startedAt?: string;
  submittedAt?: string;
  minutes?: number;
}

export interface SurveyCompleteness {
  pct: number;
  missing: { section: string; item: string }[];
}

export interface SelfSurveyDiffRow {
  room: string;
  field: string;
  customerSaid: string;
  measured: string;
  match: boolean | null;
  note?: string;
}

/* ------------------------------------------------------------------ */
/* Logic (F2)                                                          */
/* ------------------------------------------------------------------ */

/** Prefill from the customer's survey. */
export function emptyMeasuredSurvey(selfSurvey?: Survey): MeasuredSurvey {
  throw new Error("not implemented: emptyMeasuredSurvey (F2)");
}

export function surveyCompleteness(m: MeasuredSurvey): SurveyCompleteness {
  throw new Error("not implemented: surveyCompleteness (F2)");
}

/** For the pricing and design engines (areaM2 etc.). */
export function measuredToEngineSurvey(m: MeasuredSurvey, base: Survey): Survey {
  throw new Error("not implemented: measuredToEngineSurvey (F2)");
}

export function diffSelfSurvey(self: Survey, m: MeasuredSurvey): SelfSurveyDiffRow[] {
  throw new Error("not implemented: diffSelfSurvey (F2)");
}
