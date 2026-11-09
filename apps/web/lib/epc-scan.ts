/**
 * Counting pass over the EPC download, before anything is saved: how many
 * homes and certificates each London postcode district (outcode) holds, and
 * roughly how much database space they'd take. The admin then ticks which
 * districts to save.
 *
 * Runs in the browser over every certificate in England and Wales (about 25
 * million rows), so it reads only what it must: the postcode of every row,
 * and the address and UPRN of London rows. Homes (not certificates) are
 * counted with a HyperLogLog sketch per district: a few kilobytes each,
 * within about 2% of the true count, and mergeable, so a stopped count can
 * carry on and its result can be kept in the browser.
 */

import { addressKey, outcodeOf, splitCsvRecord, tidyPostcode, type EpcColumnMap } from "./epc-import";

/* ------------------------------------------------------------------ */
/* London                                                              */
/* ------------------------------------------------------------------ */

/** Postcode areas covering London. The outer ones also reach beyond Greater London. */
export const LONDON_AREAS: { area: string; name: string; outer?: boolean }[] = [
  { area: "EC", name: "City of London" },
  { area: "WC", name: "West Central" },
  { area: "E", name: "East London" },
  { area: "N", name: "North London" },
  { area: "NW", name: "North West London" },
  { area: "SE", name: "South East London" },
  { area: "SW", name: "South West London" },
  { area: "W", name: "West London" },
  { area: "BR", name: "Bromley", outer: true },
  { area: "CR", name: "Croydon", outer: true },
  { area: "DA", name: "Dartford and Bexley", outer: true },
  { area: "EN", name: "Enfield", outer: true },
  { area: "HA", name: "Harrow", outer: true },
  { area: "IG", name: "Ilford", outer: true },
  { area: "KT", name: "Kingston", outer: true },
  { area: "RM", name: "Romford", outer: true },
  { area: "SM", name: "Sutton", outer: true },
  { area: "TW", name: "Twickenham", outer: true },
  { area: "UB", name: "Southall and Uxbridge", outer: true },
];
const LONDON = new Set(LONDON_AREAS.map((a) => a.area));

/** "SW16" → "SW", "E3" → "E", "EC1A" → "EC". */
export function areaOf(outcode: string): string {
  return outcode.match(/^[A-Z]+/)?.[0] ?? "";
}
export const isLondonOutcode = (outcode: string) => LONDON.has(areaOf(outcode));

/** Database space per home saved: the record (about 1.5 KB with its indexes) plus its history note. */
export const BYTES_PER_HOME = 1_600;
/** Supabase's free plan: 500 MB for everything. */
export const FREE_PLAN_BYTES = 500_000_000;

/* ------------------------------------------------------------------ */
/* Reading one field without splitting the whole row                   */
/* ------------------------------------------------------------------ */

/** The `index`th field of a CSV record, reading only as far as it. */
export function fieldAt(raw: string, index: number): string {
  let field = 0;
  let i = 0;
  while (field < index) {
    if (i >= raw.length) return "";
    if (raw.charCodeAt(i) === 34 /* " */) {
      // A quoted field: skip to its closing quote (a doubled quote is an escaped one).
      for (i++; i < raw.length; i++) {
        if (raw.charCodeAt(i) === 34) {
          if (raw.charCodeAt(i + 1) === 34) i++;
          else break;
        }
      }
    }
    const comma = raw.indexOf(",", i);
    if (comma < 0) return "";
    i = comma + 1;
    field++;
  }
  if (raw.charCodeAt(i) === 34) {
    let out = "";
    for (i++; i < raw.length; i++) {
      const c = raw[i];
      if (c === '"') {
        if (raw[i + 1] === '"') {
          out += '"';
          i++;
        } else break;
      } else out += c;
    }
    return out;
  }
  const comma = raw.indexOf(",", i);
  return raw.slice(i, comma < 0 ? raw.length : comma).trim();
}

/* ------------------------------------------------------------------ */
/* Counting distinct homes: HyperLogLog                                 */
/* ------------------------------------------------------------------ */

const P = 12; // 4,096 registers: about 1.6% typical error, 4 KB per district
const M = 1 << P;

/** A 32-bit hash with good mixing (FNV-1a, then MurmurHash3's finaliser). */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export class HomeCounter {
  readonly registers: Uint8Array;

  constructor(registers?: Uint8Array) {
    this.registers = registers ?? new Uint8Array(M);
  }

  add(id: string) {
    const h = hash32(id);
    const index = h >>> (32 - P);
    const rest = (h << P) >>> 0;
    const rank = rest === 0 ? 32 - P + 1 : Math.clz32(rest) + 1;
    if (rank > this.registers[index]) this.registers[index] = rank;
  }

  merge(other: HomeCounter) {
    for (let i = 0; i < M; i++) if (other.registers[i] > this.registers[i]) this.registers[i] = other.registers[i];
  }

  estimate(): number {
    let sum = 0;
    let zeros = 0;
    for (let i = 0; i < M; i++) {
      sum += 2 ** -this.registers[i];
      if (this.registers[i] === 0) zeros++;
    }
    const raw = ((0.7213 / (1 + 1.079 / M)) * M * M) / sum;
    // Small counts: linear counting is near exact.
    if (raw <= 2.5 * M && zeros > 0) return Math.round(M * Math.log(M / zeros));
    return Math.round(raw);
  }

  toBase64(): string {
    let s = "";
    for (let i = 0; i < M; i++) s += String.fromCharCode(this.registers[i]);
    return btoa(s);
  }

  static fromBase64(text: string): HomeCounter {
    const s = atob(text);
    const regs = new Uint8Array(M);
    for (let i = 0; i < Math.min(M, s.length); i++) regs[i] = s.charCodeAt(i);
    return new HomeCounter(regs);
  }
}

/* ------------------------------------------------------------------ */
/* The tally                                                           */
/* ------------------------------------------------------------------ */

export interface DistrictCount {
  outcode: string;
  certificates: number;
  homes: number;
  bytes: number;
}

export class LondonTally {
  private readonly certs = new Map<string, number>();
  private readonly homes = new Map<string, HomeCounter>();

  /** One certificate row (raw CSV text). Returns true when it was a London row. */
  addRow(raw: string, columns: EpcColumnMap): boolean {
    if (columns.postcode === undefined) return false;
    const postcode = fieldAt(raw, columns.postcode);
    if (postcode.length < 5) return false;
    const outcode = outcodeOf(postcode);
    if (!isLondonOutcode(outcode)) return false;
    this.certs.set(outcode, (this.certs.get(outcode) ?? 0) + 1);

    // The same identity the import uses: the UPRN, else the address.
    const fields = splitCsvRecord(raw);
    const uprn = columns.uprn !== undefined ? (fields[columns.uprn] ?? "").trim() : "";
    let id: string;
    if (/^\d{1,12}$/.test(uprn)) id = `u${uprn}`;
    else {
      const a1 = columns.address1 !== undefined ? (fields[columns.address1] ?? "").trim() : "";
      const a2 = columns.address2 !== undefined ? (fields[columns.address2] ?? "").trim() : "";
      const whole = columns.address !== undefined ? (fields[columns.address] ?? "").trim() : "";
      id = `a${addressKey([a1, a2].filter(Boolean).join(", ") || whole, tidyPostcode(postcode))}`;
    }
    let counter = this.homes.get(outcode);
    if (!counter) {
      counter = new HomeCounter();
      this.homes.set(outcode, counter);
    }
    counter.add(id);
    return true;
  }

  merge(other: LondonTally) {
    for (const [o, n] of other.certs) this.certs.set(o, (this.certs.get(o) ?? 0) + n);
    for (const [o, c] of other.homes) {
      const mine = this.homes.get(o);
      if (mine) mine.merge(c);
      else this.homes.set(o, new HomeCounter(new Uint8Array(c.registers)));
    }
  }

  /** Every London district seen, in postcode order (SW2 before SW16). */
  districts(): DistrictCount[] {
    return [...this.certs.keys()]
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
      .map((outcode) => {
        const certificates = this.certs.get(outcode) ?? 0;
        // A sketch can't count more homes than certificates.
        const homes = Math.min(certificates, this.homes.get(outcode)?.estimate() ?? 0);
        return { outcode, certificates, homes, bytes: homes * BYTES_PER_HOME };
      });
  }

  toJSON(): { certs: Record<string, number>; homes: Record<string, string> } {
    return {
      certs: Object.fromEntries(this.certs),
      homes: Object.fromEntries([...this.homes].map(([o, c]) => [o, c.toBase64()])),
    };
  }

  static fromJSON(data: { certs: Record<string, number>; homes: Record<string, string> }): LondonTally {
    const t = new LondonTally();
    for (const [o, n] of Object.entries(data.certs ?? {})) t.certs.set(o, n);
    for (const [o, b] of Object.entries(data.homes ?? {})) t.homes.set(o, HomeCounter.fromBase64(b));
    return t;
  }
}

/** "1.2 GB", "340 MB", "12 MB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e7) return `${Math.round(bytes / 1e6)} MB`;
  return `${(bytes / 1e6).toFixed(1)} MB`;
}
