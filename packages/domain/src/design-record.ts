import {
  PROVISIONAL_RULE_WARNING,
  findRule,
  fmtKw,
  isConnectable,
  isMultiOutdoor,
  isSelectable,
  isStale,
  singlePairFor,
  validateCombination,
  type CatalogueItem,
  type CombinationCheck,
  type CompatibilityRule,
} from "./catalogue.ts";
import { MCS_HEAT_PUMP_LIMIT_DB, NOISE_LIMIT_DB, designVerdict, estimateHeightDiffM, estimatePipeRunM, type DesignVerdict, type RuleResult, type RuleStatus } from "./design.ts";
import { estimateRoomLoadWatts, selectCapacityKw } from "./heatload.ts";
import type { PropertyIntel } from "./intelligence.ts";
import {
  DIRECTIVITY_Q,
  PD_CHECKS,
  emptyMeasuredSurvey,
  measuredToEngineSurvey,
  type MeasuredRoom,
  type MeasuredSurvey,
  type OutdoorPosition,
  type PdCheckId,
} from "./survey-visit.ts";
import type { FloorLevel, PropertyType, RoomSize, RoomType, Survey, SurveyRoom } from "./types.ts";

/**
 * The persisted design: what we'll actually install, version by version.
 *
 * `designSystem` (design.ts) stays the engine; this is the record around it:
 * the measured inputs, the chosen variants (Standard / Quiet), every
 * override with its reason, and the technical lead's sign-off. An approved
 * record is the source for the proposal, the purchase orders and the
 * install runsheet, and is never edited: a change is a new version.
 *
 * Foundation ships the types; F3 owns the logic. Fields marked "Additive
 * (F3)" are optional extras on the contract types: everything a later
 * recompute needs is in the record itself (the site facts the rules read,
 * the survey baseline an override is measured against, the suggestion each
 * choice deviates from), so a design can be re-checked and audited without
 * the survey that produced it.
 *
 * Honest by construction: the room load is a rule of thumb and says so;
 * anything estimated rather than measured is flagged; a rule that can't be
 * evaluated from the data says "cannot determine" instead of guessing; and
 * a multi-split is only ever built on a compatibility rule from the
 * catalogue.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** Inputs that were estimated because the survey left them blank. */
export type RoomEstimate = "area" | "pipeRunM" | "heightDiffM" | "condensate";

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
  /** Additive (F3): room facts the rules read. */
  type?: RoomType;
  areaM2?: number;
  hasExternalWall?: boolean;
  route?: MeasuredRoom["route"];
  /** Additive (F3): what the survey said (or the estimate where it was blank): the baseline for overrides. */
  survey?: { pipeRunM: number; heightDiffM: number; condensate: "gravity" | "pump" };
  /** Additive (F3): which of the inputs above are estimates, not measurements. */
  estimated?: RoomEstimate[];
}

export interface DesignBomLine {
  catalogueItemId?: string;
  sku: string;
  label: string;
  qty: number;
  unit?: string;
  category: "equipment" | "materials" | "consumables";
  /** Additive (F3): why this quantity, or what to check ("length not measured"). */
  note?: string;
}

export interface SystemSelection {
  id: string;
  topology: "single" | "multi";
  outdoorItemId: string;
  roomIds: string[];
  outdoorPositionId?: string;
  compatibility: CombinationCheck;
  electrical: { breaker: string; cableMm2: number; isolator: string; routeNote?: string; breakerSource?: "manufacturer" | "rule-of-thumb" };
  refrigerant: {
    totalPipeM: number;
    prechargedPipeM: number;
    additionalChargeG: number;
    chargeKnown?: boolean;
    /** Additive (round 8): the outdoor unit's factory charge, and factory plus added, kg (when the catalogue has the figures). */
    factoryChargeKg?: number;
    totalChargeKg?: number;
  };
  /** Additive (F3): the compatibility rule used, and how sure it is. */
  ruleId?: string;
  ruleConfidence?: "verified" | "provisional";
  /** Additive (F3): the annotated outdoor photos that form the approved layout. */
  layoutMediaIds?: string[];
}

/** A set of choices: which indoor unit per room, and which outdoor unit serves which rooms. */
export interface VariantChoice {
  roomUnits: { roomId: string; indoorItemId: string }[];
  systems: SystemChoice[];
}

export interface SystemChoice {
  id?: string;
  outdoorItemId: string;
  roomIds: string[];
  outdoorPositionId?: string;
  layoutMediaIds?: string[];
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
  /** Additive (F3): the brand this variant is built on. */
  manufacturer?: string;
  /** Additive (F3): what the engine would choose for the current inputs; a different choice needs a reason. */
  suggested?: VariantChoice;
}

export interface DesignOverride {
  field: string;
  from: string;
  to: string;
  reason: string;
  by: string;
  at: string;
}

/** The site facts the rules need, copied from the survey when the design is drafted. */
export interface DesignSite {
  propertyType: PropertyType;
  heatingUse: MeasuredSurvey["wishes"]["heatingUse"];
  quietPriority: boolean;
  electrics: Pick<MeasuredSurvey["electrics"], "boardType" | "spareWays" | "earthing" | "cableRouteM" | "cableRouteNote" | "asbestosFlashGuard">;
  planning: {
    listedOrConservation: MeasuredSurvey["house"]["listedOrConservation"];
    pd: Partial<Record<PdCheckId, "yes" | "no" | "unsure">>;
    intel?: { conservationArea: boolean; listedBuilding: boolean; article4: boolean };
  };
  outdoorPositions: Pick<OutdoorPosition, "id" | "label" | "location" | "base" | "distanceToNeighbourWindowM" | "reflectingSurfaces" | "heightM" | "accessEquipment" | "mediaId" | "chosen">[];
  risks: Pick<MeasuredSurvey["risks"], "workingAtHeight" | "structuralConcern" | "concealedServicesConcern">;
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
  /** Additive (F3): the survey facts the rules read. */
  site?: DesignSite;
  /** Additive (F3): what the approver confirmed by hand. */
  acknowledgements?: { combinationTable?: { by: string; at: string } };
}

/* ------------------------------------------------------------------ */
/* Planning and noise                                                  */
/* ------------------------------------------------------------------ */

/** The design's own permitted-development and noise checks: Class G's unit count and size, and the MCS 020 noise estimate. */
export const PLANNING_NOISE_RULE_IDS = ["unit-count", "outdoor-volume", "noise"] as const;

/**
 * Those checks on one variant that aren't a plain pass: in review (over a
 * limit, or close to it) or blocked (can't be worked out). They never
 * decide that planning is or isn't needed: they say someone must look.
 */
export function planningNoiseFlags(variant: Pick<DesignVariant, "rules"> | undefined | null): RuleResult[] {
  return (variant?.rules ?? []).filter((r) => (PLANNING_NOISE_RULE_IDS as readonly string[]).includes(r.id) && r.status !== "pass");
}

/* ------------------------------------------------------------------ */
/* Copy                                                                */
/* ------------------------------------------------------------------ */

/** How the room load is labelled everywhere it's shown. */
export const PRELIMINARY_LOAD_LABEL = "Rule-of-thumb estimate for review, not a heat-loss calculation";

export const COMBINATION_TABLE_ACK = "I have checked the manufacturer's combination table";

export const VARIANT_LABEL: Record<"standard" | "premium", string> = { standard: "Standard", premium: "Quiet" };

/** The capacities a room can be set to. */
export const CAPACITY_OPTIONS_KW = [2.5, 3.5, 5.0, 7.1] as const;

/** A unit "fits" a capacity class from this far under it (a 3.3 or 3.4 kW unit is sold as a 3.5). */
const CLASS_TOLERANCE_KW = 0.25;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const round1 = (n: number) => Math.round(n * 10) / 10;
const sum = (ns: number[]) => ns.reduce((s, n) => s + n, 0);
const kwOf = (item: CatalogueItem | undefined): number | null => {
  const kw = item?.specs?.coolingKw;
  return typeof kw === "number" && Number.isFinite(kw) ? kw : null;
};
const tierOf = (item: CatalogueItem) => item.tier ?? "standard";
const codeOf = (item: CatalogueItem) => item.model ?? item.label;
const fmtW = (w: number) => `${String(Math.round(w)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} W`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function byIdMap(catalogue: CatalogueItem[]): Map<string, CatalogueItem> {
  return new Map(catalogue.map((i) => [i.id, i]));
}

/** Worst light wins. */
function worst(statuses: RuleStatus[]): RuleStatus {
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("review")) return "review";
  return "pass";
}

/** Room size band from a floor area, for the load estimate's fallback. */
function bandFor(areaM2: number): RoomSize {
  if (areaM2 < 11) return "small";
  if (areaM2 < 17) return "medium";
  if (areaM2 < 24) return "large";
  return "xl";
}

/* ------------------------------------------------------------------ */
/* From the survey                                                     */
/* ------------------------------------------------------------------ */

export function siteFromSurvey(measured: MeasuredSurvey, intel?: PropertyIntel): DesignSite {
  const e = measured.electrics;
  return {
    propertyType: measured.house.type,
    heatingUse: measured.wishes.heatingUse,
    quietPriority: measured.wishes.priorities.includes("quiet"),
    electrics: {
      boardType: e.boardType,
      ...(e.spareWays !== undefined ? { spareWays: e.spareWays } : {}),
      ...(e.earthing ? { earthing: e.earthing } : {}),
      ...(e.cableRouteM !== undefined ? { cableRouteM: e.cableRouteM } : {}),
      ...(e.cableRouteNote ? { cableRouteNote: e.cableRouteNote } : {}),
      asbestosFlashGuard: e.asbestosFlashGuard,
    },
    planning: {
      listedOrConservation: measured.house.listedOrConservation,
      pd: { ...measured.permissions.pd },
      ...(intel
        ? {
            intel: {
              conservationArea: intel.constraints.conservationArea,
              listedBuilding: intel.constraints.listedBuilding,
              article4: intel.constraints.article4,
            },
          }
        : {}),
    },
    outdoorPositions: measured.outdoor.positions.map((p) => ({
      id: p.id,
      label: p.label,
      location: p.location,
      base: p.base,
      ...(p.distanceToNeighbourWindowM !== undefined ? { distanceToNeighbourWindowM: p.distanceToNeighbourWindowM } : {}),
      ...(p.reflectingSurfaces ? { reflectingSurfaces: p.reflectingSurfaces } : {}),
      ...(p.heightM !== undefined ? { heightM: p.heightM } : {}),
      accessEquipment: p.accessEquipment,
      ...(p.mediaId ? { mediaId: p.mediaId } : {}),
      chosen: p.chosen,
    })),
    risks: {
      workingAtHeight: measured.risks.workingAtHeight,
      structuralConcern: measured.risks.structuralConcern,
      concealedServicesConcern: measured.risks.concealedServicesConcern,
    },
  };
}

const positive = (n: number | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const nonNegative = (n: number | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;

/**
 * The preliminary load for a measured room: the house rule of thumb
 * (heatload.ts) on the measured floor area, scaled for the measured ceiling
 * height, plus about two people's worth for a busy room. Labelled as a
 * rule of thumb wherever it's shown. The room is read through F2's
 * measuredToEngineSurvey (`engineRoom`), the same conversion the proposal's
 * engine reference uses, so the design and the price see the same room.
 */
export function preliminaryLoadW(
  room: MeasuredRoom,
  base?: SurveyRoom,
  engineRoom?: SurveyRoom,
): { loadW: number; areaM2?: number; estimatedArea: boolean } {
  const er = engineRoom ?? measuredToEngineSurvey({ ...emptyMeasuredSurvey(), rooms: [{ ...room, include: true }] }, { rooms: base ? [base] : [] } as unknown as Survey).rooms[0];
  const measuredArea = positive(er?.areaM2) ? er.areaM2 : undefined;
  const ceiling = positive(room.ceilingHeightM) ? room.ceilingHeightM : 2.4;
  const size: RoomSize = er?.size ?? (measuredArea ? bandFor(measuredArea) : (base?.size ?? "medium"));
  const engine: SurveyRoom = {
    id: room.id,
    name: room.name,
    type: er?.type ?? room.type,
    size,
    ...(measuredArea ? { areaM2: (measuredArea * ceiling) / 2.4 } : {}),
    floor: er?.floor ?? room.floor,
    glazing: er?.glazing ?? room.glazing,
    orientation: er?.orientation ?? room.orientation,
    hasExternalWall: er?.hasExternalWall ?? room.hasExternalWall,
    photos: [],
  };
  const occupancy = room.occupancy === "high" ? 240 : 0;
  return {
    loadW: estimateRoomLoadWatts(engine) + occupancy,
    ...(measuredArea ? { areaM2: round1(measuredArea) } : {}),
    estimatedArea: !measuredArea,
  };
}

/** One design input per included room: measured where the survey measured, estimated (and flagged) where it didn't. */
export function roomInputsFromSurvey(measured: MeasuredSurvey, baseSurvey?: Survey): RoomDesignInput[] {
  // F2's conversion, once for the whole survey: the engine's view of every measured room.
  const engine = new Map(
    measuredToEngineSurvey(measured, baseSurvey ?? ({ rooms: [] } as unknown as Survey)).rooms.map((r) => [r.id, r]),
  );
  return measured.rooms
    .filter((r) => r.include)
    .map((room) => {
      const base = baseSurvey?.rooms.find((b) => b.id === room.selfSurveyRoomId || b.id === room.id);
      const load = preliminaryLoadW(room, base, engine.get(room.id));
      const engineRoom = { floor: room.floor, hasExternalWall: room.hasExternalWall } as SurveyRoom;
      const estimated: RoomEstimate[] = [];
      if (load.estimatedArea) estimated.push("area");
      let pipeRunM: number;
      if (positive(room.pipeRunM)) pipeRunM = round1(room.pipeRunM);
      else {
        pipeRunM = estimatePipeRunM(engineRoom);
        estimated.push("pipeRunM");
      }
      let heightDiffM: number;
      if (nonNegative(room.heightDropM)) heightDiffM = round1(room.heightDropM);
      else {
        heightDiffM = estimateHeightDiffM(engineRoom);
        estimated.push("heightDiffM");
      }
      let condensate: "gravity" | "pump";
      if (room.condensate === "gravity" || room.condensate === "pump") condensate = room.condensate;
      else {
        condensate = room.hasExternalWall ? "gravity" : "pump";
        estimated.push("condensate");
      }
      const suggestedKw = selectCapacityKw(load.loadW);
      return {
        roomId: room.id,
        roomName: room.name,
        floor: room.floor,
        preliminaryLoadW: load.loadW,
        suggestedKw,
        chosenKw: suggestedKw,
        pipeRunM,
        heightDiffM,
        condensate,
        layoutMediaIds: [...room.mediaIds],
        type: room.type,
        ...(load.areaM2 !== undefined ? { areaM2: load.areaM2 } : {}),
        hasExternalWall: room.hasExternalWall,
        ...(room.route ? { route: room.route } : {}),
        survey: { pipeRunM, heightDiffM, condensate },
        ...(estimated.length ? { estimated } : {}),
      };
    });
}

/**
 * Fill in what an older record (or one written by another tool, like the
 * demo seed) doesn't carry yet: the site facts, the room facts and the
 * survey baseline, from the survey it was drawn from; each system's
 * position and outdoor photo; each option's brand. Nothing already there is
 * changed, and no choice is made for anyone.
 */
export function hydrateDesign(design: DesignRecord, measured?: MeasuredSurvey, opts: { intel?: PropertyIntel; catalogue?: CatalogueItem[] } = {}): DesignRecord {
  const site = design.site ?? (measured ? siteFromSurvey(measured, opts.intel) : undefined);
  const rooms = design.rooms.map((r) => {
    const m = measured?.rooms.find((x) => x.id === r.roomId);
    const next: RoomDesignInput = { ...r };
    if (m) {
      if (next.type === undefined) next.type = m.type;
      if (next.hasExternalWall === undefined) next.hasExternalWall = m.hasExternalWall;
      if (next.route === undefined && m.route) next.route = m.route;
      if (next.areaM2 === undefined) {
        const area = positive(m.areaM2) ? m.areaM2 : positive(m.lengthM) && positive(m.widthM) ? m.lengthM * m.widthM : undefined;
        if (area) next.areaM2 = round1(area);
      }
    }
    if (!next.survey) {
      // An override already on the record names its own baseline: keep it, so its reason still applies.
      const from = (field: string) => design.overrides.find((o) => o.field === `rooms.${r.roomId}.${field}`)?.from;
      const num = (v: string | undefined) => (v !== undefined && Number.isFinite(Number(v)) ? Number(v) : undefined);
      const fromCondensate = from("condensate");
      next.survey = {
        pipeRunM: num(from("pipeRunM")) ?? (m && positive(m.pipeRunM) ? round1(m.pipeRunM) : r.pipeRunM),
        heightDiffM: num(from("heightDiffM")) ?? (m && nonNegative(m.heightDropM) ? round1(m.heightDropM) : r.heightDiffM),
        condensate:
          fromCondensate === "gravity" || fromCondensate === "pump"
            ? fromCondensate
            : m && (m.condensate === "gravity" || m.condensate === "pump")
              ? m.condensate
              : r.condensate,
      };
    }
    return next;
  });
  const byId = opts.catalogue ? byIdMap(opts.catalogue) : null;
  const variants = design.variants.map((v) => {
    let manufacturer = v.manufacturer;
    if (!manufacturer && byId) {
      const counts = new Map<string, number>();
      for (const u of v.roomUnits) {
        const m = byId.get(u.indoorItemId)?.manufacturer;
        if (m) counts.set(m, (counts.get(m) ?? 0) + 1);
      }
      manufacturer = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    }
    const systems = v.systems.map((s, i) => {
      const position = s.outdoorPositionId ? site?.outdoorPositions.find((p) => p.id === s.outdoorPositionId) : defaultPosition(site, i);
      return {
        ...s,
        ...(position && !s.outdoorPositionId ? { outdoorPositionId: position.id } : {}),
        layoutMediaIds: s.layoutMediaIds ?? (position?.mediaId ? [position.mediaId] : []),
      };
    });
    return { ...v, ...(manufacturer ? { manufacturer } : {}), systems };
  });
  return { ...design, rooms, variants, ...(site ? { site } : {}) };
}

/* ------------------------------------------------------------------ */
/* Choosing equipment                                                  */
/* ------------------------------------------------------------------ */

/** Does this indoor unit cover a room set to `kw`? */
export function fitsCapacity(item: CatalogueItem, kw: number): boolean {
  const c = kwOf(item);
  return c !== null && c >= kw - CLASS_TOLERANCE_KW;
}

/**
 * Better first: available before uncertain, verified before provisional,
 * then the id. Deliberately blind to cost, so the browser (which may get a
 * catalogue without buy prices) suggests exactly what the server does.
 */
function preference(a: CatalogueItem, b: CatalogueItem): number {
  const rank = (i: CatalogueItem) => (i.status === "available" ? 0 : 2) + (i.confidence === "verified" ? 0 : 1);
  return rank(a) - rank(b) || a.id.localeCompare(b.id);
}

/**
 * Indoor units for a room, best first: the tier and brand asked for, big
 * enough for the room, and (for a multi-split) on the rule's list. The
 * smallest that fits wins; quieter wins a tie on the premium tier.
 */
export function indoorCandidates(opts: {
  kw: number;
  tier: "standard" | "premium";
  manufacturer?: string;
  catalogue: CatalogueItem[];
  rule?: CompatibilityRule;
}): CatalogueItem[] {
  return opts.catalogue
    .filter(
      (i) =>
        i.kind === "indoor" &&
        isSelectable(i) &&
        tierOf(i) === opts.tier &&
        (!opts.manufacturer || i.manufacturer === opts.manufacturer) &&
        (!opts.rule || isConnectable(opts.rule, i)) &&
        fitsCapacity(i, opts.kw),
    )
    .sort((a, b) => {
      const byKw = (kwOf(a) ?? 99) - (kwOf(b) ?? 99);
      if (Math.abs(byKw) > 0.05) return byKw;
      if (opts.tier === "premium") {
        const quiet = (a.specs?.soundPressureLowDb ?? 99) - (b.specs?.soundPressureLowDb ?? 99);
        if (quiet !== 0) return quiet;
      }
      // The range's main model (its outdoor unit lists it back) before a colour or finish variant.
      const canonical = Number(isCanonical(b, opts.catalogue)) - Number(isCanonical(a, opts.catalogue));
      return canonical || preference(a, b);
    });
}

/** The indoor unit its own outdoor pair names back: the range's main model. */
function isCanonical(indoor: CatalogueItem, catalogue: CatalogueItem[]): boolean {
  const pair = singlePairFor(indoor, catalogue);
  return Boolean(pair?.pairedWith && (pair.pairedWith === indoor.id || pair.pairedWith === indoor.model));
}

/**
 * The engine's indoor unit for a room. Falls back, in order, to the brand's
 * biggest unit in the tier (flagged as undersized by the sizing rule), then
 * any brand in the tier, then any tier. Undefined only when the catalogue
 * has no indoor units at all.
 */
export function pickIndoor(opts: { kw: number; tier: "standard" | "premium"; manufacturer?: string; catalogue: CatalogueItem[] }): CatalogueItem | undefined {
  const fits = indoorCandidates(opts);
  if (fits[0]) return fits[0];
  const pool = (filter: (i: CatalogueItem) => boolean) =>
    opts.catalogue.filter((i) => i.kind === "indoor" && isSelectable(i) && kwOf(i) !== null && filter(i)).sort((a, b) => (kwOf(b) ?? 0) - (kwOf(a) ?? 0) || preference(a, b));
  const sameBrand = pool((i) => tierOf(i) === opts.tier && (!opts.manufacturer || i.manufacturer === opts.manufacturer))[0];
  if (sameBrand) return sameBrand;
  return indoorCandidates({ ...opts, manufacturer: undefined })[0] ?? indoorCandidates({ ...opts, manufacturer: undefined, tier: opts.tier === "standard" ? "premium" : "standard" })[0];
}

interface Arranged {
  systems: SystemChoice[];
  units: Map<string, string>;
}

type UnitPicker = (room: RoomDesignInput, rule: CompatibilityRule | undefined) => CatalogueItem | undefined;

/** The best multi-split outdoor unit for a group of rooms, with the indoor unit each room gets on it. */
function bestMulti(
  group: RoomDesignInput[],
  pick: UnitPicker,
  makers: Set<string> | null,
  catalogue: CatalogueItem[],
  compatibility: CompatibilityRule[],
): { outdoor: CatalogueItem; rule: CompatibilityRule; units: CatalogueItem[] } | undefined {
  const found: { outdoor: CatalogueItem; rule: CompatibilityRule; units: CatalogueItem[] }[] = [];
  for (const outdoor of catalogue) {
    if (!isMultiOutdoor(outdoor) || !isSelectable(outdoor)) continue;
    if (makers && !makers.has(outdoor.manufacturer ?? "")) continue;
    const rule = findRule(outdoor, compatibility);
    if (!rule || rule.maxIndoorUnits < group.length || (outdoor.ports ?? 99) < group.length) continue;
    const units = group.map((r) => pick(r, rule));
    if (units.some((u) => !u)) continue;
    const check = validateCombination(rule, outdoor, units as CatalogueItem[], group.map((r) => r.pipeRunM));
    if (!check.ok) continue;
    // Never suggest a multi-split that's too much R32 for one of its rooms (or whose charge can't be worked out).
    const a2l = a2lSystemCheck(outdoor, refrigerantFor(outdoor, group.map((r) => r.pipeRunM)), group.map((room, i) => ({ room, indoor: units[i] })));
    if (a2l.errors.length === 0) found.push({ outdoor, rule, units: units as CatalogueItem[] });
  }
  found.sort(
    (a, b) =>
      (a.rule.confidence === "verified" ? 0 : 1) - (b.rule.confidence === "verified" ? 0 : 1) ||
      (a.outdoor.ports ?? 9) - (b.outdoor.ports ?? 9) ||
      (a.rule.maxConnectedKw ?? kwOf(a.outdoor) ?? 99) - (b.rule.maxConnectedKw ?? kwOf(b.outdoor) ?? 99) ||
      preference(a.outdoor, b.outdoor),
  );
  return found[0];
}

/** Two groups with capacity spread evenly: biggest rooms first, each to the lighter group. */
function splitInTwo(rooms: RoomDesignInput[]): RoomDesignInput[][] {
  const groups: RoomDesignInput[][] = [[], []];
  const load = [0, 0];
  for (const r of [...rooms].sort((a, b) => b.chosenKw - a.chosenKw || a.roomId.localeCompare(b.roomId))) {
    const i = load[0]! < load[1]! || (load[0] === load[1] && groups[0]!.length <= groups[1]!.length) ? 0 : 1;
    groups[i]!.push(r);
    load[i]! += r.chosenKw;
  }
  // Keep the survey's room order inside each group.
  const order = new Map(rooms.map((r, i) => [r.roomId, i]));
  return groups
    .filter((g) => g.length > 0)
    .map((g) => g.sort((a, b) => order.get(a.roomId)! - order.get(b.roomId)!))
    .sort((a, b) => order.get(a[0]!.roomId)! - order.get(b[0]!.roomId)!);
}

/**
 * Topology: one room is a single split; more try one multi-split whose rule
 * passes, then (three rooms or more) two multi-splits, then a single split
 * per room. A room whose unit has no listed pair gets an empty outdoor
 * choice, which the compatibility check reports.
 */
function arrange(rooms: RoomDesignInput[], pick: UnitPicker, makers: Set<string> | null, catalogue: CatalogueItem[], compatibility: CompatibilityRule[]): Arranged {
  const units = new Map<string, string>();
  const single = (room: RoomDesignInput): SystemChoice => {
    const unit = pick(room, undefined);
    if (unit) units.set(room.roomId, unit.id);
    const pair = unit ? singlePairFor(unit, catalogue) : undefined;
    return { outdoorItemId: pair?.id ?? "", roomIds: [room.roomId] };
  };
  if (rooms.length === 0) return { systems: [], units };
  if (rooms.length === 1) return { systems: [single(rooms[0]!)], units };

  const multiFor = (group: RoomDesignInput[]): SystemChoice | null => {
    if (group.length === 1) return single(group[0]!);
    const m = bestMulti(group, pick, makers, catalogue, compatibility);
    if (!m) return null;
    group.forEach((r, i) => units.set(r.roomId, m.units[i]!.id));
    return { outdoorItemId: m.outdoor.id, roomIds: group.map((r) => r.roomId) };
  };

  const one = multiFor(rooms);
  if (one) return { systems: [one], units };
  if (rooms.length >= 3) {
    const two = splitInTwo(rooms).map(multiFor);
    if (two.every((s): s is SystemChoice => s !== null)) return { systems: two, units };
    units.clear();
  }
  return { systems: rooms.map(single), units };
}

/** The engine's full choice for a tier and brand: indoor units and topology together. */
export function autoChoice(
  rooms: RoomDesignInput[],
  tier: "standard" | "premium",
  manufacturer: string | undefined,
  catalogue: CatalogueItem[],
  compatibility: CompatibilityRule[],
): VariantChoice {
  const pick: UnitPicker = (room, rule) =>
    rule ? indoorCandidates({ kw: room.chosenKw, tier, manufacturer, catalogue, rule })[0] : pickIndoor({ kw: room.chosenKw, tier, manufacturer, catalogue });
  const makers = manufacturer ? new Set([manufacturer]) : null;
  const arranged = arrange(rooms, pick, makers, catalogue, compatibility);
  const roomUnits = rooms.map((r) => ({ roomId: r.roomId, indoorItemId: arranged.units.get(r.roomId) ?? "" }));
  // The topology is always the one autoSystems gives for these units, so a
  // recompute with nothing changed suggests exactly what was drafted.
  return { roomUnits, systems: autoSystems(rooms, roomUnits, catalogue, compatibility) };
}

/** The engine's topology for indoor units already chosen (by the engine or a person). */
export function autoSystems(
  rooms: RoomDesignInput[],
  roomUnits: { roomId: string; indoorItemId: string }[],
  catalogue: CatalogueItem[],
  compatibility: CompatibilityRule[],
): SystemChoice[] {
  const byId = byIdMap(catalogue);
  const unitOf = (room: RoomDesignInput) => byId.get(roomUnits.find((u) => u.roomId === room.roomId)?.indoorItemId ?? "");
  const pick: UnitPicker = (room, rule) => {
    const unit = unitOf(room);
    return unit && (!rule || isConnectable(rule, unit)) ? unit : undefined;
  };
  const brands = new Set(rooms.map((r) => unitOf(r)?.manufacturer ?? ""));
  return arrange(rooms, pick, brands.size === 1 ? brands : null, catalogue, compatibility).systems;
}

/** Brands with indoor units in this tier, alphabetical. */
export function manufacturersFor(tier: "standard" | "premium", catalogue: CatalogueItem[]): string[] {
  return [...new Set(catalogue.filter((i) => i.kind === "indoor" && isSelectable(i) && tierOf(i) === tier && i.manufacturer).map((i) => i.manufacturer!))].sort();
}

/**
 * Which brand to build a tier on, all rooms the same brand: the one that
 * covers every room at its size with the fewest compatibility errors and the
 * fewest outdoor units, then the best-documented (verified, available,
 * priced). `prefer` wins when that brand has units in the tier.
 */
export function chooseManufacturer(
  rooms: RoomDesignInput[],
  tier: "standard" | "premium",
  catalogue: CatalogueItem[],
  compatibility: CompatibilityRule[],
  prefer?: string,
): string | undefined {
  const makers = manufacturersFor(tier, catalogue);
  if (prefer && makers.includes(prefer)) return prefer;
  if (makers.length === 0) return undefined;
  const byId = byIdMap(catalogue);
  const scored = makers.map((m) => {
    const choice = autoChoice(rooms, tier, m, catalogue, compatibility);
    const items = [...choice.roomUnits.map((u) => byId.get(u.indoorItemId)), ...choice.systems.map((s) => byId.get(s.outdoorItemId))];
    const fit = choice.roomUnits.filter((u) => {
      const item = byId.get(u.indoorItemId);
      const room = rooms.find((r) => r.roomId === u.roomId)!;
      return item && item.manufacturer === m && fitsCapacity(item, room.chosenKw);
    }).length;
    const errors = sum(
      choice.systems.map((s) => {
        const outdoor = byId.get(s.outdoorItemId);
        if (!outdoor) return 3;
        const indoors = s.roomIds.map((id) => byId.get(choice.roomUnits.find((u) => u.roomId === id)?.indoorItemId ?? "")).filter((i): i is CatalogueItem => !!i);
        return validateCombination(findRule(outdoor, compatibility), outdoor, indoors, s.roomIds.map((id) => rooms.find((r) => r.roomId === id)?.pipeRunM ?? 0)).errors.length;
      }),
    );
    const known = items.filter((i): i is CatalogueItem => !!i);
    return {
      m,
      score: [
        -fit,
        errors,
        choice.systems.length,
        -known.filter((i) => i.confidence === "verified").length,
        known.filter((i) => i.status !== "available").length,
        -known.filter((i) => i.costPence !== null).length,
      ],
    };
  });
  scored.sort((a, b) => {
    for (let i = 0; i < a.score.length; i++) if (a.score[i] !== b.score[i]) return a.score[i]! - b.score[i]!;
    return a.m.localeCompare(b.m);
  });
  return scored[0]?.m;
}

/* ------------------------------------------------------------------ */
/* Electrics, refrigerant, noise                                       */
/* ------------------------------------------------------------------ */

const ISOLATOR_RATINGS_A = [20, 32, 40, 63];

/** The circuit for one outdoor unit: the manufacturer's breaker when known, else a labelled rule of thumb. */
export function electricalFor(outdoor: CatalogueItem | undefined, connectedKw: number, site?: DesignSite): SystemSelection["electrical"] {
  const listed = outdoor?.specs?.recommendedBreakerA;
  const fromMaker = typeof listed === "number" && listed > 0;
  const kw = kwOf(outdoor) ?? connectedKw;
  const amps = fromMaker ? listed : kw <= 5.0 ? 16 : kw <= 7.1 ? 20 : kw <= 10 ? 25 : 32;
  const cableMm2 = amps <= 20 ? 2.5 : amps <= 32 ? 4 : 6;
  const isolatorA = ISOLATOR_RATINGS_A.find((r) => r >= amps) ?? 63;
  const route = site?.electrics.cableRouteNote;
  const length = site?.electrics.cableRouteM;
  const routeNote = [route, positive(length) ? `${round1(length)} m measured` : "cable length not measured"].filter(Boolean).join(" · ");
  return {
    breaker: `${amps} A RCBO`,
    cableMm2,
    isolator: `${isolatorA} A weatherproof rotary isolator`,
    routeNote,
    breakerSource: fromMaker ? "manufacturer" : "rule-of-thumb",
  };
}

/**
 * The research formula (docs/research §12): additional charge =
 * max(0, pipe length − chargeless length) × grams per metre, with the
 * outdoor unit's own figures. Unknown when either figure is missing: then
 * nothing is invented and the refrigerant rule says so.
 */
export function refrigerantFor(outdoor: CatalogueItem | undefined, runsM: number[]): SystemSelection["refrigerant"] {
  const totalPipeM = round1(sum(runsM));
  const pre = outdoor?.specs?.prechargedPipeM;
  const perM = outdoor?.specs?.additionalChargeGPerM;
  if (typeof pre !== "number" || typeof perM !== "number") {
    return { totalPipeM, prechargedPipeM: typeof pre === "number" ? pre : 0, additionalChargeG: 0, chargeKnown: false };
  }
  return { totalPipeM, prechargedPipeM: pre, additionalChargeG: Math.round(Math.max(0, totalPipeM - pre) * perM), chargeKnown: true };
}

/** A guess at the directivity from the base alone (on the ground, against a wall: two surfaces; a wall bracket: one), for a position whose surfaces weren't counted. */
export function directivityFor(base: OutdoorPosition["base"] | undefined): 2 | 4 {
  return base === "wall-bracket" || base === "roof-frame" ? 2 : 4;
}

/** MCS 020(a) directivity for a position: from the reflecting surfaces counted at the survey (Q2, Q4, Q8), else guessed from the base (`counted` false). */
export function directivityOf(pos: Pick<OutdoorPosition, "base" | "reflectingSurfaces"> | undefined): { q: 2 | 4 | 8; counted: boolean } {
  const counted = pos?.reflectingSurfaces ? DIRECTIVITY_Q[pos.reflectingSurfaces] : undefined;
  return counted ? { q: counted, counted: true } : { q: directivityFor(pos?.base), counted: false };
}

/** Sound pressure at distance r (m) from sound power LWA with directivity Q: Lp = LWA + 10·log10(Q / 4πr²). */
export function soundPressureDb(lwa: number, distanceM: number, q: number): number {
  const r = Math.max(1, distanceM);
  return lwa + 10 * Math.log10(q / (4 * Math.PI * r * r));
}

/** Several sources at one window add as energy. */
export function addDecibels(levels: number[]): number {
  return 10 * Math.log10(sum(levels.map((l) => 10 ** (l / 10))));
}

/* ------------------------------------------------------------------ */
/* R32 (A2L) charge and room size                                      */
/* ------------------------------------------------------------------ */

/** R32's lower flammability limit, kg/m³. */
export const R32_LFL_KG_M3 = 0.307;

/**
 * R32 is mildly flammable (A2L). Above 1.84 kg in one system (6 m³ × LFL)
 * IEC 60335-2-40 Annex GG / BS EN 378-1 Annex C, and the manufacturers' R32
 * manuals, set a minimum floor area for every room the system serves,
 * because a leak can release the whole system's charge into any one of them.
 */
export const A2L_ROOM_CHECK_ABOVE_KG = 1.84;

/** The release height h0 the standard gives a wall-mounted indoor unit. */
export const WALL_RELEASE_HEIGHT_M = 1.8;

/** A room closer to its minimum than this (×) is flagged for the manual's own table, which can be stricter. */
const A2L_CLOSE_FACTOR = 1.25;

const A2L_K = 2.5 * R32_LFL_KG_M3 ** 1.25;

/** The smallest floor area (m², rounded up) for a charge released at h0: A = (m ÷ (2.5 × LFL^1.25 × h0))². */
export function a2lMinFloorAreaM2(chargeKg: number, releaseHeightM: number): number {
  return Math.ceil((chargeKg / (A2L_K * releaseHeightM)) ** 2 * 10 - 1e-9) / 10;
}

/** The most R32 (kg, rounded down) a room of this floor area may hold at h0: 2.5 × LFL^1.25 × h0 × √A. */
export function a2lMaxChargeKg(areaM2: number, releaseHeightM: number): number {
  return Math.floor(A2L_K * releaseHeightM * Math.sqrt(areaM2) * 100 + 1e-9) / 100;
}

/** An indoor unit's release height: its catalogue figure, else a wall unit's 1.8 m (said so), never a guess for a floor or ceiling unit. */
export function releaseHeightOf(indoor: CatalogueItem | undefined): { h0: number; assumed: boolean } | null {
  const h = indoor?.specs?.releaseHeightM;
  if (typeof h === "number" && Number.isFinite(h) && h > 0) return { h0: h, assumed: false };
  if (/floor|console|cassette|ceiling|duct/i.test(`${indoor?.label ?? ""} ${indoor?.series ?? ""} ${indoor?.category ?? ""}`)) return null;
  return { h0: WALL_RELEASE_HEIGHT_M, assumed: true };
}

export interface A2lRoomCheck {
  roomId: string;
  roomName: string;
  /** The measured floor area, when there is one. */
  areaM2?: number;
  minAreaM2?: number;
  h0?: number;
  h0Assumed?: boolean;
  status: "ok" | "close" | "below" | "unmeasured" | "no-height";
}

export interface A2lSystemCheck {
  /** Factory plus added, kg; a lower bound when `complete` is false. Null when the factory charge isn't on record. */
  totalKg: number | null;
  factoryKg: number | null;
  /** The added charge is known (pre-charged length and grams per metre on record). */
  complete: boolean;
  /** Over the threshold, so every room needs its minimum floor area. */
  applies: boolean;
  rooms: A2lRoomCheck[];
  /** What blocks approval (the compatibility errors). */
  errors: string[];
}

/**
 * The R32 room-size check for one system: the total charge (the outdoor
 * unit's factory charge plus the added charge the design works out), and,
 * above 1.84 kg, each room's floor area against the minimum by the
 * standard's formula. It blocks approval when a measured room is too small,
 * when a room it applies to isn't measured, when a floor or ceiling unit has
 * no release height, and when a multi-split's charge can't be worked out (the
 * systems that pass 1.84 kg). The manufacturer's table in the installation
 * manual decides and can be stricter: the rule says so.
 */
export function a2lSystemCheck(
  outdoor: CatalogueItem | undefined,
  refrigerant: SystemSelection["refrigerant"],
  rooms: { room: RoomDesignInput; indoor: CatalogueItem | undefined }[],
): A2lSystemCheck {
  const code = outdoor ? codeOf(outdoor) : "the outdoor unit";
  const factory = outdoor?.specs?.factoryChargeKg;
  const factoryKg = typeof factory === "number" && Number.isFinite(factory) && factory > 0 ? factory : null;
  const complete = factoryKg !== null && refrigerant.chargeKnown !== false;
  const totalKg = factoryKg === null ? null : Math.round((factoryKg + (refrigerant.chargeKnown === false ? 0 : refrigerant.additionalChargeG / 1000)) * 100) / 100;
  const multi = rooms.length > 1 || (outdoor ? isMultiOutdoor(outdoor) : false);
  const errors: string[] = [];
  if (multi && totalKg === null) errors.push(`No factory charge on record for ${code}: add it from the nameplate or the installation manual, so the smallest room it may serve (R32) can be checked.`);
  else if (multi && !complete)
    errors.push(`${code}: the added charge can't be worked out (no pre-charged length or grams per metre on record), so the total R32 charge and the smallest room it may serve can't be checked.`);
  const applies = totalKg !== null && totalKg > A2L_ROOM_CHECK_ABOVE_KG;
  const checks: A2lRoomCheck[] = rooms.map(({ room, indoor }) => {
    const base = { roomId: room.roomId, roomName: room.roomName, ...(positive(room.areaM2) && !room.estimated?.includes("area") ? { areaM2: room.areaM2 } : {}) };
    if (!applies || totalKg === null) return { ...base, status: "ok" as const };
    const h = releaseHeightOf(indoor);
    if (!h) {
      errors.push(`${room.roomName}: set the R32 release height of ${indoor ? codeOf(indoor) : "its indoor unit"} in the catalogue (a floor unit is 0.6 m, a ceiling unit 2.2 m): ${code} holds ${totalKg} kg, over ${A2L_ROOM_CHECK_ABOVE_KG} kg.`);
      return { ...base, status: "no-height" as const };
    }
    const minAreaM2 = a2lMinFloorAreaM2(totalKg, h.h0);
    const view = { ...base, minAreaM2, h0: h.h0, h0Assumed: h.assumed };
    if (base.areaM2 === undefined) {
      errors.push(`${room.roomName}: measure the floor area. ${code} holds ${complete ? "" : "at least "}${totalKg} kg of R32, so every room it serves needs at least ${minAreaM2} m².`);
      return { ...view, status: "unmeasured" as const };
    }
    if (base.areaM2 < minAreaM2) {
      errors.push(
        `${room.roomName}: ${base.areaM2} m² is below the ${minAreaM2} m² minimum floor area for ${complete ? "" : "at least "}${totalKg} kg of R32 on ${code} (indoor unit at ${h.h0} m, IEC 60335-2-40 Annex GG). Serve this room from a smaller system, or choose a larger room.`,
      );
      return { ...view, status: "below" as const };
    }
    return { ...view, status: base.areaM2 < minAreaM2 * A2L_CLOSE_FACTOR ? ("close" as const) : ("ok" as const) };
  });
  return { totalKg, factoryKg, complete, applies, rooms: checks, errors };
}

/* ------------------------------------------------------------------ */
/* Bill of materials                                                   */
/* ------------------------------------------------------------------ */

interface Mat {
  item: CatalogueItem;
  text: string;
  perMetre: boolean;
  lengthM: number | null;
}

function materialIndex(catalogue: CatalogueItem[]): Mat[] {
  return catalogue
    .filter((i) => i.kind === "material" && isSelectable(i))
    .map((item) => {
      const unit = (item.unit ?? "").trim().toLowerCase();
      const label = item.label.toLowerCase();
      const perMetre = /^(per\s*)?(m|metre|meter|metres|meters)$/.test(unit) || /^per m\b/.test(unit);
      const length = /(\d+(?:\.\d+)?)\s*m\b/.exec(unit) ?? /(\d+(?:\.\d+)?)\s*m\b/.exec(label);
      return {
        item,
        text: `${label} ${(item.category ?? "").toLowerCase()} ${item.id.toLowerCase()}`,
        perMetre,
        lengthM: perMetre ? 1 : length ? Number(length[1]) : null,
      };
    })
    .sort((a, b) => preference(a.item, b.item));
}

const INCH: [number, string][] = [
  [6.35, "1/4"],
  [9.52, "3/8"],
  [12.7, "1/2"],
  [15.88, "5/8"],
];

/** 6.35 mm → "1/4", 9.5 → "3/8" (±0.2 mm). */
export function pipeFraction(mm: number): string | undefined {
  return INCH.find(([v]) => Math.abs(v - mm) <= 0.2)?.[1];
}

/** Liquid and gas line sizes for a room: the indoor unit's, else the outdoor unit's, else by capacity. */
function pipeSizes(indoor: CatalogueItem | undefined, outdoor: CatalogueItem | undefined, kw: number): { liquid: string; gas: string } {
  const from = (i: CatalogueItem | undefined) => {
    const l = i?.specs?.liquidPipeMm;
    const g = i?.specs?.gasPipeMm;
    const lf = typeof l === "number" ? pipeFraction(l) : undefined;
    const gf = typeof g === "number" ? pipeFraction(g) : undefined;
    return lf && gf ? { liquid: lf, gas: gf } : undefined;
  };
  return from(indoor) ?? from(outdoor) ?? (kw <= 3.5 ? { liquid: "1/4", gas: "3/8" } : kw <= 5.0 ? { liquid: "1/4", gas: "1/2" } : { liquid: "3/8", gas: "5/8" });
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

class Bom {
  private lines = new Map<string, DesignBomLine>();
  private metres = new Map<string, { mat: Mat; metres: number; category: DesignBomLine["category"]; notes: Set<string> }>();

  item(item: CatalogueItem, qty: number, category: DesignBomLine["category"], note?: string) {
    const key = item.id;
    const line = this.lines.get(key);
    if (line) {
      line.qty = round1(line.qty + qty);
      if (note && !(line.note ?? "").includes(note)) line.note = line.note ? `${line.note}; ${note}` : note;
      return;
    }
    this.lines.set(key, {
      catalogueItemId: item.id,
      sku: item.model ?? item.id,
      label: item.label,
      qty: round1(qty),
      unit: item.unit ?? "each",
      category,
      ...(note ? { note } : {}),
    });
  }

  generic(sku: string, label: string, qty: number, unit: string, category: DesignBomLine["category"], note?: string) {
    const line = this.lines.get(sku);
    if (line) {
      line.qty = round1(line.qty + qty);
      if (note && !(line.note ?? "").includes(note)) line.note = line.note ? `${line.note}; ${note}` : note;
      return;
    }
    this.lines.set(sku, { sku, label, qty: round1(qty), unit, category, note: note ? `Not in the catalogue yet; ${note}` : "Not in the catalogue yet" });
  }

  /** Material sold by length: metres add up across rooms, then round to whole units at the end. */
  length(mat: Mat, metres: number, category: DesignBomLine["category"], note?: string) {
    const entry = this.metres.get(mat.item.id) ?? { mat, metres: 0, category, notes: new Set<string>() };
    entry.metres += metres;
    if (note) entry.notes.add(note);
    this.metres.set(mat.item.id, entry);
  }

  lines_(): DesignBomLine[] {
    for (const { mat, metres, category, notes } of this.metres.values()) {
      const qty = mat.perMetre ? Math.ceil(metres) : mat.lengthM ? Math.ceil(metres / mat.lengthM) : 1;
      const note = [`${round1(metres)} m in total`, ...notes].join("; ");
      this.item(mat.item, qty, category, note);
    }
    this.metres.clear();
    const order: Record<DesignBomLine["category"], number> = { equipment: 0, materials: 1, consumables: 2 };
    return [...this.lines.values()].sort((a, b) => order[a.category] - order[b.category]);
  }
}

function findMat(mats: Mat[], test: (m: Mat) => boolean): Mat | undefined {
  return mats.find(test);
}

/** For things bought by length: a cut length by the metre first, else the shortest pack (a 50 m drum before a 100 m one). */
function findLengthMat(mats: Mat[], test: (m: Mat) => boolean): Mat | undefined {
  return mats.filter(test).sort((a, b) => Number(b.perMetre) - Number(a.perMetre) || (a.lengthM ?? 999) - (b.lengthM ?? 999) || preference(a.item, b.item))[0];
}

/** Smallest coil that covers the run with little waste, else cut length by the metre, else coils. */
function pipeLine(mats: Mat[], liquid: string, gas: string): Mat[] {
  const pair = new RegExp(`${esc(liquid)}["”]?\\s*\\+\\s*${esc(gas)}(?!\\d)`);
  return mats.filter((m) => /pipe|line set|line-set|lineset/.test(m.text) && !/trunking/.test(m.text) && pair.test(m.text));
}

function buildBom(input: {
  systems: SystemSelection[];
  rooms: RoomDesignInput[];
  roomUnits: { roomId: string; indoorItemId: string }[];
  site?: DesignSite;
  catalogue: CatalogueItem[];
}): DesignBomLine[] {
  const { systems, rooms, roomUnits, site, catalogue } = input;
  const byId = byIdMap(catalogue);
  const mats = materialIndex(catalogue);
  const bom = new Bom();
  const roomOf = (id: string) => rooms.find((r) => r.roomId === id);

  // Equipment.
  for (const u of roomUnits) {
    const item = byId.get(u.indoorItemId);
    if (item) bom.item(item, 1, "equipment", `For ${roomOf(u.roomId)?.roomName ?? u.roomId}`);
  }
  for (const s of systems) {
    const item = byId.get(s.outdoorItemId);
    if (item) bom.item(item, 1, "equipment");
  }

  const interconnect = findLengthMat(mats, (m) => /interconnect/.test(m.text) || (/4[- ]core/.test(m.text) && /1\.5/.test(m.text) && /cable/.test(m.text)));
  const hose = findLengthMat(mats, (m) => /hose/.test(m.text) && !/pump/.test(m.text));
  const gravity = findMat(mats, (m) => /(condensate|drain)/.test(m.text) && /(gravity|fitting)/.test(m.text) && !/pump/.test(m.text));
  const pumps = mats.filter((m) => /pump/.test(m.text) && /(condensate|drain)/.test(m.text));
  const pump = pumps.find((m) => /mini/.test(m.text)) ?? pumps[0];
  const trunking = findLengthMat(mats, (m) => /trunking/.test(m.text) && !/(bend|inlet|end cap|coupler|corner)/.test(m.text));
  const bend = findMat(mats, (m) => /trunking/.test(m.text) && /bend/.test(m.text));
  const inlet = findMat(mats, (m) => /trunking/.test(m.text) && /inlet/.test(m.text));
  const sleeve = findMat(mats, (m) => /sleeve/.test(m.text));

  // Per room: pipe, interconnect, condensate, trunking, sleeve.
  for (const s of systems) {
    const outdoor = byId.get(s.outdoorItemId);
    for (const roomId of s.roomIds) {
      const room = roomOf(roomId);
      if (!room) continue;
      const indoor = byId.get(roomUnits.find((u) => u.roomId === roomId)?.indoorItemId ?? "");
      const run = room.pipeRunM;
      const estimated = room.estimated?.includes("pipeRunM") ? "run estimated, not measured" : undefined;
      const sizes = pipeSizes(indoor, outdoor, room.chosenKw);
      const options = pipeLine(mats, sizes.liquid, sizes.gas);
      const coils = options.filter((m) => !m.perMetre && m.lengthM).sort((a, b) => a.lengthM! - b.lengthM!);
      const cut = options.find((m) => m.perMetre);
      const snug = coils.find((m) => m.lengthM! >= run && m.lengthM! - run <= 3);
      const note = [`${room.roomName}: ${round1(run)} m run`, estimated].filter(Boolean).join(", ");
      if (snug) bom.item(snug.item, 1, "materials", note);
      else if (cut) bom.length(cut, run, "materials", estimated);
      else if (coils.length) {
        const cover = coils.find((m) => m.lengthM! >= run);
        if (cover) bom.item(cover.item, 1, "materials", note);
        else {
          const longest = coils[coils.length - 1]!;
          const n = Math.ceil(run / longest.lengthM!);
          bom.item(longest.item, n, "materials", `${note}: longer than one coil, needs a brazed joint`);
        }
      } else {
        bom.generic(`pipe-${sizes.liquid}-${sizes.gas}`.replace(/\//g, ""), `Insulated copper pipe pair ${sizes.liquid}" + ${sizes.gas}"`, Math.ceil(run), "m", "materials", note);
      }

      if (interconnect) bom.length(interconnect, run + 1, "materials");
      else bom.generic("interconnect-cable", "4-core 1.5 mm² interconnect cable", Math.ceil(run + 1), "m", "materials");

      if (room.condensate === "pump") {
        if (pump) bom.item(pump.item, 1, "materials", `${room.roomName}: no fall to an outside wall`);
        else bom.generic("condensate-pump", "Condensate pump", 1, "each", "materials", room.roomName);
      } else if (gravity) {
        bom.item(gravity.item, 1, "materials");
      } else {
        bom.generic("condensate-gravity", "Gravity condensate drain fittings", 1, "set", "materials");
      }
      if (hose && hose.item.id !== gravity?.item.id) bom.length(hose, Math.max(1, run), "materials");

      const trunked = room.route === "internal-concealed" ? 0 : room.route === "through-wall" ? Math.min(run, 2) : run;
      if (trunked > 0) {
        if (trunking) bom.length(trunking, trunked, "materials");
        else bom.generic("trunking", "Line-set trunking", Math.ceil(trunked / 2), "2 m length", "materials");
        if (room.route === "external-trunking" && bend) bom.item(bend.item, 2, "materials");
        if (inlet) bom.item(inlet.item, 1, "materials");
      }
      if (sleeve) bom.item(sleeve.item, 1, "materials");
      else bom.generic("wall-sleeve", "Wall sleeve / core-hole liner", 1, "each", "materials");
    }
  }

  // Per system: supply circuit, isolator, mounting.
  for (const s of systems) {
    const outdoor = byId.get(s.outdoorItemId);
    const amps = Number.parseInt(s.electrical.breaker, 10);
    const mm = s.electrical.cableMm2;
    const supply = findLengthMat(mats, (m) => /twin/.test(m.text) && new RegExp(`\\b${esc(String(mm))}(\\.0)?\\s*mm`).test(m.text));
    const cableM = positive(site?.electrics.cableRouteM) ? site!.electrics.cableRouteM! : 10;
    const cableNote = positive(site?.electrics.cableRouteM) ? undefined : "10 m allowed: length not measured";
    if (supply) bom.length(supply, cableM, "materials", cableNote);
    else bom.generic(`supply-cable-${mm}`, `${mm} mm² twin and earth supply cable`, Math.ceil(cableM), "m", "materials", cableNote);

    const rcbo = findMat(mats, (m) => /rcbo/.test(m.text) && new RegExp(`\\b${amps}\\s*a\\b`).test(m.text));
    if (rcbo) bom.item(rcbo.item, 1, "materials");
    else bom.generic(`rcbo-${amps}a`, `${amps} A RCBO`, 1, "each", "materials");

    const isolators = mats
      .filter((m) => /isolator/.test(m.text))
      .map((m) => ({ m, rating: Number(/(\d+)\s*a\b/.exec(m.text)?.[1] ?? NaN) }))
      .filter((x) => Number.isFinite(x.rating) && x.rating >= amps)
      .sort((a, b) => a.rating - b.rating);
    if (isolators[0]) bom.item(isolators[0].m.item, 1, "materials");
    else bom.generic(`isolator-${amps}a`, s.electrical.isolator, 1, "each", "materials");

    const position = site?.outdoorPositions.find((p) => p.id === s.outdoorPositionId);
    const big = (outdoor?.specs?.dimensionsMm?.w ?? 0) > 800 || (kwOf(outdoor) ?? 0) >= 5;
    const sized = (list: Mat[]) => {
      const sizedList = list.map((m) => ({ m, size: Number(/\b(\d{3})\b/.exec(`${m.item.label} ${m.item.id}`)?.[1] ?? NaN) }));
      const withSize = sizedList.filter((x) => Number.isFinite(x.size)).sort((a, b) => a.size - b.size);
      if (withSize.length) return (big ? withSize[withSize.length - 1] : withSize[0])!.m;
      return list[0];
    };
    if (position?.base === "wall-bracket") {
      const bracket = sized(mats.filter((m) => /bracket/.test(m.text) && !/plate/.test(m.text)));
      if (bracket) bom.item(bracket.item, 1, "materials");
      else bom.generic("outdoor-bracket", "Outdoor unit wall bracket", 1, "pair", "materials");
      const pads = findMat(mats, (m) => /(anti-vibration|av pad|av-pad)/.test(m.text) && !/(feet|foot)/.test(m.text));
      if (pads) bom.item(pads.item, 1, "materials");
    } else if (position?.base === "roof-frame" || position?.base === "other") {
      bom.generic("outdoor-frame", "Outdoor unit mounting frame", 1, "each", "materials", "confirm the frame with the tech lead");
      const pads = findMat(mats, (m) => /(anti-vibration|av pad|av-pad)/.test(m.text) && !/(feet|foot)/.test(m.text));
      if (pads) bom.item(pads.item, 1, "materials");
    } else {
      const feet = sized(mats.filter((m) => /(feet|foot)/.test(m.text)));
      if (feet) bom.item(feet.item, 1, "materials", position ? undefined : "no outdoor position chosen yet");
      else bom.generic("outdoor-feet", "Ground mounting feet", 1, "pair", "materials");
    }
  }

  // Refrigerant top-up, when the runs go past the factory charge.
  const grams = sum(systems.map((s) => s.refrigerant.additionalChargeG));
  if (grams > 0) {
    const r32 = findMat(mats, (m) => /r32/.test(m.text) && /refrigerant/.test(m.text));
    const kg = Math.ceil(grams / 100) / 10;
    if (r32) bom.item(r32.item, r32.perMetre ? 1 : kg, "materials", `${grams} g additional charge`);
    else bom.generic("r32", "R32 refrigerant", kg, "kg", "materials", `${grams} g additional charge`);
  }

  // Consumables, once per job (fixings per outdoor unit).
  const roomsN = rooms.length;
  const anyExternal = rooms.some((r) => r.route !== "internal-concealed");
  const anyConcealed = rooms.some((r) => r.route === "via-loft" || r.route === "internal-concealed");
  const consumables: { test: (m: Mat) => boolean; qty: number; when: boolean }[] = [
    { test: (m) => /fixings/.test(m.text), qty: Math.max(1, systems.length), when: true },
    { test: (m) => /foam/.test(m.text), qty: 1, when: true },
    { test: (m) => /sealant/.test(m.text) && !/(fire|intumescent)/.test(m.text), qty: 1, when: true },
    { test: (m) => /(fire-stop|fire stop|intumescent)/.test(m.text) && !/sleeve/.test(m.text), qty: 1, when: anyConcealed },
    { test: (m) => /pvc/.test(m.text) && /tape/.test(m.text), qty: Math.max(1, Math.ceil(roomsN / 2)), when: true },
    { test: (m) => /\buv\b/.test(m.text) && /tape/.test(m.text), qty: 1, when: anyExternal },
    { test: (m) => /cable[- ]ties/.test(m.text), qty: 1, when: true },
  ];
  let anyConsumable = false;
  for (const c of consumables) {
    if (!c.when) continue;
    const m = findMat(mats, c.test);
    if (m) {
      bom.item(m.item, c.qty, "consumables");
      anyConsumable = true;
    }
  }
  if (!anyConsumable && roomsN > 0) bom.generic("consumables", "Consumables (fixings, sealant, tapes, ties)", 1, "job", "consumables");

  return bom.lines_();
}

/** What a BOM line needs flagging for, against the catalogue as it stands. */
export function bomLineFlags(line: DesignBomLine, catalogue: CatalogueItem[]): { notInCatalogue: boolean; unpriced: boolean; provisional: boolean; uncertain: boolean } {
  const item = line.catalogueItemId ? catalogue.find((i) => i.id === line.catalogueItemId) : undefined;
  return {
    notInCatalogue: !item,
    unpriced: !item || item.costPence === null,
    provisional: Boolean(item && item.confidence !== "verified"),
    uncertain: Boolean(item && item.status !== "available"),
  };
}

/* ------------------------------------------------------------------ */
/* Rules                                                               */
/* ------------------------------------------------------------------ */

interface RuleInput {
  rooms: RoomDesignInput[];
  roomUnits: { roomId: string; indoorItemId: string }[];
  systems: SystemSelection[];
  site?: DesignSite;
  byId: Map<string, CatalogueItem>;
  compatibility: CompatibilityRule[];
  asOf: string;
}

const LOCATION_LABEL: Record<string, string> = {
  "ground-rear": "rear, ground level",
  "ground-side": "side, ground level",
  "wall-bracket": "wall bracket",
  "flat-roof": "flat roof",
  balcony: "balcony",
  unsure: "undecided",
};

function designRules(x: RuleInput): RuleResult[] {
  const { rooms, roomUnits, systems, site, byId } = x;
  const rules: RuleResult[] = [];
  const add = (id: string, title: string, status: RuleStatus, detail: string) => rules.push({ id, title, status, detail });
  const unitFor = (roomId: string) => byId.get(roomUnits.find((u) => u.roomId === roomId)?.indoorItemId ?? "");
  const outdoorOf = (s: SystemSelection) => byId.get(s.outdoorItemId);
  const positionOf = (s: SystemSelection) => site?.outdoorPositions.find((p) => p.id === s.outdoorPositionId);

  if (rooms.length === 0) {
    add("rooms", "Rooms", "fail", "No rooms are included in the survey, so there's nothing to design. Include at least one room in the survey.");
    return rules;
  }

  // 1. Sizing.
  {
    const notes: string[] = [];
    let status: RuleStatus = "pass";
    for (const r of rooms) {
      const unit = unitFor(r.roomId);
      const kw = kwOf(unit);
      const est = r.estimated?.includes("area") ? " (area estimated: not measured)" : "";
      if (!unit) {
        status = "fail";
        notes.push(`${r.roomName}: no indoor unit chosen.`);
      } else if (kw === null) {
        status = worst([status, "review"]);
        notes.push(`${r.roomName}: ${fmtW(r.preliminaryLoadW)}${est}; ${codeOf(unit)} has no capacity on record.`);
      } else if (kw * 1000 < r.preliminaryLoadW - 50) {
        status = worst([status, "review"]);
        notes.push(`${r.roomName}: ${fmtW(r.preliminaryLoadW)}${est} but ${codeOf(unit)} is ${fmtKw(kw)}, so it looks undersized.`);
      } else {
        notes.push(`${r.roomName}: ${fmtW(r.preliminaryLoadW)}${est} → ${codeOf(unit)} (${fmtKw(kw)}).`);
      }
      if (r.estimated?.includes("area")) status = worst([status, "review"]);
    }
    if (site?.heatingUse === "main") {
      status = worst([status, "review"]);
      notes.push("They want this as their main heating: that needs a proper room-by-room heat-loss calculation, not this estimate.");
    }
    add("capacity", "Room sizing", status, `${notes.join(" ")} ${PRELIMINARY_LOAD_LABEL}.`);
  }

  // 2. Topology.
  if (systems.length <= 1) {
    const s = systems[0];
    const o = s ? outdoorOf(s) : undefined;
    add(
      "topology",
      "System topology",
      "pass",
      rooms.length === 1 ? "One room, one single split." : `${plural(rooms.length, "room")} on one ${o ? codeOf(o) : "outdoor unit"}.`,
    );
  } else {
    const multi = systems.filter((s) => s.topology === "multi").length;
    add(
      "topology",
      "System topology",
      "review",
      `${plural(rooms.length, "room")} across ${plural(systems.length, "outdoor unit")}${multi ? ` (${plural(multi, "multi-split")})` : " (single splits)"}: worth an engineer's eye on where each one goes.`,
    );
  }

  // 3. Combination.
  {
    const errors = systems.flatMap((s) => s.compatibility.errors);
    const warnings = systems.flatMap((s) => s.compatibility.warnings);
    const provisional = systems.some((s) => s.topology === "multi" && s.ruleConfidence !== "verified");
    if (errors.length) add("compatibility", "Equipment combination", "fail", [...new Set(errors)].join(" "));
    else if (warnings.length || provisional) add("compatibility", "Equipment combination", "review", [...new Set(warnings)].join(" "));
    else
      add(
        "compatibility",
        "Equipment combination",
        "pass",
        systems.some((s) => s.topology === "multi") ? "Every indoor unit is on its outdoor unit's verified combination list, inside its capacity and pipe limits." : "Every room uses its indoor unit's listed outdoor pair.",
      );
  }

  // 4. Pipe and height limits.
  {
    let status: RuleStatus = "pass";
    const notes: string[] = [];
    for (const s of systems) {
      const o = outdoorOf(s);
      if (!o) continue;
      const maxHeight = o.specs?.maxHeightDiffM;
      const multi = s.topology === "multi";
      const total = s.refrigerant.totalPipeM;
      // A multi-split's total comes from its rule (the outdoor spec's figure can be per room); a single split's from the unit.
      const rule = s.ruleId ? x.compatibility.find((r) => r.id === s.ruleId) : undefined;
      const maxRun = multi ? rule?.maxTotalPipeM : o.specs?.maxPipeM;
      const limit = typeof maxRun === "number" ? maxRun : null;
      if (limit === null) {
        status = worst([status, "review"]);
        notes.push(`${codeOf(o)}: no pipe limit on record, check the installation manual.`);
      } else {
        const pct = Math.round(((multi ? total : (rooms.find((r) => r.roomId === s.roomIds[0])?.pipeRunM ?? 0)) / limit) * 100);
        if (pct > 100) status = "fail";
        else if (pct > 85) status = worst([status, "review"]);
        notes.push(`${codeOf(o)}: ${multi ? `${total} m in total` : `${total} m run`} of ${limit} m (${pct}%).`);
      }
      for (const roomId of s.roomIds) {
        const r = rooms.find((x) => x.roomId === roomId);
        if (!r) continue;
        if (typeof maxHeight === "number" && r.heightDiffM > maxHeight) {
          status = "fail";
          notes.push(`${r.roomName}: ${r.heightDiffM} m height difference is over the ${maxHeight} m limit.`);
        } else if (typeof maxHeight !== "number") {
          status = worst([status, "review"]);
        }
      }
    }
    const estimated = rooms.filter((r) => r.estimated?.some((e) => e === "pipeRunM" || e === "heightDiffM"));
    if (estimated.length) {
      status = worst([status, "review"]);
      notes.push(`Estimated, not measured: ${estimated.map((r) => r.roomName).join(", ")}. Measure before approving.`);
    }
    if (systems.some((s) => typeof outdoorOf(s)?.specs?.maxHeightDiffM !== "number")) notes.push("Height limit not on record for every outdoor unit.");
    add("pipe-limits", "Pipe length & height limits", status, notes.join(" ") || "No outdoor unit chosen yet.");
  }

  // 5. Refrigerant.
  {
    const unknown = systems.filter((s) => outdoorOf(s) && s.refrigerant.chargeKnown === false);
    if (!systems.some((s) => outdoorOf(s))) {
      add("refrigerant", "Refrigerant charge", "fail", "Cannot determine: no outdoor unit chosen yet.");
    } else if (unknown.length) {
      add(
        "refrigerant",
        "Refrigerant charge",
        "fail",
        `Cannot determine the extra charge: add the pre-charged pipe length and the grams per metre for ${unknown.map((s) => codeOf(outdoorOf(s)!)).join(", ")} to the catalogue (from the installation manual).`,
      );
    } else {
      const parts = systems
        .filter((s) => outdoorOf(s))
        .map((s) => {
          const r = s.refrigerant;
          return r.additionalChargeG > 0
            ? `${codeOf(outdoorOf(s)!)}: ${r.totalPipeM} m against ${r.prechargedPipeM} m pre-charged, so add ${r.additionalChargeG} g of R32.`
            : `${codeOf(outdoorOf(s)!)}: ${r.totalPipeM} m is within the ${r.prechargedPipeM} m pre-charge, so no top-up.`;
        });
      add("refrigerant", "Refrigerant charge", "pass", `${parts.join(" ")} Record factory, added and total charge on the F-gas label (R32, GWP 675).`);
    }
  }

  // 5b. Room size for the R32 charge (A2L: mildly flammable).
  if (systems.some((s) => outdoorOf(s))) {
    const statuses: RuleStatus[] = [];
    const notes: string[] = [];
    let applied = false;
    for (const s of systems) {
      const o = outdoorOf(s);
      if (!o) continue;
      const group = s.roomIds.map((id) => rooms.find((r) => r.roomId === id)).filter((r): r is RoomDesignInput => !!r);
      const check = a2lSystemCheck(o, s.refrigerant, group.map((room) => ({ room, indoor: unitFor(room.roomId) })));
      const code = codeOf(o);
      if (check.totalKg === null) {
        statuses.push("fail");
        notes.push(`Cannot determine for ${code}: add its factory charge (nameplate or installation manual) to the catalogue.`);
        continue;
      }
      const added = s.refrigerant.chargeKnown === false ? "an added charge the catalogue can't work out" : `${round1(s.refrigerant.additionalChargeG / 100) / 10} kg added`;
      const total = `${check.complete ? "" : "at least "}${check.totalKg} kg of R32 (${check.factoryKg} kg factory, ${added})`;
      if (!check.applies) {
        if (!check.complete) {
          statuses.push("fail");
          notes.push(`Cannot determine for ${code}: ${total}.`);
        } else {
          statuses.push("pass");
          notes.push(`${code}: ${total}, not over ${A2L_ROOM_CHECK_ABOVE_KG} kg, so no minimum room size applies.`);
        }
        continue;
      }
      applied = true;
      if (!check.complete) statuses.push("fail");
      const parts = check.rooms.map((r) => {
        if (r.status === "no-height") return `${r.roomName}: indoor unit height not set (floor or ceiling unit)`;
        if (r.status === "unmeasured") return `${r.roomName}: not measured, needs at least ${r.minAreaM2} m²`;
        if (r.status === "below") return `${r.roomName}: ${r.areaM2} m² is BELOW the ${r.minAreaM2} m² minimum`;
        if (r.status === "close") return `${r.roomName}: ${r.areaM2} m², close to the ${r.minAreaM2} m² minimum`;
        return `${r.roomName}: ${r.areaM2} m² (minimum ${r.minAreaM2} m²)`;
      });
      for (const r of check.rooms) statuses.push(r.status === "ok" ? "pass" : r.status === "close" ? "review" : "fail");
      const assumed = check.rooms.some((r) => r.h0Assumed);
      notes.push(`${code}: ${total}, over ${A2L_ROOM_CHECK_ABOVE_KG} kg, so every room it serves needs a minimum floor area. ${parts.join("; ")}.${assumed ? ` Taken as wall units at ${WALL_RELEASE_HEIGHT_M} m.` : ""}`);
    }
    if (applied) notes.push("Minimums by the IEC 60335-2-40 Annex GG formula (R32, LFL 0.307 kg/m³); the installation manual's own table decides and can be stricter, so check every room against it.");
    add("refrigerant-room", "Room size for the R32 charge", worst(statuses), notes.join(" "));
  }

  // 6. Electrics.
  {
    const e = site?.electrics;
    const notes: string[] = [];
    const statuses: RuleStatus[] = [];
    if (!e || e.boardType === "unknown") {
      statuses.push("fail");
      notes.push("The consumer unit type isn't recorded, so the new circuit can't be planned.");
    } else if (e.boardType === "older-fuse-box") {
      statuses.push("review");
      notes.push("Older fuse board: a board upgrade is likely before a new circuit. The electrician confirms.");
    } else if (e.spareWays === undefined) {
      statuses.push("review");
      notes.push("Spare ways on the board not recorded.");
    } else if (e.spareWays < systems.length) {
      statuses.push("review");
      notes.push(`${plural(systems.length, "new circuit")} but ${plural(e.spareWays, "spare way")}: free a way or extend the board.`);
    } else {
      notes.push(`Modern board with ${plural(e.spareWays, "spare way")}.`);
    }
    if (e?.earthing === "TT") {
      statuses.push("review");
      notes.push("TT earthing: check the earth electrode and RCD protection.");
    }
    if (e && (e.asbestosFlashGuard === "possible" || e.asbestosFlashGuard === "yes")) {
      statuses.push("review");
      notes.push("Possible asbestos flash guard in the board: nobody works on it until it's checked.");
    }
    if (e && !positive(e.cableRouteM)) {
      statuses.push("review");
      notes.push("Cable route length not measured.");
    }
    for (const s of systems) {
      const o = outdoorOf(s);
      if (!o) continue;
      if (s.electrical.breakerSource === "rule-of-thumb") {
        statuses.push("review");
        notes.push(`${codeOf(o)}: ${s.electrical.breaker} is a rule of thumb (no manufacturer figure on record), confirm in the installation manual.`);
      } else {
        notes.push(`${codeOf(o)}: ${s.electrical.breaker}, ${s.electrical.cableMm2} mm² cable, ${s.electrical.isolator}.`);
      }
    }
    notes.push("A new circuit is Part P notifiable: a registered electrician signs the certificate.");
    add("electrics", "Electrical supply", worst(statuses), notes.join(" "));
  }

  // 7. Planning: never "no planning needed".
  {
    const p = site?.planning;
    const notes: string[] = [];
    const statuses: RuleStatus[] = [];
    if (!p) {
      statuses.push("review");
      notes.push("No planning facts on record.");
    } else {
      if (p.intel?.listedBuilding || p.listedOrConservation === "yes") {
        statuses.push("review");
        notes.push(p.intel?.listedBuilding ? "Listed building on record: listed building consent and likely planning permission." : "The survey says listed or conservation area: the outdoor position needs a consent-aware check.");
      }
      if (p.intel?.conservationArea || p.intel?.article4) {
        statuses.push("review");
        notes.push(`${p.intel.conservationArea ? "Conservation area" : "Article 4 direction"} on the property record: rear or concealed positions only, and confirm with the council.`);
      }
      if (p.listedOrConservation === "unknown") {
        statuses.push("review");
        notes.push("The survey couldn't confirm whether the property is listed or in a conservation area.");
      }
      if (!p.intel) {
        statuses.push("review");
        notes.push("No property record held, so listing, conservation area and Article 4 haven't been checked against the council's maps.");
      }
      const answers = Object.values(p.pd);
      const pdLabel = (k: string) => `“${PD_CHECKS.find((c) => c.id === k)?.label ?? k}”`;
      const no = Object.entries(p.pd).filter(([, v]) => v === "no").map(([k]) => pdLabel(k));
      const unsure = Object.entries(p.pd).filter(([, v]) => v === "unsure").map(([k]) => pdLabel(k));
      if (no.length) {
        statuses.push("review");
        notes.push(`Permitted development answered no: ${no.join("; ")}. This goes down the planning application route.`);
      }
      if (unsure.length || answers.length < 8) {
        statuses.push("review");
        notes.push(`${unsure.length ? `Unsure: ${unsure.join("; ")}. ` : ""}${answers.length < 8 ? `${8 - answers.length} permitted-development checks unanswered.` : ""}`.trim());
      }
      if (site?.heatingUse === "cooling-only-intent") {
        statuses.push("review");
        notes.push("They mean to use it only for cooling: permitted development covers heat pumps used for heating.");
      }
      if (statuses.length === 0) notes.push("No listing, conservation area or Article 4 on the property record, and every permitted-development check answered yes.");
    }
    notes.push("The technical lead confirms the assessment; this isn't a planning decision.");
    add("planning", "Planning constraints", worst(statuses), notes.join(" "));
  }

  // 8. Number of outdoor units (Class G).
  if (site) {
    const n = systems.length;
    if (site.propertyType === "flat") {
      add("unit-count", "Outdoor units (permitted development)", "review", `${plural(n, "outdoor unit")} on a flat: the permitted-development limits for flats differ, so check them (or plan for an application).`);
    } else {
      const limit = site.propertyType === "detached" ? 2 : 1;
      add(
        "unit-count",
        "Outdoor units (permitted development)",
        n <= limit ? "pass" : "review",
        n <= limit
          ? `${plural(n, "outdoor unit")}, within the ${limit} allowed on a ${site.propertyType} house under permitted development.`
          : `${plural(n, "outdoor unit")} on a ${site.propertyType} house, but permitted development allows ${limit}: this needs a planning application, or fewer outdoor units (a multi-split).`,
      );
    }
  }

  // 9. Outdoor unit volume (Class G).
  {
    const limit = site?.propertyType === "flat" ? 0.6 : 1.5;
    const vols = systems
      .map((s) => outdoorOf(s))
      .filter((o): o is CatalogueItem => !!o)
      .map((o) => {
        const d = o.specs?.dimensionsMm;
        return { o, m3: d ? (d.w * d.h * d.d) / 1e9 : null };
      });
    const unknown = vols.filter((v) => v.m3 === null);
    const over = vols.filter((v) => v.m3 !== null && v.m3 > limit);
    if (vols.length === 0) add("outdoor-volume", "Outdoor unit size (permitted development)", "fail", "No outdoor unit chosen yet.");
    else if (over.length) add("outdoor-volume", "Outdoor unit size (permitted development)", "review", `${over.map((v) => `${codeOf(v.o)} is ${v.m3!.toFixed(2)} m³`).join("; ")}: over the ${limit} m³ permitted-development limit.`);
    else if (unknown.length) add("outdoor-volume", "Outdoor unit size (permitted development)", "review", `Dimensions not on record for ${unknown.map((v) => codeOf(v.o)).join(", ")}, so the ${limit} m³ limit can't be checked.`);
    else add("outdoor-volume", "Outdoor unit size (permitted development)", "pass", `${vols.map((v) => `${codeOf(v.o)} ${v.m3!.toFixed(2)} m³`).join("; ")}: within the ${limit} m³ limit.`);
  }

  // 10. Noise at the neighbour (MCS 020(a)): needs the outdoor unit's sound power, a measured distance and the reflecting surfaces.
  {
    const parts: { label: string; lp: number }[] = [];
    const missing: string[] = [];
    const uncounted: string[] = [];
    for (const s of systems) {
      const o = outdoorOf(s);
      if (!o) continue;
      const lwa = o.specs?.soundPowerDb;
      const pos = positionOf(s);
      if (typeof lwa !== "number") {
        missing.push(`add the outdoor unit's sound power (LWA) for ${codeOf(o)}`);
        continue;
      }
      if (!pos || !positive(pos.distanceToNeighbourWindowM)) {
        missing.push(`measure the distance from ${pos ? `"${pos.label}"` : `${codeOf(o)}'s position`} to the nearest neighbouring window`);
        continue;
      }
      const { q, counted } = directivityOf(pos);
      if (!counted) uncounted.push(`"${pos.label}"`);
      parts.push({ label: `${codeOf(o)} ${lwa} dB(A) LWA at ${pos.distanceToNeighbourWindowM} m, Q${q}${counted ? "" : " (surfaces not counted: guessed from the base)"}`, lp: soundPressureDb(lwa, pos.distanceToNeighbourWindowM, q) });
    }
    const limit = `the ${MCS_HEAT_PUMP_LIMIT_DB.toFixed(1)} dB(A) MCS 020(a) allows the heat pump at the assessment position (the ${NOISE_LIMIT_DB} dB(A) limit includes an assumed 40 dB(A) background)`;
    if (systems.length === 0 || !systems.some((s) => outdoorOf(s))) {
      add("noise", "Noise at nearest neighbour", "fail", "Cannot determine: no outdoor unit chosen yet.");
    } else if (missing.length) {
      add("noise", "Noise at nearest neighbour", "fail", `Cannot determine: ${missing.join("; ")}.`);
    } else {
      const total = Math.round(addDecibels(parts.map((p) => p.lp)) * 10) / 10;
      const basis = `${parts.map((p) => p.label).join("; ")}. Estimate by the MCS 020(a) method (Lp = LWA + 10·log10(Q ÷ 4πr²)), no barrier credit${parts.length > 1 ? ", units added together" : ""}; the full MCS 020(a) calculation, with any barrier, is the technical lead's.`;
      const count = uncounted.length ? ` Count the hard surfaces within 1 m of ${uncounted.join(", ")} at the survey (a corner or side return is Q8): until then this can't pass.` : "";
      if (total > MCS_HEAT_PUMP_LIMIT_DB) add("noise", "Noise at nearest neighbour", "review", `About ${total} dB(A) from the heat pump, over ${limit}: move the unit, choose a quieter one, credit a barrier in the full calculation, or plan for an application.${count} ${basis}`);
      else if (uncounted.length) add("noise", "Noise at nearest neighbour", "review", `About ${total} dB(A) from the heat pump, under ${limit}, but not every position's surfaces were counted.${count} ${basis}`);
      else if (total > MCS_HEAT_PUMP_LIMIT_DB - 1) add("noise", "Noise at nearest neighbour", "review", `About ${total} dB(A) from the heat pump, within 1 dB of ${limit}: check the distance (to the assessment position, 1 m out from the window) and the datasheet LWA. ${basis}`);
      else add("noise", "Noise at nearest neighbour", "pass", `About ${total} dB(A) from the heat pump, under ${limit}. ${basis}`);
    }
  }

  // 11. Condensate.
  {
    const pumped = rooms.filter((r) => r.condensate === "pump");
    const assumed = rooms.filter((r) => r.estimated?.includes("condensate"));
    const status: RuleStatus = assumed.length ? "review" : "pass";
    const detail = [
      pumped.length ? `Condensate pumps for ${pumped.map((r) => r.roomName).join(", ")} (in the kit list); gravity drains elsewhere.` : "Every indoor unit drains by gravity.",
      assumed.length ? `Not confirmed at the survey, assumed: ${assumed.map((r) => `${r.roomName} (${r.condensate})`).join(", ")}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
    add("drainage", "Condensate drainage", status, detail);
  }

  // 12. Indoor mounting and routes.
  {
    const internal = rooms.filter((r) => r.hasExternalWall === false);
    const concealed = rooms.filter((r) => r.route === "via-loft" || r.route === "internal-concealed");
    const notes: string[] = [];
    if (internal.length) notes.push(`${internal.map((r) => r.roomName).join(", ")}: no outside wall, so the pipes run concealed to the nearest outside point.`);
    if (concealed.length) notes.push(`Concealed route (${concealed.map((r) => `${r.roomName}: ${r.route === "via-loft" ? "via the loft" : "inside walls/ceilings"}`).join("; ")}): check joists, services and access before anything is boxed in.`);
    if (site?.risks.concealedServicesConcern) notes.push("The survey flagged concealed services: scan before drilling.");
    add("mounting", "Indoor unit mounting", notes.length ? "review" : "pass", notes.join(" ") || "Every indoor unit is on an outside wall with a direct route.");
  }

  // 13. Outdoor position and access.
  {
    const used = systems.map((s) => positionOf(s));
    if (!site || site.outdoorPositions.length === 0) {
      add("clearances", "Outdoor position & access", "fail", "Cannot determine: no outdoor position recorded at the survey.");
    } else if (used.some((p) => !p)) {
      add("clearances", "Outdoor position & access", "review", "Not every outdoor unit has a position chosen.");
    } else {
      const positions = used as NonNullable<(typeof used)[number]>[];
      const notes: string[] = [];
      let status: RuleStatus = "pass";
      for (const p of positions) {
        if (p.location === "unsure") {
          status = "fail";
          notes.push(`"${p.label}": position undecided.`);
        } else if (p.location === "flat-roof" || p.location === "balcony") {
          status = worst([status, "review"]);
          notes.push(`"${p.label}" (${LOCATION_LABEL[p.location]}): airflow, clearances and safe service access need confirming.`);
        }
        if (p.accessEquipment === "tower" || p.accessEquipment === "scaffold") {
          status = worst([status, "review"]);
          notes.push(`"${p.label}" needs a ${p.accessEquipment}: plan it in the RAMS and the kit list.`);
        }
      }
      if (site.risks.workingAtHeight && !notes.some((n) => n.includes("RAMS"))) {
        status = worst([status, "review"]);
        notes.push("Working at height flagged at the survey.");
      }
      add(
        "clearances",
        "Outdoor position & access",
        status,
        notes.join(" ") || `${positions.map((p) => `"${p.label}" (${LOCATION_LABEL[p.location] ?? p.location})`).join(", ")}: standard service clearances achievable.`,
      );
    }
  }

  // 14. How sure the catalogue data is.
  {
    const ids = new Set([...roomUnits.map((u) => u.indoorItemId), ...systems.map((s) => s.outdoorItemId)]);
    const items = [...ids].map((id) => byId.get(id)).filter((i): i is CatalogueItem => !!i);
    const gone = items.filter((i) => i.status === "discontinued" || !i.active);
    const uncertain = items.filter((i) => i.status === "uncertain");
    const unsure = items.filter((i) => i.confidence !== "verified" || isStale(i, x.asOf));
    if (gone.length) add("equipment-data", "Catalogue data", "fail", `${gone.map(codeOf).join(", ")} ${gone.length === 1 ? "is" : "are"} discontinued or retired.`);
    else if (uncertain.length || unsure.length) {
      add(
        "equipment-data",
        "Catalogue data",
        "review",
        [
          unsure.length
            ? `${plural(unsure.length, "item")} provisional or stale (${unsure.map(codeOf).join(", ")}): fine to design with, but the proposal shows their figures (quietest dB, app control) as the catalogue has them, so check those against the datasheet before it goes out, and again before ordering.`
            : "",
          uncertain.length ? `Availability uncertain: ${uncertain.map(codeOf).join(", ")}.` : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
    } else if (items.length) add("equipment-data", "Catalogue data", "pass", "Every unit in this design is verified and available.");
  }

  return rules;
}

/** Install days, an estimate: a day for the first room, half a day per extra room, more for hard routes and access. */
export function estimateInstallDays(rooms: RoomDesignInput[], systems: SystemSelection[], site?: DesignSite): number {
  if (rooms.length === 0) return 0;
  let days = 1 + 0.5 * (rooms.length - 1) + 0.25 * Math.max(0, systems.length - 1);
  if (rooms.some((r) => r.condensate === "pump" || r.route === "via-loft" || r.route === "internal-concealed")) days += 0.5;
  const used = systems.map((s) => site?.outdoorPositions.find((p) => p.id === s.outdoorPositionId));
  if (site?.risks.workingAtHeight || used.some((p) => p?.accessEquipment === "tower" || p?.accessEquipment === "scaffold")) days += 0.5;
  return Math.max(1, Math.ceil(days));
}

/* ------------------------------------------------------------------ */
/* Building a variant                                                  */
/* ------------------------------------------------------------------ */

function defaultPosition(site: DesignSite | undefined, index: number): DesignSite["outdoorPositions"][number] | undefined {
  const positions = site?.outdoorPositions ?? [];
  const chosen = positions.filter((p) => p.chosen);
  const pool = chosen.length ? chosen : positions;
  return pool[index] ?? pool[0];
}

/**
 * Normalise a set of choices against the rooms (every room in exactly one
 * system, every room with a unit), then work out everything that follows:
 * compatibility, circuit, charge, bill of materials, rules, verdict, days.
 */
function buildVariant(input: {
  id: string;
  tier: "standard" | "premium";
  label?: string;
  manufacturer?: string;
  choice: VariantChoice;
  rooms: RoomDesignInput[];
  site?: DesignSite;
  catalogue: CatalogueItem[];
  compatibility: CompatibilityRule[];
  asOf: string;
}): DesignVariant {
  const { rooms, site, catalogue, compatibility, tier } = input;
  const byId = byIdMap(catalogue);
  const roomIds = new Set(rooms.map((r) => r.roomId));

  // Every room gets a unit: the chosen one, else the engine's.
  const roomUnits = rooms.map((r) => {
    const chosen = input.choice.roomUnits.find((u) => u.roomId === r.roomId)?.indoorItemId;
    const id = chosen ?? pickIndoor({ kw: r.chosenKw, tier, manufacturer: input.manufacturer, catalogue })?.id ?? "";
    return { roomId: r.roomId, indoorItemId: id };
  });

  // Every room in exactly one system; empty systems dropped; leftovers get a single split.
  const placed = new Set<string>();
  const choices: SystemChoice[] = [];
  for (const s of input.choice.systems) {
    const ids = s.roomIds.filter((id) => roomIds.has(id) && !placed.has(id));
    ids.forEach((id) => placed.add(id));
    if (ids.length) choices.push({ ...s, roomIds: ids });
  }
  for (const r of rooms) {
    if (placed.has(r.roomId)) continue;
    const unit = byId.get(roomUnits.find((u) => u.roomId === r.roomId)!.indoorItemId);
    choices.push({ outdoorItemId: unit ? (singlePairFor(unit, catalogue)?.id ?? "") : "", roomIds: [r.roomId] });
  }

  const usedIds = new Set<string>();
  const systems: SystemSelection[] = choices.map((c, i) => {
    let id = c.id && !usedIds.has(c.id) ? c.id : `s${i + 1}`;
    while (usedIds.has(id)) id = `${id}x`;
    usedIds.add(id);
    const outdoor = byId.get(c.outdoorItemId);
    const groupRooms = c.roomIds.map((rid) => rooms.find((r) => r.roomId === rid)!);
    const indoors = c.roomIds.map((rid) => byId.get(roomUnits.find((u) => u.roomId === rid)?.indoorItemId ?? ""));
    const runs = groupRooms.map((r) => r.pipeRunM);
    const rule = outdoor ? findRule(outdoor, compatibility) : undefined;

    let compatibility_: CombinationCheck;
    if (!outdoor) {
      const names = groupRooms.map((r) => r.roomName).join(", ");
      compatibility_ = {
        ok: false,
        errors: [c.outdoorItemId ? `Outdoor unit "${c.outdoorItemId}" isn't in the catalogue.` : `Choose an outdoor unit for ${names}: the catalogue has no listed pair for the indoor unit chosen.`],
        warnings: [],
      };
    } else {
      const known = indoors.map((u, k) => ({ u, run: runs[k]! })).filter((x): x is { u: CatalogueItem; run: number } => !!x.u);
      compatibility_ = validateCombination(rule, outdoor, known.map((x) => x.u), known.map((x) => x.run));
      const missing = groupRooms.filter((_, k) => !indoors[k]);
      if (missing.length) {
        compatibility_ = {
          ok: false,
          errors: [...missing.map((r) => `Choose an indoor unit for ${r.roomName}.`), ...compatibility_.errors],
          warnings: compatibility_.warnings,
        };
      }
      const maxHeight = outdoor.specs?.maxHeightDiffM;
      if (typeof maxHeight === "number") {
        const high = groupRooms.filter((r) => r.heightDiffM > maxHeight);
        if (high.length) {
          compatibility_ = {
            ok: false,
            errors: [...compatibility_.errors, ...high.map((r) => `${r.roomName}: ${r.heightDiffM} m height difference is over ${codeOf(outdoor)}'s ${maxHeight} m limit.`)],
            warnings: compatibility_.warnings,
          };
        }
      }
    }

    let refrigerant = refrigerantFor(outdoor, runs);
    if (outdoor) {
      // R32 is mildly flammable: above 1.84 kg every room on the system needs its minimum floor area.
      const a2l = a2lSystemCheck(outdoor, refrigerant, groupRooms.map((room, k) => ({ room, indoor: indoors[k] })));
      if (a2l.factoryKg !== null) refrigerant = { ...refrigerant, factoryChargeKg: a2l.factoryKg, ...(a2l.complete && a2l.totalKg !== null ? { totalChargeKg: a2l.totalKg } : {}) };
      if (a2l.errors.length) compatibility_ = { ok: false, errors: [...compatibility_.errors, ...a2l.errors], warnings: compatibility_.warnings };
    }

    const position = c.outdoorPositionId ? site?.outdoorPositions.find((p) => p.id === c.outdoorPositionId) : defaultPosition(site, i);
    const connectedKw = sum(indoors.map((u) => kwOf(u) ?? 0));
    return {
      id,
      topology: c.roomIds.length > 1 ? "multi" : "single",
      outdoorItemId: c.outdoorItemId,
      roomIds: c.roomIds,
      ...(position ? { outdoorPositionId: position.id } : {}),
      compatibility: compatibility_,
      electrical: electricalFor(outdoor, connectedKw, site),
      refrigerant,
      ...(rule ? { ruleId: rule.id, ruleConfidence: rule.confidence } : {}),
      layoutMediaIds: c.layoutMediaIds ?? (position?.mediaId ? [position.mediaId] : []),
    };
  });

  const rules = designRules({ rooms, roomUnits, systems, site, byId, compatibility, asOf: input.asOf });
  const manufacturer = input.manufacturer;
  const suggestedUnits = autoChoice(rooms, tier, manufacturer, catalogue, compatibility).roomUnits;
  return {
    id: input.id,
    label: input.label ?? VARIANT_LABEL[tier],
    tier,
    systems,
    roomUnits,
    bom: buildBom({ systems, rooms, roomUnits, site, catalogue }),
    rules,
    verdict: designVerdict(rules),
    installDays: estimateInstallDays(rooms, systems, site),
    ...(manufacturer ? { manufacturer } : {}),
    suggested: {
      roomUnits: suggestedUnits,
      systems: autoSystems(rooms, roomUnits, catalogue, compatibility).map((s) => ({ outdoorItemId: s.outdoorItemId, roomIds: s.roomIds })),
    },
  };
}

/* ------------------------------------------------------------------ */
/* The contract functions                                              */
/* ------------------------------------------------------------------ */

/**
 * Draft a design from the measured survey: per included room the
 * preliminary load (rule of thumb, labelled), the suggested size, the
 * measured runs (estimates flagged); then a Standard and a Quiet variant,
 * each on one brand, each a multi-split where a catalogue rule passes and
 * single splits otherwise, with circuit, charge, bill of materials and
 * rule lights. A tier with no indoor units in the catalogue is left out.
 */
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
  /** Additive (F3): build both tiers on this brand when it has units. */
  manufacturer?: string;
  surveyRecordId?: string;
  createdBy?: string;
}): DesignRecord {
  const site = siteFromSurvey(input.measured, input.intel);
  const rooms = roomInputsFromSurvey(input.measured, input.baseSurvey);
  const catalogue = input.catalogue;
  const tiers = (["standard", "premium"] as const).filter((t) => manufacturersFor(t, catalogue).length > 0);
  const variants = (tiers.length ? tiers : (["standard"] as const)).map((tier) => {
    const manufacturer = chooseManufacturer(rooms, tier, catalogue, input.compatibility, input.manufacturer);
    const choice = autoChoice(rooms, tier, manufacturer, catalogue, input.compatibility);
    return buildVariant({ id: tier, tier, manufacturer, choice, rooms, site, catalogue, compatibility: input.compatibility, asOf: input.now });
  });
  return {
    id: input.id,
    projectId: input.projectId,
    version: input.version,
    status: "draft",
    ...(input.surveyRecordId ? { surveyRecordId: input.surveyRecordId } : {}),
    rooms,
    variants,
    overrides: [],
    createdAt: input.now,
    ...(input.createdBy ? { createdBy: input.createdBy } : {}),
    site,
  };
}

/**
 * Recompute one variant after an edit: the person's choices (units,
 * topology, positions, layout photos) stand; everything derived from them
 * is worked out again against the catalogue as it is now.
 */
export function recomputeVariant(design: DesignRecord, variantId: string, catalogue: CatalogueItem[], compatibility: CompatibilityRule[]): DesignVariant {
  const variant = design.variants.find((v) => v.id === variantId);
  if (!variant) throw new Error(`No variant "${variantId}" in design v${design.version}.`);
  return buildVariant({
    id: variant.id,
    tier: variant.tier,
    label: variant.label,
    manufacturer: variant.manufacturer,
    choice: { roomUnits: variant.roomUnits, systems: variant.systems },
    rooms: design.rooms,
    site: design.site,
    catalogue,
    compatibility,
    asOf: design.createdAt,
  });
}

/* ------------------------------------------------------------------ */
/* Overrides                                                           */
/* ------------------------------------------------------------------ */

export interface DesignDeviation {
  field: string;
  /** What changed, for people: "Main bedroom: capacity". */
  label: string;
  from: string;
  to: string;
}

const systemsKey = (systems: { outdoorItemId: string; roomIds: string[] }[]) =>
  systems
    .map((s) => `${s.outdoorItemId}:${[...s.roomIds].sort().join("+")}`)
    .sort()
    .join("|");

const numEq = (a: number, b: number) => Math.abs(a - b) < 0.05;

/**
 * Every place the design departs from what the survey said or what the
 * engine suggested. Each one needs an override with a reason before the
 * design can be approved.
 */
export function designDeviations(design: DesignRecord): DesignDeviation[] {
  const out: DesignDeviation[] = [];
  for (const r of design.rooms) {
    if (!numEq(r.chosenKw, r.suggestedKw)) out.push({ field: `rooms.${r.roomId}.chosenKw`, label: `${r.roomName}: capacity`, from: String(r.suggestedKw), to: String(r.chosenKw) });
    if (r.survey) {
      if (!numEq(r.pipeRunM, r.survey.pipeRunM)) out.push({ field: `rooms.${r.roomId}.pipeRunM`, label: `${r.roomName}: pipe run (m)`, from: String(r.survey.pipeRunM), to: String(r.pipeRunM) });
      if (!numEq(r.heightDiffM, r.survey.heightDiffM)) out.push({ field: `rooms.${r.roomId}.heightDiffM`, label: `${r.roomName}: height difference (m)`, from: String(r.survey.heightDiffM), to: String(r.heightDiffM) });
      if (r.condensate !== r.survey.condensate) out.push({ field: `rooms.${r.roomId}.condensate`, label: `${r.roomName}: condensate`, from: r.survey.condensate, to: r.condensate });
    }
  }
  for (const v of design.variants) {
    if (!v.suggested) continue;
    for (const u of v.roomUnits) {
      const sug = v.suggested.roomUnits.find((s) => s.roomId === u.roomId);
      const room = design.rooms.find((r) => r.roomId === u.roomId);
      if (sug && sug.indoorItemId && sug.indoorItemId !== u.indoorItemId) {
        out.push({ field: `variants.${v.id}.rooms.${u.roomId}.indoor`, label: `${v.label}, ${room?.roomName ?? u.roomId}: indoor unit`, from: sug.indoorItemId, to: u.indoorItemId });
      }
    }
    const chosen = systemsKey(v.systems);
    const suggested = systemsKey(v.suggested.systems);
    if (chosen !== suggested) out.push({ field: `variants.${v.id}.systems`, label: `${v.label}: outdoor units`, from: suggested, to: chosen });
  }
  return out;
}

/** Every layout photo the design points at: room photos and outdoor photos, every variant. */
export function layoutMediaIdsOf(design: DesignRecord): string[] {
  return [...new Set([...design.rooms.flatMap((r) => r.layoutMediaIds), ...design.variants.flatMap((v) => v.systems.flatMap((s) => s.layoutMediaIds ?? []))])];
}

/** Does any variant put rooms on a multi-split whose rule isn't verified? */
export function needsCombinationAck(design: DesignRecord): boolean {
  return design.variants.some((v) => v.systems.some((s) => s.topology === "multi" && (s.ruleConfidence !== "verified" || s.compatibility.warnings.includes(PROVISIONAL_RULE_WARNING))));
}

/**
 * What stops this version being signed: compatibility errors, missing
 * units, deviations without a reason, rooms with no layout photo, and a
 * multi-split on a provisional rule without the technical lead confirming
 * the manufacturer's combination table.
 */
export function designApprovalErrors(design: DesignRecord): string[] {
  const out: string[] = [];
  if (design.status === "approved") out.push("This version is already approved.");
  if (design.status === "superseded") out.push("A newer version of this design exists: approve that one.");
  if (design.rooms.length === 0) out.push("No rooms are included in the design.");
  if (design.variants.length === 0) out.push("There's no design option to approve.");
  const many = design.variants.length > 1;
  for (const v of design.variants) {
    const prefix = many ? `${v.label}: ` : "";
    for (const r of design.rooms) {
      const unit = v.roomUnits.find((u) => u.roomId === r.roomId);
      if (!unit?.indoorItemId) out.push(`${prefix}choose an indoor unit for ${r.roomName}.`);
      if (!v.systems.some((s) => s.roomIds.includes(r.roomId))) out.push(`${prefix}${r.roomName} isn't connected to an outdoor unit.`);
    }
    for (const s of v.systems) for (const e of s.compatibility.errors) out.push(`${prefix}${e}`);
  }
  for (const d of designDeviations(design)) {
    const o = design.overrides.find((x) => x.field === d.field && x.to === d.to);
    if (!o || o.reason.trim().length < 3) out.push(`Give a reason for the change to ${d.label}.`);
  }
  for (const r of design.rooms) if (r.layoutMediaIds.length === 0) out.push(`${r.roomName}: choose at least one layout photo.`);
  if (needsCombinationAck(design) && !design.acknowledgements?.combinationTable) {
    out.push(`A multi-split here rests on a provisional rule: tick "${COMBINATION_TABLE_ACK}" to approve.`);
  }
  return [...new Set(out)];
}

/* ------------------------------------------------------------------ */
/* Editing                                                             */
/* ------------------------------------------------------------------ */

/** What the design studio sends back: the person's choices, never derived numbers. */
export interface DesignEdits {
  rooms: { roomId: string; chosenKw: number; pipeRunM: number; heightDiffM: number; condensate: "gravity" | "pump"; layoutMediaIds: string[] }[];
  /** Variants kept, with their choices. A variant left out is dropped (at least one must stay). */
  variants: { id: string; manufacturer?: string; roomUnits: { roomId: string; indoorItemId: string }[]; systems: SystemChoice[] }[];
  /** Override reasons by field (see designDeviations). */
  reasons: Record<string, string>;
  notes?: string;
}

/**
 * The next version of a design with these edits applied and everything
 * derived recomputed. Overrides are rebuilt from the deviations: a reason
 * already given for the same change is kept (with its author and time);
 * a new or changed reason is credited to `by` at `at`. Pure: the caller
 * decides whether anything changed (see designInputsKey) before saving.
 */
export function applyDesignEdits(
  base: DesignRecord,
  edits: DesignEdits,
  ctx: { catalogue: CatalogueItem[]; compatibility: CompatibilityRule[]; by: string; at: string; id: string; version: number },
): DesignRecord {
  const rooms = base.rooms.map((r) => {
    const e = edits.rooms.find((x) => x.roomId === r.roomId);
    if (!e) return r;
    return {
      ...r,
      chosenKw: e.chosenKw,
      pipeRunM: round1(e.pipeRunM),
      heightDiffM: round1(e.heightDiffM),
      condensate: e.condensate,
      layoutMediaIds: [...new Set(e.layoutMediaIds)],
    };
  });
  const kept = edits.variants.filter((e) => base.variants.some((v) => v.id === e.id));
  const draft: DesignRecord = { ...base, id: ctx.id, version: ctx.version, status: "draft", rooms, createdAt: ctx.at, createdBy: ctx.by };
  delete draft.approval;
  delete draft.acknowledgements;
  const variants = (kept.length ? kept : base.variants.map((v) => ({ id: v.id, manufacturer: v.manufacturer, roomUnits: v.roomUnits, systems: v.systems }))).map((e) => {
    const v = base.variants.find((x) => x.id === e.id)!;
    return buildVariant({
      id: v.id,
      tier: v.tier,
      label: v.label,
      manufacturer: e.manufacturer ?? v.manufacturer,
      choice: { roomUnits: e.roomUnits, systems: e.systems },
      rooms,
      site: base.site,
      catalogue: ctx.catalogue,
      compatibility: ctx.compatibility,
      asOf: ctx.at,
    });
  });
  draft.variants = variants;
  const notes = (edits.notes ?? "").trim();
  if (notes) draft.notes = notes;
  else delete draft.notes;

  draft.overrides = designDeviations(draft).map((d) => {
    const given = (edits.reasons[d.field] ?? "").trim();
    const prior = base.overrides.find((o) => o.field === d.field && o.to === d.to);
    const reason = given || prior?.reason || "";
    const same = prior && prior.reason === reason;
    return { field: d.field, from: d.from, to: d.to, reason, by: same ? prior.by : ctx.by, at: same ? prior.at : ctx.at };
  });
  draft.rooms = draft.rooms.map((r) => {
    const reason = draft.overrides.find((o) => o.field === `rooms.${r.roomId}.chosenKw`)?.reason;
    const next = { ...r };
    if (reason) next.reason = reason;
    else delete next.reason;
    return next;
  });
  return draft;
}

/** A canonical string of everything a person chose, so "nothing changed" means no new version. */
export function designInputsKey(d: DesignRecord): string {
  return JSON.stringify({
    rooms: d.rooms.map((r) => [r.roomId, r.chosenKw, r.pipeRunM, r.heightDiffM, r.condensate, [...r.layoutMediaIds].sort()]),
    variants: d.variants.map((v) => [
      v.id,
      v.manufacturer ?? "",
      v.roomUnits.map((u) => [u.roomId, u.indoorItemId]),
      v.systems.map((s) => [s.outdoorItemId, [...s.roomIds], s.outdoorPositionId ?? "", [...(s.layoutMediaIds ?? [])].sort()]),
    ]),
    overrides: d.overrides.map((o) => [o.field, o.to, o.reason]).sort(),
    notes: d.notes ?? "",
  });
}

/** The edits that reproduce a record as it stands (what the studio starts from). */
export function editsFromDesign(d: DesignRecord): DesignEdits {
  return {
    rooms: d.rooms.map((r) => ({ roomId: r.roomId, chosenKw: r.chosenKw, pipeRunM: r.pipeRunM, heightDiffM: r.heightDiffM, condensate: r.condensate, layoutMediaIds: [...r.layoutMediaIds] })),
    variants: d.variants.map((v) => ({
      id: v.id,
      ...(v.manufacturer ? { manufacturer: v.manufacturer } : {}),
      roomUnits: v.roomUnits.map((u) => ({ ...u })),
      systems: v.systems.map((s) => ({
        id: s.id,
        outdoorItemId: s.outdoorItemId,
        roomIds: [...s.roomIds],
        ...(s.outdoorPositionId ? { outdoorPositionId: s.outdoorPositionId } : {}),
        layoutMediaIds: [...(s.layoutMediaIds ?? [])],
      })),
    })),
    reasons: Object.fromEntries(d.overrides.map((o) => [o.field, o.reason])),
    ...(d.notes ? { notes: d.notes } : {}),
  };
}

/**
 * Sign a design: the approval errors must be clear (after recording the
 * combination-table acknowledgement, when given). The approver's identity
 * and F-gas reference come from the caller's verified staff record.
 */
export function approveDesign(
  design: DesignRecord,
  approver: { staffId: string; name: string; qualificationRef: string },
  at: string,
  opts: { combinationTableChecked: boolean },
): { ok: true; design: DesignRecord } | { ok: false; errors: string[] } {
  const next: DesignRecord = { ...design };
  if (opts.combinationTableChecked && needsCombinationAck(design)) next.acknowledgements = { combinationTable: { by: approver.name, at } };
  const errors = designApprovalErrors(next);
  if (!approver.qualificationRef.trim()) errors.push("The approver needs a current F-gas qualification reference on their staff record.");
  if (errors.length) return { ok: false, errors };
  return { ok: true, design: { ...next, status: "approved", approval: { ...approver, at } } };
}
