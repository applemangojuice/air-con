import { buildDefaultConfig, generateQuote, type Survey, type SurveyRoom } from "@aircon/domain";

/**
 * Engine-computed example prices for marketing surfaces (homepage anchor,
 * cost guide). Every number a visitor sees comes from the SAME engine that
 * prices their real quote — never a hand-typed figure that can drift.
 * Pure + deterministic, so statically-rendered pages bake them at build.
 */

function room(partial: Partial<SurveyRoom> & { name: string; type: SurveyRoom["type"] }): SurveyRoom {
  return {
    id: partial.name.toLowerCase().replace(/\s+/g, "-"),
    size: "medium",
    floor: "first",
    glazing: "medium",
    orientation: "unsure",
    hasExternalWall: true,
    photos: [],
    ...partial,
  };
}

function quoteFor(rooms: SurveyRoom[], bedrooms: number): number {
  const survey: Survey = {
    postcode: "SW16 1AA",
    addressLine: "Example",
    property: { type: "terraced", era: "pre-1930", bedrooms, ownership: "owner" },
    rooms,
    outdoor: { location: "ground-rear", photos: [] },
    electrics: { condition: "unsure", photos: [] },
  };
  return generateQuote(survey).totalGbp;
}

function wholeHome(type: "terraced" | "semi-detached", era: "pre-1930" | "1930-1950", bedrooms: number): number {
  const config = buildDefaultConfig({ type, era, bedrooms, bathrooms: 1, layout: "separate" });
  const survey: Survey = {
    postcode: "SW16 1AA",
    addressLine: "Example",
    archetypeId: config.archetypeId,
    permutationId: config.permutationId,
    property: { type, era, bedrooms, ownership: "owner" },
    rooms: config.rooms,
    outdoor: { location: config.outdoorDefault, photos: [] },
    electrics: { condition: "unsure", photos: [] },
  };
  return generateQuote(survey).totalGbp;
}

export interface ExamplePrices {
  oneBedroom: number;
  livingRoom: number;
  twoRooms: number;
  threeBedTerrace: number;
  threeBedSemi: number;
  fourBedHome: number;
}

export function examplePrices(): ExamplePrices {
  return {
    oneBedroom: quoteFor([room({ name: "Bedroom", type: "bedroom" })], 3),
    livingRoom: quoteFor([room({ name: "Living room", type: "living-room", size: "large", floor: "ground" })], 3),
    twoRooms: quoteFor(
      [
        room({ name: "Bedroom", type: "bedroom" }),
        room({ name: "Living room", type: "living-room", size: "large", floor: "ground" }),
      ],
      3,
    ),
    threeBedTerrace: wholeHome("terraced", "pre-1930", 3),
    threeBedSemi: wholeHome("semi-detached", "1930-1950", 3),
    fourBedHome: wholeHome("terraced", "pre-1930", 4),
  };
}

/** The lowest realistic entry point, for "from £X" anchors. */
export function fromPrice(): number {
  const p = examplePrices();
  return Math.min(p.oneBedroom, p.livingRoom);
}
