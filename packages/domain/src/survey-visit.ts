import type { ElectricsPlanStatus } from "./project.ts";
import type {
  ElectricsCondition,
  FloorLevel,
  GlazingLevel,
  Orientation,
  OutdoorLocation,
  PropertyEra,
  PropertyType,
  RoomSize,
  RoomType,
  Survey,
  SurveyPhoto,
  SurveyRoom,
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
export const PD_CHECKS: { id: PdCheckId; label: string; help: string; byDesign?: true }[] = [
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
    label: "Noise at the neighbour's window passes the MCS 020(a) check",
    help: "Calculated, not measured: the heat pump's own level 1 m out from the nearest habitable-room window next door must be 37.0 dB(A) or less (the 42 dB(A) limit includes an assumed 40 dB(A) background). There's no design at the survey, so the surveyor doesn't answer it: the design works it out from the distance and surfaces recorded here, and the technical lead runs the full calculation.",
    // Round 10: never guessed at the survey (it reached the family's survey report as a "Yes").
    byDesign: true,
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

export type ReflectingSurfaces = "one" | "two" | "three";

/** MCS 020(a) directivity from the reflecting surfaces counted at the survey. */
export const DIRECTIVITY_Q: Record<ReflectingSurfaces, 2 | 4 | 8> = { one: 2, two: 4, three: 8 };

/** A flat's block: how tall, whether our route crosses its fire compartments, and who manages it. */
export interface BlockFacts {
  /** Storeys in the block, the ground floor counting as one (basements and roof plant left out). */
  storeys?: number;
  /** Or its height, ground to the top floor's surface, m, where that's known instead. */
  heightM?: number;
  /** Does the pipe or cable route cross a compartment wall or floor (to another flat, a corridor, a riser), or run through a common part? */
  crossing?: "yes" | "no" | "unsure";
  /** The freeholder or managing agent: name and how to reach them. */
  freeholder?: string;
}

/**
 * A higher-risk building (Building Safety Act 2022 s.65 with the 2023
 * descriptions regulations, read through extracts: to verify): at least
 * 18 m or at least 7 storeys, with at least two homes (any block of flats).
 */
export const HRB_MIN_STOREYS = 7;
export const HRB_MIN_HEIGHT_M = 18;

export function isFlat(m: { house?: { type?: string } } | null | undefined): boolean {
  return m?.house?.type === "flat";
}

/** Is this flat in a higher-risk building (7 storeys or 18 m and above)? */
export function higherRiskBuilding(m: { house?: { type?: string; block?: BlockFacts } } | null | undefined): boolean {
  if (!isFlat(m)) return false;
  const b = m!.house!.block ?? {};
  return (typeof b.storeys === "number" && b.storeys >= HRB_MIN_STOREYS) || (typeof b.heightM === "number" && b.heightM >= HRB_MIN_HEIGHT_M);
}

/** Does the route cross a compartment wall or floor, or a common part? "Not sure", or not asked, counts as yes on a flat. */
export function crossesCompartment(m: { house?: { type?: string; block?: BlockFacts } } | null | undefined): boolean {
  return isFlat(m) && m!.house!.block?.crossing !== "no";
}

export type AccessEquipmentKind = "none" | "ladder" | "podium" | "tower" | "scaffold" | "mewp";

/** Access that isn't a ladder: what a bracket above the ladder limit needs (each a priced hire line on the proposal). */
export const HEIGHT_ACCESS: readonly AccessEquipmentKind[] = ["podium", "tower", "scaffold", "mewp"];

/** The access in a sentence ("needs a tower"). */
export const ACCESS_PHRASE: Record<AccessEquipmentKind, string> = {
  none: "no access equipment",
  ladder: "a ladder",
  podium: "podium steps",
  tower: "a mobile tower",
  scaffold: "a scaffold",
  mewp: "a MEWP (cherry picker)",
};

/**
 * Above this height to the bracket (m), a ladder isn't accepted as the way
 * to install an outdoor unit: a heavy two-handed lift isn't the light,
 * short work a ladder is for (HSE INDG455, read through reproductions: to
 * verify). The company's default (first-floor bracket height); Settings →
 * Safety changes it for surveys started afterwards.
 */
export const LADDER_MAX_BRACKET_M = 2.5;

/** An outdoor unit heavier than this (kg) is a two-person lift on the crew's day (HSE's guideline weights, read through extracts: to verify). */
export const TWO_PERSON_LIFT_KG = 25;

export interface OutdoorPosition {
  id: string;
  label: string;
  location: OutdoorLocation;
  mediaId?: string;
  distanceToNeighbourWindowM?: number;
  /** Hard surfaces within 1 m of the unit, the ground included: MCS 020(a)'s directivity (one Q2, two Q4, three Q8). */
  reflectingSurfaces?: ReflectingSurfaces;
  base: "ground-feet" | "wall-bracket" | "slab" | "roof-frame" | "other";
  /** Height to the bracket (or the unit's base) off the ground, m: asked for a wall bracket or a roof frame. */
  heightM?: number;
  /** How the crew reaches it to install it. Above the ladder limit only a tower, podium, scaffold or MEWP will do. */
  accessEquipment: AccessEquipmentKind;
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
    /** A flat: the block it's in (asked only for a flat). */
    block?: BlockFacts;
  };
  rooms: MeasuredRoom[];
  outdoor: { positions: OutdoorPosition[] };
  /** The company's limits this survey was started under (Settings → Safety), so the record says what applied. */
  limits?: { ladderMaxBracketM?: number };
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
  risks: {
    workingAtHeight: boolean;
    structuralConcern: boolean;
    concealedServicesConcern: boolean;
    notes?: string;
    /**
     * Which of the three questions the surveyor has actually answered (a
     * yes/no boolean can't say "not asked yet"). A new survey starts with [];
     * records made before this existed have no list and count as answered.
     */
    answered?: RiskQuestionId[];
  };
  assumptions: string[];
  unknowns: string[];
}

export type RiskQuestionId = "workingAtHeight" | "structuralConcern" | "concealedServicesConcern";

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
  /**
   * `section` and `item` are the words (the readiness gate shows them);
   * the optional ids let a screen jump straight to the room, position or
   * field that's missing.
   */
  missing: { section: string; item: string; sectionId?: SurveySectionId; roomId?: string; positionId?: string; field?: string }[];
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
/* Words                                                               */
/* ------------------------------------------------------------------ */

export type SurveySectionId = "site" | "wishes" | "house" | "rooms" | "outdoor" | "electrics" | "permissions" | "risks";

/** The sections the completeness check covers, in visit order. */
export const SURVEY_SECTIONS: { id: SurveySectionId; label: string }[] = [
  { id: "site", label: "Site & people" },
  { id: "wishes", label: "Wishes" },
  { id: "house", label: "House" },
  { id: "rooms", label: "Rooms" },
  { id: "outdoor", label: "Outdoor" },
  { id: "electrics", label: "Electrics" },
  { id: "permissions", label: "Permissions" },
  { id: "risks", label: "Risks" },
];

const SECTION_LABEL = Object.fromEntries(SURVEY_SECTIONS.map((s) => [s.id, s.label])) as Record<SurveySectionId, string>;

/**
 * The customer's size bands as the funnel describes them ("Medium, about
 * 10–16 m²"). Lower bound inclusive, upper exclusive; xl has no ceiling.
 */
export const ROOM_SIZE_BANDS: Record<RoomSize, { label: string; minM2: number; maxM2: number | null }> = {
  small: { label: "Small", minM2: 0, maxM2: 10 },
  medium: { label: "Medium", minM2: 10, maxM2: 16 },
  large: { label: "Large", minM2: 16, maxM2: 24 },
  xl: { label: "Very large", minM2: 24, maxM2: null },
};

/** The band a measured floor area falls in. */
export function roomSizeForArea(areaM2: number): RoomSize {
  if (areaM2 < 10) return "small";
  if (areaM2 < 16) return "medium";
  if (areaM2 < 24) return "large";
  return "xl";
}

/** "Medium (10–16 m²)". */
export function roomSizeLabel(size: RoomSize): string {
  const b = ROOM_SIZE_BANDS[size];
  if (!b) return String(size);
  if (b.maxM2 === null) return `${b.label} (${b.minM2} m² or more)`;
  return b.minM2 === 0 ? `${b.label} (under ${b.maxM2} m²)` : `${b.label} (${b.minM2}–${b.maxM2} m²)`;
}

/** Plain labels for every choice the survey screens and the diff show. */
export const SURVEY_LABELS = {
  propertyType: {
    detached: "Detached",
    "semi-detached": "Semi-detached",
    terraced: "Terraced",
    flat: "Flat",
    bungalow: "Bungalow",
  } satisfies Record<PropertyType, string>,
  era: {
    "pre-1930": "Before 1930",
    "1930-1950": "1930 to 1950",
    "1950-2000": "1950 to 2000",
    "2000+": "2000 or later",
  } satisfies Record<PropertyEra, string>,
  roomType: {
    bedroom: "Bedroom",
    "living-room": "Living room",
    "kitchen-diner": "Kitchen / diner",
    "home-office": "Home office",
    "loft-room": "Loft room",
    conservatory: "Conservatory",
    other: "Other room",
  } satisfies Record<RoomType, string>,
  floor: {
    ground: "Ground floor",
    first: "First floor",
    "second-plus": "Second floor or higher",
    loft: "Loft",
  } satisfies Record<FloorLevel, string>,
  glazing: { low: "A little glass", medium: "Some glass", high: "Lots of glass" } satisfies Record<GlazingLevel, string>,
  orientation: { north: "North", east: "East", south: "South", west: "West", unsure: "Not sure" } satisfies Record<Orientation, string>,
  outdoorLocation: {
    "ground-rear": "Ground, at the back",
    "ground-side": "Ground, at the side",
    "wall-bracket": "On a wall bracket",
    "flat-roof": "On a flat roof",
    balcony: "On a balcony",
    unsure: "Not sure",
  } satisfies Record<OutdoorLocation, string>,
  electricsCondition: {
    "modern-spare-ways": "Modern board with spare ways",
    "modern-full": "Modern board, full",
    "older-fuse-box": "Older fuse box",
    unsure: "Not sure",
  } satisfies Record<ElectricsCondition, string>,
  boardType: {
    "modern-rcbo": "Modern, RCBOs",
    "modern-rcd": "Modern, RCD protected",
    "older-fuse-box": "Older fuse box",
    unknown: "Not checked yet",
  } satisfies Record<MeasuredSurvey["electrics"]["boardType"], string>,
  tenure: {
    owner: "Owner",
    leaseholder: "Leaseholder",
    tenant: "Tenant",
    unknown: "Not confirmed",
  } satisfies Record<MeasuredSurvey["site"]["tenure"], string>,
  heatingUse: {
    main: "Main heating",
    supplementary: "Extra heating, alongside what they have",
    "cooling-only-intent": "Cooling only",
    unsure: "Not discussed yet",
  } satisfies Record<MeasuredSurvey["wishes"]["heatingUse"], string>,
  route: {
    "through-wall": "Straight through the wall",
    "external-trunking": "Outside, in trunking",
    "internal-concealed": "Hidden inside",
    "via-loft": "Through the loft",
    other: "Other",
  } satisfies Record<NonNullable<MeasuredRoom["route"]>, string>,
  reflectingSurfaces: {
    one: "One: free-standing on the ground, or high on a wall clear of corners (Q2)",
    two: "Two: on the ground against a wall, or on a wall near the ground (Q4)",
    three: "Three: in a corner or a side return, such as house wall, boundary wall and ground (Q8)",
  } satisfies Record<ReflectingSurfaces, string>,
  base: {
    "ground-feet": "Ground feet",
    "wall-bracket": "Wall bracket",
    slab: "Concrete slab",
    "roof-frame": "Roof frame",
    other: "Other",
  } satisfies Record<OutdoorPosition["base"], string>,
  accessEquipment: {
    none: "None",
    ladder: "Ladder",
    podium: "Podium steps",
    tower: "Tower",
    scaffold: "Scaffold",
    mewp: "MEWP (cherry picker)",
  } satisfies Record<OutdoorPosition["accessEquipment"], string>,
  wallConstruction: {
    "solid-brick": "Solid brick",
    cavity: "Cavity wall",
    "timber-frame": "Timber frame",
    stone: "Stone",
    concrete: "Concrete",
    plasterboard: "Plasterboard / stud",
    unknown: "Not sure",
  } satisfies Record<WallConstruction, string>,
};

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const positive = (v: unknown): boolean => (num(v) ?? 0) > 0;
const filled = (v: unknown): boolean => typeof v === "string" && v.trim().length > 0;
const round1 = (n: number) => Math.round(n * 10) / 10;
const list = <T>(v: T[] | undefined | null): T[] => (Array.isArray(v) ? v : []);

/**
 * The room's measured floor area: length × width when both are there,
 * otherwise the area typed in directly. Never a guess from the size band.
 */
export function measuredRoomArea(room: Pick<MeasuredRoom, "lengthM" | "widthM" | "areaM2">): number | undefined {
  const l = num(room.lengthM);
  const w = num(room.widthM);
  if (l !== undefined && w !== undefined && l > 0 && w > 0) return round1(l * w);
  const a = num(room.areaM2);
  return a !== undefined && a > 0 ? round1(a) : undefined;
}

/** A stable, path-safe id: the customer's room id when it's tidy, else a positional one. */
function roomIdFrom(raw: unknown, i: number, taken: Set<string>): string {
  let id = typeof raw === "string" && /^[A-Za-z0-9_-]{1,48}$/.test(raw) ? raw : `room-${i + 1}`;
  while (taken.has(id)) id = `${id}-${i + 1}`;
  taken.add(id);
  return id;
}

/** The engine's electrics condition for what the surveyor found (undefined when they haven't looked). */
export function electricsConditionFound(
  e: Pick<MeasuredSurvey["electrics"], "boardType" | "spareWays">,
): ElectricsCondition | undefined {
  switch (e.boardType) {
    case "older-fuse-box":
      return "older-fuse-box";
    case "modern-rcbo":
    case "modern-rcd": {
      const spare = num(e.spareWays);
      if (spare === undefined) return undefined;
      return spare > 0 ? "modern-spare-ways" : "modern-full";
    }
    default:
      return undefined;
  }
}

/* ------------------------------------------------------------------ */
/* Prefill                                                             */
/* ------------------------------------------------------------------ */

const OUTDOOR_BASE_GUESS: Record<OutdoorLocation, OutdoorPosition["base"]> = {
  "ground-rear": "ground-feet",
  "ground-side": "ground-feet",
  "wall-bracket": "wall-bracket",
  "flat-roof": "roof-frame",
  balcony: "ground-feet",
  unsure: "ground-feet",
};

function storeysGuess(self: Survey | undefined): number {
  if (!self) return 2;
  if (self.property?.type === "flat" || self.property?.type === "bungalow") return 1;
  if (list(self.rooms).some((r) => r.floor === "second-plus")) return 3;
  return 2;
}

/**
 * The measured survey as it starts on the surveyor's phone: the customer's
 * own answers carried over to confirm or correct (rooms with their names,
 * types, floors, glass, orientation and outside wall; the outdoor spot they
 * picked; what they said about the fuse board; the house type and age),
 * and everything only a visit can know left empty. Nothing measured is
 * guessed: no area from the size band (the screen shows the band as a
 * hint), no pipe runs, no photos, and every permission, risk and the
 * asbestos check start unanswered.
 */
export function emptyMeasuredSurvey(selfSurvey?: Survey): MeasuredSurvey {
  const self = selfSurvey;
  const taken = new Set<string>();
  const rooms: MeasuredRoom[] = list(self?.rooms).map((r, i) => ({
    id: roomIdFrom(r?.id, i, taken),
    name: (r?.name ?? "").trim() || `Room ${i + 1}`,
    type: r?.type ?? "other",
    floor: r?.floor ?? "ground",
    include: true,
    glazing: r?.glazing ?? "medium",
    orientation: r?.orientation ?? "unsure",
    hasExternalWall: r?.hasExternalWall !== false,
    condensate: "tbc",
    mediaIds: [],
    ...(typeof r?.id === "string" && r.id ? { selfSurveyRoomId: r.id } : {}),
  }));

  const guess = self?.outdoor?.location;
  const positions: OutdoorPosition[] =
    guess && guess !== "unsure"
      ? [
          {
            id: "outdoor-1",
            label: `Customer's choice: ${SURVEY_LABELS.outdoorLocation[guess].toLowerCase()}`,
            location: guess,
            base: OUTDOOR_BASE_GUESS[guess],
            accessEquipment: "none",
            chosen: false,
          },
        ]
      : [];

  const condition = self?.electrics?.condition;
  const boardType: MeasuredSurvey["electrics"]["boardType"] =
    condition === "older-fuse-box"
      ? "older-fuse-box"
      : condition === "modern-spare-ways" || condition === "modern-full"
        ? "modern-rcd"
        : "unknown";

  const ownership = self?.property?.ownership;
  return {
    version: 1,
    site: {
      confirmedAddress: false,
      ownerConfirmed: false,
      tenure: ownership === "owner" ? "owner" : ownership === "renting" ? "tenant" : "unknown",
    },
    wishes: { priorities: [], heatingUse: "unsure" },
    house: {
      type: self?.property?.type ?? "semi-detached",
      // Unknown age: assume older, so the asbestos check is asked rather than skipped.
      era: self?.property?.era ?? "1950-2000",
      wallConstruction: "unknown",
      storeys: storeysGuess(self),
      loftAccess: list(self?.rooms).some((r) => r.floor === "loft"),
      listedOrConservation: "unknown",
      asbestosRisk: "not-assessed",
    },
    rooms,
    outdoor: { positions },
    electrics: {
      boardType,
      ...(condition === "modern-full" ? { spareWays: 0 } : {}),
      asbestosFlashGuard: "n/a",
      mediaIds: [],
    },
    permissions: { pd: {} },
    risks: { workingAtHeight: false, structuralConcern: false, concealedServicesConcern: false, answered: [] },
    assumptions: [],
    unknowns: [],
  };
}

/**
 * What the property record already knows about designations, carried in
 * as a starting point when the surveyor hasn't answered yet. The planning
 * checks themselves stay unanswered: the surveyor and the technical lead
 * decide those.
 */
export function prefillFromPropertyIntel(
  m: MeasuredSurvey,
  constraints: { conservationArea?: boolean; listedBuilding?: boolean; article4?: boolean } | null | undefined,
): MeasuredSurvey {
  if (!constraints || m.house.listedOrConservation !== "unknown") return m;
  const found: string[] = [];
  if (constraints.listedBuilding) found.push("listed building");
  if (constraints.conservationArea) found.push("conservation area");
  if (constraints.article4) found.push("Article 4 direction");
  const line = found.length
    ? `Property record shows: ${found.join(", ")}. Check on site.`
    : "Property record shows no listing, conservation area or Article 4. Confirm on site.";
  return {
    ...m,
    house: {
      ...m.house,
      listedOrConservation: found.length ? "yes" : "no",
      notes: [m.house.notes?.trim(), line].filter(Boolean).join("\n"),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Completeness                                                        */
/* ------------------------------------------------------------------ */

/** One thing the survey needs, done or not. surveyCompleteness is the list of the undone ones. */
export interface SurveyCheck {
  sectionId: SurveySectionId;
  section: string;
  item: string;
  done: boolean;
  roomId?: string;
  positionId?: string;
  /** The form field that answers it, for jump links. */
  field?: string;
}

/** A unit mounted at or above this height needs access equipment: a ladder at least. */
export const ACCESS_EQUIPMENT_HEIGHT_M = 2;

/** The ladder limit this survey is judged against: the one it was started under, else the company default. */
export function ladderLimitM(m: Pick<MeasuredSurvey, "limits"> | null | undefined): number {
  const v = m?.limits?.ladderMaxBracketM;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : LADDER_MAX_BRACKET_M;
}

/** Is this position's bracket above the ladder limit, so a ladder (or nothing) won't do? */
export function needsHeightAccess(p: Pick<OutdoorPosition, "heightM">, limitM: number): boolean {
  return typeof p.heightM === "number" && Number.isFinite(p.heightM) && p.heightM > limitM;
}

/** Above the ladder limit with only a ladder (or nothing) picked: the survey can't be finished like that. */
export function ladderRefused(p: Pick<OutdoorPosition, "heightM" | "accessEquipment">, limitM: number): boolean {
  return needsHeightAccess(p, limitM) && !HEIGHT_ACCESS.includes(p.accessEquipment);
}

export const RISK_QUESTIONS: { id: RiskQuestionId; label: string; question: string; help: string }[] = [
  {
    id: "workingAtHeight",
    label: "working at height",
    question: "Will any work be above ground floor from outside, or need a ladder or tower?",
    help: "High wall brackets, first-floor core holes from outside, roof or loft access.",
  },
  {
    id: "structuralConcern",
    label: "structural concerns",
    question: "Any concern about the walls or structure the units fix to?",
    help: "Cracks, crumbling brick, render over weak walls, timber or stud walls for a heavy bracket.",
  },
  {
    id: "concealedServicesConcern",
    label: "hidden pipes and cables",
    question: "Could there be pipes or cables where you'd drill?",
    help: "Sockets or switches nearby, radiators below, boiler flues, gas meters, underfloor runs.",
  },
];

/**
 * Every check the survey has to pass, in visit order. Items appear only
 * where they apply (the asbestos check for homes built before 2000, the
 * flash-guard check for an older fuse box, access equipment for a unit
 * high on a wall), so the meter counts real work, never a box that's
 * ticked by default. Tolerant of partial records (a JSONB row read back).
 */
export function surveyChecks(m: MeasuredSurvey): SurveyCheck[] {
  const out: SurveyCheck[] = [];
  const add = (sectionId: SurveySectionId, item: string, done: boolean, extra: Partial<SurveyCheck> = {}) =>
    out.push({ sectionId, section: SECTION_LABEL[sectionId], item, done, ...extra });

  const site: Partial<MeasuredSurvey["site"]> = m?.site ?? {};
  add("site", "Address confirmed", site.confirmedAddress === true, { field: "confirmedAddress" });
  add("site", "Who makes the decision", filled(site.decisionMaker), { field: "decisionMaker" });
  add("site", "Owner, or authority to go ahead, confirmed", site.ownerConfirmed === true, { field: "ownerConfirmed" });
  add("site", "Tenure", !!site.tenure && site.tenure !== "unknown", { field: "tenure" });

  const wishes: Partial<MeasuredSurvey["wishes"]> = m?.wishes ?? {};
  add("wishes", "How they'll use it: heating, or cooling only", !!wishes.heatingUse && wishes.heatingUse !== "unsure", {
    field: "heatingUse",
  });

  const house: Partial<MeasuredSurvey["house"]> = m?.house ?? {};
  if (house.era !== "2000+") {
    add("house", "Asbestos risk assessed (built before 2000)", !!house.asbestosRisk && house.asbestosRisk !== "not-assessed", {
      field: "asbestosRisk",
    });
  }
  if (house.asbestosRisk === "possible" || house.asbestosRisk === "suspected") {
    add("house", "Asbestos: what you saw and where", filled(house.asbestosNote), { field: "asbestosNote" });
  }
  if (house.type === "flat") {
    const b: BlockFacts = house.block ?? {};
    add("house", "The block: how many storeys (or its height)", positive(b.storeys) || positive(b.heightM), { field: "blockStoreys" });
    add("house", "The block: does a pipe or cable cross a compartment wall or floor, or a common part?", b.crossing === "yes" || b.crossing === "no" || b.crossing === "unsure", { field: "blockCrossing" });
    add("house", "The block: the freeholder or managing agent", filled(b.freeholder), { field: "blockFreeholder" });
  }

  const rooms = list(m?.rooms).filter((r) => r && r.include !== false);
  if (rooms.length === 0) add("rooms", "At least one room to survey", false);
  rooms.forEach((r, i) => {
    const name = (r.name ?? "").trim() || `Room ${i + 1}`;
    const at = { roomId: r.id };
    add("rooms", `${name}: measurements`, measuredRoomArea(r) !== undefined, { ...at, field: "lengthM" });
    add("rooms", `${name}: ceiling height`, positive(r.ceilingHeightM), { ...at, field: "ceilingHeightM" });
    add("rooms", `${name}: which way the windows face`, !!r.orientation && r.orientation !== "unsure", { ...at, field: "orientation" });
    add("rooms", `${name}: photo of the unit wall`, list(r.mediaIds).length > 0, { ...at, field: "photos" });
    add("rooms", `${name}: pipe run length`, positive(r.pipeRunM), { ...at, field: "pipeRunM" });
    add("rooms", `${name}: height difference to the outdoor unit`, num(r.heightDropM) !== undefined, { ...at, field: "heightDropM" });
    const conflict = r.hasExternalWall === false && r.route === "through-wall";
    add(
      "rooms",
      conflict ? `${name}: pipe route (no outside wall, so not straight through)` : `${name}: pipe route`,
      !!r.route && !conflict,
      { ...at, field: "route" },
    );
    add("rooms", `${name}: condensate, gravity or pump`, r.condensate === "gravity" || r.condensate === "pump", {
      ...at,
      field: "condensate",
    });
  });

  const chosen = list(m?.outdoor?.positions).filter((p) => p && p.chosen);
  add("outdoor", "Choose the outdoor unit position", chosen.length > 0);
  chosen.forEach((p, i) => {
    const name = (p.label ?? "").trim() || `Outdoor position ${i + 1}`;
    const at = { positionId: p.id };
    add("outdoor", `${name}: photo`, filled(p.mediaId), { ...at, field: "photo" });
    add("outdoor", `${name}: distance to the nearest neighbour's window`, (num(p.distanceToNeighbourWindowM) ?? -1) >= 0, {
      ...at,
      field: "distanceToNeighbourWindowM",
    });
    add("outdoor", `${name}: hard surfaces within 1 m (for the noise calculation)`, p.reflectingSurfaces === "one" || p.reflectingSurfaces === "two" || p.reflectingSurfaces === "three", {
      ...at,
      field: "reflectingSurfaces",
    });
    if (p.base === "wall-bracket" || p.base === "roof-frame") {
      add("outdoor", `${name}: mounting height`, (num(p.heightM) ?? -1) >= 0, { ...at, field: "heightM" });
    }
    const height = num(p.heightM) ?? 0;
    const limit = ladderLimitM(m);
    if (needsHeightAccess(p, limit)) {
      // Above the ladder limit: a tower, podium, scaffold or MEWP, never a ladder.
      add("outdoor", `${name}: access for a bracket ${round1(height)} m up (above ${round1(limit)} m a ladder won't do: a tower, podium, scaffold or MEWP)`, !ladderRefused(p, limit), {
        ...at,
        field: "accessEquipment",
      });
    } else if (height >= ACCESS_EQUIPMENT_HEIGHT_M) {
      add("outdoor", `${name}: access equipment for a unit ${round1(height)} m up`, !!p.accessEquipment && p.accessEquipment !== "none", {
        ...at,
        field: "accessEquipment",
      });
    }
    add("outdoor", `${name}: where defrost water will drain`, filled(p.defrostDrainage), { ...at, field: "defrostDrainage" });
  });

  const e: Partial<MeasuredSurvey["electrics"]> = m?.electrics ?? {};
  add("electrics", "Fuse board type", !!e.boardType && e.boardType !== "unknown", { field: "boardType" });
  add("electrics", "Photo of the fuse board", list(e.mediaIds).length > 0, { field: "photos" });
  add("electrics", "Cable route length", positive(e.cableRouteM), { field: "cableRouteM" });
  if (e.boardType === "older-fuse-box") {
    add("electrics", "Asbestos flash guard checked (older board)", !!e.asbestosFlashGuard && e.asbestosFlashGuard !== "n/a", {
      field: "asbestosFlashGuard",
    });
  }

  const pd = m?.permissions?.pd ?? {};
  // What the design works out (noise) isn't asked at the survey.
  for (const check of PD_CHECKS.filter((c) => !c.byDesign)) {
    const answer = pd[check.id];
    add("permissions", check.label, answer === "yes" || answer === "no" || answer === "unsure", { field: `pd-${check.id}` });
  }

  const risks: Partial<MeasuredSurvey["risks"]> = m?.risks ?? {};
  const answered = risks.answered;
  for (const q of RISK_QUESTIONS) {
    add("risks", `Asked about ${q.label}`, answered === undefined || (Array.isArray(answered) && answered.includes(q.id)), {
      field: q.id,
    });
  }
  // Records made before the question list existed are taken as complete, the
  // same as the questions above: only ask for the note on new-style records.
  if (answered !== undefined && (risks.structuralConcern || risks.concealedServicesConcern)) {
    add("risks", "Say what the concern is", filled(risks.notes), { field: "riskNotes" });
  }
  return out;
}

/**
 * How complete the survey is, and exactly what's left. `pct` counts items
 * (every check weighs the same) and only reads 100 when nothing is missing.
 */
export function surveyCompleteness(m: MeasuredSurvey): SurveyCompleteness {
  const checks = surveyChecks(m);
  const missing = checks
    .filter((c) => !c.done)
    .map((c) => ({
      section: c.section,
      item: c.item,
      sectionId: c.sectionId,
      ...(c.roomId ? { roomId: c.roomId } : {}),
      ...(c.positionId ? { positionId: c.positionId } : {}),
      ...(c.field ? { field: c.field } : {}),
    }));
  const total = checks.length;
  const done = total - missing.length;
  const pct = missing.length === 0 ? 100 : Math.min(99, Math.floor((done / Math.max(1, total)) * 100));
  return { pct, missing };
}

/** Done and total per section, for the overview's meters. */
export function sectionProgress(m: MeasuredSurvey): Record<SurveySectionId, { done: number; total: number }> {
  const out = Object.fromEntries(SURVEY_SECTIONS.map((s) => [s.id, { done: 0, total: 0 }])) as Record<
    SurveySectionId,
    { done: number; total: number }
  >;
  for (const c of surveyChecks(m)) {
    out[c.sectionId].total += 1;
    if (c.done) out[c.sectionId].done += 1;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Into the engines                                                    */
/* ------------------------------------------------------------------ */

/**
 * The customer's survey with the measured facts laid over it, so the
 * pricing and design engines run on what the surveyor found: each
 * included room's measured area (and the band it falls in), floor, glass,
 * orientation and outside wall; the chosen outdoor spot; the fuse board as
 * found. Photos are kept: the customer's, plus the survey's media ids.
 * Rooms left out at the survey are left out here too.
 */
export function measuredToEngineSurvey(m: MeasuredSurvey, base: Survey): Survey {
  const byId = new Map(list(base?.rooms).map((r) => [r.id, r]));
  const rooms: SurveyRoom[] = list(m?.rooms)
    .filter((r) => r && r.include !== false)
    .map((r) => {
      const self = r.selfSurveyRoomId ? byId.get(r.selfSurveyRoomId) : undefined;
      const area = measuredRoomArea(r);
      const room: SurveyRoom = {
        id: r.id,
        name: r.name,
        type: r.type,
        size: area !== undefined ? roomSizeForArea(area) : (self?.size ?? "medium"),
        floor: r.floor,
        glazing: r.glazing,
        orientation: r.orientation,
        hasExternalWall: r.hasExternalWall,
        photos: [...list(self?.photos), ...list(r.mediaIds).map((id): SurveyPhoto => ({ id, kind: "room" }))],
      };
      if (area !== undefined) room.areaM2 = area;
      return room;
    });

  const positions = list(m?.outdoor?.positions);
  const chosen = positions.find((p) => p && p.chosen);
  const outdoorPhotos: SurveyPhoto[] = [
    ...list(base?.outdoor?.photos),
    ...positions.filter((p) => p?.chosen && p.mediaId).map((p): SurveyPhoto => ({ id: p.mediaId!, kind: "outdoor-location" })),
  ];

  const e = m?.electrics;
  const found = e ? electricsConditionFound(e) : undefined;
  const said = base?.electrics?.condition ?? "unsure";
  // A modern board whose spare ways weren't counted: keep the customer's "modern" answer, else unsure.
  const modern = e?.boardType === "modern-rcbo" || e?.boardType === "modern-rcd";
  const condition: ElectricsCondition =
    found ?? (modern ? (said === "modern-full" || said === "modern-spare-ways" ? said : "unsure") : said);

  const tenure = m?.site?.tenure;
  const ownership =
    tenure === "owner" || tenure === "leaseholder" ? "owner" : tenure === "tenant" ? "renting" : (base?.property?.ownership ?? "owner");

  return {
    ...base,
    property: {
      ...base?.property,
      type: m?.house?.type ?? base?.property?.type,
      era: m?.house?.era ?? base?.property?.era,
      bedrooms: base?.property?.bedrooms ?? 0,
      ownership,
    },
    rooms,
    outdoor: { location: chosen?.location ?? base?.outdoor?.location ?? "unsure", photos: outdoorPhotos },
    electrics: {
      condition,
      photos: [...list(base?.electrics?.photos), ...list(e?.mediaIds).map((id): SurveyPhoto => ({ id, kind: "fuse-board" }))],
    },
  };
}

/**
 * What the surveyor's fuse-board finding means for the customer's
 * electrics plan (the `survey-submitted` action's optional `electrics`).
 * Customer-facing copy, calm and specific. Undefined until the board has
 * been looked at.
 */
export function electricsFinding(m: MeasuredSurvey): { status: ElectricsPlanStatus; summary: string } | undefined {
  const e = m?.electrics;
  if (!e || !e.boardType || e.boardType === "unknown") return undefined;
  const flash = e.asbestosFlashGuard === "possible" || e.asbestosFlashGuard === "yes";
  if (flash) {
    return {
      status: "attention",
      summary:
        "Your surveyor found a fuse board that may have an asbestos flash guard. It needs checking by a specialist before any electrical work; your proposal explains the next step and any cost.",
    };
  }
  if (e.boardType === "older-fuse-box") {
    return {
      status: "attention",
      summary:
        "Your surveyor found an older fuse box. Adding a new circuit safely may mean upgrading it; your proposal says exactly what's needed and prices it before anything is booked.",
    };
  }
  const spare = num(e.spareWays);
  if (spare === undefined) {
    return {
      status: "provisional",
      summary: "Your surveyor checked your fuse board: it's a modern one. We'll confirm the spare capacity for the new circuit in your design.",
    };
  }
  if (spare <= 0) {
    return {
      status: "attention",
      summary:
        "Your fuse board is modern but full, so we'll need to free up a way or add a small extra board. Your proposal says what's needed and prices it.",
    };
  }
  return {
    status: "validated",
    summary: `Your surveyor checked your fuse board: modern, with ${spare} spare way${spare === 1 ? "" : "s"} for the new circuit. Our electrician confirms your supply can take it before anything is booked.`,
  };
}

/* ------------------------------------------------------------------ */
/* Self-survey diff                                                    */
/* ------------------------------------------------------------------ */

const yesNo = (b: boolean) => (b ? "Yes" : "No");

/** What the customer said about a room's size: their own area when they gave one, else the band. */
function saidSize(s: SurveyRoom): { words: string; band: RoomSize } {
  const area = num(s.areaM2);
  if (area !== undefined && area > 0) return { words: `${round1(area)} m²`, band: roomSizeForArea(area) };
  return { words: roomSizeLabel(s.size), band: s.size };
}

/**
 * The customer's own answers against what the surveyor found, a row per
 * fact: the home (type, age, how many rooms), each room (size band against
 * the measured area's band, floor, outside wall), the outdoor spot and the
 * fuse board. `match` is null when either side doesn't say (the customer
 * wasn't sure, or it wasn't measured), so accuracy only counts real
 * comparisons. The pilot's most valuable data: does self-survey work?
 */
export function diffSelfSurvey(self: Survey, m: MeasuredSurvey): SelfSurveyDiffRow[] {
  const rows: SelfSurveyDiffRow[] = [];
  const home = "Whole home";
  const selfRooms = list(self?.rooms);
  const measuredRooms = list(m?.rooms).filter(Boolean);
  const included = measuredRooms.filter((r) => r.include !== false);

  if (self?.property?.type && m?.house?.type) {
    rows.push({
      room: home,
      field: "Property type",
      customerSaid: SURVEY_LABELS.propertyType[self.property.type] ?? self.property.type,
      measured: SURVEY_LABELS.propertyType[m.house.type] ?? m.house.type,
      match: self.property.type === m.house.type,
    });
  }
  if (self?.property?.era && m?.house?.era) {
    rows.push({
      room: home,
      field: "Built",
      customerSaid: SURVEY_LABELS.era[self.property.era] ?? self.property.era,
      measured: SURVEY_LABELS.era[m.house.era] ?? m.house.era,
      match: self.property.era === m.house.era,
    });
  }
  rows.push({
    room: home,
    field: "Rooms to air-condition",
    customerSaid: String(selfRooms.length),
    measured: String(included.length),
    match: selfRooms.length === included.length,
  });

  const matched = new Set<string>();
  for (const r of measuredRooms) {
    const s = r.selfSurveyRoomId ? selfRooms.find((x) => x.id === r.selfSurveyRoomId) : undefined;
    const name = (r.name ?? "").trim() || "Room";
    if (!s) {
      if (r.include !== false) rows.push({ room: name, field: "Room", customerSaid: "Not listed", measured: "Added at the survey", match: null });
      continue;
    }
    matched.add(s.id);
    if (r.include === false) {
      rows.push({ room: name, field: "Room", customerSaid: "Listed", measured: "Left out at the survey", match: null });
      continue;
    }
    const said = saidSize(s);
    const area = measuredRoomArea(r);
    if (area === undefined) {
      rows.push({ room: name, field: "Size", customerSaid: said.words, measured: "Not measured", match: null });
    } else {
      const band = roomSizeForArea(area);
      const row: SelfSurveyDiffRow = {
        room: name,
        field: "Size",
        customerSaid: said.words,
        measured: `${area} m² (${ROOM_SIZE_BANDS[band].label.toLowerCase()})`,
        match: band === said.band,
      };
      if (band !== said.band) {
        const b = ROOM_SIZE_BANDS[said.band];
        const bigger = b.maxM2 !== null && area >= b.maxM2;
        const edge = bigger ? area - (b.maxM2 ?? 0) : b.minM2 - area;
        row.note = edge <= 1 ? `Just ${bigger ? "over" : "under"} the customer's band` : bigger ? "Bigger than the customer thought" : "Smaller than the customer thought";
      }
      rows.push(row);
    }
    rows.push({
      room: name,
      field: "Floor",
      customerSaid: SURVEY_LABELS.floor[s.floor] ?? s.floor,
      measured: SURVEY_LABELS.floor[r.floor] ?? r.floor,
      match: s.floor === r.floor,
    });
    const saidWall = s.hasExternalWall !== false;
    const foundWall = r.hasExternalWall !== false;
    rows.push({ room: name, field: "Outside wall", customerSaid: yesNo(saidWall), measured: yesNo(foundWall), match: saidWall === foundWall });
  }
  for (const s of selfRooms) {
    if (!matched.has(s.id)) rows.push({ room: (s.name ?? "").trim() || "Room", field: "Room", customerSaid: "Listed", measured: "Not surveyed", match: null });
  }

  const guess = self?.outdoor?.location;
  const chosen = list(m?.outdoor?.positions).find((p) => p && p.chosen);
  rows.push({
    room: "Outside",
    field: "Outdoor unit spot",
    customerSaid: guess ? SURVEY_LABELS.outdoorLocation[guess] : "Not asked",
    measured: chosen ? (SURVEY_LABELS.outdoorLocation[chosen.location] ?? chosen.location) : "Not chosen yet",
    match: !guess || guess === "unsure" || !chosen || chosen.location === "unsure" ? null : guess === chosen.location,
  });

  const saidBoard = self?.electrics?.condition;
  const e = m?.electrics;
  const found = e ? electricsConditionFound(e) : undefined;
  const spare = num(e?.spareWays);
  const measured =
    e?.boardType && e.boardType !== "unknown"
      ? `${SURVEY_LABELS.boardType[e.boardType]}${spare !== undefined ? `, ${spare} spare way${spare === 1 ? "" : "s"}` : ""}`
      : "Not checked yet";
  const electricsRow: SelfSurveyDiffRow = {
    room: "Electrics",
    field: "Fuse board",
    customerSaid: saidBoard ? SURVEY_LABELS.electricsCondition[saidBoard] : "Not asked",
    measured,
    match: !saidBoard || saidBoard === "unsure" || !found ? null : saidBoard === found,
  };
  if (!found && (e?.boardType === "modern-rcbo" || e?.boardType === "modern-rcd")) electricsRow.note = "Spare ways not counted";
  rows.push(electricsRow);
  return rows;
}

/** How often the customer was right, over the rows that could be compared. Null when none could. */
export function diffAccuracyPct(rows: SelfSurveyDiffRow[]): number | null {
  const compared = rows.filter((r) => r.match !== null);
  if (compared.length === 0) return null;
  return Math.round((compared.filter((r) => r.match === true).length / compared.length) * 100);
}
