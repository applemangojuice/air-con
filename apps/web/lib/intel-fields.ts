/**
 * What the property book stores about each home, what the app uses each
 * piece for, and how to slim a stored record down to what's used.
 *
 * Shared by the import (which stores only used fields), the Data preview page
 * (/ops/intel/data: fill rates, sample values and space per field) and the
 * slimming route (which removes unused fields from homes already saved).
 */

import type { PropertyIntel } from "@aircon/domain";

export interface IntelField {
  path: string;
  label: string;
  /** What the app uses it for, or null when nothing reads it. */
  usedFor: string | null;
}

export const INTEL_FIELDS: IntelField[] = [
  { path: "address.line1", label: "Address", usedFor: "the quote form's address list, letters and landing pages" },
  { path: "address.postcode", label: "Postcode", usedFor: "finding homes at a postcode" },
  { path: "uprn", label: "Property ID (UPRN)", usedFor: "matching the same home across certificates and sources" },
  { path: "epc.propertyType", label: "Property type", usedFor: "the home's install pattern and the quote's prefill" },
  { path: "epc.builtForm", label: "Built form", usedFor: "the install pattern (terrace, semi, detached)" },
  { path: "epc.constructionAgeBand", label: "Age band", usedFor: "the home's era, for the install pattern and prefill" },
  { path: "epc.totalFloorAreaM2", label: "Floor area", usedFor: "the size prefill and the floor-area filter" },
  { path: "epc.habitableRooms", label: "Habitable rooms", usedFor: "the bedrooms prefill" },
  { path: "epc.glazingDescription", label: "Glazing", usedFor: "the \"double glazed\" line on letters and landing pages" },
  { path: "epc.currentRating", label: "Energy rating", usedFor: "the rating filter and letters" },
  { path: "epc.lodgedAt", label: "Certificate date", usedFor: "keeping the newest certificate; recently-certified targeting" },
  { path: "epc.wallDescription", label: "Walls", usedFor: null },
  { path: "epc.roofDescription", label: "Roof", usedFor: null },
  { path: "epc.mainHeatDescription", label: "Main heating", usedFor: null },
  { path: "epc.hotWaterDescription", label: "Hot water", usedFor: null },
  { path: "epc.potentialRating", label: "Potential rating", usedFor: null },
  { path: "planning", label: "Planning flags", usedFor: "lofts and extensions found in planning applications" },
  { path: "constraints", label: "Constraints", usedFor: "conservation area, listed building and Article 4 checks" },
  { path: "marketing", label: "Marketing", usedFor: "priority, lead status and campaigns" },
  { path: "audit", label: "Our audit", usedFor: "your own survey notes on the home" },
];

/** EPC details nothing in the app reads: not stored by the import, removable from saved homes. */
export const UNUSED_EPC_KEYS = INTEL_FIELDS.filter((f) => f.usedFor === null).map((f) => f.path.replace(/^epc\./, ""));

/** "England and Wales: 1900-1929" → "1900-1929" (the era only needs the years). */
export function shortAgeBand(band: string): string {
  return band.replace(/^England and Wales:\s*/i, "").trim();
}

/** A record without unused EPC details, empty values or the long age-band prefix. */
export function slimIntel(intel: PropertyIntel): { intel: PropertyIntel; changed: boolean } {
  if (!intel.epc) return { intel, changed: false };
  const epc: Record<string, unknown> = { ...intel.epc };
  let changed = false;
  for (const key of Object.keys(epc)) {
    const v = epc[key];
    if (UNUSED_EPC_KEYS.includes(key) || v === "" || v === null || v === undefined) {
      delete epc[key];
      changed = true;
    }
  }
  if (typeof epc.constructionAgeBand === "string") {
    const short = shortAgeBand(epc.constructionAgeBand);
    if (short !== epc.constructionAgeBand) {
      epc.constructionAgeBand = short;
      changed = true;
    }
  }
  return changed ? { intel: { ...intel, epc: epc as PropertyIntel["epc"] }, changed } : { intel, changed };
}

/* ------------------------------------------------------------------ */
/* Space                                                               */
/* ------------------------------------------------------------------ */

/**
 * Measured on Postgres 16 with the properties table as migrated: a home's
 * row is its record (stored JSON is about 1.16 × its text length) plus about
 * 253 bytes of row and columns; the indexes add about 134; a bulk-import
 * history note about 275.
 */
export const SPACE = { jsonFactor: 1.16, rowOverhead: 253, indexes: 134, historyNote: 275 } as const;

export function getPath(intel: unknown, path: string): unknown {
  let v: unknown = intel;
  for (const part of path.split(".")) {
    if (v === null || typeof v !== "object") return undefined;
    v = (v as Record<string, unknown>)[part];
  }
  return v;
}

export interface FieldStats extends IntelField {
  filled: number;
  /** Share of sampled homes with a value, 0 to 1. */
  fillRate: number;
  /** Average stored bytes per home (key and value), over all sampled homes. */
  bytesPerHome: number;
  /** Most common values (strings and numbers only). */
  top: { value: string; count: number }[];
}

export function fieldStats(sample: PropertyIntel[]): FieldStats[] {
  return INTEL_FIELDS.map((f) => {
    let filled = 0;
    let bytes = 0;
    const counts = new Map<string, number>();
    const key = f.path.split(".").pop()!;
    for (const intel of sample) {
      const v = getPath(intel, f.path);
      if (v === undefined || v === null || v === "") continue;
      filled++;
      bytes += JSON.stringify(v).length + key.length + 4;
      if (typeof v === "string" || typeof v === "number") counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
    }
    const top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([value, count]) => ({ value, count }));
    return {
      ...f,
      filled,
      fillRate: sample.length ? filled / sample.length : 0,
      bytesPerHome: sample.length ? (bytes / sample.length) * SPACE.jsonFactor : 0,
      top,
    };
  });
}

/** Estimated bytes per home for these records as stored (row, record and indexes, no history). */
export function bytesPerHome(sample: PropertyIntel[]): number {
  if (sample.length === 0) return 0;
  const json = sample.reduce((t, i) => t + JSON.stringify(i).length, 0) / sample.length;
  return json * SPACE.jsonFactor + SPACE.rowOverhead + SPACE.indexes;
}
