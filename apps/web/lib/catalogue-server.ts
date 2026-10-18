import {
  CATALOGUE_KINDS,
  catalogueFromCsv,
  catalogueItemErrors,
  catalogueToCsv,
  compatibilityRuleErrors,
  mergeCsvRow,
  planSeedMerge,
  type CatalogueItem,
  type CompatibilityRule,
  type StaffMember,
} from "@aircon/domain";
import { z } from "zod";
import { audit } from "./audit";
import * as catalogueRepo from "./repo/catalogue";
import * as compatibilityRepo from "./repo/compatibility";

/**
 * The catalogue on the server (F3): reads, validated writes, the researched
 * seed, CSV in and out, and the compatibility rules. Permissions are the
 * caller's (actions check `catalogue.edit`; pages `projects.view-all`).
 * Every write is audited. Nothing here invents a price: an empty cost is
 * stored as null (unpriced), never zero.
 */

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const fail = (errors: string[] | string): { ok: false; errors: string[] } => ({ ok: false, errors: Array.isArray(errors) ? errors : [errors] });

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function loadCatalogue(): Promise<{ items: CatalogueItem[]; rules: CompatibilityRule[] }> {
  const [items, rules] = await Promise.all([catalogueRepo.list(), compatibilityRepo.list()]);
  return { items, rules };
}

export async function getItem(id: string): Promise<CatalogueItem | null> {
  return catalogueRepo.get(id);
}

export async function getRule(id: string): Promise<CompatibilityRule | null> {
  return compatibilityRepo.get(id);
}

/** The whole catalogue as CSV (costs included: callers must be staff who may see them). */
export async function exportCatalogueCsv(): Promise<string> {
  return catalogueToCsv(await catalogueRepo.list());
}

/** Costs and where they came from removed, for people who mayn't see buy prices. */
export function withoutCosts(item: CatalogueItem): CatalogueItem {
  const { costSource: _cs, supplier: _s, ...rest } = item;
  return { ...rest, costPence: null };
}

/* ------------------------------------------------------------------ */
/* Input schemas                                                       */
/* ------------------------------------------------------------------ */

const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));
const url = z
  .string()
  .trim()
  .max(1000)
  .regex(/^https?:\/\/\S+$/i, "Links must start http:// or https://");
const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates look like 2026-10-18");
const num = z.number().finite();
const nullableNum = num.nullable().optional();
const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v ? v : null));

const specsSchema = z
  .object({
    coolingKw: nullableNum,
    heatingKw: nullableNum,
    seer: nullableNum,
    scop: nullableNum,
    energyClassCooling: nullableText(20),
    energyClassHeating: nullableText(20),
    soundPressureLowDb: nullableNum,
    soundPressureHighDb: nullableNum,
    soundPowerDb: nullableNum,
    dimensionsMm: z.object({ w: num.positive(), h: num.positive(), d: num.positive() }).nullable().optional(),
    weightKg: nullableNum,
    refrigerant: nullableText(20),
    liquidPipeMm: nullableNum,
    gasPipeMm: nullableNum,
    maxPipeM: nullableNum,
    maxHeightDiffM: nullableNum,
    prechargedPipeM: nullableNum,
    additionalChargeGPerM: nullableNum,
    powerSupply: nullableText(500),
    recommendedBreakerA: nullableNum,
    wifi: nullableText(500),
    operatingRangeCoolingC: nullableText(60),
    operatingRangeHeatingC: nullableText(60),
  })
  .strict();

export const catalogueItemSchema = z
  .object({
    id: z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/i, "The id may only use letters, numbers, dots, dashes and underscores"),
    kind: z.enum(CATALOGUE_KINDS as [CatalogueItem["kind"], ...CatalogueItem["kind"][]]),
    manufacturer: optText(80),
    series: optText(200),
    model: optText(80),
    label: text(200).min(1, "Give the item a label"),
    tier: z.enum(["standard", "premium"]).optional(),
    multiSplitCapable: z.boolean().optional(),
    ports: z.number().int().min(1).max(9).nullable().optional(),
    pairedWith: nullableText(100),
    specs: specsSchema.optional(),
    unit: optText(60),
    category: optText(60),
    customerBlurb: optText(300),
    costPence: z.number().int().min(0).max(100_000_000).nullable(),
    costSource: z
      .object({
        url: url.optional().or(z.literal("").transform(() => undefined)),
        supplier: optText(120),
        observedAt: isoDate.optional().or(z.literal("").transform(() => undefined)),
        vatIncluded: z.boolean().optional(),
        note: optText(1000),
      })
      .optional(),
    supplier: optText(120),
    status: z.enum(["available", "uncertain", "discontinued"]),
    confidence: z.enum(["verified", "provisional", "stale"]),
    verifiedAt: isoDate.optional().or(z.literal("").transform(() => undefined)),
    sources: z.array(z.object({ url, title: optText(300) })).max(30),
    warranty: nullableText(4000),
    notes: optText(8000),
    active: z.boolean(),
  })
  .strict();

export const compatibilityRuleSchema = z
  .object({
    id: z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/i, "The id may only use letters, numbers, dots, dashes and underscores"),
    outdoorModel: text(80).min(1, "Which outdoor model is this rule for?"),
    maxIndoorUnits: z.number().int().min(1).max(9),
    connectableIndoorSeries: z.array(text(200).min(1)).max(50),
    connectableIndoorModels: z.array(text(80).min(1)).max(200),
    minConnectedKw: num.positive().nullable(),
    maxConnectedKw: num.positive().nullable(),
    maxTotalPipeM: num.positive().nullable(),
    maxPipePerRoomM: num.positive().nullable(),
    source: z.object({ url, title: optText(300) }).nullable(),
    confidence: z.enum(["verified", "provisional"]),
    manufacturer: optText(80),
    notes: optText(8000),
  })
  .strict();

/** zod issues as the plain sentences the forms show. */
export function issuesOf(error: z.ZodError): string[] {
  return error.issues.map((i) => {
    const where = i.path.length ? `${i.path.join(".")}: ` : "";
    return `${where}${i.message}`;
  });
}

/** Optional fields absent rather than undefined, specs only when there are any. */
function cleanItem(raw: z.infer<typeof catalogueItemSchema>): CatalogueItem {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) if (v !== undefined) out[k] = v;
  if (raw.costSource) {
    const cs = Object.fromEntries(Object.entries(raw.costSource).filter(([, v]) => v !== undefined));
    if (Object.keys(cs).length) out.costSource = cs;
    else delete out.costSource;
  }
  if (raw.specs) {
    const specs = Object.fromEntries(Object.entries(raw.specs).filter(([, v]) => v !== undefined));
    if (Object.keys(specs).length) out.specs = specs;
    else delete out.specs;
  }
  out.sources = raw.sources.map((s) => (s.title ? { url: s.url, title: s.title } : { url: s.url }));
  return out as unknown as CatalogueItem;
}

/* ------------------------------------------------------------------ */
/* Item writes                                                         */
/* ------------------------------------------------------------------ */

/**
 * Create or update one item. `mode: "create"` refuses an id that's taken
 * (so a typo can't overwrite another item); `"update"` refuses one that
 * isn't there.
 */
export async function saveItem(input: unknown, actor: StaffMember, mode: "create" | "update"): Promise<Result<CatalogueItem>> {
  const parsed = catalogueItemSchema.safeParse(input);
  if (!parsed.success) return fail(issuesOf(parsed.error));
  const item = cleanItem(parsed.data);
  const problems = catalogueItemErrors(item);
  if (problems.length) return fail(problems);
  const existing = await catalogueRepo.get(item.id);
  if (mode === "create" && existing) return fail(`There's already an item with the id "${item.id}". Pick another id, or edit that item.`);
  if (mode === "update" && !existing) return fail("That item doesn't exist any more. Reload the catalogue.");
  const saved = await catalogueRepo.upsert(item);
  await audit({
    actor,
    action: mode === "create" ? "catalogue.create" : "catalogue.update",
    entity: "catalogue_item",
    entityId: item.id,
    detail: existing ? { changed: changedKeys(existing, saved) } : {},
  });
  return { ok: true, value: saved };
}

function changedKeys(a: CatalogueItem, b: CatalogueItem): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => JSON.stringify((a as unknown as Record<string, unknown>)[k]) !== JSON.stringify((b as unknown as Record<string, unknown>)[k]));
}

/** Retire or restore. Items are never deleted: designs and orders point at them. */
export async function setItemActive(id: string, active: boolean, actor: StaffMember): Promise<Result<CatalogueItem>> {
  const saved = await catalogueRepo.setActive(id, active);
  if (!saved) return fail("That item doesn't exist any more.");
  await audit({ actor, action: active ? "catalogue.restore" : "catalogue.retire", entity: "catalogue_item", entityId: id });
  return { ok: true, value: saved };
}

/* ------------------------------------------------------------------ */
/* The researched seed                                                 */
/* ------------------------------------------------------------------ */

export interface SeedSummary {
  items: { added: number; kept: number; replaced: number };
  rules: { added: number; kept: number; replaced: number };
}

/**
 * Upsert RESEARCHED_CATALOGUE and RESEARCHED_COMPATIBILITY. Items and rules
 * already stored are left exactly as they are (supplier costs, edits,
 * retirements) unless `overwrite`, which replaces them with the research.
 */
export async function loadResearchedCatalogue(overwrite: boolean, actor: StaffMember): Promise<SeedSummary> {
  // The research module is large: loaded on demand, server-side only.
  const { RESEARCHED_CATALOGUE, RESEARCHED_COMPATIBILITY } = await import("@aircon/domain/catalogue-data");
  const [items, rules] = await Promise.all([catalogueRepo.list(), compatibilityRepo.list()]);
  const itemPlan = planSeedMerge(items, RESEARCHED_CATALOGUE, overwrite);
  const rulePlan = planSeedMerge(rules, RESEARCHED_COMPATIBILITY, overwrite);
  if (itemPlan.upserts.length) await catalogueRepo.upsertMany(itemPlan.upserts);
  if (rulePlan.upserts.length) await compatibilityRepo.upsertMany(rulePlan.upserts);
  const summary: SeedSummary = {
    items: { added: itemPlan.added, kept: itemPlan.kept, replaced: itemPlan.replaced },
    rules: { added: rulePlan.added, kept: rulePlan.kept, replaced: rulePlan.replaced },
  };
  await audit({ actor, action: "catalogue.load-research", entity: "catalogue", detail: { overwrite, ...summary } });
  return summary;
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

/** A CSV bigger than this is refused before parsing. */
export const CSV_MAX_BYTES = 2 * 1024 * 1024;

export interface CsvPreview {
  rows: { id: string; label: string; kind: CatalogueItem["kind"]; change: "new" | "update" | "same" }[];
  errors: string[];
  counts: { new: number; update: number; same: number };
}

/** What an import would do, row by row, without writing anything. */
/** The rows of an import laid over what's stored (columns the file doesn't have are kept), with their problems. */
async function parseImport(csv: string): Promise<{ merged: { item: CatalogueItem; before: CatalogueItem | undefined }[]; errors: string[] }> {
  const { items, errors, columns } = catalogueFromCsv(csv);
  const existing = new Map((await catalogueRepo.listByIds(items.map((i) => i.id))).map((i) => [i.id, i]));
  const merged = items.map((i) => ({ item: mergeCsvRow(existing.get(i.id), i, columns), before: existing.get(i.id) }));
  const problems = merged.flatMap(({ item }) => catalogueItemErrors(item).map((e) => `${item.id}: ${e}`));
  return { merged: merged.filter(({ item }) => catalogueItemErrors(item).length === 0), errors: [...errors, ...problems] };
}

export async function previewCsv(csv: string): Promise<CsvPreview> {
  if (csv.length > CSV_MAX_BYTES) return { rows: [], errors: ["That file is over 2 MB. Split it and import in parts."], counts: { new: 0, update: 0, same: 0 } };
  const { merged, errors } = await parseImport(csv);
  const rows = merged.map(({ item: i, before }) => {
    const change: "new" | "update" | "same" = !before ? "new" : JSON.stringify(sortKeys(before)) === JSON.stringify(sortKeys(i)) ? "same" : "update";
    return { id: i.id, label: i.label, kind: i.kind, change };
  });
  return {
    rows,
    errors,
    counts: {
      new: rows.filter((r) => r.change === "new").length,
      update: rows.filter((r) => r.change === "update").length,
      same: rows.filter((r) => r.change === "same").length,
    },
  };
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== null && x !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, sortKeys(x)]),
    );
  }
  return v;
}

/** Apply the valid rows of an import (new and changed ones). Rows with errors are never written. */
export async function applyCsv(csv: string, actor: StaffMember): Promise<Result<{ written: number; skipped: number; errors: string[] }>> {
  if (csv.length > CSV_MAX_BYTES) return fail("That file is over 2 MB. Split it and import in parts.");
  const preview = await previewCsv(csv);
  const { merged } = await parseImport(csv);
  const wanted = new Set(preview.rows.filter((r) => r.change !== "same").map((r) => r.id));
  const toWrite = merged.map((m) => m.item).filter((i) => wanted.has(i.id));
  if (toWrite.length) await catalogueRepo.upsertMany(toWrite);
  await audit({ actor, action: "catalogue.import-csv", entity: "catalogue", detail: { written: toWrite.length, errors: preview.errors.length, ids: toWrite.map((i) => i.id).slice(0, 200) } });
  return { ok: true, value: { written: toWrite.length, skipped: preview.counts.same, errors: preview.errors } };
}

/* ------------------------------------------------------------------ */
/* Compatibility rules                                                 */
/* ------------------------------------------------------------------ */

export async function saveRule(input: unknown, actor: StaffMember, mode: "create" | "update"): Promise<Result<CompatibilityRule>> {
  const parsed = compatibilityRuleSchema.safeParse(input);
  if (!parsed.success) return fail(issuesOf(parsed.error));
  const raw = parsed.data;
  const rule: CompatibilityRule = {
    id: raw.id,
    outdoorModel: raw.outdoorModel,
    maxIndoorUnits: raw.maxIndoorUnits,
    connectableIndoorSeries: [...new Set(raw.connectableIndoorSeries)],
    connectableIndoorModels: [...new Set(raw.connectableIndoorModels)],
    minConnectedKw: raw.minConnectedKw,
    maxConnectedKw: raw.maxConnectedKw,
    maxTotalPipeM: raw.maxTotalPipeM,
    maxPipePerRoomM: raw.maxPipePerRoomM,
    source: raw.source ? (raw.source.title ? { url: raw.source.url, title: raw.source.title } : { url: raw.source.url }) : null,
    confidence: raw.confidence,
    ...(raw.manufacturer ? { manufacturer: raw.manufacturer } : {}),
    ...(raw.notes ? { notes: raw.notes } : {}),
  };
  const problems = compatibilityRuleErrors(rule);
  if (problems.length) return fail(problems);
  const existing = await compatibilityRepo.get(rule.id);
  if (mode === "create" && existing) return fail(`There's already a rule with the id "${rule.id}".`);
  if (mode === "update" && !existing) return fail("That rule doesn't exist any more. Reload the rules.");
  const saved = await compatibilityRepo.upsert(rule);
  await audit({ actor, action: mode === "create" ? "compatibility.create" : "compatibility.update", entity: "catalogue_compatibility", entityId: rule.id, detail: { confidence: rule.confidence } });
  return { ok: true, value: saved };
}

/**
 * Delete a rule. Designs already made keep their own copy of the check;
 * new multi-splits on that outdoor unit are blocked until a rule is back.
 */
export async function deleteRule(id: string, actor: StaffMember): Promise<Result<null>> {
  const existing = await compatibilityRepo.get(id);
  if (!existing) return fail("That rule doesn't exist any more.");
  await compatibilityRepo.remove(id);
  await audit({ actor, action: "compatibility.delete", entity: "catalogue_compatibility", entityId: id, detail: { outdoorModel: existing.outdoorModel } });
  return { ok: true, value: null };
}
