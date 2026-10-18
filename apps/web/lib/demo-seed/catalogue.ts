import { DEMO_CATALOGUE, DEMO_COMPATIBILITY, type CatalogueItem, type CompatibilityRule } from "@aircon/domain";

/**
 * The DEMO catalogue the demo pilots' designs and proposals point at: the
 * domain's DEMO_CATALOGUE (F3), so the seed and the design studio price from
 * the same fictional items, and a seeded design's bill of materials has no
 * "not in catalogue" lines. Fictional manufacturer, fictional models,
 * plausible numbers: every id starts "demo-", every label ends "(DEMO)",
 * and every item is provisional. Nothing here is a real product or price.
 */
export const DEMO_CATALOGUE_ITEMS: CatalogueItem[] = DEMO_CATALOGUE;

export const DEMO_COMPATIBILITY_RULES: CompatibilityRule[] = DEMO_COMPATIBILITY;

const BY_ID = new Map(DEMO_CATALOGUE_ITEMS.map((i) => [i.id, i]));

/** A DEMO catalogue item by id; throws on a typo, so the seed can't reference something that isn't there. */
export function demoItem(id: string): CatalogueItem {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`demo catalogue: no item ${id}`);
  return found;
}
