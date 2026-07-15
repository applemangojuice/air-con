import {
  generateQuote,
  type HouseArchetype,
  type InstallPermutation,
  type QuoteResult,
  type Survey,
} from "@aircon/domain";
import type { Extraction } from "./extract";

/**
 * Assembles an engine-ready Survey from the extraction + archetype defaults.
 * The archetype supplies what the narration can't (property type/era, outdoor
 * pattern); the extraction supplies the rooms and wishes.
 */
export function assembleSurvey(
  extraction: Extraction,
  archetype: HouseArchetype,
  permutation: InstallPermutation,
  postcode: string,
): { survey: Survey; quote: QuoteResult } {
  const rooms = extraction.rooms
    .filter((r) => r.wantsCooling)
    .map((r, i) => ({
      id: `vroom-${i + 1}`,
      name: r.name,
      type: r.type,
      size: r.size,
      floor: r.floor,
      glazing: r.glazing,
      orientation: r.orientation,
      hasExternalWall: r.hasExternalWall,
      photos: [],
    }));

  const survey: Survey = {
    postcode,
    addressLine: "(video walkthrough, address on booking)",
    archetypeId: archetype.id,
    permutationId: permutation.id,
    property: {
      type: archetype.matches.types[0] ?? "semi-detached",
      era: archetype.matches.eras[0] ?? "1930-1950",
      bedrooms: Math.max(1, extraction.rooms.filter((r) => r.type === "bedroom").length),
      ownership: "owner",
    },
    rooms,
    outdoor: { location: permutation.outdoorLocation, photos: [] },
    electrics: { condition: extraction.electricsCondition, photos: [] },
  };

  const quote = generateQuote(survey);
  // The narration's open questions become ops review flags alongside the
  // engine's own.
  quote.reviewFlags.push(...extraction.uncertainties.map((u) => `From narration: ${u}`));
  return { survey, quote };
}
