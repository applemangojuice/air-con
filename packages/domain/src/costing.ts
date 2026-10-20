import type { CatalogueItem } from "./catalogue.ts";
import type { DesignVariant } from "./design-record.ts";
import { generateQuote } from "./pricing.ts";
import { TAX_CODES, effectiveTaxCode, type PilotSettings, type TaxCodeId } from "./settings.ts";
import type { Survey } from "./types.ts";

/**
 * Costing: what a design costs us, and what we charge for it.
 *
 * Two numbers, kept apart on purpose. The list price is the pricing
 * engine re-run on the surveyed design (so any discount is off a genuine
 * reference price). The cost build-up is catalogue costs plus labour,
 * subcontract, access, delivery, contingency and overhead. Margin is the
 * gap, before and after discount, and a proposal below the minimum margin
 * can't issue without an override. All integer pence.
 *
 * Honest about gaps: a catalogue item with no cost is an unpriced line
 * (`unitCostPence: null`), never £0, and the margin built on top of it is
 * incomplete (`unpricedCostLines > 0`). Pure and deterministic, so the ops
 * builder previews in the browser exactly what the server stores.
 */

export type CostCategory =
  | "equipment"
  | "materials"
  | "labour"
  | "subcontract"
  | "access"
  | "delivery"
  | "consumables"
  | "contingency"
  | "overhead";

export interface CostLine {
  id: string;
  category: CostCategory;
  label: string;
  qty: number;
  unit: string;
  unitCostPence: number | null;
  totalPence: number | null;
  source?: string;
  catalogueItemId?: string;
  verified: boolean;
  /** The supplier's VAT-inclusive price, used as it is (we aren't VAT registered, so no input VAT goes on top). */
  vatIncluded?: boolean;
}

export interface LabourPlan {
  crewSize: number;
  installerDays: number;
  electricianDays: number;
  techLeadDays: number;
}

export interface PriceLine {
  id: string;
  label: string;
  detail?: string;
  amountPence: number;
  kind: "system" | "room" | "extra" | "discount" | "fee";
}

export interface OptionPricing {
  pricingBasis: "engine" | "cost-plus" | "manual";
  manualReason?: string;
  listNetPence: number;
  discount?: { code: string; label: string; reason: string; amountPence: number };
  netPence: number;
  taxCode: TaxCodeId;
  taxPence: number;
  totalPence: number;
  costPence: number;
  unpricedCostLines: number;
  grossMarginPct: number;
  grossMarginPctBeforeDiscount: number;
  contributionPence: number;
  belowMinMargin: boolean;
}

/** A pricing input that can't be priced as given (the builder shows the message as is). */
export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricingError";
  }
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
const round1 = (n: number) => Math.round(n * 10) / 10;
/** To the nearest whole pound, in pence. Customer prices never carry odd pence. */
export const roundToPound = (pence: number) => Math.round(pence / 100) * 100;
const isWholePence = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);

/** Gross margin on a price: (price − cost) / price, as a % to one decimal. 0 for a price of 0. */
export function marginPct(pricePence: number, costPence: number): number {
  return pricePence > 0 ? round1(((pricePence - costPence) / pricePence) * 100) : 0;
}

/** Markup on cost: (price − cost) / cost, as a % to one decimal; null when there's no cost to mark up. Not the margin. */
export function markupPct(pricePence: number, costPence: number): number | null {
  return costPence > 0 ? round1(((pricePence - costPence) / costPence) * 100) : null;
}

/* ------------------------------------------------------------------ */
/* List price                                                          */
/* ------------------------------------------------------------------ */

/**
 * The engine's price for a survey, net of any VAT, in pence: the genuine
 * reference price every discount is measured against.
 *
 * One rule for what the customer pays: the engine's total is the price the
 * online quote shows them ("your price, confirmed at your survey"), whatever
 * the tax position, so the net is that total less the tax the proposal will
 * add back under the business's tax code (effectiveTaxCode). Registered at
 * 20%: total / 1.2. Not registered (outside scope) or zero-rated: the total
 * itself, so an unchanged design's proposal total equals the online price
 * under every tax code.
 */
export function engineListNetPence(survey: Survey, settings: PilotSettings): number {
  const rate = TAX_CODES[effectiveTaxCode(settings)]?.ratePct ?? 0;
  return Math.round((generateQuote(survey).totalGbp * 100) / (1 + rate / 100));
}

/* ------------------------------------------------------------------ */
/* Labour                                                              */
/* ------------------------------------------------------------------ */

/**
 * The default labour plan for a variant: a crew of two installers for the
 * install block, an electrician for half a day (a whole day when there's
 * more than one circuit or more than two rooms), and the technical lead for
 * the commissioning day. Placeholders until the pilots' time logs say
 * otherwise; the builder edits them per option.
 */
export function defaultLabourPlan(variant: DesignVariant, settings: PilotSettings): LabourPlan {
  const days = variant.installDays > 0 ? variant.installDays : settings.scheduling.installBlockDays;
  const rooms = variant.roomUnits.length;
  const bigger = variant.systems.length > 1 || rooms > 2;
  return { crewSize: 2, installerDays: days, electricianDays: bigger ? 1 : 0.5, techLeadDays: 1 };
}

/* ------------------------------------------------------------------ */
/* Cost build-up                                                       */
/* ------------------------------------------------------------------ */

export type AccessEquipment = "none" | "ladder" | "podium" | "tower" | "scaffold" | "mewp";

/** Hire that goes on the cost build-up when a chosen outdoor position needs it (a ladder is the crew's own). */
const ACCESS_HIRE: { kind: "podium" | "tower" | "scaffold" | "mewp"; re: RegExp; label: string }[] = [
  { kind: "tower", re: /tower/i, label: "Access tower hire" },
  { kind: "podium", re: /podium/i, label: "Podium steps hire" },
  { kind: "scaffold", re: /scaffold/i, label: "Scaffold hire" },
  { kind: "mewp", re: /\bmewp\b|cherry picker|boom lift|scissor lift/i, label: "MEWP hire" },
];

/** A cost typed in on the proposal for a line the catalogue can't price (ex VAT). */
export interface CostOverride {
  unitCostPence: number;
  note?: string;
}

/** Categories bought from someone else, which carry VAT we can't reclaim when we aren't registered. */
const SUPPLIER_CATEGORIES: ReadonlySet<CostCategory> = new Set<CostCategory>([
  "equipment",
  "materials",
  "consumables",
  "subcontract",
  "access",
  "delivery",
]);

/** Lines worked out from the others, which an override can't replace. */
export const DERIVED_COST_LINE_IDS: ReadonlySet<string> = new Set(["input-vat", "contingency"]);

const INPUT_VAT_PCT = 20;

const BOM_CATEGORY: Record<DesignVariant["bom"][number]["category"], CostCategory> = {
  equipment: "equipment",
  materials: "materials",
  consumables: "consumables",
};

/** One catalogue service/tool item for a job-level line (delivery, access hire, consumables), if the catalogue has one. */
function serviceItem(catalogue: CatalogueItem[], test: (i: CatalogueItem) => boolean): CatalogueItem | undefined {
  return catalogue.find((i) => i.active && test(i));
}

const cat = (i: CatalogueItem) => (i.category ?? "").toLowerCase();

function sourceOf(item: CatalogueItem): string {
  const parts = ["Catalogue"];
  if (item.costSource?.supplier || item.supplier) parts.push(item.costSource?.supplier ?? item.supplier ?? "");
  if (item.costSource?.observedAt) parts.push(`seen ${item.costSource.observedAt.slice(0, 10)}`);
  if (item.confidence !== "verified") parts.push(item.confidence);
  return parts.filter(Boolean).join(", ");
}

/**
 * What the variant costs us, line by line: equipment and materials from the
 * catalogue by BOM line, labour from the plan × the day rates in settings,
 * the electrician as subcontract unless one is in-house, access hire when
 * an outdoor position needs a tower or scaffold, delivery, consumables, then
 * (when we aren't VAT registered) the 20% VAT on supplier costs we can't
 * reclaim as its own line, contingency on the subtotal, and the overhead per
 * job.
 *
 *  * A catalogue cost marked `vatIncluded` is used gross when we can't
 *    reclaim VAT (so no input VAT is added on it) and net of 20% when we can.
 *  * Install-only contracts leave the equipment out: the customer supplies it.
 *  * `overrides` fill in (or correct) a line's unit cost, ex VAT, by line id.
 *    They're how a pilot proposal gets priced while the catalogue is mostly
 *    blank. The derived lines (input VAT, contingency) can't be overridden.
 *  * Unpriced lines stay in, with null costs, and count toward nothing.
 */
export function buildCostLines(input: {
  variant: DesignVariant;
  catalogue: CatalogueItem[];
  labour: LabourPlan;
  settings: PilotSettings;
  extras?: CostLine[];
  /** An active, in-house Part P electrician: their day is labour, not subcontract. Default false. */
  inHouseElectrician?: boolean;
  /** Access equipment the chosen outdoor positions need (from the survey). */
  accessEquipment?: AccessEquipment[];
  /** Install-only: the customer supplies the equipment. Default supply-and-install. */
  contractType?: "supply-and-install" | "install-only";
  overrides?: Record<string, CostOverride>;
}): CostLine[] {
  const { variant, catalogue, labour, settings } = input;
  const vatRegistered = settings.tax.vatRegistered;
  const byId = new Map(catalogue.map((i) => [i.id, i]));
  const overrides = input.overrides ?? {};
  const lines: CostLine[] = [];
  /** Lines whose cost already includes VAT we pay and can't reclaim: no input VAT on top. */
  const grossLines = new Set<string>();

  const push = (line: Omit<CostLine, "totalPence">, opts: { gross?: boolean } = {}) => {
    let unit = line.unitCostPence;
    let source = line.source;
    let verified = line.verified;
    const o = overrides[line.id];
    if (o && !DERIVED_COST_LINE_IDS.has(line.id) && isWholePence(o.unitCostPence) && o.unitCostPence >= 0) {
      unit = o.unitCostPence;
      source = `Entered on the proposal${o.note?.trim() ? `: ${o.note.trim()}` : ""}`;
      verified = false;
    } else if (opts.gross) {
      grossLines.add(line.id);
    }
    lines.push({
      ...line,
      unitCostPence: unit,
      totalPence: unit === null ? null : Math.round(line.qty * unit),
      ...(source ? { source } : {}),
      verified,
      ...(grossLines.has(line.id) ? { vatIncluded: true } : {}),
    });
  };

  // Equipment, materials and consumables from the BOM, one line per item.
  const merged = new Map<string, { line: DesignVariant["bom"][number]; qty: number }>();
  for (const b of variant.bom) {
    if (!(b.qty > 0)) continue;
    const category = BOM_CATEGORY[b.category] ?? "materials";
    if (category === "equipment" && input.contractType === "install-only") continue;
    const key = `bom:${b.catalogueItemId ?? b.sku}:${category}`;
    const seen = merged.get(key);
    if (seen) seen.qty += b.qty;
    else merged.set(key, { line: b, qty: b.qty });
  }
  for (const [id, { line: b, qty }] of merged) {
    const category = BOM_CATEGORY[b.category] ?? "materials";
    const item = b.catalogueItemId ? byId.get(b.catalogueItemId) : undefined;
    const raw = item?.costPence ?? null;
    const vatIncluded = item?.costSource?.vatIncluded === true;
    const unitCost = raw === null ? null : vatIncluded && vatRegistered ? Math.round(raw / 1.2) : raw;
    push(
      {
        id,
        category,
        label: item?.label ?? b.label,
        qty,
        unit: b.unit ?? item?.unit ?? "each",
        unitCostPence: unitCost,
        source: item ? sourceOf(item) : "Not in the catalogue",
        ...(b.catalogueItemId ? { catalogueItemId: b.catalogueItemId } : {}),
        verified: Boolean(item && item.confidence === "verified" && raw !== null),
      },
      { gross: vatIncluded && !vatRegistered && raw !== null },
    );
  }

  // Consumables, when the BOM didn't list any.
  if (![...merged.values()].some((m) => m.line.category === "consumables")) {
    const item = serviceItem(catalogue, (i) => i.kind === "material" && cat(i) === "consumables");
    push(
      {
        id: "consumables",
        category: "consumables",
        label: item?.label ?? "Consumables: sealant, fixings, tape",
        qty: 1,
        unit: "job",
        unitCostPence: item?.costPence ?? null,
        source: item ? sourceOf(item) : "No catalogue price yet",
        ...(item ? { catalogueItemId: item.id } : {}),
        verified: Boolean(item && item.confidence === "verified" && item.costPence !== null),
      },
      { gross: Boolean(item?.costSource?.vatIncluded && !vatRegistered && item.costPence !== null) },
    );
  }

  // Labour, from the day rates in settings.
  const rates = settings.pricing.labourRates;
  const crew = Math.max(0, labour.crewSize);
  const installerPersonDays = crew * Math.max(0, labour.installerDays);
  if (installerPersonDays > 0) {
    push({
      id: "labour:installers",
      category: "labour",
      label: `Installers: ${crew} × ${labour.installerDays} day${labour.installerDays === 1 ? "" : "s"}`,
      qty: installerPersonDays,
      unit: "person-day",
      unitCostPence: rates.installerDayPence,
      source: "Day rate in settings",
      verified: false,
    });
  }
  if (labour.techLeadDays > 0) {
    push({
      id: "labour:tech-lead",
      category: "labour",
      label: "Technical lead: commissioning and sign-off (F-gas)",
      qty: labour.techLeadDays,
      unit: "day",
      unitCostPence: rates.techLeadDayPence,
      source: "Day rate in settings",
      verified: false,
    });
  }
  if (labour.electricianDays > 0) {
    const inHouse = input.inHouseElectrician === true;
    push({
      id: inHouse ? "labour:electrician" : "subcontract:electrician",
      category: inHouse ? "labour" : "subcontract",
      label: inHouse ? "Electrician (Part P): new circuit and certificate" : "Electrician, subcontracted (Part P): new circuit and certificate",
      qty: labour.electricianDays,
      unit: "day",
      unitCostPence: rates.electricianDayPence,
      source: inHouse ? "Day rate in settings" : "Day rate in settings (no in-house Part P electrician)",
      verified: false,
    });
  }

  // Access hire, when an outdoor position needs more than a ladder: a priced catalogue item first, then the
  // hire price in Settings → Safety; with neither, the line stays unpriced and the proposal waits for a price.
  for (const { kind, re, label } of ACCESS_HIRE) {
    if (!(input.accessEquipment ?? []).includes(kind)) continue;
    const matches = catalogue.filter((i) => i.active && (i.kind === "tool" || i.kind === "service") && re.test(`${i.label} ${i.model ?? ""} ${cat(i)}`));
    const item = matches.find((i) => i.costPence !== null) ?? matches[0];
    const setting = settings.safety?.accessHirePence?.[kind];
    const fromSettings = (!item || item.costPence === null) && typeof setting === "number";
    push(
      {
        id: `access:${kind}`,
        category: "access",
        label: item?.label ?? label,
        qty: 1,
        unit: "hire",
        unitCostPence: fromSettings ? setting : (item?.costPence ?? null),
        source: fromSettings ? "Hire price in Settings → Safety" : item ? sourceOf(item) : "No hire price yet: type it in, or set it in Settings → Safety",
        ...(item && !fromSettings ? { catalogueItemId: item.id } : {}),
        verified: Boolean(!fromSettings && item && item.confidence === "verified" && item.costPence !== null),
      },
      { gross: Boolean(!fromSettings && item?.costSource?.vatIncluded && !vatRegistered && item.costPence !== null) },
    );
  }

  // Delivery of the kit (not needed when the customer supplies it).
  if (input.contractType !== "install-only") {
    const item = serviceItem(catalogue, (i) => i.kind === "service" && (cat(i) === "delivery" || /deliver/i.test(i.label)));
    push(
      {
        id: "delivery",
        category: "delivery",
        label: item?.label ?? "Kit delivery",
        qty: 1,
        unit: "drop",
        unitCostPence: item?.costPence ?? null,
        source: item ? sourceOf(item) : "No catalogue price yet",
        ...(item ? { catalogueItemId: item.id } : {}),
        verified: Boolean(item && item.confidence === "verified" && item.costPence !== null),
      },
      { gross: Boolean(item?.costSource?.vatIncluded && !vatRegistered && item.costPence !== null) },
    );
  }

  // Anything else the builder added (entered ex VAT).
  for (const extra of input.extras ?? []) {
    if (DERIVED_COST_LINE_IDS.has(extra.id) || lines.some((l) => l.id === extra.id)) continue;
    push({ ...extra, unitCostPence: extra.unitCostPence });
  }

  // VAT on supplier costs we can't reclaim while not registered.
  if (!vatRegistered) {
    const base = sum(
      lines.filter((l) => SUPPLIER_CATEGORIES.has(l.category) && l.totalPence !== null && !grossLines.has(l.id)).map((l) => l.totalPence!),
    );
    if (base > 0) {
      push({
        id: "input-vat",
        category: "overhead",
        label: `VAT we can't reclaim (${INPUT_VAT_PCT}% on supplier costs: we aren't VAT registered)`,
        qty: 1,
        unit: "job",
        unitCostPence: Math.round((base * INPUT_VAT_PCT) / 100),
        source: "Worked out from the supplier lines above",
        verified: true,
      });
    }
  }

  // Contingency on everything priced so far, then the overhead per job.
  const pct = settings.pricing.contingencyPct;
  if (pct > 0) {
    const subtotal = sum(lines.filter((l) => l.totalPence !== null).map((l) => l.totalPence!));
    push({
      id: "contingency",
      category: "contingency",
      label: `Contingency (${pct}% of the costs above)`,
      qty: 1,
      unit: "job",
      unitCostPence: Math.round((subtotal * pct) / 100),
      source: "Contingency % in settings",
      verified: true,
    });
  }
  if (settings.pricing.overheadPerJobPence > 0) {
    push({
      id: "overhead",
      category: "overhead",
      label: "Overhead per job",
      qty: 1,
      unit: "job",
      unitCostPence: settings.pricing.overheadPerJobPence,
      source: "Overhead per job in settings",
      verified: true,
    });
  }
  return lines;
}

/* ------------------------------------------------------------------ */
/* Pricing                                                             */
/* ------------------------------------------------------------------ */

/**
 * Price one option from its cost lines.
 *
 * List price (net of VAT), by basis:
 *  * engine: the engine's net price for the surveyed design; a premium
 *    option adds `premiumUpliftPct`. To the nearest pound.
 *  * cost-plus: cost / (1 − target margin), rounded UP to the next £10, so
 *    the margin never lands under the target. The target defaults to the
 *    minimum margin in settings.
 *  * manual: the amount given, which needs a reason.
 *
 * Then the discount (a settings code: a percentage, a fixed amount, or the
 * custom code with an amount and a reason), to the nearest pound and never
 * more than the price; tax from TAX_CODES on the discounted net (no VAT at
 * all unless VAT registered; a registered business may pass an override
 * code); and the margins: gross margin = (net − cost) / net on every cost
 * line including the overhead allocation, before and after the discount;
 * contribution = net − the direct costs (everything but the overhead per
 * job). A margin built on unpriced lines is incomplete: `unpricedCostLines`
 * says how many, the UI says so, and the proposal can't issue until they're
 * priced or an admin overrides (proposalIssueErrors and the proposal-issue
 * gate fail closed: `belowMinMargin` only judges the costs that are known).
 * Cost-plus refuses to price while any equipment line is unpriced.
 *
 * Throws PricingError for an input it can't honestly price.
 */
export function priceOption(input: {
  costLines: CostLine[];
  basis: OptionPricing["pricingBasis"];
  engineNetPence: number;
  manualNetPence?: number;
  manualReason?: string;
  discountCode?: string;
  customDiscountPence?: number;
  discountReason?: string;
  settings: PilotSettings;
  tier: "standard" | "premium";
  /** cost-plus only: the gross margin to price to. Default: the minimum margin in settings. */
  targetMarginPct?: number;
  /** VAT registered only: an override of the settings' tax code (the proposal records why). */
  taxCode?: TaxCodeId;
}): OptionPricing {
  const { settings } = input;
  const priced = input.costLines.filter((l) => l.totalPence !== null);
  const costPence = sum(priced.map((l) => l.totalPence!));
  const directCostPence = sum(priced.filter((l) => l.id !== "overhead").map((l) => l.totalPence!));
  const unpricedCostLines = input.costLines.length - priced.length;

  // List price.
  let listNetPence: number;
  let manualReason: string | undefined;
  switch (input.basis) {
    case "engine": {
      if (!isWholePence(input.engineNetPence) || input.engineNetPence <= 0) {
        throw new PricingError("There's no engine price for this design yet. Use cost-plus or a manual price.");
      }
      const uplift = input.tier === "premium" ? settings.pricing.premiumUpliftPct : 0;
      listNetPence = roundToPound(input.engineNetPence * (1 + uplift / 100));
      break;
    }
    case "cost-plus": {
      const target = input.targetMarginPct ?? settings.pricing.minMarginPct;
      if (!(target >= 0 && target < 100)) throw new PricingError("The target margin must be between 0% and 99%.");
      if (costPence <= 0) throw new PricingError("Cost-plus needs at least one priced cost line.");
      // A price built on unpriced equipment would sit far below the target
      // margin it claims: the units are most of the cost.
      const kitUnpriced = input.costLines.filter((l) => l.category === "equipment" && l.totalPence === null).length;
      if (kitUnpriced > 0) {
        throw new PricingError(
          `Cost-plus needs the equipment priced: ${kitUnpriced} equipment line${kitUnpriced === 1 ? " has" : "s have"} no cost yet. Type the cost in the build-up, or price it in the catalogue.`,
        );
      }
      listNetPence = Math.ceil(costPence / (1 - target / 100) / 1000) * 1000;
      break;
    }
    case "manual": {
      if (!isWholePence(input.manualNetPence) || input.manualNetPence <= 0) {
        throw new PricingError("Enter the manual price (before any VAT).");
      }
      manualReason = input.manualReason?.trim();
      if (!manualReason) throw new PricingError("A manual price needs a reason.");
      listNetPence = input.manualNetPence;
      break;
    }
    default:
      throw new PricingError("Choose how to price this option.");
  }

  // Discount.
  let discount: OptionPricing["discount"];
  const code = input.discountCode?.trim().toUpperCase();
  const custom = input.customDiscountPence;
  const reasonGiven = input.discountReason?.trim();
  if (code) {
    const found = settings.discounts.find((d) => d.code.trim().toUpperCase() === code);
    if (!found || !found.active) throw new PricingError(`The discount code ${code} isn't active in settings.`);
    let raw: number;
    let reason = reasonGiven || found.reason;
    if (typeof found.pct === "number" && found.pct > 0) {
      raw = (listNetPence * found.pct) / 100;
    } else if (isWholePence(found.amountPence) && found.amountPence > 0) {
      raw = found.amountPence;
    } else {
      // A per-job code: the amount and the reason come from the proposal.
      if (!isWholePence(custom) || custom <= 0) throw new PricingError(`Enter the discount amount for ${found.code}.`);
      if (!reasonGiven) throw new PricingError(`Say why this home gets the ${found.code} discount.`);
      raw = custom;
      reason = reasonGiven;
    }
    const amountPence = Math.min(listNetPence, roundToPound(raw));
    if (amountPence > 0) discount = { code: found.code, label: found.label, reason, amountPence };
  } else if (custom !== undefined && custom !== 0) {
    if (!isWholePence(custom) || custom < 0) throw new PricingError("A discount must be a positive amount.");
    if (!reasonGiven) throw new PricingError("A custom discount needs a reason.");
    const amountPence = Math.min(listNetPence, roundToPound(custom));
    if (amountPence > 0) discount = { code: "CUSTOM", label: "Pilot discount", reason: reasonGiven, amountPence };
  }
  const netPence = listNetPence - (discount?.amountPence ?? 0);

  // Tax on the discounted net.
  let taxCode: TaxCodeId = effectiveTaxCode(settings);
  if (settings.tax.vatRegistered && input.taxCode && input.taxCode !== "outside-scope" && TAX_CODES[input.taxCode]) {
    taxCode = input.taxCode;
  }
  const taxPence = Math.round((netPence * TAX_CODES[taxCode].ratePct) / 100);

  const grossMarginPct = marginPct(netPence, costPence);
  return {
    pricingBasis: input.basis,
    ...(manualReason ? { manualReason } : {}),
    listNetPence,
    ...(discount ? { discount } : {}),
    netPence,
    taxCode,
    taxPence,
    totalPence: netPence + taxPence,
    costPence,
    unpricedCostLines,
    grossMarginPct,
    grossMarginPctBeforeDiscount: marginPct(listNetPence, costPence),
    contributionPence: netPence - directCostPence,
    belowMinMargin: netPence <= 0 || grossMarginPct < settings.pricing.minMarginPct,
  };
}
