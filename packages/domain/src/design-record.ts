import type { CatalogueItem, CombinationCheck, CompatibilityRule } from "./catalogue.ts";
import type { DesignVerdict, RuleResult } from "./design.ts";
import type { PropertyIntel } from "./intelligence.ts";
import type { MeasuredSurvey } from "./survey-visit.ts";
import type { FloorLevel, Survey } from "./types.ts";

/**
 * The persisted design: what we'll actually install, version by version.
 *
 * `designSystem` (design.ts) stays the engine; this is the record around it:
 * the measured inputs, the chosen variants (Standard / Quiet), every
 * override with its reason, and the technical lead's sign-off. An approved
 * record is the source for the proposal, the purchase orders and the
 * install runsheet, and is never edited: a change is a new version.
 *
 * Foundation ships the types; F3 owns the logic.
 */

export interface RoomDesignInput {
  roomId: string;
  roomName: string;
  floor: FloorLevel;
  preliminaryLoadW: number;
  suggestedKw: number;
  chosenKw: number;
  reason?: string;
  pipeRunM: number;
  heightDiffM: number;
  condensate: "gravity" | "pump";
  layoutMediaIds: string[];
}

export interface DesignBomLine {
  catalogueItemId?: string;
  sku: string;
  label: string;
  qty: number;
  unit?: string;
  category: "equipment" | "materials" | "consumables";
}

export interface SystemSelection {
  id: string;
  topology: "single" | "multi";
  outdoorItemId: string;
  roomIds: string[];
  outdoorPositionId?: string;
  compatibility: CombinationCheck;
  electrical: { breaker: string; cableMm2: number; isolator: string; routeNote?: string };
  refrigerant: { totalPipeM: number; prechargedPipeM: number; additionalChargeG: number };
}

export interface DesignVariant {
  id: string;
  label: string;
  tier: "standard" | "premium";
  systems: SystemSelection[];
  roomUnits: { roomId: string; indoorItemId: string }[];
  bom: DesignBomLine[];
  rules: RuleResult[];
  verdict: DesignVerdict;
  installDays: number;
}

export interface DesignOverride {
  field: string;
  from: string;
  to: string;
  reason: string;
  by: string;
  at: string;
}

export interface DesignRecord {
  id: string;
  projectId: string;
  version: number;
  status: "draft" | "in-review" | "approved" | "superseded";
  surveyRecordId?: string;
  rooms: RoomDesignInput[];
  variants: DesignVariant[];
  overrides: DesignOverride[];
  notes?: string;
  approval?: { staffId: string; name: string; qualificationRef: string; at: string };
  createdAt: string;
  createdBy?: string;
}

export function draftDesign(input: {
  projectId: string;
  id: string;
  version: number;
  measured: MeasuredSurvey;
  baseSurvey: Survey;
  catalogue: CatalogueItem[];
  compatibility: CompatibilityRule[];
  intel?: PropertyIntel;
  now: string;
}): DesignRecord {
  throw new Error("not implemented: draftDesign (F3)");
}

export function recomputeVariant(
  design: DesignRecord,
  variantId: string,
  catalogue: CatalogueItem[],
  compatibility: CompatibilityRule[],
): DesignVariant {
  throw new Error("not implemented: recomputeVariant (F3)");
}

/** e.g. compatibility errors, reasons missing on overrides, missing layout photos. */
export function designApprovalErrors(design: DesignRecord): string[] {
  throw new Error("not implemented: designApprovalErrors (F3)");
}
