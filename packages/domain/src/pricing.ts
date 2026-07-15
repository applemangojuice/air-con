import { estimateRoomLoadWatts, selectCapacityKw } from "./heatload.ts";
import { getPermutation } from "./archetypes.ts";
import { scoreConfidence } from "./confidence.ts";
import type {
  CapacityKw,
  FinanceOption,
  QuoteLine,
  QuoteResult,
  RoomDesign,
  Survey,
  SystemDesign,
} from "./types.ts";

/**
 * The fixed-price engine.
 *
 * Deterministic: same survey in → same quote out. Every quote persists
 * `engineVersion` + inputs + outputs so historical quotes can be replayed
 * against improved rules and priced-vs-actual can be analysed per rule.
 *
 * All amounts are GBP, VAT inclusive.
 */
export const ENGINE_VERSION = "2026.07.1";

/** Fully-installed price for a single-split system (one indoor + one outdoor). */
const SINGLE_SPLIT_PRICE: Record<CapacityKw, number> = {
  2.5: 1795,
  3.5: 1995,
  5.0: 2395,
  7.1: 2895,
};

/** Multi-split outdoor unit + base install, by number of indoor units served. */
const MULTI_OUTDOOR_PRICE: Record<number, number> = {
  2: 1595,
  3: 1995,
  4: 2495,
};

/** Per-indoor-unit price on a multi-split (unit + pipework + commissioning). */
const MULTI_INDOOR_PRICE: Record<CapacityKw, number> = {
  2.5: 745,
  3.5: 845,
  5.0: 995,
  7.1: 1295,
};

const MAX_INDOORS_PER_OUTDOOR = 4;

const FLOOR_ADDER: Record<string, { amount: number; label: string }> = {
  first: { amount: 100, label: "First-floor pipe run" },
  "second-plus": { amount: 220, label: "Second-floor+ pipe run" },
  loft: { amount: 280, label: "Loft pipe run & access" },
};

const OUTDOOR_ADDER: Record<string, { amount: number; label: string }> = {
  "wall-bracket": { amount: 150, label: "Outdoor wall bracket & fixings" },
  "flat-roof": { amount: 340, label: "Flat-roof mounting & access" },
  balcony: { amount: 120, label: "Balcony mounting kit" },
};

const INTERNAL_ROUTING_ADDER = 180; // room with no external wall
const OLD_ELECTRICS_ADDER = 395; // dedicated circuit from an older board
const FULL_BOARD_ADDER = 195; // modern board but no spare ways

const WARRANTY_YEARS = 5;

function designSystems(survey: Survey): SystemDesign[] {
  const roomDesigns: RoomDesign[] = survey.rooms.map((room) => {
    const load = estimateRoomLoadWatts(room);
    const capacity = selectCapacityKw(load);
    return {
      roomId: room.id,
      roomName: room.name,
      capacityKw: capacity,
      estimatedLoadWatts: load,
      unitLabel: `${capacity.toFixed(1)} kW wall-mounted indoor unit`,
    };
  });

  if (roomDesigns.length <= 1) {
    return roomDesigns.map((r) => ({
      outdoorLabel: `${r.capacityKw.toFixed(1)} kW outdoor unit`,
      topology: "single" as const,
      rooms: [r],
    }));
  }

  // Group rooms onto multi-split outdoor units, biggest loads first so
  // capacity spreads evenly across outdoor units.
  const sorted = [...roomDesigns].sort((a, b) => b.capacityKw - a.capacityKw);
  const groupCount = Math.ceil(sorted.length / MAX_INDOORS_PER_OUTDOOR);
  const groups: RoomDesign[][] = Array.from({ length: groupCount }, () => []);
  sorted.forEach((room, i) => {
    groups[i % groupCount]!.push(room);
  });

  return groups.map((rooms) => {
    // 0.8 diversity factor: not every room peaks at once.
    const totalKw = rooms.reduce((sum, r) => sum + r.capacityKw, 0);
    const outdoorKw = Math.round(totalKw * 0.8 * 10) / 10;
    return {
      outdoorLabel: `${outdoorKw.toFixed(1)} kW multi-split outdoor unit (serves ${rooms.length} rooms)`,
      topology: rooms.length > 1 ? ("multi" as const) : ("single" as const),
      rooms,
    };
  });
}

function financeOptions(totalGbp: number): FinanceOption[] {
  const APR = 11.9;
  const deposit = Math.round(totalGbp * 0.1);
  const principal = totalGbp - deposit;
  const monthlyRate = APR / 100 / 12;
  return [24, 48, 60].map((months) => {
    const monthly =
      (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months));
    const monthlyRounded = Math.round(monthly * 100) / 100;
    return {
      months,
      aprPercent: APR,
      depositGbp: deposit,
      monthlyGbp: monthlyRounded,
      totalPayableGbp: Math.round(deposit + monthlyRounded * months),
    };
  });
}

export function generateQuote(survey: Survey): QuoteResult {
  const systems = designSystems(survey);
  const lines: QuoteLine[] = [];
  const reviewFlags: string[] = [];

  for (const system of systems) {
    if (system.topology === "single") {
      const room = system.rooms[0]!;
      lines.push({
        label: `${room.roomName}: ${room.capacityKw.toFixed(1)} kW single-split system`,
        detail: "Indoor + outdoor unit, pipework, install & commissioning",
        amount: SINGLE_SPLIT_PRICE[room.capacityKw],
      });
    } else {
      lines.push({
        label: system.outdoorLabel,
        detail: "Outdoor unit, base pipework, install & commissioning",
        amount: MULTI_OUTDOOR_PRICE[Math.min(system.rooms.length, 4)]!,
      });
      for (const room of system.rooms) {
        lines.push({
          label: `${room.roomName}: ${room.unitLabel}`,
          amount: MULTI_INDOOR_PRICE[room.capacityKw],
        });
      }
    }
  }

  // Per-room complexity adders.
  for (const room of survey.rooms) {
    const floorAdder = FLOOR_ADDER[room.floor];
    if (floorAdder) {
      lines.push({
        label: `${room.name}: ${floorAdder.label}`,
        amount: floorAdder.amount,
      });
    }
    if (!room.hasExternalWall) {
      lines.push({
        label: `${room.name}: internal pipe routing`,
        detail: "No external wall: concealed trunking to nearest route",
        amount: INTERNAL_ROUTING_ADDER,
      });
      reviewFlags.push(
        `${room.name} has no external wall, so the pipe route needs a design check.`,
      );
    }
  }

  const outdoorAdder = OUTDOOR_ADDER[survey.outdoor.location];
  if (outdoorAdder) {
    lines.push({ label: outdoorAdder.label, amount: outdoorAdder.amount });
  }
  if (survey.outdoor.location === "unsure") {
    reviewFlags.push("Outdoor unit position undecided. We'll advise on the best spot.");
  }

  // Archetype install permutation: pattern-specific work + ops checks.
  const permutation =
    survey.archetypeId && survey.permutationId
      ? getPermutation(survey.archetypeId, survey.permutationId)
      : undefined;
  if (permutation) {
    if (permutation.adderGbp > 0) {
      lines.push({
        label: `Install pattern: ${permutation.label}`,
        detail: permutation.pipeRoute,
        amount: permutation.adderGbp,
      });
    }
    if (survey.rooms.length > permutation.servesUpTo) {
      reviewFlags.push(
        `"${permutation.label}" serves up to ${permutation.servesUpTo} rooms and you asked for ${survey.rooms.length}, so we'll confirm the second outdoor unit position.`,
      );
    }
    for (const check of permutation.checks) {
      reviewFlags.push(`Pattern check: ${check}`);
    }
  }

  if (survey.electrics.condition === "older-fuse-box") {
    lines.push({
      label: "Dedicated electrical circuit (older fuse board)",
      amount: OLD_ELECTRICS_ADDER,
    });
  } else if (survey.electrics.condition === "modern-full") {
    lines.push({
      label: "Consumer unit way + dedicated circuit",
      amount: FULL_BOARD_ADDER,
    });
  } else if (survey.electrics.condition === "unsure") {
    reviewFlags.push("Electrics unconfirmed. A fuse board photo lets us lock this line in.");
  }

  const totalGbp = lines.reduce((sum, l) => sum + l.amount, 0);
  const indoorCount = survey.rooms.length;
  const installDays = Math.max(1, Math.ceil((indoorCount * 0.5 + 0.5) * 2) / 2);

  return {
    engineVersion: ENGINE_VERSION,
    systems,
    lines,
    totalGbp,
    installDays,
    warrantyYears: WARRANTY_YEARS,
    confidence: scoreConfidence(survey),
    finance: totalGbp > 0 ? financeOptions(totalGbp) : [],
    reviewFlags,
  };
}
