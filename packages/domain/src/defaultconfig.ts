import { suggestArchetypes } from "./archetypes.ts";
import type {
  OutdoorLocation,
  PropertyEra,
  PropertyType,
  RoomSize,
  SurveyRoom,
} from "./types.ts";

/**
 * Price-first capture: a handful of answers (house type, era, bedrooms,
 * bathrooms, kitchen/living layout, rough floor area) deterministically
 * generate a full default room configuration, so an indicative price can
 * appear immediately, before any per-room clicking.
 *
 * The customer then edits the generated rooms rather than building the list.
 */

export type KitchenLivingLayout =
  | "open-plan" // one large kitchen + living space
  | "separate" // separate kitchen and living room
  | "two-receptions" // two living rooms + kitchen
  | "other";

export const LAYOUT_LABEL: Record<KitchenLivingLayout, string> = {
  "open-plan": "One open-plan kitchen & living room",
  separate: "Separate kitchen and living room",
  "two-receptions": "Two living rooms + kitchen",
  other: "Something else",
};

export interface DefaultConfigInput {
  type: PropertyType;
  era: PropertyEra;
  /** Bedrooms / studies / offices, 1–6+. */
  bedrooms: number;
  bathrooms: number;
  layout: KitchenLivingLayout;
  /** Rough whole-home floor area; when present it is allocated across rooms. */
  floorAreaM2?: number;
}

export interface ExcludedRoom {
  name: string;
  reason: string;
}

export interface DefaultConfig {
  archetypeId?: string;
  permutationId?: string;
  /** Rooms we suggest cooling, ready for the engine. */
  rooms: SurveyRoom[];
  /** Rooms we can't serve at a fixed price (no suitable external wall). */
  excluded: ExcludedRoom[];
  /** Where the outdoor unit can go for this property type (no roofs/balconies). */
  outdoorOptions: OutdoorLocation[];
  outdoorDefault: OutdoorLocation;
}

/** Relative share of the home's area each room type takes. */
const AREA_WEIGHT: Record<string, number> = {
  "living-xl": 2.4,
  "living-large": 1.7,
  "living-second": 1.2,
  kitchen: 1.3,
  "bedroom-main": 1.4,
  bedroom: 1.0,
  office: 0.7,
};

function bandForArea(m2: number): RoomSize {
  if (m2 < 10) return "small";
  if (m2 < 16.5) return "medium";
  if (m2 < 24) return "large";
  return "xl";
}

interface Seed {
  name: string;
  type: SurveyRoom["type"];
  size: RoomSize;
  floor: SurveyRoom["floor"];
  weight: number;
  hasExternalWall: boolean;
}

export function buildDefaultConfig(input: DefaultConfigInput): DefaultConfig {
  const archetype = suggestArchetypes({ type: input.type, era: input.era })[0];
  const singleStorey = input.type === "bungalow" || input.type === "flat";
  const bedroomFloor = singleStorey ? "ground" : "first";

  const seeds: Seed[] = [];

  // Living spaces from the layout choice.
  switch (input.layout) {
    case "open-plan":
      seeds.push({ name: "Open-plan kitchen & living room", type: "kitchen-diner", size: "xl", floor: "ground", weight: AREA_WEIGHT["living-xl"]!, hasExternalWall: true });
      break;
    case "two-receptions":
      seeds.push(
        { name: "Living room", type: "living-room", size: "large", floor: "ground", weight: AREA_WEIGHT["living-large"]!, hasExternalWall: true },
        { name: "Second living room", type: "living-room", size: "medium", floor: "ground", weight: AREA_WEIGHT["living-second"]!, hasExternalWall: true },
        { name: "Kitchen", type: "kitchen-diner", size: "medium", floor: "ground", weight: AREA_WEIGHT.kitchen!, hasExternalWall: true },
      );
      break;
    default: // separate | other
      seeds.push(
        { name: "Living room", type: "living-room", size: "large", floor: "ground", weight: AREA_WEIGHT["living-large"]!, hasExternalWall: true },
        { name: "Kitchen", type: "kitchen-diner", size: "medium", floor: "ground", weight: AREA_WEIGHT.kitchen!, hasExternalWall: true },
      );
      break;
  }

  // Bedrooms / studies. In a terrace, only front- and rear-facing rooms have
  // suitable external walls; extra middle rooms can't take a unit.
  const excluded: ExcludedRoom[] = [];
  const maxExternalBedrooms = input.type === "terraced" ? 2 : input.bedrooms;
  for (let i = 1; i <= input.bedrooms; i++) {
    const name = i === 1 ? "Main bedroom" : `Bedroom ${i}`;
    if (i > maxExternalBedrooms) {
      excluded.push({
        name,
        reason:
          "Middle rooms in a terrace usually have no suitable external wall, and we only install on external walls.",
      });
      continue;
    }
    seeds.push({
      name,
      type: "bedroom",
      size: i === 1 ? "medium" : "small",
      floor: bedroomFloor,
      weight: i === 1 ? AREA_WEIGHT["bedroom-main"]! : AREA_WEIGHT.bedroom!,
      hasExternalWall: true,
    });
  }

  // Allocate the home's floor area across rooms (bathrooms, hall and stairs
  // taken off the top), then size each room from its share.
  let areaByIndex: number[] | undefined;
  if (input.floorAreaM2 && input.floorAreaM2 >= 30) {
    const excludedWeight = excluded.length * AREA_WEIGHT.bedroom!;
    const usable =
      input.floorAreaM2 * 0.85 - Math.max(1, input.bathrooms) * 4.5;
    const totalWeight =
      seeds.reduce((sum, s) => sum + s.weight, 0) + excludedWeight;
    areaByIndex = seeds.map((s) =>
      Math.max(5, Math.round((usable * s.weight) / totalWeight)),
    );
  }

  const rooms: SurveyRoom[] = seeds.map((seed, i) => {
    const areaM2 = areaByIndex?.[i];
    return {
      id: `default-${i}`,
      name: seed.name,
      type: seed.type,
      size: areaM2 ? bandForArea(areaM2) : seed.size,
      areaM2,
      floor: seed.floor,
      glazing: "medium",
      orientation: "unsure",
      hasExternalWall: seed.hasExternalWall,
      photos: [],
    };
  });

  // Outdoor unit: ground-level only (no roofs, no balconies). Terraces and
  // flats route to the rear; semis and detached homes can also use the side.
  const outdoorOptions: OutdoorLocation[] =
    input.type === "terraced" || input.type === "flat"
      ? ["ground-rear"]
      : ["ground-rear", "ground-side"];
  const outdoorDefault = outdoorOptions[0]!;

  const permutation =
    archetype?.permutations.find((p) => p.outdoorLocation === outdoorDefault) ??
    archetype?.permutations[0];

  return {
    archetypeId: archetype?.id,
    permutationId: permutation?.id,
    rooms,
    excluded,
    outdoorOptions,
    outdoorDefault,
  };
}
