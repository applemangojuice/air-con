import {
  classifyProperty,
  defaultConfigFromIntel,
  generateQuote,
  prefillFromIntel,
  type PropertyIntel,
  type QuoteResult,
} from "@aircon/domain";

/**
 * THE indicative quote for a known property — one derivation, one set of
 * assumptions, consumed by the per-address page (/a/[id]) and the printed
 * mailing letter. These two used to derive prices independently; for a brand
 * whose whole pitch is "a fixed price, not an estimate", the letter and the
 * page it links to must never disagree.
 */
export interface IndicativeQuote {
  quote: QuoteResult;
  rooms: { id: string; name: string }[];
  archetypeName: string | null;
  planningRisk: string;
}

export function indicativeQuoteFromIntel(intel: PropertyIntel): IndicativeQuote | null {
  const cls = classifyProperty(intel);
  const prefill = prefillFromIntel(intel);
  const config = defaultConfigFromIntel(intel);
  if (!config || !prefill.type || !prefill.era) return null;

  const quote = generateQuote({
    postcode: intel.address.postcode,
    addressLine: intel.address.line1,
    archetypeId: config.archetypeId,
    permutationId: config.permutationId,
    property: {
      type: prefill.type,
      era: prefill.era,
      bedrooms: prefill.bedrooms ?? 3,
      ownership: "owner",
    },
    rooms: config.rooms,
    outdoor: { location: config.outdoorDefault, photos: [] },
    electrics: { condition: "unsure", photos: [] },
  });

  return {
    quote,
    rooms: config.rooms.map((r) => ({ id: r.id, name: r.name })),
    archetypeName: cls.archetypeName ?? null,
    planningRisk: cls.planningRisk,
  };
}
