import { TAX_CODES, effectiveTaxCode, type PilotSettings } from "./settings.ts";
import type { CapacityKw, QuoteResult, Survey } from "./types.ts";

/**
 * What an online quote costs us to deliver, and the margin left in its price.
 *
 * The pricing engine (pricing.ts) sets the customer's price from rules
 * (system size, floors, outdoor position, electrics). This prices the same
 * design from the other side: equipment and materials at planning costs,
 * labour from the day rates in Settings, the VAT we can't reclaim, and the
 * contingency and overhead from Settings. Both read one survey, so a rule
 * changed here or in the engine changes every home's numbers at once:
 * correct it for the pilot homes and it's corrected for the whole area.
 *
 * PLANNING_COSTS are researched retail figures (docs/research/planning-costs.md),
 * ex VAT, for budgeting until trade prices replace them. Proposals cost a
 * surveyed design from the Catalogue instead (costing.ts); this is the
 * before-survey view. Integer pence throughout. Pure.
 */

export type EquipmentTier = "standard" | "premium";

export const PLANNING_COSTS = {
  researchedAt: "2026-10-21",
  /** Single-split pair kit (indoor + outdoor), ex VAT. */
  singleSplitKitPence: {
    standard: { 2.5: 56_500, 3.5: 67_500, 5.0: 86_500, 7.1: 135_500 },
    premium: { 2.5: 84_000, 3.5: 94_500, 5.0: 133_500, 7.1: 188_000 },
  } satisfies Record<EquipmentTier, Record<CapacityKw, number>>,
  /** Multi-split outdoor unit by indoor units served, ex VAT. */
  multiOutdoorPence: { 2: 129_500, 3: 174_500, 4: 255_500 } as Record<number, number>,
  /** Multi-split indoor head, ex VAT. 7.1 kW is an estimate (no listing found). */
  multiIndoorPence: { 2.5: 25_500, 3.5: 28_500, 5.0: 36_500, 7.1: 52_000 } satisfies Record<CapacityKw, number>,
  /** A premium multi-split (quiet heads, a better outdoor unit) costs this much more. */
  multiPremiumUpliftPct: 25,
  /** Pipe pair, bracket, trunking, isolator, interconnect and sundries, per indoor unit, ex VAT. */
  materialsPerRoomPence: 19_000,
  /** Extra pipe and trunking for a room above the ground floor, ex VAT. */
  extraRunByFloorPence: { ground: 0, first: 3_000, "second-plus": 6_000, loft: 8_000 } as Record<string, number>,
  /** A room with no external wall: a condensate pump and the longer concealed run. */
  internalRoutingPence: 8_400 + 4_000,
  /** Mounting the outdoor unit, by position, ex VAT (feet and pad on the ground; brackets on a wall). */
  outdoorMountPence: {
    "ground-rear": 3_500,
    "ground-side": 3_500,
    "wall-bracket": 2_500,
    "flat-roof": 9_000,
    balcony: 4_000,
    unsure: 3_500,
  } as Record<string, number>,
  /** Electrics materials beyond the isolator: a new circuit from an old board, or a way freed on a full one. */
  electricsMaterialsPence: { "older-fuse-box": 9_000, "modern-full": 4_000, "modern-spare-ways": 2_000, unsure: 2_000 } as Record<string, number>,
  /** Labour plan: a crew of two for the engine's install days; the electrician and technical lead by job size. */
  crewSize: 2,
  techLeadDays: 0.5,
  electricianDays: { upToTwoRooms: 0.5, more: 1, olderBoardExtra: 0.5 },
} as const;

/** Representative models for each size, for the price check's "what we'd fit" column. */
export const SUGGESTED_UNITS: Record<EquipmentTier, Record<CapacityKw, string>> = {
  standard: {
    2.5: "Daikin Sensira FTXF25 / Mitsubishi MSZ-HR25",
    3.5: "Daikin Sensira FTXF35 / Mitsubishi MSZ-HR35",
    5.0: "Daikin Sensira FTXF50 / Mitsubishi MSZ-HR50",
    7.1: "Daikin Sensira FTXF71 / Mitsubishi MSZ-AP71",
  },
  premium: {
    2.5: "Daikin Perfera FTXM25 / Mitsubishi MSZ-LN25",
    3.5: "Daikin Perfera FTXM35 / Mitsubishi MSZ-LN35",
    5.0: "Daikin Perfera FTXM50 / Mitsubishi MSZ-LN50",
    7.1: "Daikin Perfera FTXM71 / Panasonic Etherea Z71",
  },
};

const MULTI_OUTDOOR_MODELS: Record<number, string> = {
  2: "2-port multi outdoor (Daikin 2MXM50 / Mitsubishi MXZ-2F53)",
  3: "3-port multi outdoor (Daikin 3MXM52 or 3MXM68 / Mitsubishi MXZ-3F54 or 3F68)",
  4: "4-port multi outdoor (Daikin 4MXM80 / Mitsubishi MXZ-4F83)",
};

export type CostGroup = "equipment" | "materials" | "labour" | "subcontract" | "vat" | "contingency" | "overhead";

export interface QuoteCostLine {
  group: CostGroup;
  label: string;
  /** What the figure is built from, in words. */
  basis: string;
  amountPence: number;
}

export interface QuoteCost {
  tier: EquipmentTier;
  lines: QuoteCostLine[];
  costPence: number;
  /** What the customer pays (the engine's total, plus the premium uplift for premium). */
  priceTotalPence: number;
  /** The price less any VAT we'd charge on it: what's ours. */
  priceNetPence: number;
  profitPence: number;
  marginPct: number;
  minMarginPct: number;
  belowMinMargin: boolean;
  /** The lowest price that meets the minimum margin, to the pound, VAT inclusive. */
  priceAtMinMarginPence: number;
  units: { system: string; unit: string; costPence: number }[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Cost and margin for a quote. `quote` must be generateQuote(survey): the
 * design (unit sizes, single or multi) is read from it, the rest from the
 * survey.
 */
export function costQuote(survey: Survey, quote: QuoteResult, settings: PilotSettings, tier: EquipmentTier = "standard"): QuoteCost {
  const C = PLANNING_COSTS;
  const lines: QuoteCostLine[] = [];
  const units: QuoteCost["units"] = [];
  const add = (group: CostGroup, label: string, basis: string, amountPence: number) => {
    // Whole pounds: these are planning figures, and pence would suggest a precision they don't have.
    const rounded = Math.round(amountPence / 100) * 100;
    if (rounded > 0) lines.push({ group, label, basis, amountPence: rounded });
  };

  // Equipment, from the engine's design.
  const multiUplift = tier === "premium" ? 1 + C.multiPremiumUpliftPct / 100 : 1;
  for (const system of quote.systems) {
    if (system.topology === "single") {
      const room = system.rooms[0]!;
      const cost = C.singleSplitKitPence[tier][room.capacityKw];
      const unit = SUGGESTED_UNITS[tier][room.capacityKw];
      add("equipment", `${room.roomName}: ${room.capacityKw.toFixed(1)} kW single split`, unit, cost);
      units.push({ system: room.roomName, unit, costPence: cost });
    } else {
      const ports = Math.min(4, Math.max(2, system.rooms.length));
      const outdoor = Math.round((C.multiOutdoorPence[ports]! * multiUplift) / 100) * 100;
      add("equipment", `${ports}-port multi-split outdoor unit`, MULTI_OUTDOOR_MODELS[ports]!, outdoor);
      units.push({ system: `Outdoor (${system.rooms.length} rooms)`, unit: MULTI_OUTDOOR_MODELS[ports]!, costPence: outdoor });
      for (const room of system.rooms) {
        const head = Math.round((C.multiIndoorPence[room.capacityKw] * multiUplift) / 100) * 100;
        const unit = `${room.capacityKw.toFixed(1)} kW multi head (${tier === "premium" ? "Daikin FTXM / Mitsubishi MSZ-LN" : "Daikin FTXM / Mitsubishi MSZ-AY"})`;
        add("equipment", `${room.roomName}: ${room.capacityKw.toFixed(1)} kW indoor head`, unit, head);
        units.push({ system: room.roomName, unit, costPence: head });
      }
    }
  }

  // Materials, per room and per job.
  const rooms = survey.rooms.length;
  add("materials", `Pipe, trunking, brackets and cable × ${rooms}`, `${gbpWords(C.materialsPerRoomPence)} a room`, C.materialsPerRoomPence * rooms);
  const upstairs = survey.rooms.reduce((s, r) => s + (C.extraRunByFloorPence[r.floor] ?? 0), 0);
  add("materials", "Longer runs to upstairs rooms", "By each room's floor", upstairs);
  const internal = survey.rooms.filter((r) => !r.hasExternalWall).length;
  add("materials", `Condensate pump and concealed run × ${internal}`, "Rooms with no external wall", C.internalRoutingPence * internal);
  const outdoorUnits = quote.systems.length;
  add(
    "materials",
    `Outdoor unit mounting × ${outdoorUnits}`,
    survey.outdoor.location,
    (C.outdoorMountPence[survey.outdoor.location] ?? C.outdoorMountPence.unsure!) * outdoorUnits,
  );
  add("materials", "Electrics materials", survey.electrics.condition, C.electricsMaterialsPence[survey.electrics.condition] ?? 0);

  // Labour from the day rates in Settings.
  const rates = settings.pricing.labourRates;
  const personDays = C.crewSize * quote.installDays;
  add("labour", `Installers: ${C.crewSize} × ${quote.installDays} day${quote.installDays === 1 ? "" : "s"}`, `${gbpWords(rates.installerDayPence)} a day (Settings)`, personDays * rates.installerDayPence);
  add("labour", `Technical lead: commissioning and sign-off, ${C.techLeadDays} day`, `${gbpWords(rates.techLeadDayPence)} a day (Settings)`, C.techLeadDays * rates.techLeadDayPence);
  const sparkyDays =
    (rooms > 2 || outdoorUnits > 1 ? C.electricianDays.more : C.electricianDays.upToTwoRooms) +
    (survey.electrics.condition === "older-fuse-box" ? C.electricianDays.olderBoardExtra : 0);
  add("subcontract", `Electrician (Part P): ${sparkyDays} day${sparkyDays === 1 ? "" : "s"}`, `${gbpWords(rates.electricianDayPence)} a day (Settings)`, sparkyDays * rates.electricianDayPence);

  // VAT on what we buy, when we can't reclaim it.
  if (!settings.tax.vatRegistered) {
    const bought = lines.filter((l) => l.group === "equipment" || l.group === "materials" || l.group === "subcontract").reduce((s, l) => s + l.amountPence, 0);
    add("vat", "VAT we can't reclaim (20%)", "On equipment, materials and the electrician: not VAT registered", bought * 0.2);
  }

  const subtotal = lines.reduce((s, l) => s + l.amountPence, 0);
  add("contingency", `Contingency ${settings.pricing.contingencyPct}%`, "Settings → Pricing", (subtotal * settings.pricing.contingencyPct) / 100);
  add("overhead", "Overhead per job", "Settings → Pricing", settings.pricing.overheadPerJobPence);
  const costPence = lines.reduce((s, l) => s + l.amountPence, 0);

  // The price: the engine's, plus the premium uplift from Settings for the quiet tier.
  const uplift = tier === "premium" ? 1 + settings.pricing.premiumUpliftPct / 100 : 1;
  const priceTotalPence = Math.round(quote.totalGbp * uplift) * 100;
  const taxRate = (TAX_CODES[effectiveTaxCode(settings)]?.ratePct ?? 0) / 100;
  const priceNetPence = Math.round(priceTotalPence / (1 + taxRate));
  const profitPence = priceNetPence - costPence;
  const marginPct = priceNetPence > 0 ? round1((profitPence / priceNetPence) * 100) : 0;
  const minMarginPct = settings.pricing.minMarginPct;
  const minNet = minMarginPct < 100 ? costPence / (1 - minMarginPct / 100) : costPence;
  const priceAtMinMarginPence = Math.ceil((minNet * (1 + taxRate)) / 100) * 100;

  return {
    tier,
    lines,
    costPence,
    priceTotalPence,
    priceNetPence,
    profitPence,
    marginPct,
    minMarginPct,
    belowMinMargin: marginPct < minMarginPct,
    priceAtMinMarginPence,
    units,
  };
}

function gbpWords(pence: number): string {
  return `£${(pence / 100).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}
