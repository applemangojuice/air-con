/**
 * EPC bulk import, shared by the browser and the server.
 *
 * The government's bulk download is one CSV per year (certificates-2008.csv
 * … certificates-2026.csv, about 8.6 GB in all). The browser reads those
 * files a piece at a time on the admin's own computer, keeps only the rows in
 * the outcodes asked for, and posts them in small batches. The server turns
 * each row into a property record with the same rules as
 * scripts/import-intel.mjs: the newest certificate per home wins, and
 * planning, constraints, audit and marketing already on a record survive.
 *
 * Nothing here touches the network or the database, so the browser can load it.
 */

import { normaliseAddress, type PropertyIntel } from "@aircon/domain";

/* ------------------------------------------------------------------ */
/* Columns                                                             */
/* ------------------------------------------------------------------ */

/** "address_line_1", "Address Line 1" and "ADDRESS-LINE-1" all become ADDRESS_LINE_1. */
export function normaliseHeader(h: string): string {
  return h
    .replace(/^﻿/, "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * The fields the import uses, each with the column names it may arrive
 * under. The first names are the register's long-standing ones; the rest
 * cover the renamings a new download service might make.
 */
export const EPC_FIELDS = {
  postcode: ["POSTCODE", "POST_CODE"],
  address1: ["ADDRESS1", "ADDRESS_LINE_1", "ADDRESS_LINE1", "ADDRESS_1"],
  address2: ["ADDRESS2", "ADDRESS_LINE_2", "ADDRESS_LINE2", "ADDRESS_2"],
  address: ["ADDRESS", "FULL_ADDRESS"],
  uprn: ["UPRN"],
  lodged: ["LODGEMENT_DATE", "LODGEMENT_DATETIME", "REGISTRATION_DATE", "INSPECTION_DATE"],
  propertyType: ["PROPERTY_TYPE"],
  builtForm: ["BUILT_FORM"],
  ageBand: ["CONSTRUCTION_AGE_BAND"],
  floorArea: ["TOTAL_FLOOR_AREA", "TOTAL_FLOOR_AREA_M2"],
  rooms: ["NUMBER_HABITABLE_ROOMS", "HABITABLE_ROOMS"],
  walls: ["WALLS_DESCRIPTION", "WALL_DESCRIPTION"],
  roof: ["ROOF_DESCRIPTION"],
  windows: ["WINDOWS_DESCRIPTION", "GLAZED_TYPE"],
  heating: ["MAINHEAT_DESCRIPTION", "MAIN_HEATING_DESCRIPTION"],
  hotWater: ["HOTWATER_DESCRIPTION", "HOT_WATER_DESCRIPTION"],
  currentRating: ["CURRENT_ENERGY_RATING", "CURRENT_ENERGY_EFFICIENCY_BAND", "ENERGY_RATING_CURRENT"],
  potentialRating: ["POTENTIAL_ENERGY_RATING", "POTENTIAL_ENERGY_EFFICIENCY_BAND", "ENERGY_RATING_POTENTIAL"],
} as const;

export type EpcField = keyof typeof EPC_FIELDS;
/** One certificate, reduced to the fields we keep. */
export type EpcRow = Partial<Record<EpcField, string>>;
export const EPC_FIELD_NAMES = Object.keys(EPC_FIELDS) as EpcField[];

/** Rows per upload request: well under the host's request-size limit (about 4.5 MB). */
export const EPC_BATCH_MAX = 1000;
/** What the browser sends per request. */
export const EPC_BATCH_SIZE = 500;

/** Which column index holds each field, from a file's header row. */
export type EpcColumnMap = Partial<Record<EpcField, number>>;

export function mapEpcColumns(header: string[]): EpcColumnMap {
  const index = new Map(header.map((h, i) => [normaliseHeader(h), i] as const));
  const map: EpcColumnMap = {};
  for (const field of EPC_FIELD_NAMES) {
    for (const name of EPC_FIELDS[field]) {
      const i = index.get(name);
      if (i !== undefined) {
        map[field] = i;
        break;
      }
    }
  }
  return map;
}

/** What a file is missing to be importable, in words an admin can act on (empty = fine). */
export function epcColumnProblems(map: EpcColumnMap): string[] {
  const problems: string[] = [];
  if (map.postcode === undefined) problems.push("no postcode column (looked for POSTCODE)");
  if (map.address1 === undefined && map.address === undefined) {
    problems.push("no address column (looked for ADDRESS1 or ADDRESS)");
  }
  return problems;
}

export function epcRowFromFields(fields: string[], map: EpcColumnMap): EpcRow {
  const row: EpcRow = {};
  for (const field of EPC_FIELD_NAMES) {
    const i = map[field];
    if (i === undefined) continue;
    const value = (fields[i] ?? "").trim();
    if (value) row[field] = value.slice(0, 500);
  }
  return row;
}

/* ------------------------------------------------------------------ */
/* Postcodes                                                           */
/* ------------------------------------------------------------------ */

export function outcodeOf(postcode: string): string {
  const clean = postcode.toUpperCase().replace(/\s+/g, "");
  return clean.length > 3 ? clean.slice(0, -3) : clean;
}

/** "SW16 1AD" with one space, whatever spacing the file used. */
export function tidyPostcode(postcode: string): string {
  const clean = postcode.toUpperCase().replace(/\s+/g, "");
  return clean.length > 3 ? `${clean.slice(0, -3)} ${clean.slice(-3)}` : clean;
}

/** "sw16, SW17 sw2" → ["SW16", "SW17", "SW2"]. */
export function parseOutcodes(text: string): string[] {
  return [...new Set(text.toUpperCase().split(/[\s,;]+/).filter((o) => /^[A-Z]{1,2}[0-9][0-9A-Z]?$/.test(o)))];
}

/* ------------------------------------------------------------------ */
/* Streaming CSV                                                       */
/* ------------------------------------------------------------------ */

/**
 * Splits CSV text into records as it arrives, a chunk at a time, so a file of
 * any size never has to be held in memory. A quoted field may hold commas,
 * doubled quotes and line breaks, and may be split across chunks.
 *
 * `wanted` is a cheap pre-check on a record's raw text: records that fail it
 * are skipped without being split into fields, which is what makes a
 * whole-country file quick to filter down to a few postcodes.
 */
export class CsvRecordStream {
  private buffer = "";
  private header: string[] | null = null;

  private readonly wanted: (rawRecord: string) => boolean;

  constructor(wanted: (rawRecord: string) => boolean = () => true) {
    this.wanted = wanted;
  }

  /** Feed text; get back the header (once, when first seen) and the wanted records' fields. */
  push(text: string): { header?: string[]; records: string[][]; scanned: number } {
    this.buffer += text;
    return this.drain(false);
  }

  /** The file has ended: whatever is left is the last record. */
  end(): { header?: string[]; records: string[][]; scanned: number } {
    return this.drain(true);
  }

  private drain(final: boolean): { header?: string[]; records: string[][]; scanned: number } {
    const records: string[][] = [];
    let header: string[] | undefined;
    let scanned = 0;
    let start = 0;
    let inQuotes = false;
    const buf = this.buffer;
    for (let i = 0; i < buf.length; i++) {
      const c = buf.charCodeAt(i);
      if (c === 34 /* " */) inQuotes = !inQuotes; // a doubled quote toggles twice: no change
      else if (c === 10 /* \n */ && !inQuotes) {
        const raw = buf.slice(start, buf.charCodeAt(i - 1) === 13 ? i - 1 : i);
        start = i + 1;
        if (raw.length === 0) continue;
        if (!this.header) {
          this.header = splitCsvRecord(raw);
          header = this.header;
          continue;
        }
        scanned++;
        if (this.wanted(raw)) records.push(splitCsvRecord(raw));
      }
    }
    this.buffer = buf.slice(start);
    if (final && this.buffer.trim().length > 0) {
      const raw = this.buffer.replace(/\r$/, "");
      this.buffer = "";
      if (!this.header) {
        this.header = splitCsvRecord(raw);
        header = this.header;
      } else {
        scanned++;
        if (this.wanted(raw)) records.push(splitCsvRecord(raw));
      }
    }
    return { header, records, scanned };
  }
}

/** One complete CSV record → its fields. */
export function splitCsvRecord(raw: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inQuotes) {
      if (c === '"') {
        if (raw[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      fields.push(field);
      field = "";
    } else field += c;
  }
  fields.push(field);
  return fields;
}

/** A cheap "might this record be in one of these outcodes?" check on raw text. */
export function outcodePrefilter(outcodes: string[]): (raw: string) => boolean {
  if (outcodes.length === 0) return () => true;
  const needles = outcodes.map((o) => o.toUpperCase());
  return (raw) => {
    const upper = raw.toUpperCase();
    return needles.some((n) => upper.includes(n));
  };
}

/* ------------------------------------------------------------------ */
/* Certificate → property record                                       */
/* ------------------------------------------------------------------ */

export const addressKey = (line1: string, postcode: string) =>
  `${normaliseAddress(line1)} ${postcode.toUpperCase().replace(/\s+/g, "")}`;

/** The importer script's synthetic id for a home with no UPRN (kept identical, so re-imports match). */
export function syntheticId(line1: string, postcode: string): string {
  const key = addressKey(line1, postcode);
  let hash = 5381;
  for (let i = 0; i < key.length; i++) hash = ((hash << 5) + hash + key.charCodeAt(i)) >>> 0;
  return `addr-${hash.toString(36)}-${key.replace(/[^A-Z0-9]/g, "").slice(0, 12).toLowerCase()}`;
}

/** Dates compare as text once they're ISO: "2019-03-04 10:20:00" → "2019-03-04". */
function isoDay(value: string | undefined): string {
  if (!value) return "";
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const uk = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (uk) return `${uk[3]}-${uk[2].padStart(2, "0")}-${uk[1].padStart(2, "0")}`;
  return value.slice(0, 10);
}

export interface EpcCandidate {
  key: string;
  lodged: string;
  intel: PropertyIntel;
}

/** One certificate → a fresh property record, or null when it has no usable postcode or address. */
export function epcCandidate(row: EpcRow, outcodes: string[] = []): EpcCandidate | null {
  const postcode = row.postcode ? tidyPostcode(row.postcode) : "";
  if (!postcode || postcode.length < 5) return null;
  const outcode = outcodeOf(postcode);
  if (outcodes.length > 0 && !outcodes.includes(outcode)) return null;
  const line1 = [row.address1, row.address2].filter(Boolean).join(", ") || row.address || "";
  if (!line1) return null;

  const lodged = isoDay(row.lodged);
  const uprn = row.uprn && /^\d{1,12}$/.test(row.uprn) ? row.uprn : undefined;
  const num = (v?: string) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : undefined);
  const intel: PropertyIntel = {
    id: uprn ?? syntheticId(line1, postcode),
    uprn,
    address: { line1, postcode, outcode },
    epc: {
      propertyType: row.propertyType ?? "",
      builtForm: row.builtForm ?? "",
      constructionAgeBand: row.ageBand ?? "",
      totalFloorAreaM2: num(row.floorArea),
      habitableRooms: num(row.rooms),
      wallDescription: row.walls ?? "",
      roofDescription: row.roof ?? "",
      glazingDescription: row.windows ?? "",
      mainHeatDescription: row.heating ?? "",
      hotWaterDescription: row.hotWater ?? "",
      currentRating: row.currentRating ?? "",
      potentialRating: row.potentialRating ?? "",
      lodgedAt: lodged || undefined,
    },
    planning: { loftConversion: false, rearExtension: false, sideExtension: false, garageConversion: false },
    constraints: { conservationArea: false, listedBuilding: false, article4: false },
    marketing: { leadStatus: "untouched" },
  };
  return { key: addressKey(line1, postcode), lodged, intel };
}

/** Within one batch: one candidate per home (by UPRN, else address), the newest certificate. */
export function newestPerHome(candidates: EpcCandidate[]): EpcCandidate[] {
  const best = new Map<string, EpcCandidate>();
  for (const c of candidates) {
    const id = c.intel.id;
    const prev = best.get(id);
    if (!prev || c.lodged >= prev.lodged) best.set(id, c);
  }
  return [...best.values()];
}

/**
 * Fold a fresh certificate into the record already held for that home.
 * Returns null when the held record has a newer certificate (the year files
 * arrive in any order). What we learned ourselves survives: planning,
 * constraints, audit, marketing, and the record's id.
 */
export function mergeEpc(fresh: EpcCandidate, prior: { id: string; intel: PropertyIntel } | undefined): PropertyIntel | null {
  if (!prior) return fresh.intel;
  const p = prior.intel;
  const priorLodged = isoDay(p.epc?.lodgedAt);
  if (priorLodged && fresh.lodged && priorLodged > fresh.lodged) return null;
  return {
    ...fresh.intel,
    id: prior.id,
    uprn: fresh.intel.uprn ?? p.uprn,
    planning: p.planning ?? fresh.intel.planning,
    constraints: p.constraints ?? fresh.intel.constraints,
    audit: p.audit,
    marketing: p.marketing ?? fresh.intel.marketing,
  };
}
