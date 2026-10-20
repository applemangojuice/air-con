/**
 * The equipment and materials catalogue, plus verified compatibility rules.
 *
 * Every item carries where its numbers came from and how sure we are:
 * `verified` (checked against a manufacturer source), `provisional`
 * (plausible, needs checking) or `stale`. Provisional items can be designed
 * with, but are labelled as such. Multi-split combinations are only allowed
 * when a compatibility rule says so; nothing is guessed.
 *
 * Foundation ships the types; F3 owns the logic and the demo data. The
 * researched seed (real model names, mostly provisional, mostly unpriced)
 * lives in catalogue-data.ts, generated from docs/research/data.
 */

export type CatalogueKind = "indoor" | "outdoor" | "material" | "labour" | "tool" | "service";

export const CATALOGUE_KINDS: CatalogueKind[] = ["indoor", "outdoor", "material", "labour", "tool", "service"];

export const CATALOGUE_KIND_LABEL: Record<CatalogueKind, string> = {
  indoor: "Indoor unit",
  outdoor: "Outdoor unit",
  material: "Material",
  labour: "Labour",
  tool: "Tool",
  service: "Service",
};

export interface EquipmentSpecs {
  coolingKw: number | null;
  heatingKw: number | null;
  seer: number | null;
  scop: number | null;
  energyClassCooling: string | null;
  energyClassHeating: string | null;
  soundPressureLowDb: number | null;
  soundPressureHighDb: number | null;
  soundPowerDb: number | null;
  dimensionsMm: { w: number; h: number; d: number } | null;
  weightKg: number | null;
  refrigerant: string | null;
  liquidPipeMm: number | null;
  gasPipeMm: number | null;
  maxPipeM: number | null;
  maxHeightDiffM: number | null;
  /**
   * The installation manual's limits beyond the maximum run (outdoor units;
   * null or absent = not on record, which the design reads as "check the
   * manual", never as a pass). The shortest run per indoor unit (a single
   * split's run, each branch of a multi-split), m.
   */
  minPipeM?: number | null;
  /** Multi-splits: the longest run to any one indoor unit, m. */
  maxPipePerBranchM?: number | null;
  /** Multi-splits: the shortest and the longest total of all the runs, m. */
  minTotalPipeM?: number | null;
  maxTotalPipeM?: number | null;
  /** Multi-splits: the most two indoor units on it may be apart in height, m. */
  maxIndoorHeightDiffM?: number | null;
  /** Multi-splits: the fewest indoor units it runs with. */
  minIndoorUnits?: number | null;
  /** Multi-splits: the least indoor capacity connected (cooling, kW). */
  minConnectedKw?: number | null;
  /**
   * Multi-splits: each outdoor port's liquid/gas size, mm, from the manual
   * ("A 6.35/9.52, B 6.35/9.52, C 6.35/12.7"). Where a port differs from the
   * indoor unit's pipe, the design adds a reducer (parsePortSizes). Blank:
   * not on record, and the runsheet says to check the manual.
   */
  portSizesMm?: string | null;
  prechargedPipeM: number | null;
  additionalChargeGPerM: number | null;
  /** Outdoor units: the refrigerant charged at the factory (nameplate), kg. With the added charge it sets the R32 minimum room size. */
  factoryChargeKg?: number | null;
  /** Indoor units: the release height h0 for the R32 room-size check (wall 1.8 m, floor 0.6 m, ceiling 2.2 m). */
  releaseHeightM?: number | null;
  powerSupply: string | null;
  recommendedBreakerA: number | null;
  wifi: string | null;
  operatingRangeCoolingC: string | null;
  operatingRangeHeatingC: string | null;
}

/** Every spec key, in display order, with how to show it. */
export const SPEC_FIELDS: { key: keyof EquipmentSpecs; label: string; unit?: string; kind: "number" | "text" | "dimensions" }[] = [
  { key: "coolingKw", label: "Cooling capacity", unit: "kW", kind: "number" },
  { key: "heatingKw", label: "Heating capacity", unit: "kW", kind: "number" },
  { key: "seer", label: "SEER", kind: "number" },
  { key: "scop", label: "SCOP", kind: "number" },
  { key: "energyClassCooling", label: "Energy class (cooling)", kind: "text" },
  { key: "energyClassHeating", label: "Energy class (heating)", kind: "text" },
  { key: "soundPressureLowDb", label: "Sound pressure, lowest", unit: "dB(A)", kind: "number" },
  { key: "soundPressureHighDb", label: "Sound pressure, highest", unit: "dB(A)", kind: "number" },
  { key: "soundPowerDb", label: "Sound power (LWA)", unit: "dB(A)", kind: "number" },
  { key: "dimensionsMm", label: "Dimensions W × H × D", unit: "mm", kind: "dimensions" },
  { key: "weightKg", label: "Weight", unit: "kg", kind: "number" },
  { key: "refrigerant", label: "Refrigerant", kind: "text" },
  { key: "liquidPipeMm", label: "Liquid pipe", unit: "mm", kind: "number" },
  { key: "gasPipeMm", label: "Gas pipe", unit: "mm", kind: "number" },
  { key: "maxPipeM", label: "Maximum pipe length", unit: "m", kind: "number" },
  { key: "maxHeightDiffM", label: "Maximum height difference, outdoor to indoor", unit: "m", kind: "number" },
  { key: "minPipeM", label: "Minimum pipe length per indoor unit", unit: "m", kind: "number" },
  { key: "maxPipePerBranchM", label: "Maximum pipe length per indoor unit (multi-split)", unit: "m", kind: "number" },
  { key: "minTotalPipeM", label: "Minimum total pipe length (multi-split)", unit: "m", kind: "number" },
  { key: "maxTotalPipeM", label: "Maximum total pipe length (multi-split)", unit: "m", kind: "number" },
  { key: "maxIndoorHeightDiffM", label: "Maximum height between indoor units (multi-split)", unit: "m", kind: "number" },
  { key: "minIndoorUnits", label: "Fewest indoor units connected (multi-split)", kind: "number" },
  { key: "minConnectedKw", label: "Minimum connected indoor capacity (multi-split)", unit: "kW", kind: "number" },
  { key: "portSizesMm", label: "Outdoor port sizes per branch, liquid/gas (multi-split), e.g. A 6.35/9.52, B 6.35/12.7", unit: "mm", kind: "text" },
  { key: "prechargedPipeM", label: "Pre-charged (chargeless) pipe length", unit: "m", kind: "number" },
  { key: "additionalChargeGPerM", label: "Additional charge per metre", unit: "g/m", kind: "number" },
  { key: "factoryChargeKg", label: "Factory refrigerant charge", unit: "kg", kind: "number" },
  { key: "releaseHeightM", label: "Indoor unit height for the R32 room-size check", unit: "m", kind: "number" },
  { key: "powerSupply", label: "Power supply", kind: "text" },
  { key: "recommendedBreakerA", label: "Recommended breaker", unit: "A", kind: "number" },
  { key: "wifi", label: "Wi-Fi / app", kind: "text" },
  { key: "operatingRangeCoolingC", label: "Operating range, cooling", unit: "°C", kind: "text" },
  { key: "operatingRangeHeatingC", label: "Operating range, heating", unit: "°C", kind: "text" },
];

/** One outdoor port of a multi-split, as the catalogue records it. */
export interface PortSize {
  port: string;
  liquidMm: number;
  gasMm: number;
}

/**
 * The ports in a catalogue item's `portSizesMm`: entries split by commas or
 * semicolons, each "A 6.35/9.52" (or just "6.35/9.52", lettered in order).
 * Null when blank, or when any entry can't be read (never half a list).
 */
export function parsePortSizes(text: string | null | undefined): PortSize[] | null {
  const raw = (text ?? "").trim();
  if (!raw) return null;
  const out: PortSize[] = [];
  for (const [i, part] of raw.split(/[,;]+/).map((x) => x.trim()).filter(Boolean).entries()) {
    const m = part.match(/^(?:([A-Za-z0-9]{1,3})\s*[:=]?\s+)?(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
    if (!m) return null;
    const liquidMm = Number(m[2]);
    const gasMm = Number(m[3]);
    if (!(liquidMm > 0 && gasMm > 0 && liquidMm <= 30 && gasMm <= 40)) return null;
    out.push({ port: m[1] ?? String.fromCharCode(65 + i), liquidMm, gasMm });
  }
  return out.length ? out : null;
}

export interface CatalogueItem {
  id: string;
  kind: CatalogueKind;
  manufacturer?: string;
  series?: string;
  model?: string;
  label: string;
  tier?: "standard" | "premium";
  multiSplitCapable?: boolean;
  ports?: number | null;
  pairedWith?: string | null;
  specs?: Partial<EquipmentSpecs>;
  unit?: string;
  category?: string;
  customerBlurb?: string;
  costPence: number | null;
  costSource?: { url?: string; supplier?: string; observedAt?: string; vatIncluded?: boolean; note?: string };
  supplier?: string;
  status: "available" | "uncertain" | "discontinued";
  confidence: "verified" | "provisional" | "stale";
  verifiedAt?: string;
  sources: { url: string; title?: string }[];
  warranty?: string | null;
  notes?: string;
  active: boolean;
}

export interface CompatibilityRule {
  id: string;
  outdoorModel: string;
  maxIndoorUnits: number;
  connectableIndoorSeries: string[];
  connectableIndoorModels: string[];
  minConnectedKw: number | null;
  maxConnectedKw: number | null;
  maxTotalPipeM: number | null;
  maxPipePerRoomM: number | null;
  source: { url: string; title?: string } | null;
  confidence: "verified" | "provisional";
  /** Additive (F3): the brand, for the rules list. */
  manufacturer?: string;
  /** Additive (F3): how the list was put together, and what to check. */
  notes?: string;
}

export interface CombinationCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

const round1 = (n: number) => Math.round(n * 10) / 10;

/** "2.5 kW", "3.3 kW". */
export function fmtKw(kw: number): string {
  return `${round1(kw).toFixed(1)} kW`;
}

/** The name staff see in pickers: "Panasonic Etherea 2.5 kW · CS-Z25CKEW". */
export function itemDisplayName(item: Pick<CatalogueItem, "label" | "model">): string {
  return item.model && !item.label.includes(item.model) ? `${item.label} · ${item.model}` : item.label;
}

/** Usable in a new design: retired and discontinued items aren't. */
export function isSelectable(item: CatalogueItem): boolean {
  return item.active && item.status !== "discontinued";
}

/**
 * Model patterns in a rule: exact (case-insensitive), or with `*` standing
 * for any run of characters ("MSZ-AY*VGK"). Nothing fuzzier than that.
 */
export function modelMatches(pattern: string, model: string | undefined): boolean {
  const p = norm(pattern);
  const m = norm(model);
  if (!p || !m) return false;
  if (!p.includes("*")) return p === m;
  const re = new RegExp(`^${p.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
  return re.test(m);
}

/** Is this indoor unit on the rule's list, by model (or pattern) or by exact series name? */
export function isConnectable(rule: CompatibilityRule, indoor: CatalogueItem): boolean {
  if (rule.connectableIndoorModels.some((pattern) => modelMatches(pattern, indoor.model) || norm(pattern) === norm(indoor.id))) return true;
  return Boolean(indoor.series) && rule.connectableIndoorSeries.some((s) => norm(s) === norm(indoor.series));
}

/** The rule for an outdoor unit, matched on its model code (or its catalogue id). */
export function findRule(outdoor: Pick<CatalogueItem, "id" | "model">, rules: CompatibilityRule[]): CompatibilityRule | undefined {
  return (
    rules.find((r) => outdoor.model && norm(r.outdoorModel) === norm(outdoor.model)) ??
    rules.find((r) => norm(r.outdoorModel) === norm(outdoor.id))
  );
}

/** Takes more than one indoor unit. */
export function isMultiOutdoor(item: CatalogueItem): boolean {
  return item.kind === "outdoor" && (item.multiSplitCapable === true || (item.ports ?? 1) > 1) && (item.ports ?? 2) > 1;
}

const kwOf = (item: CatalogueItem): number | null => {
  const kw = item.specs?.coolingKw;
  return typeof kw === "number" && Number.isFinite(kw) ? kw : null;
};

const codeOf = (item: CatalogueItem) => item.model ?? item.label;

/* ------------------------------------------------------------------ */
/* Compatibility                                                       */
/* ------------------------------------------------------------------ */

export const UNVERIFIED_COMBINATION = "Unverified combination — needs the manufacturer's combination table";

/** The warning every provisional multi-split rule carries, so approval can look for it. */
export const PROVISIONAL_RULE_WARNING =
  "Provisional rule: this combination list isn't the manufacturer's official table. A technical lead must check the combination table before approval.";

/**
 * Can this outdoor unit drive these indoor units over these pipe runs?
 * `pipeRunsM` is one run per indoor unit, in the same order.
 *
 * One indoor unit with no rule is a single split: it must be the outdoor
 * unit's listed pair. More than one needs a rule, and a missing rule is an
 * error, never a guess. A provisional rule passes with a warning, which the
 * design approval turns into a required tech-lead acknowledgement.
 */
export function validateCombination(
  rule: CompatibilityRule | undefined,
  outdoor: CatalogueItem,
  indoors: CatalogueItem[],
  pipeRunsM: number[],
): CombinationCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const outCode = codeOf(outdoor);

  if (outdoor.kind !== "outdoor") errors.push(`${outdoor.label} isn't an outdoor unit.`);
  if (indoors.length === 0) errors.push(`No indoor units are connected to ${outCode}.`);
  for (const item of [outdoor, ...indoors]) {
    if (item.status === "discontinued") errors.push(`${codeOf(item)} is discontinued.`);
    else if (!item.active) errors.push(`${codeOf(item)} has been retired from the catalogue.`);
    else if (item.status === "uncertain") warnings.push(`Availability of ${codeOf(item)} is uncertain: confirm with the supplier before ordering.`);
  }
  const notIndoor = indoors.filter((i) => i.kind !== "indoor");
  for (const i of notIndoor) errors.push(`${i.label} isn't an indoor unit.`);

  const runs = indoors.map((_, i) => pipeRunsM[i]);
  const knownRuns = runs.filter((r): r is number => typeof r === "number" && Number.isFinite(r));
  const totalPipe = round1(knownRuns.reduce((s, r) => s + r, 0));

  if (!rule) {
    if (indoors.length > 1) {
      errors.push(UNVERIFIED_COMBINATION);
      return { ok: false, errors: dedupe(errors), warnings: dedupe(warnings) };
    }
    const indoor = indoors[0];
    if (indoor && indoor.kind === "indoor") {
      const paired = pairsWith(indoor, outdoor);
      if (!paired) errors.push(`${outCode} isn't listed as the pair for ${codeOf(indoor)}. Pick its paired outdoor unit, or add a compatibility rule with its source.`);
      if (isMultiOutdoor(outdoor) && !paired) warnings.push(`${outCode} is a multi-split outdoor unit: a single room on it needs the manufacturer's minimum connected capacity checked.`);
    }
    const max = outdoor.specs?.maxPipeM;
    const run = knownRuns[0];
    if (typeof max === "number" && typeof run === "number") {
      if (run > max) errors.push(`Pipe run ${round1(run)} m is over ${outCode}'s ${max} m limit.`);
    } else if (indoors.length === 1) {
      warnings.push(`No maximum pipe length on record for ${outCode}: check the installation manual.`);
    }
    return { ok: errors.length === 0, errors: dedupe(errors), warnings: dedupe(warnings) };
  }

  // A rule applies: ports, the list, connected capacity, pipe limits.
  const ports = outdoor.ports ?? null;
  if (indoors.length > rule.maxIndoorUnits) {
    errors.push(`${rule.outdoorModel} takes up to ${rule.maxIndoorUnits} indoor unit${rule.maxIndoorUnits === 1 ? "" : "s"}; this has ${indoors.length}.`);
  } else if (ports !== null && indoors.length > ports) {
    errors.push(`${outCode} has ${ports} port${ports === 1 ? "" : "s"}; this has ${indoors.length} indoor units.`);
  }
  for (const indoor of indoors.filter((i) => i.kind === "indoor")) {
    if (!isConnectable(rule, indoor)) errors.push(`${codeOf(indoor)} isn't on ${rule.outdoorModel}'s list of connectable indoor units.`);
  }

  const kws = indoors.map(kwOf);
  if (kws.some((k) => k === null)) {
    const unknown = indoors.filter((i) => kwOf(i) === null).map(codeOf);
    warnings.push(`Capacity unknown for ${unknown.join(", ")}, so the connected-capacity range can't be checked.`);
  } else {
    const sum = round1(kws.reduce<number>((s, k) => s + (k ?? 0), 0));
    if (rule.minConnectedKw !== null && sum < rule.minConnectedKw) {
      errors.push(`Connected capacity ${fmtKw(sum)} is below ${rule.outdoorModel}'s minimum of ${fmtKw(rule.minConnectedKw)}.`);
    }
    if (rule.maxConnectedKw !== null && sum > rule.maxConnectedKw) {
      errors.push(`Connected capacity ${fmtKw(sum)} is above ${rule.outdoorModel}'s maximum of ${fmtKw(rule.maxConnectedKw)}.`);
    }
  }
  if (rule.minConnectedKw === null || rule.maxConnectedKw === null) {
    warnings.push(`No ${rule.minConnectedKw === null && rule.maxConnectedKw === null ? "connected-capacity range" : rule.minConnectedKw === null ? "minimum connected capacity" : "maximum connected capacity"} on record for ${rule.outdoorModel}: check the manufacturer's table.`);
  }

  if (knownRuns.length < indoors.length) warnings.push("Some pipe runs aren't known, so the pipe limits can't be fully checked.");
  if (rule.maxTotalPipeM !== null) {
    if (totalPipe > rule.maxTotalPipeM) errors.push(`Total pipe ${totalPipe} m is over ${rule.outdoorModel}'s ${rule.maxTotalPipeM} m limit.`);
  } else {
    warnings.push(`No total pipe limit on record for ${rule.outdoorModel}.`);
  }
  if (rule.maxPipePerRoomM !== null) {
    runs.forEach((run, i) => {
      if (typeof run === "number" && run > rule.maxPipePerRoomM!) {
        errors.push(`Indoor unit ${i + 1} (${codeOf(indoors[i]!)}): pipe run ${round1(run)} m is over the ${rule.maxPipePerRoomM} m per-room limit.`);
      }
    });
  } else {
    warnings.push(`No per-room pipe limit on record for ${rule.outdoorModel}.`);
  }

  if (rule.confidence !== "verified") warnings.push(PROVISIONAL_RULE_WARNING);
  if (!rule.source?.url) warnings.push(`No source recorded for ${rule.outdoorModel}'s rule.`);

  return { ok: errors.length === 0, errors: dedupe(errors), warnings: dedupe(warnings) };
}

function dedupe(list: string[]): string[] {
  return [...new Set(list)];
}

/** Listed as each other's pair, by id or model, either way round. */
export function pairsWith(indoor: CatalogueItem, outdoor: CatalogueItem): boolean {
  const ref = (p: string | null | undefined, item: CatalogueItem) => Boolean(p) && (norm(p) === norm(item.id) || (Boolean(item.model) && norm(p) === norm(item.model)));
  return ref(indoor.pairedWith, outdoor) || ref(outdoor.pairedWith, indoor);
}

/**
 * The outdoor unit an indoor unit pairs with as a single split, from the
 * catalogue's own pairing (never by guessing a similar size). Retired and
 * discontinued units don't count.
 */
export function singlePairFor(indoor: CatalogueItem, catalogue: CatalogueItem[]): CatalogueItem | undefined {
  const outdoors = catalogue.filter((i) => i.kind === "outdoor" && isSelectable(i));
  const direct = indoor.pairedWith ? outdoors.find((o) => norm(o.id) === norm(indoor.pairedWith) || (o.model && norm(o.model) === norm(indoor.pairedWith))) : undefined;
  if (direct) return direct;
  const reverse = outdoors.filter((o) => o.pairedWith && (norm(o.pairedWith) === norm(indoor.id) || (indoor.model && norm(o.pairedWith) === norm(indoor.model))));
  return reverse.find((o) => o.status === "available") ?? reverse[0];
}

/* ------------------------------------------------------------------ */
/* Honesty labels                                                      */
/* ------------------------------------------------------------------ */

/** A verified figure goes stale this long after it was last checked. */
export const STALE_AFTER_DAYS = 90;

function dayNumber(iso: string): number | null {
  const t = Date.parse(`${iso.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(t) ? Math.floor(t / 86_400_000) : null;
}

/** Whole days from `fromIso` to `toIso` (dates only), or null when either is junk. */
export function daysBetweenDates(fromIso: string, toIso: string): number | null {
  const a = dayNumber(fromIso);
  const b = dayNumber(toIso);
  return a === null || b === null ? null : b - a;
}

/** Verified once, but long enough ago that it needs checking again. */
export function isStale(item: Pick<CatalogueItem, "confidence" | "verifiedAt">, todayIso: string): boolean {
  if (item.confidence === "stale") return true;
  if (!item.verifiedAt) return false;
  const age = daysBetweenDates(item.verifiedAt, todayIso);
  return age !== null && age > STALE_AFTER_DAYS;
}

/** The confidence to show today: a verified item past its check-by date reads stale. */
export function effectiveConfidence(item: Pick<CatalogueItem, "confidence" | "verifiedAt">, todayIso: string): CatalogueItem["confidence"] {
  return isStale(item, todayIso) ? "stale" : item.confidence;
}

/**
 * Safe to show a customer without a "to be confirmed" label: active,
 * available and verified. Provisional (and stale, and uncertain) items can
 * still be designed with; customer pages label them instead.
 */
export function isCustomerSafe(item: CatalogueItem): boolean {
  return item.active && item.status === "available" && item.confidence === "verified";
}

/* ------------------------------------------------------------------ */
/* Loading the researched seed                                         */
/* ------------------------------------------------------------------ */

export interface SeedMergePlan<T extends { id: string }> {
  /** What to write. */
  upserts: T[];
  added: number;
  /** Already there and left exactly as they are (costs, edits, retirements). */
  kept: number;
  /** Already there and replaced by the seed (only with `overwrite`). */
  replaced: number;
}

/**
 * Merge a seed into what's stored. New ids are added; existing ones are
 * kept untouched (so supplier costs and edits survive a re-load) unless
 * `overwrite` says to replace them with the seed.
 */
export function planSeedMerge<T extends { id: string }>(existing: T[], seed: T[], overwrite: boolean): SeedMergePlan<T> {
  const have = new Set(existing.map((e) => e.id));
  const upserts: T[] = [];
  let added = 0;
  let kept = 0;
  let replaced = 0;
  for (const item of seed) {
    if (!have.has(item.id)) {
      upserts.push(item);
      added++;
    } else if (overwrite) {
      upserts.push(item);
      replaced++;
    } else {
      kept++;
    }
  }
  return { upserts, added, kept, replaced };
}

type PricedFields = Pick<CatalogueItem, "id" | "costPence" | "costSource">;

/**
 * Whether an item's buy cost is still exactly the one the researched seed
 * loaded with: a public retail price read off a web page (some of them
 * approximate), not a price anyone here typed in from a supplier. Any edit
 * to the cost, the supplier or the date it was seen makes it ours.
 */
export function stillResearchPrice(item: PricedFields, seed: ReadonlyMap<string, PricedFields>): boolean {
  if (item.costPence === null) return false;
  const researched = seed.get(item.id);
  if (!researched || researched.costPence === null) return false;
  return (
    researched.costPence === item.costPence &&
    (researched.costSource?.supplier ?? "") === (item.costSource?.supplier ?? "") &&
    (researched.costSource?.observedAt ?? "") === (item.costSource?.observedAt ?? "")
  );
}

/** What's wrong with a rule as typed into the editor (empty when it's fine). */
export function compatibilityRuleErrors(rule: CompatibilityRule): string[] {
  const out: string[] = [];
  if (!rule.id.trim()) out.push("The rule needs an id.");
  if (!rule.outdoorModel.trim()) out.push("Which outdoor model is this rule for?");
  if (!Number.isInteger(rule.maxIndoorUnits) || rule.maxIndoorUnits < 1 || rule.maxIndoorUnits > 9) out.push("Maximum indoor units must be a whole number from 1 to 9.");
  if (rule.connectableIndoorModels.length === 0 && rule.connectableIndoorSeries.length === 0) out.push("List at least one connectable indoor model or series.");
  for (const [label, v] of [
    ["Minimum connected capacity", rule.minConnectedKw],
    ["Maximum connected capacity", rule.maxConnectedKw],
    ["Maximum total pipe", rule.maxTotalPipeM],
    ["Maximum pipe per room", rule.maxPipePerRoomM],
  ] as const) {
    if (v !== null && (!Number.isFinite(v) || v <= 0)) out.push(`${label} must be a positive number, or left blank if unknown.`);
  }
  if (rule.minConnectedKw !== null && rule.maxConnectedKw !== null && rule.minConnectedKw > rule.maxConnectedKw) out.push("The minimum connected capacity is above the maximum.");
  if (rule.confidence === "verified" && !rule.source?.url) out.push("A verified rule needs its source (the manufacturer's combination table).");
  if (rule.source?.url && !/^https?:\/\//i.test(rule.source.url)) out.push("The source must be a web address starting http:// or https://.");
  return out;
}

/** What's wrong with an item as edited (empty when it's fine). Shape checks happen before this. */
export function catalogueItemErrors(item: CatalogueItem): string[] {
  const out: string[] = [];
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(item.id)) out.push("The id may only use letters, numbers, dots, dashes and underscores (up to 100).");
  if (!item.label.trim()) out.push("Give the item a label.");
  if (item.costPence !== null && (!Number.isInteger(item.costPence) || item.costPence < 0)) out.push("Cost must be zero or more, in pounds and pence.");
  if ((item.kind === "indoor" || item.kind === "outdoor") && !item.model?.trim()) out.push("Equipment needs its model code.");
  if (item.verifiedAt && dayNumber(item.verifiedAt) === null) out.push("The verified date isn't a real date.");
  if (item.confidence === "verified" && item.sources.length === 0) out.push("A verified item needs at least one source.");
  for (const s of item.sources) if (!/^https?:\/\//i.test(s.url)) out.push(`Source "${s.url}" must start http:// or https://.`);
  if (item.costSource?.url && !/^https?:\/\//i.test(item.costSource.url)) out.push("The cost source link must start http:// or https://.");
  if (item.ports !== undefined && item.ports !== null && (!Number.isInteger(item.ports) || item.ports < 1 || item.ports > 9)) out.push("Ports must be a whole number from 1 to 9.");
  return out;
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

type ColumnKind = "text" | "number" | "boolean" | "money" | "date";

interface Column {
  name: string;
  kind: ColumnKind;
  get: (item: CatalogueItem) => unknown;
}

const SPEC_COLUMN_PREFIX = "spec.";

const BASE_COLUMNS: Column[] = [
  { name: "id", kind: "text", get: (i) => i.id },
  { name: "kind", kind: "text", get: (i) => i.kind },
  { name: "manufacturer", kind: "text", get: (i) => i.manufacturer },
  { name: "series", kind: "text", get: (i) => i.series },
  { name: "model", kind: "text", get: (i) => i.model },
  { name: "label", kind: "text", get: (i) => i.label },
  { name: "tier", kind: "text", get: (i) => i.tier },
  { name: "multiSplitCapable", kind: "boolean", get: (i) => i.multiSplitCapable },
  { name: "ports", kind: "number", get: (i) => i.ports },
  { name: "pairedWith", kind: "text", get: (i) => i.pairedWith },
  { name: "category", kind: "text", get: (i) => i.category },
  { name: "unit", kind: "text", get: (i) => i.unit },
  { name: "customerBlurb", kind: "text", get: (i) => i.customerBlurb },
  { name: "costGbpExVat", kind: "money", get: (i) => i.costPence },
  { name: "costSupplier", kind: "text", get: (i) => i.costSource?.supplier },
  { name: "costUrl", kind: "text", get: (i) => i.costSource?.url },
  { name: "costObservedAt", kind: "date", get: (i) => i.costSource?.observedAt },
  { name: "costVatIncluded", kind: "boolean", get: (i) => i.costSource?.vatIncluded },
  { name: "costNote", kind: "text", get: (i) => i.costSource?.note },
  { name: "supplier", kind: "text", get: (i) => i.supplier },
  { name: "status", kind: "text", get: (i) => i.status },
  { name: "confidence", kind: "text", get: (i) => i.confidence },
  { name: "verifiedAt", kind: "date", get: (i) => i.verifiedAt },
  { name: "active", kind: "boolean", get: (i) => i.active },
  { name: "warranty", kind: "text", get: (i) => i.warranty },
  { name: "notes", kind: "text", get: (i) => i.notes },
  { name: "sources", kind: "text", get: (i) => i.sources.map((s) => (s.title ? `${s.url} | ${s.title}` : s.url)).join("\n") },
];

const SPEC_COLUMNS: Column[] = SPEC_FIELDS.map((f) => ({
  name: `${SPEC_COLUMN_PREFIX}${f.key}`,
  kind: f.kind === "number" ? "number" : "text",
  get: (i: CatalogueItem) => {
    const v = i.specs?.[f.key];
    if (f.kind === "dimensions") {
      const d = v as EquipmentSpecs["dimensionsMm"] | undefined;
      return d ? `${d.w}x${d.h}x${d.d}` : d;
    }
    return v;
  },
}));

/** Every column, in file order. */
export const CATALOGUE_CSV_COLUMNS: string[] = [...BASE_COLUMNS, ...SPEC_COLUMNS].map((c) => c.name);

/** A cell a spreadsheet would run as a formula gets a leading apostrophe (and loses it again on import). */
const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(value: unknown, kind: ColumnKind): string {
  let s: string;
  if (value === null || value === undefined) s = "";
  else if (kind === "money") s = (Number(value) / 100).toFixed(2);
  else if (kind === "boolean") s = value ? "TRUE" : "FALSE";
  else s = String(value);
  if (kind === "text" && FORMULA_START.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The whole catalogue as CSV (RFC 4180, CRLF), one row per item, every field. Costs in £ ex VAT. */
export function catalogueToCsv(items: CatalogueItem[]): string {
  const cols = [...BASE_COLUMNS, ...SPEC_COLUMNS];
  const lines = [cols.map((c) => c.name).join(",")];
  for (const item of items) lines.push(cols.map((c) => csvCell(c.get(item), c.kind)).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

/** RFC 4180 parsing: quoted cells, doubled quotes, commas and newlines inside quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** At most this many rows in one import. */
export const CSV_MAX_ROWS = 2000;

const KINDS = new Set<string>(CATALOGUE_KINDS);
const STATUSES = new Set(["available", "uncertain", "discontinued"]);
const CONFIDENCES = new Set(["verified", "provisional", "stale"]);
const TIERS = new Set(["standard", "premium"]);

/**
 * A date cell from the catalogue CSV as yyyy-mm-dd, or null when it isn't
 * one. Takes the export's own 2026-10-18 and the UK day-first form Excel and
 * Google Sheets rewrite it to on the export, edit, import round trip
 * (18/10/2026, 8/1/2026; a time after it is ignored). Never month-first.
 */
export function csvDate(raw: string): string | null {
  const v = raw.trim();
  let iso: string | null = null;
  if (/^\d{4}-\d{2}-\d{2}(?:$|[T\s])/.test(v)) iso = v.slice(0, 10);
  else {
    const uk = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:$|\s)/.exec(v);
    if (uk) iso = `${uk[3]}-${uk[2]!.padStart(2, "0")}-${uk[1]!.padStart(2, "0")}`;
  }
  if (!iso || dayNumber(iso) === null) return null;
  // dayNumber rolls 31/02 over to March: only a date that reads back the same is real.
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toISOString().slice(0, 10) === iso ? iso : null;
}

/**
 * Items from a CSV, with row-level errors in plain English ("Row 7
 * (daikin-x): cost "12abc" isn't a number"). A row with any error is left
 * out, so the caller can show the errors before anything is applied.
 * Unknown columns are ignored; `id`, `kind` and `label` are required.
 */
export function catalogueFromCsv(csv: string): { items: CatalogueItem[]; errors: string[]; columns: string[] } {
  const rows = parseCsv(csv);
  const errors: string[] = [];
  if (rows.length === 0) return { items: [], errors: ["The file is empty."], columns: [] };
  const header = rows[0]!.map((h) => h.trim());
  const at = new Map(header.map((h, i) => [h, i]));
  const missing = ["id", "kind", "label"].filter((h) => !at.has(h));
  if (missing.length) return { items: [], errors: [`The header row is missing: ${missing.join(", ")}. Export the catalogue to get a template.`], columns: header };
  if (rows.length - 1 > CSV_MAX_ROWS) return { items: [], errors: [`That's ${rows.length - 1} rows; import at most ${CSV_MAX_ROWS} at a time.`], columns: header };

  const items: CatalogueItem[] = [];
  const seen = new Set<string>();
  rows.slice(1).forEach((cells, index) => {
    const rowNo = index + 2;
    const raw = (name: string): string => {
      const i = at.get(name);
      let v = i === undefined ? "" : (cells[i] ?? "");
      if (v.startsWith("'") && FORMULA_START.test(v.slice(1))) v = v.slice(1);
      return v;
    };
    const text = (name: string) => raw(name).trim();
    const rowErrors: string[] = [];
    const id = text("id");
    const where = `Row ${rowNo}${id ? ` (${id})` : ""}`;
    const fail = (msg: string) => rowErrors.push(`${where}: ${msg}`);

    const num = (name: string, label: string): number | null => {
      const v = text(name).replace(/,/g, "");
      if (!v) return null;
      const n = Number(v);
      if (!Number.isFinite(n)) {
        fail(`${label} "${text(name)}" isn't a number.`);
        return null;
      }
      return n;
    };
    const bool = (name: string, label: string): boolean | undefined => {
      const v = norm(text(name));
      if (!v) return undefined;
      if (["true", "yes", "y", "1"].includes(v)) return true;
      if (["false", "no", "n", "0"].includes(v)) return false;
      fail(`${label} "${text(name)}" should be TRUE or FALSE.`);
      return undefined;
    };
    const date = (name: string, label: string): string | undefined => {
      const v = text(name);
      if (!v) return undefined;
      const iso = csvDate(v);
      if (!iso) {
        fail(`${label} "${v}" should be a date like 2026-10-18 or 18/10/2026.`);
        return undefined;
      }
      return iso;
    };

    if (!id) fail("the id is blank.");
    else if (!/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(id)) fail("the id may only use letters, numbers, dots, dashes and underscores.");
    else if (seen.has(id)) fail("this id appears more than once in the file.");
    const kind = text("kind");
    if (!KINDS.has(kind)) fail(`kind "${kind}" should be one of ${CATALOGUE_KINDS.join(", ")}.`);
    const label = text("label");
    if (!label) fail("the label is blank.");
    const tier = text("tier");
    if (tier && !TIERS.has(tier)) fail(`tier "${tier}" should be standard or premium (or blank).`);
    const status = text("status") || "available";
    if (!STATUSES.has(status)) fail(`status "${status}" should be available, uncertain or discontinued.`);
    const confidence = text("confidence") || "provisional";
    if (!CONFIDENCES.has(confidence)) fail(`confidence "${confidence}" should be verified, provisional or stale.`);

    let costPence: number | null = null;
    const costRaw = text("costGbpExVat").replace(/[£,\s]/g, "");
    if (costRaw) {
      const n = Number(costRaw);
      if (!Number.isFinite(n)) fail(`cost "${text("costGbpExVat")}" isn't a number.`);
      else if (n < 0) fail("cost can't be negative.");
      else costPence = Math.round(n * 100);
    }

    const equipment = kind === "indoor" || kind === "outdoor";
    const portsN = num("ports", "Ports");
    if (portsN !== null && (!Number.isInteger(portsN) || portsN < 1 || portsN > 9)) fail("ports should be a whole number from 1 to 9.");

    const specs: Partial<EquipmentSpecs> = {};
    let anySpec = false;
    for (const f of SPEC_FIELDS) {
      const name = `${SPEC_COLUMN_PREFIX}${f.key}`;
      const v = text(name);
      if (f.kind === "dimensions") {
        if (!v) {
          if (equipment) (specs as Record<string, unknown>)[f.key] = null;
          continue;
        }
        const m = /^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)$/i.exec(v);
        if (!m) fail(`dimensions "${v}" should look like 870x295x229 (mm).`);
        else {
          specs.dimensionsMm = { w: Number(m[1]), h: Number(m[2]), d: Number(m[3]) };
          anySpec = true;
        }
      } else if (f.kind === "number") {
        const n = num(name, f.label);
        if (n !== null) {
          (specs as Record<string, unknown>)[f.key] = n;
          anySpec = true;
        } else if (equipment) (specs as Record<string, unknown>)[f.key] = null;
      } else if (v) {
        (specs as Record<string, unknown>)[f.key] = v;
        anySpec = true;
      } else if (equipment) (specs as Record<string, unknown>)[f.key] = null;
    }

    const sources: CatalogueItem["sources"] = [];
    for (const line of raw("sources").split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      const bar = t.indexOf(" | ");
      const url = (bar >= 0 ? t.slice(0, bar) : t).trim();
      const title = bar >= 0 ? t.slice(bar + 3).trim() : "";
      if (!/^https?:\/\//i.test(url)) fail(`source "${url}" should be a web address (http…).`);
      else sources.push(title ? { url, title } : { url });
    }

    const costSource: NonNullable<CatalogueItem["costSource"]> = {};
    if (text("costUrl")) costSource.url = text("costUrl");
    if (text("costSupplier")) costSource.supplier = text("costSupplier");
    const observedAt = date("costObservedAt", "Cost date");
    if (observedAt) costSource.observedAt = observedAt;
    const vatIncluded = bool("costVatIncluded", "VAT included");
    if (vatIncluded !== undefined) costSource.vatIncluded = vatIncluded;
    if (text("costNote")) costSource.note = text("costNote");
    if (costSource.url && !/^https?:\/\//i.test(costSource.url)) fail("the cost source link should start http:// or https://.");

    const active = bool("active", "Active");
    const multiSplitCapable = bool("multiSplitCapable", "Multi-split capable");
    const verifiedAt = date("verifiedAt", "Verified date");

    if (id) seen.add(id);
    if (rowErrors.length) {
      errors.push(...rowErrors);
      return;
    }
    const opt = (name: string) => text(name) || undefined;
    const nullable = (name: string) => (text(name) ? raw(name).trim() : equipment ? null : undefined);
    const item: CatalogueItem = {
      id,
      kind: kind as CatalogueKind,
      ...(opt("manufacturer") ? { manufacturer: opt("manufacturer") } : {}),
      ...(opt("series") ? { series: opt("series") } : {}),
      ...(opt("model") ? { model: opt("model") } : {}),
      label,
      ...(tier ? { tier: tier as "standard" | "premium" } : {}),
      ...(multiSplitCapable !== undefined ? { multiSplitCapable } : {}),
      ...(portsN !== null ? { ports: portsN } : equipment ? { ports: null } : {}),
      ...(nullable("pairedWith") !== undefined ? { pairedWith: nullable("pairedWith") } : {}),
      ...(anySpec || equipment ? { specs } : {}),
      ...(opt("unit") ? { unit: opt("unit") } : {}),
      ...(opt("category") ? { category: opt("category") } : {}),
      ...(opt("customerBlurb") ? { customerBlurb: opt("customerBlurb") } : {}),
      costPence,
      ...(Object.keys(costSource).length ? { costSource } : {}),
      ...(opt("supplier") ? { supplier: opt("supplier") } : {}),
      status: status as CatalogueItem["status"],
      confidence: confidence as CatalogueItem["confidence"],
      ...(verifiedAt ? { verifiedAt } : {}),
      sources,
      ...(nullable("warranty") !== undefined ? { warranty: nullable("warranty") } : {}),
      ...(raw("notes").trim() ? { notes: raw("notes").trim() } : {}),
      active: active ?? true,
    };
    items.push(item);
  });
  return { items, errors, columns: header.filter((h) => CATALOGUE_CSV_COLUMNS.includes(h)) };
}

const COST_SOURCE_COLUMN: Record<string, keyof NonNullable<CatalogueItem["costSource"]>> = {
  costSupplier: "supplier",
  costUrl: "url",
  costObservedAt: "observedAt",
  costVatIncluded: "vatIncluded",
  costNote: "note",
};

/**
 * An imported row laid over what's stored: only the columns the file has
 * change anything, so a price list with just id, kind, label and the cost
 * columns updates prices and leaves specs, sources and notes alone. A blank
 * cell in a column that is there clears that field (or sets its default).
 */
export function mergeCsvRow(existing: CatalogueItem | undefined, incoming: CatalogueItem, columns: string[]): CatalogueItem {
  if (!existing) return incoming;
  const out = JSON.parse(JSON.stringify(existing)) as Record<string, unknown> & CatalogueItem;
  const src = incoming as unknown as Record<string, unknown>;
  for (const col of columns) {
    if (col === "costGbpExVat") {
      out.costPence = incoming.costPence;
    } else if (col in COST_SOURCE_COLUMN) {
      const key = COST_SOURCE_COLUMN[col]!;
      const cs: Record<string, unknown> = { ...(out.costSource ?? {}) };
      const v = incoming.costSource?.[key];
      if (v === undefined) delete cs[key];
      else cs[key] = v;
      if (Object.keys(cs).length) out.costSource = cs as CatalogueItem["costSource"];
      else delete out.costSource;
    } else if (col.startsWith(SPEC_COLUMN_PREFIX)) {
      const key = col.slice(SPEC_COLUMN_PREFIX.length) as keyof EquipmentSpecs;
      const specs: Record<string, unknown> = { ...(out.specs ?? {}) };
      const v = incoming.specs?.[key];
      if (v === undefined) delete specs[key];
      else specs[key] = v;
      if (Object.keys(specs).length) out.specs = specs as Partial<EquipmentSpecs>;
      else delete out.specs;
    } else {
      const v = src[col];
      if (v === undefined) delete out[col];
      else out[col] = v;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* DEMO data                                                           */
/* ------------------------------------------------------------------ */

const DEMO_SOURCE = [{ url: "https://example.com/demo-catalogue", title: "DEMO catalogue (fictional)" }];
const DEMO_COST_SOURCE = { supplier: "DEMO Aircon Supplies", note: "DEMO price, not a real quote", vatIncluded: true };

function demo(over: Partial<CatalogueItem> & Pick<CatalogueItem, "id" | "kind" | "label" | "costPence">): CatalogueItem {
  return {
    status: "available",
    confidence: "provisional",
    sources: DEMO_SOURCE,
    costSource: DEMO_COST_SOURCE,
    supplier: "DEMO Aircon Supplies",
    active: true,
    notes: "DEMO data for the demo pilots. Not a real product.",
    ...over,
  };
}

const demoIndoor = (kw: number, heatKw: number, lowDb: number, w: number): Partial<EquipmentSpecs> => ({
  coolingKw: kw,
  heatingKw: heatKw,
  seer: 8.5,
  scop: 4.6,
  soundPressureLowDb: lowDb,
  soundPressureHighDb: lowDb + 20,
  dimensionsMm: { w, h: 295, d: 230 },
  refrigerant: "R32",
  liquidPipeMm: 6.35,
  gasPipeMm: kw > 3 ? 12.7 : 9.52,
  wifi: "Built in (DEMO app)",
  releaseHeightM: 1.8,
});

/** DEMO limits: every DEMO outdoor unit takes runs of 3 m or more; the multi-splits add their own (fictional) table. */
const DEMO_MULTI_LIMITS = (maxTotal: number, minKw: number): Partial<EquipmentSpecs> => ({
  maxPipePerBranchM: 20,
  minTotalPipeM: 6,
  maxTotalPipeM: maxTotal,
  maxIndoorHeightDiffM: 7.5,
  minIndoorUnits: 2,
  minConnectedKw: minKw,
});

const demoOutdoor = (kw: number, precharged: number, maxPipe: number, powerDb: number, factoryKg: number, multi?: Partial<EquipmentSpecs>): Partial<EquipmentSpecs> => ({
  coolingKw: kw,
  heatingKw: Math.round(kw * 1.25 * 10) / 10,
  refrigerant: "R32",
  soundPowerDb: powerDb,
  maxPipeM: maxPipe,
  maxHeightDiffM: 15,
  minPipeM: 3,
  ...multi,
  prechargedPipeM: precharged,
  additionalChargeGPerM: 20,
  factoryChargeKg: factoryKg,
  powerSupply: "230 V single phase",
  recommendedBreakerA: kw > 4 ? 20 : 16,
  dimensionsMm: { w: 800, h: 550, d: 285 },
});

const DEMO_MAKER = "DEMO Aircon Co";
const DEMO_TRADE = "DEMO Trade Counter";

/**
 * Fictional-but-plausible DEMO-labelled items for demo mode and tests. The
 * first nineteen are the same records the demo seed (apps/web/lib/demo-seed)
 * loads, id for id; the last few fill the materials a full bill needs.
 */
export const DEMO_CATALOGUE: CatalogueItem[] = [
  demo({ id: "demo-ind-brz25", kind: "indoor", manufacturer: DEMO_MAKER, series: "Breeze", model: "DM-BRZ25", label: "Breeze 25 wall unit (DEMO)", tier: "standard", multiSplitCapable: true, specs: demoIndoor(2.5, 3.2, 21, 800), costPence: 38_000, customerBlurb: "Neat, efficient and quiet at night: 21 dB on its lowest setting.", category: "wall" }),
  demo({ id: "demo-ind-brz35", kind: "indoor", manufacturer: DEMO_MAKER, series: "Breeze", model: "DM-BRZ35", label: "Breeze 35 wall unit (DEMO)", tier: "standard", multiSplitCapable: true, specs: demoIndoor(3.5, 4.0, 22, 890), costPence: 45_000, customerBlurb: "The living-room size: cools a sunny room fast, heats it on chilly evenings.", category: "wall" }),
  demo({ id: "demo-ind-whs25", kind: "indoor", manufacturer: DEMO_MAKER, series: "Whisper", model: "DM-WHS25", label: "Whisper 25 wall unit (DEMO)", tier: "premium", multiSplitCapable: true, specs: demoIndoor(2.5, 3.4, 19, 800), costPence: 62_000, customerBlurb: "Whisper-quiet at 19 dB, with app control and an air purifying filter.", category: "wall" }),
  demo({ id: "demo-ind-whs35", kind: "indoor", manufacturer: DEMO_MAKER, series: "Whisper", model: "DM-WHS35", label: "Whisper 35 wall unit (DEMO)", tier: "premium", multiSplitCapable: true, specs: demoIndoor(3.5, 4.2, 19, 890), costPence: 70_000, customerBlurb: "Our quietest larger unit: 19 dB, app control, purifying filter.", category: "wall" }),

  demo({ id: "demo-out-brz25", kind: "outdoor", manufacturer: DEMO_MAKER, series: "Breeze", model: "DM-BRZ25-O", label: "Breeze 25 outdoor unit (DEMO)", tier: "standard", ports: 1, pairedWith: "demo-ind-brz25", specs: demoOutdoor(2.5, 15, 20, 59, 0.6), costPence: 52_000 }),
  demo({ id: "demo-out-brz35", kind: "outdoor", manufacturer: DEMO_MAKER, series: "Breeze", model: "DM-BRZ35-O", label: "Breeze 35 outdoor unit (DEMO)", tier: "standard", ports: 1, pairedWith: "demo-ind-brz35", specs: demoOutdoor(3.5, 15, 20, 61, 0.75), costPence: 60_000 }),
  demo({ id: "demo-out-whs25", kind: "outdoor", manufacturer: DEMO_MAKER, series: "Whisper", model: "DM-WHS25-O", label: "Whisper 25 outdoor unit (DEMO)", tier: "premium", ports: 1, pairedWith: "demo-ind-whs25", specs: demoOutdoor(2.5, 15, 20, 56, 0.6), costPence: 66_000 }),
  demo({ id: "demo-out-whs35", kind: "outdoor", manufacturer: DEMO_MAKER, series: "Whisper", model: "DM-WHS35-O", label: "Whisper 35 outdoor unit (DEMO)", tier: "premium", ports: 1, pairedWith: "demo-ind-whs35", specs: demoOutdoor(3.5, 15, 20, 57, 0.75), costPence: 74_000 }),
  demo({ id: "demo-out-duo50", kind: "outdoor", manufacturer: DEMO_MAKER, series: "Duo", model: "DM-DUO50", label: "Duo 50 two-room outdoor unit (DEMO)", tier: "standard", multiSplitCapable: true, ports: 2, specs: demoOutdoor(5.0, 20, 30, 62, 1.2, DEMO_MULTI_LIMITS(30, 4.0)), costPence: 112_000 }),
  demo({ id: "demo-out-trio52", kind: "outdoor", manufacturer: DEMO_MAKER, series: "Trio", model: "DM-TRIO52", label: "Trio 52 three-room outdoor unit (DEMO)", tier: "standard", multiSplitCapable: true, ports: 3, specs: demoOutdoor(5.2, 30, 45, 63, 1.6, DEMO_MULTI_LIMITS(45, 5.0)), costPence: 145_000 }),

  demo({ id: "demo-mat-lineset", kind: "material", label: "Insulated copper line set, 1/4 + 3/8 (DEMO)", unit: "m", category: "pipework", costPence: 900, supplier: DEMO_TRADE }),
  demo({ id: "demo-mat-trunking", kind: "material", label: "Line-set trunking, 2 m length (DEMO)", unit: "length", category: "pipework", costPence: 1_200, supplier: DEMO_TRADE }),
  demo({ id: "demo-mat-feet", kind: "material", label: "Ground mounting feet + anti-vibration pads (DEMO)", unit: "set", category: "mounting", costPence: 4_500, supplier: DEMO_TRADE }),
  demo({ id: "demo-mat-bracket", kind: "material", label: "Galvanised outdoor wall bracket (DEMO)", unit: "set", category: "mounting", costPence: 5_500, supplier: DEMO_TRADE }),
  demo({ id: "demo-mat-cable", kind: "material", label: "2.5 mm² twin and earth (DEMO)", unit: "m", category: "electrical", costPence: 180, supplier: DEMO_TRADE }),
  demo({ id: "demo-mat-rcbo", kind: "material", label: "16 A Type C RCBO (DEMO)", unit: "each", category: "electrical", costPence: 2_200, supplier: DEMO_TRADE }),
  demo({ id: "demo-mat-isolator", kind: "material", label: "20 A rotary isolator, IP65 (DEMO)", unit: "each", category: "electrical", costPence: 1_800, supplier: DEMO_TRADE }),
  demo({ id: "demo-mat-condensate", kind: "material", label: "Condensate hose and fittings (DEMO)", unit: "kit", category: "drainage", costPence: 1_500, supplier: DEMO_TRADE }),
  demo({ id: "demo-mat-sleeve", kind: "material", label: "Wall sleeve and fire-stop (DEMO)", unit: "each", category: "pipework", costPence: 600, supplier: DEMO_TRADE }),

  // What a complete bill also needs (the demo seed loads this whole list: lib/demo-seed/catalogue.ts).
  demo({ id: "demo-mat-lineset-12", kind: "material", label: "Insulated copper line set, 1/4 + 1/2 (DEMO)", unit: "m", category: "pipework", costPence: 1_100, supplier: DEMO_TRADE }),
  demo({ id: "demo-mat-interconnect", kind: "material", label: "4-core 1.5 mm² interconnect cable (DEMO)", unit: "m", category: "cable", costPence: 150, supplier: DEMO_TRADE }),
  demo({ id: "demo-mat-rcbo20", kind: "material", label: "20 A Type C RCBO (DEMO)", unit: "each", category: "electrical", costPence: 2_400, supplier: DEMO_TRADE }),
  demo({ id: "demo-mat-pump", kind: "material", label: "Mini condensate pump (DEMO)", unit: "each", category: "drainage", costPence: 8_500, supplier: DEMO_TRADE }),
  demo({ id: "demo-mat-r32", kind: "material", label: "R32 refrigerant (DEMO)", unit: "kg", category: "refrigerant", costPence: 3_000, supplier: DEMO_TRADE }),
  demo({ id: "demo-mat-fixings", kind: "material", label: "Fixings pack (DEMO)", unit: "pack", category: "consumable", costPence: 1_000, supplier: DEMO_TRADE }),
  // The proposal's delivery line (buildCostLines), so a DEMO build-up is complete and can issue.
  demo({ id: "demo-svc-delivery", kind: "service", label: "Kit delivery to the home (DEMO)", unit: "drop", category: "delivery", costPence: 4_500, supplier: DEMO_TRADE }),
];

export const DEMO_COMPATIBILITY: CompatibilityRule[] = [
  {
    id: "demo-compat-duo50",
    outdoorModel: "DM-DUO50",
    maxIndoorUnits: 2,
    connectableIndoorSeries: ["Breeze", "Whisper"],
    connectableIndoorModels: ["DM-BRZ25", "DM-BRZ35", "DM-WHS25", "DM-WHS35"],
    minConnectedKw: 4.0,
    maxConnectedKw: 7.0,
    maxTotalPipeM: 30,
    maxPipePerRoomM: 20,
    source: { url: "https://example.com/demo-duo50-combinations", title: "DEMO combination table (fictional)" },
    confidence: "verified",
  },
  {
    id: "demo-compat-trio52",
    outdoorModel: "DM-TRIO52",
    maxIndoorUnits: 3,
    connectableIndoorSeries: ["Breeze", "Whisper"],
    connectableIndoorModels: ["DM-BRZ25", "DM-BRZ35", "DM-WHS25", "DM-WHS35"],
    minConnectedKw: 5.0,
    maxConnectedKw: 8.5,
    maxTotalPipeM: 45,
    maxPipePerRoomM: 20,
    source: { url: "https://example.com/demo-trio52-combinations", title: "DEMO combination table (fictional)" },
    confidence: "verified",
  },
];
