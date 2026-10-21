/**
 * A number typed on the phone. Pure (no browser), so it's tested directly.
 *
 * A comma is a decimal point only where it can't be a thousands comma:
 * "12,5", "0,25", "0,125" and "1,2500" read as decimals, but "1,250" could be
 * 1250 or 1.25 (an Android number pad has a comma key, and UK writers put
 * one in thousands), so it's refused with the two readings, never guessed:
 * a 1,250 micron vacuum read as 1.25 would pass a failed test (round 11).
 */
const AMBIGUOUS = /^-?[1-9]\d{0,2}(,\d{3})+$/;

/** "12,5" or " 12.5 " → 12.5; "1,250" (ambiguous), "1,250.5" or anything else → null. */
export function parseReading(text: string): number | null {
  const raw = text.trim();
  if (AMBIGUOUS.test(raw)) return null;
  const t = /^-?\d+,\d+$/.test(raw) ? raw.replace(",", ".") : raw;
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Why "1,250" isn't saved: the words to show, or null when it isn't that. */
export function readingProblem(text: string, unit?: string): string | null {
  const raw = text.trim();
  if (!AMBIGUOUS.test(raw)) return null;
  const whole = raw.replace(/,/g, "");
  const u = unit ? ` ${unit}` : "";
  if ((raw.match(/,/g) ?? []).length > 1) return `"${raw}": type ${whole} (no commas).`;
  return `"${raw}" could be ${whole}${u} or ${String(Number(raw.replace(",", ".")))}${u}: type ${whole} (no comma), or use a point for a decimal.`;
}
