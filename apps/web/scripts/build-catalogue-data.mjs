#!/usr/bin/env node
/**
 * Regenerates packages/domain/src/catalogue-data.ts (RESEARCHED_CATALOGUE +
 * RESEARCHED_COMPATIBILITY) from docs/research/data/catalogue-seed.json.
 *
 *   node apps/web/scripts/build-catalogue-data.mjs
 *
 * Deterministic: the same JSON always writes the same file, so a diff of
 * the generated module is a diff of the research. The mapping is honest by
 * construction: costs stay null where the research found none, confidence
 * is carried unchanged, `verifiedAt` is only set on verified records (the
 * research date), and the few models the research flags as superseded or
 * not confirmed for the UK are marked "uncertain".
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const SEED = join(root, "docs", "research", "data", "catalogue-seed.json");
const OUT = join(root, "packages", "domain", "src", "catalogue-data.ts");

const seed = JSON.parse(readFileSync(SEED, "utf8"));
const researchedAt = String(seed.researchedAt ?? "").slice(0, 10);

/** Models the research says to confirm before quoting: availability, not specs. */
const UNCERTAIN = {
  "mitsubishi-electric-msz-ap25vgk": "Superseded in the UK by MSZ-AY at 2.5-5.0 kW; still listed by retailers. Confirm availability before quoting.",
  "mitsubishi-electric-muz-ap25vg": "Superseded in the UK by MUZ-AY at 2.5-5.0 kW; still listed by retailers. Confirm availability before quoting.",
  "mitsubishi-electric-msz-ap35vgk": "Superseded in the UK by MSZ-AY at 2.5-5.0 kW; still listed by retailers. Confirm availability before quoting.",
  "mitsubishi-electric-muz-ap35vg": "Superseded in the UK by MUZ-AY at 2.5-5.0 kW; still listed by retailers. Confirm availability before quoting.",
  "mitsubishi-electric-msz-ap50vgk": "Superseded in the UK by MSZ-AY at 2.5-5.0 kW; still listed by retailers. Confirm availability before quoting.",
  "mitsubishi-electric-muz-ap50vg": "Superseded in the UK by MUZ-AY at 2.5-5.0 kW; still listed by retailers. Confirm availability before quoting.",
  "daikin-ftxj25a2v1bw": "UK availability in 2025-26 not confirmed (only a 2022 UK datasheet found). Confirm with the distributor.",
};

const SPEC_KEYS = [
  "coolingKw", "heatingKw", "seer", "scop", "energyClassCooling", "energyClassHeating", "soundPressureLowDb",
  "soundPressureHighDb", "soundPowerDb", "dimensionsMm", "weightKg", "refrigerant", "liquidPipeMm", "gasPipeMm",
  "maxPipeM", "maxHeightDiffM", "minPipeM", "maxPipePerBranchM", "minTotalPipeM", "maxTotalPipeM", "maxIndoorHeightDiffM", "minIndoorUnits",
  "minConnectedKw", "portSizesMm", "prechargedPipeM", "additionalChargeGPerM", "factoryChargeKg", "releaseHeightM", "powerSupply", "recommendedBreakerA",
  "wifi", "operatingRangeCoolingC", "operatingRangeHeatingC",
];

const clean = (v) => (v === undefined ? null : v);

function specsOf(raw) {
  const out = {};
  for (const k of SPEC_KEYS) out[k] = clean(raw?.[k]);
  return out;
}

/**
 * A plain-English line for customers, only from what the research found:
 * the quietest setting and whether app control is built in. Nothing about
 * heating limits or efficiency (too many of those figures are provisional).
 */
function blurbFor(item) {
  const db = item.specs?.soundPressureLowDb;
  const wifi = String(item.specs?.wifi ?? "");
  const builtIn = /^(built-in wi-?fi|wi-fi control as standard)/i.test(wifi);
  if (typeof db === "number" && builtIn) return `As quiet as ${db} dB(A) on its lowest setting, with Wi-Fi app control built in.`;
  if (typeof db === "number") return `As quiet as ${db} dB(A) on its lowest setting.`;
  if (builtIn) return "Wi-Fi app control built in.";
  return undefined;
}

function costSourceOf(cs) {
  if (!cs) return undefined;
  const out = {};
  for (const k of ["url", "supplier", "observedAt", "vatIncluded", "note"]) if (cs[k] !== undefined && cs[k] !== null) out[k] = cs[k];
  return Object.keys(out).length ? out : undefined;
}

function equipment(raw) {
  const status = UNCERTAIN[raw.id] ? "uncertain" : "available";
  const item = {
    id: raw.id,
    kind: raw.kind,
    manufacturer: raw.manufacturer,
    series: raw.series,
    model: raw.model,
    label: raw.label,
    tier: raw.tier,
    multiSplitCapable: Boolean(raw.multiSplitCapable),
    ports: clean(raw.ports),
    pairedWith: raw.pairedWithId ?? raw.pairedWith ?? null,
    specs: specsOf(raw.specs),
  };
  if (raw.kind === "indoor") {
    const blurb = blurbFor(item);
    if (blurb) item.customerBlurb = blurb;
  }
  item.costPence = typeof raw.costPence === "number" ? raw.costPence : null;
  const cs = costSourceOf(raw.costSource);
  if (cs) item.costSource = cs;
  if (cs?.supplier) item.supplier = cs.supplier;
  item.status = status;
  item.confidence = raw.confidence === "verified" ? "verified" : "provisional";
  if (item.confidence === "verified" && researchedAt) item.verifiedAt = researchedAt;
  item.sources = (raw.sources ?? []).filter((s) => s && s.url).map((s) => (s.title ? { url: s.url, title: s.title } : { url: s.url }));
  item.warranty = clean(raw.warranty);
  const notes = [UNCERTAIN[raw.id], raw.notes].filter(Boolean).join(" ");
  if (notes) item.notes = notes;
  item.active = true;
  return item;
}

function material(raw) {
  const suppliers = (raw.suppliersToCheck ?? []).join(", ");
  const notes = [raw.spec ? `Spec: ${raw.spec}.` : "", suppliers ? `Suppliers to check: ${suppliers}.` : "", raw.notes ?? ""]
    .filter(Boolean)
    .join(" ");
  const item = {
    id: raw.id,
    kind: raw.capex ? "tool" : "material",
    label: raw.label,
    unit: raw.unit,
    category: raw.category,
    costPence: typeof raw.costPence === "number" ? raw.costPence : null,
  };
  if (raw.source?.url) item.costSource = { url: raw.source.url };
  item.status = "available";
  item.confidence = "provisional";
  item.sources = raw.source?.url ? [{ url: raw.source.url }] : [];
  if (notes) item.notes = notes;
  item.active = true;
  return item;
}

function rule(raw) {
  const uncatalogued = raw.uncataloguedIndoorModels ?? [];
  const notes = [raw.notes, uncatalogued.length ? `Named but not in the catalogue yet (no specs): ${uncatalogued.join(", ")}.` : ""]
    .filter(Boolean)
    .join(" ");
  const out = {
    id: raw.id,
    outdoorModel: raw.outdoorModel,
    maxIndoorUnits: raw.maxIndoorUnits,
    connectableIndoorSeries: raw.connectableIndoorSeries ?? [],
    connectableIndoorModels: raw.connectableIndoorModels ?? [],
    minConnectedKw: clean(raw.minConnectedKw),
    maxConnectedKw: clean(raw.maxConnectedKw),
    maxTotalPipeM: clean(raw.maxTotalPipeM),
    maxPipePerRoomM: clean(raw.maxPipePerRoomM),
    source: raw.source?.url ? (raw.source.title ? { url: raw.source.url, title: raw.source.title } : { url: raw.source.url }) : null,
    confidence: raw.confidence === "verified" ? "verified" : "provisional",
  };
  if (raw.manufacturer) out.manufacturer = raw.manufacturer;
  if (notes) out.notes = notes;
  return out;
}

const items = [...seed.items.map(equipment), ...seed.materials.map(material)];
const rules = seed.compatibility.map(rule);

const ids = new Set();
for (const i of items) {
  if (ids.has(i.id)) throw new Error(`duplicate catalogue id ${i.id}`);
  ids.add(i.id);
}

const json = (v) => JSON.stringify(v, null, 2);
const source = relative(root, SEED);
const out = `/**
 * GENERATED by apps/web/scripts/build-catalogue-data.mjs from
 * ${source} (researched ${researchedAt}). Do not edit by
 * hand: change the research JSON and run
 *
 *   node apps/web/scripts/build-catalogue-data.mjs
 *
 * Real model names with researched specs. Mostly PROVISIONAL, mostly
 * UNPRICED (costPence null = no trustworthy price yet, never free), and every
 * multi-split rule is provisional: the connectable lists were partly derived
 * by the researchers, not copied from the manufacturers' combination tables.
 * Server-only: import it from "@aircon/domain/catalogue-data", never from a
 * client component (it's large).
 */
import type { CatalogueItem, CompatibilityRule } from "./catalogue.ts";

export const RESEARCHED_AT = ${json(researchedAt)};

/** What the research itself says to be careful about, for the "Load researched catalogue" panel. */
export const RESEARCH_CAVEATS: string[] = ${json(seed.caveats ?? [])};

export const RESEARCHED_CATALOGUE: CatalogueItem[] = ${json(items)};

export const RESEARCHED_COMPATIBILITY: CompatibilityRule[] = ${json(rules)};
`;

writeFileSync(OUT, out);
console.log(`wrote ${relative(root, OUT)}: ${items.length} items (${seed.items.length} equipment, ${seed.materials.length} materials/tools), ${rules.length} rules`);
