import type { CapacityKw, SurveyRoom } from "./types.ts";

/**
 * Quick-estimate heat load per room.
 *
 * This is deliberately a simple, transparent rule set, not a Manual J / CIBSE
 * calculation. It exists to size units consistently from self-survey answers.
 * As installation outcomes accumulate, these factors get tuned from real data
 * (see ARCHITECTURE.md → knowledge loop).
 */

/** Midpoint floor areas for the size bands customers pick, in m². */
const AREA_M2: Record<SurveyRoom["size"], number> = {
  small: 9, // box room / small bedroom
  medium: 14, // double bedroom / office
  large: 20, // main living room
  xl: 28, // open-plan / kitchen-diner
};

const CEILING_HEIGHT_M = 2.4;

/** Base sensible load per m³ for a typical UK room. */
const BASE_WATTS_PER_M3 = 42;

const GLAZING_FACTOR: Record<SurveyRoom["glazing"], number> = {
  low: 0.9,
  medium: 1.0,
  high: 1.3,
};

const ORIENTATION_FACTOR: Record<SurveyRoom["orientation"], number> = {
  north: 0.9,
  east: 1.0,
  west: 1.1,
  south: 1.2,
  unsure: 1.05,
};

const FLOOR_FACTOR: Record<SurveyRoom["floor"], number> = {
  ground: 1.0,
  first: 1.05,
  "second-plus": 1.1,
  loft: 1.35, // lofts run hot
};

const ROOM_TYPE_EXTRA_WATTS: Record<SurveyRoom["type"], number> = {
  bedroom: 0,
  "living-room": 300, // occupancy + electronics
  "kitchen-diner": 800, // appliances
  "home-office": 350, // equipment, all-day occupancy
  "loft-room": 0, // covered by floor factor
  conservatory: 1200, // solar gain
  other: 150,
};

export function estimateRoomLoadWatts(room: SurveyRoom): number {
  // Real measured/allocated area beats the band midpoint when we have it.
  const area = room.areaM2 && room.areaM2 > 0 ? room.areaM2 : AREA_M2[room.size];
  const volume = area * CEILING_HEIGHT_M;
  const base =
    volume *
    BASE_WATTS_PER_M3 *
    GLAZING_FACTOR[room.glazing] *
    ORIENTATION_FACTOR[room.orientation] *
    FLOOR_FACTOR[room.floor];
  return Math.round(base + ROOM_TYPE_EXTRA_WATTS[room.type]);
}

const CAPACITIES: CapacityKw[] = [2.5, 3.5, 5.0, 7.1];

/** Pick the smallest unit that comfortably covers the estimated load. */
export function selectCapacityKw(loadWatts: number): CapacityKw {
  for (const c of CAPACITIES) {
    if (c * 1000 >= loadWatts) return c;
  }
  return 7.1;
}
