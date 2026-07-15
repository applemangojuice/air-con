import { suggestArchetypes, getArchetype } from "./archetypes.ts";
import { buildDefaultConfig, type DefaultConfig } from "./defaultconfig.ts";
import type { PropertyEra, PropertyType } from "./types.ts";

/**
 * The Property Intelligence Engine: a structured understanding of every
 * property in our target area, keyed on UPRN, built from open datasets
 * (EPC, planning, conservation) plus our own manual audits.
 *
 * Same rules as the rest of the domain package: plain JSON types that
 * persist to JSONB as-is, and pure deterministic functions. The importer,
 * the funnel prefill, the per-address landing pages and the analytics
 * platform all speak these types.
 */

/* ------------------------------------------------------------------ */
/* The master record                                                   */
/* ------------------------------------------------------------------ */

export type LeadStatus =
  | "untouched"
  | "mailed"
  | "responded"
  | "quoted"
  | "customer"
  | "excluded";

export type PriorityBand = "hot" | "warm" | "standard" | "low" | "exclude";

export type AuditDifficulty = "easy" | "standard" | "complex";

export interface PropertyIntel {
  /** UPRN when we have one, otherwise a synthetic key from the address. */
  id: string;
  uprn?: string;
  address: {
    line1: string;
    postcode: string;
    /** Outward code, e.g. SW16. The unit of geographic rollout. */
    outcode: string;
  };
  /** Physical profile from the EPC register. Raw strings kept as-is. */
  epc?: {
    propertyType?: string; // House | Flat | Bungalow | Maisonette
    builtForm?: string; // Detached | Semi-Detached | Mid-Terrace | End-Terrace | ...
    constructionAgeBand?: string; // e.g. "England and Wales: 1930-1949"
    totalFloorAreaM2?: number;
    habitableRooms?: number;
    wallDescription?: string;
    roofDescription?: string;
    glazingDescription?: string;
    mainHeatDescription?: string;
    hotWaterDescription?: string;
    currentRating?: string; // A-G
    potentialRating?: string;
    lodgedAt?: string; // certificate date, ISO
  };
  /** Structural changes spotted in planning applications. */
  planning: {
    loftConversion: boolean;
    rearExtension: boolean;
    sideExtension: boolean;
    garageConversion: boolean;
    applicationCount?: number;
  };
  /** Planning constraints that restrict outdoor units. */
  constraints: {
    conservationArea: boolean;
    listedBuilding: boolean;
    article4: boolean;
  };
  /** Our proprietary manual audit. The most valuable data we hold. */
  audit?: {
    archetypeId?: string;
    permutationId?: string;
    difficulty: AuditDifficulty;
    condenserPosition?: string;
    indoorUnitNotes?: string;
    pipeRoute?: string;
    electricalNotes?: string;
    notes?: string;
    confidence: number; // 0-100
    auditedAt: string; // ISO
    auditor: string;
  };
  /** Commercial state for targeting and campaigns. */
  marketing: {
    priorityScore?: number;
    priorityBand?: PriorityBand;
    campaign?: string;
    lastContactAt?: string;
    leadStatus: LeadStatus;
    targetPackage?: string;
  };
}

export function emptyMarketing(): PropertyIntel["marketing"] {
  return { leadStatus: "untouched" };
}

export function emptyPlanning(): PropertyIntel["planning"] {
  return {
    loftConversion: false,
    rearExtension: false,
    sideExtension: false,
    garageConversion: false,
  };
}

export function emptyConstraints(): PropertyIntel["constraints"] {
  return { conservationArea: false, listedBuilding: false, article4: false };
}

/* ------------------------------------------------------------------ */
/* Address helpers                                                     */
/* ------------------------------------------------------------------ */

/** "12a, Larkhall  Rise" → "12A LARKHALL RISE": the join key for datasets. */
export function normaliseAddress(line: string): string {
  return line
    .toUpperCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function outcodeOf(postcode: string): string {
  const clean = postcode.toUpperCase().replace(/\s+/g, "");
  return clean.length > 3 ? clean.slice(0, -3) : clean;
}

/** Stable synthetic id for rows with no UPRN: addr key from address+postcode. */
export function syntheticId(line1: string, postcode: string): string {
  const key = `${normaliseAddress(line1)} ${postcode.toUpperCase().replace(/\s+/g, "")}`;
  // djb2: tiny, deterministic, dependency-free. Collisions are practically
  // impossible within one postcode, and the address is stored alongside.
  let hash = 5381;
  for (let i = 0; i < key.length; i++) hash = ((hash << 5) + hash + key.charCodeAt(i)) >>> 0;
  return `addr-${hash.toString(36)}-${key.replace(/[^A-Z0-9]/g, "").slice(0, 12).toLowerCase()}`;
}

/* ------------------------------------------------------------------ */
/* EPC → survey vocabulary                                             */
/* ------------------------------------------------------------------ */

/** Map EPC PROPERTY_TYPE + BUILT_FORM onto our survey's property type. */
export function mapPropertyType(
  epcPropertyType?: string,
  builtForm?: string,
): PropertyType | undefined {
  const pt = (epcPropertyType ?? "").toLowerCase();
  const bf = (builtForm ?? "").toLowerCase();
  if (pt.includes("bungalow")) return "bungalow";
  if (pt.includes("flat") || pt.includes("maisonette")) return "flat";
  if (bf.includes("detached") && !bf.includes("semi")) return "detached";
  if (bf.includes("semi")) return "semi-detached";
  if (bf.includes("terrace")) return "terraced";
  if (pt.includes("house")) return "semi-detached"; // house with unknown form
  return undefined;
}

/** Map an EPC construction age band string onto our era buckets. */
export function mapEra(constructionAgeBand?: string): PropertyEra | undefined {
  const band = (constructionAgeBand ?? "").toLowerCase();
  if (!band) return undefined;
  if (band.includes("before 1900") || band.includes("pre 1900")) return "pre-1930";
  const years = band.match(/(\d{4})/g)?.map(Number) ?? [];
  if (years.length === 0) return undefined;
  const start = years[0]!;
  if (start < 1930) return "pre-1930";
  if (start < 1950) return "1930-1950";
  if (start < 2000) return "1950-2000";
  return "2000+";
}

/* ------------------------------------------------------------------ */
/* Classification: intel → archetype                                   */
/* ------------------------------------------------------------------ */

export type PlanningRisk = "none" | "check" | "high";

export interface Classification {
  archetypeId?: string;
  archetypeName?: string;
  propertyType?: PropertyType;
  era?: PropertyEra;
  /** 0-100: how sure we are of the archetype call. */
  confidence: number;
  planningRisk: PlanningRisk;
  reasons: string[];
}

export function planningRiskOf(intel: PropertyIntel): PlanningRisk {
  if (intel.constraints.listedBuilding) return "high";
  if (intel.constraints.conservationArea || intel.constraints.article4) return "check";
  return "none";
}

/**
 * Recognise what type of house we're looking at. A manual audit always wins;
 * otherwise the EPC profile drives the call through the archetype library.
 */
export function classifyProperty(intel: PropertyIntel): Classification {
  const risk = planningRiskOf(intel);
  const reasons: string[] = [];

  if (intel.audit?.archetypeId) {
    const archetype = getArchetype(intel.audit.archetypeId);
    reasons.push(`Manual audit by ${intel.audit.auditor}`);
    return {
      archetypeId: intel.audit.archetypeId,
      archetypeName: archetype?.name,
      propertyType: mapPropertyType(intel.epc?.propertyType, intel.epc?.builtForm),
      era: mapEra(intel.epc?.constructionAgeBand),
      confidence: intel.audit.confidence,
      planningRisk: risk,
      reasons,
    };
  }

  const propertyType = mapPropertyType(intel.epc?.propertyType, intel.epc?.builtForm);
  const era = mapEra(intel.epc?.constructionAgeBand);

  if (!propertyType || !era) {
    reasons.push("EPC profile incomplete: needs built form and age band");
    return { propertyType, era, confidence: 0, planningRisk: risk, reasons };
  }

  const archetype = suggestArchetypes({ type: propertyType, era })[0];
  let confidence = 40;
  reasons.push(`EPC: ${intel.epc?.builtForm ?? intel.epc?.propertyType}, ${intel.epc?.constructionAgeBand}`);
  if (intel.epc?.totalFloorAreaM2) {
    confidence += 15;
    reasons.push(`Floor area ${intel.epc.totalFloorAreaM2} m²`);
  }
  if (intel.epc?.habitableRooms) {
    confidence += 10;
    reasons.push(`${intel.epc.habitableRooms} habitable rooms`);
  }
  if (intel.planning.applicationCount !== undefined) {
    confidence += 10;
    reasons.push("Planning history checked");
  }
  if (intel.planning.loftConversion) reasons.push("Loft conversion on record");
  if (intel.planning.rearExtension) reasons.push("Rear extension on record");

  return {
    archetypeId: archetype?.id,
    archetypeName: archetype?.name,
    propertyType,
    era,
    confidence: Math.min(confidence, 80), // only an audit gets above 80
    planningRisk: risk,
    reasons,
  };
}

/* ------------------------------------------------------------------ */
/* Funnel prefill                                                      */
/* ------------------------------------------------------------------ */

export interface PropertyPrefill {
  type?: PropertyType;
  era?: PropertyEra;
  bedrooms?: number;
  floorAreaM2?: number;
}

/**
 * What we can pre-answer in the quote funnel. The flow stays identical, the
 * customer just confirms instead of typing.
 */
export function prefillFromIntel(intel: PropertyIntel): PropertyPrefill {
  const type = mapPropertyType(intel.epc?.propertyType, intel.epc?.builtForm);
  const era = mapEra(intel.epc?.constructionAgeBand);
  const rooms = intel.epc?.habitableRooms;
  // Habitable rooms include receptions; two off (living + kitchen/diner) is a
  // solid bedroom estimate for the housing stock we target.
  const bedrooms = rooms ? Math.min(6, Math.max(1, rooms - 2)) : undefined;
  const floorAreaM2 = intel.epc?.totalFloorAreaM2
    ? Math.round(intel.epc.totalFloorAreaM2)
    : undefined;
  return { type, era, bedrooms, floorAreaM2 };
}

/**
 * The proposed installation for a property before anyone has answered a
 * single question: prefill → default configuration → pricing-engine input.
 * Returns undefined when the profile is too thin to classify.
 */
export function defaultConfigFromIntel(intel: PropertyIntel): DefaultConfig | undefined {
  const prefill = prefillFromIntel(intel);
  if (!prefill.type || !prefill.era) return undefined;
  return buildDefaultConfig({
    type: prefill.type,
    era: prefill.era,
    bedrooms: prefill.bedrooms ?? 3,
    bathrooms: 1,
    layout: "separate",
    floorAreaM2: prefill.floorAreaM2,
  });
}

/* ------------------------------------------------------------------ */
/* Marketing priority                                                  */
/* ------------------------------------------------------------------ */

export interface PriorityResult {
  score: number; // 0-100
  band: PriorityBand;
  reasons: string[];
}

/**
 * Who do we mail first? Deterministic scoring from the property profile.
 * Houses with heat-prone spaces (lofts, big floor plates) and no planning
 * friction rank highest.
 */
export function scoreMarketing(intel: PropertyIntel): PriorityResult {
  if (intel.marketing.leadStatus === "customer" || intel.marketing.leadStatus === "excluded") {
    return { score: 0, band: "exclude", reasons: [`Lead status: ${intel.marketing.leadStatus}`] };
  }

  const cls = classifyProperty(intel);
  let score = 20;
  const reasons: string[] = [];

  if (cls.propertyType && cls.propertyType !== "flat") {
    score += 15;
    reasons.push("House (freeholder, no consent chain)");
  }
  if (intel.planning.loftConversion) {
    score += 20;
    reasons.push("Loft conversion: the hottest rooms in London");
  }
  if (intel.planning.rearExtension || intel.planning.sideExtension) {
    score += 5;
    reasons.push("Extended: invests in the home");
  }
  const area = intel.epc?.totalFloorAreaM2 ?? 0;
  if (area >= 120) {
    score += 15;
    reasons.push("Large home (120 m²+)");
  } else if (area >= 90) {
    score += 10;
    reasons.push("Good-size home (90 m²+)");
  }
  if (cls.archetypeId) {
    score += 10;
    reasons.push(`Matches a proven install pattern (${cls.archetypeName})`);
  }
  if (intel.audit) {
    score += 10;
    reasons.push("Audited: install plan already on file");
  }

  if (cls.planningRisk === "high") {
    score -= 40;
    reasons.push("Listed building: high planning risk");
  } else if (cls.planningRisk === "check") {
    score -= 10;
    reasons.push("Conservation area / Article 4: check before external units");
  }

  score = Math.max(0, Math.min(100, score));
  const band: PriorityBand = score >= 60 ? "hot" : score >= 45 ? "warm" : score >= 30 ? "standard" : "low";
  return { score, band, reasons };
}

/* ------------------------------------------------------------------ */
/* Business case                                                       */
/* ------------------------------------------------------------------ */

export interface CampaignAssumptions {
  /** Print + postage per letter. */
  mailCostGbp: number;
  /** Letters that turn into a quote-funnel visit that completes, %. */
  responseRatePct: number;
  /** Completed quotes that turn into a booked install, %. */
  quoteToInstallPct: number;
  /** Average order value, VAT inclusive. */
  avgOrderValueGbp: number;
  /** Gross margin on an install, %. */
  grossMarginPct: number;
}

export const DEFAULT_ASSUMPTIONS: CampaignAssumptions = {
  mailCostGbp: 0.85,
  responseRatePct: 2,
  quoteToInstallPct: 25,
  avgOrderValueGbp: 3400,
  grossMarginPct: 45,
};

export interface BusinessCase {
  mailed: number;
  mailCostGbp: number;
  expectedQuotes: number;
  expectedInstalls: number;
  expectedRevenueGbp: number;
  expectedGrossProfitGbp: number;
  costPerInstallGbp: number;
  /** Gross profit over mail cost. */
  roi: number;
}

/** The maths behind "should we mail this list?". */
export function businessCase(
  propertyCount: number,
  a: CampaignAssumptions = DEFAULT_ASSUMPTIONS,
): BusinessCase {
  const mailCostGbp = propertyCount * a.mailCostGbp;
  const expectedQuotes = (propertyCount * a.responseRatePct) / 100;
  const expectedInstalls = (expectedQuotes * a.quoteToInstallPct) / 100;
  const expectedRevenueGbp = expectedInstalls * a.avgOrderValueGbp;
  const expectedGrossProfitGbp = (expectedRevenueGbp * a.grossMarginPct) / 100;
  return {
    mailed: propertyCount,
    mailCostGbp: Math.round(mailCostGbp),
    expectedQuotes: Math.round(expectedQuotes * 10) / 10,
    expectedInstalls: Math.round(expectedInstalls * 10) / 10,
    expectedRevenueGbp: Math.round(expectedRevenueGbp),
    expectedGrossProfitGbp: Math.round(expectedGrossProfitGbp),
    costPerInstallGbp: expectedInstalls > 0 ? Math.round(mailCostGbp / expectedInstalls) : 0,
    roi: mailCostGbp > 0 ? Math.round((expectedGrossProfitGbp / mailCostGbp) * 10) / 10 : 0,
  };
}
