/**
 * Canonical survey + quote types for the whole platform.
 *
 * Every app (customer web, ops dashboard, installer app) speaks these types.
 * They are deliberately serialisable (plain JSON) so a survey can be stored,
 * replayed against newer engine versions, and audited.
 */

export type PropertyType =
  | "detached"
  | "semi-detached"
  | "terraced"
  | "flat"
  | "bungalow";

export type PropertyEra = "pre-1930" | "1930-1979" | "1980-1999" | "2000+";

export type Ownership = "owner" | "renting";

export type RoomType =
  | "bedroom"
  | "living-room"
  | "kitchen-diner"
  | "home-office"
  | "loft-room"
  | "conservatory"
  | "other";

/** Approximate floor area bands — customers guess bands far more reliably than metres. */
export type RoomSize = "small" | "medium" | "large" | "xl";

export type FloorLevel = "ground" | "first" | "second-plus" | "loft";

/** How much glass the room has relative to its size. */
export type GlazingLevel = "low" | "medium" | "high";

export type Orientation = "north" | "east" | "south" | "west" | "unsure";

export type OutdoorLocation =
  | "ground-rear"
  | "ground-side"
  | "wall-bracket"
  | "flat-roof"
  | "balcony"
  | "unsure";

export type ElectricsCondition =
  | "modern-spare-ways" // modern consumer unit with spare ways
  | "modern-full" // modern but full — needs a way freed / small board work
  | "older-fuse-box" // rewireable fuses / very old board
  | "unsure";

export type PhotoKind =
  | "room"
  | "window"
  | "external-wall"
  | "outdoor-location"
  | "fuse-board"
  | "side-access";

export interface SurveyPhoto {
  id: string;
  kind: PhotoKind;
  /** Storage path once uploaded (e.g. Supabase Storage object path). */
  storagePath?: string;
  /** Original file name, for ops reference. */
  fileName?: string;
}

export interface SurveyRoom {
  id: string;
  name: string;
  type: RoomType;
  size: RoomSize;
  floor: FloorLevel;
  glazing: GlazingLevel;
  orientation: Orientation;
  /** Does the room have at least one external wall? Drives pipe routing cost. */
  hasExternalWall: boolean;
  photos: SurveyPhoto[];
}

/** Resolved from the postcode (postcodes.io). Metadata only — the engine ignores it. */
export interface SurveyGeo {
  district?: string;
  region?: string;
  latitude?: number;
  longitude?: number;
}

export interface Survey {
  postcode: string;
  addressLine: string;
  geo?: SurveyGeo;
  /** Archetype + install permutation the customer selected (see archetypes.ts). */
  archetypeId?: string;
  permutationId?: string;
  property: {
    type: PropertyType;
    era: PropertyEra;
    bedrooms: number;
    ownership: Ownership;
  };
  rooms: SurveyRoom[];
  outdoor: {
    location: OutdoorLocation;
    photos: SurveyPhoto[];
  };
  electrics: {
    condition: ElectricsCondition;
    photos: SurveyPhoto[];
  };
}

/** Indoor unit capacities we install, in kW (cooling). */
export type CapacityKw = 2.5 | 3.5 | 5.0 | 7.1;

export interface RoomDesign {
  roomId: string;
  roomName: string;
  capacityKw: CapacityKw;
  estimatedLoadWatts: number;
  unitLabel: string;
}

/** One outdoor unit and the indoor units it serves. */
export interface SystemDesign {
  outdoorLabel: string;
  /** "single" = one indoor per outdoor; "multi" = multi-split. */
  topology: "single" | "multi";
  rooms: RoomDesign[];
}

export interface QuoteLine {
  label: string;
  detail?: string;
  amount: number; // GBP, VAT inclusive
}

export type ConfidenceBand = "high" | "medium" | "low";

export interface Confidence {
  score: number; // 0–100
  band: ConfidenceBand;
  /** Things that would raise the score (missing photos, "unsure" answers…). */
  gaps: string[];
}

export interface FinanceOption {
  months: number;
  aprPercent: number;
  depositGbp: number;
  monthlyGbp: number;
  totalPayableGbp: number;
}

export interface QuoteResult {
  engineVersion: string;
  systems: SystemDesign[];
  lines: QuoteLine[];
  totalGbp: number; // VAT inclusive
  installDays: number;
  warrantyYears: number;
  confidence: Confidence;
  finance: FinanceOption[];
  /** Non-price flags ops should review before confirming (e.g. "no external wall"). */
  reviewFlags: string[];
}
