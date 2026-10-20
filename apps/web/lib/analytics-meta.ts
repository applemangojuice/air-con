/**
 * Facts the privacy notice doesn't list are never stored, whatever an old or
 * altered page sends: no postcode, address, contact details, prices or
 * consents in analytics (app/api/track).
 */
const PRIVATE_META = /postcode|address|email|phone|name|price|total|gbp|pence|marketing/i;

export function analyticsMeta(meta: Record<string, string | number | boolean | null> | undefined): Record<string, string | number | boolean | null> | null {
  if (!meta) return null;
  const kept = Object.fromEntries(Object.entries(meta).filter(([k]) => !PRIVATE_META.test(k)));
  return Object.keys(kept).length ? kept : null;
}
