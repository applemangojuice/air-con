import { isValidUkPostcode } from "./format";

/**
 * Finding the customer's address from a postcode. Two sources, both optional:
 * the Property Intelligence Engine (homes we hold a record for, with an id
 * that pre-fills the quote) and the licensed address list behind
 * /api/addresses (getAddress.io, when configured). Neither is required: a
 * house number or name typed by hand is a perfectly good address.
 */

export interface KnownAddress {
  line1: string;
  /** Property Intelligence id when we hold a record for this home. */
  intelId?: string;
}

export async function fetchIntelAddresses(postcode: string, signal?: AbortSignal): Promise<KnownAddress[]> {
  if (!isValidUkPostcode(postcode)) return [];
  try {
    const res = await fetch(`/api/intel/addresses?postcode=${encodeURIComponent(postcode)}`, { signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { matches: { id: string; line1: string }[] };
    return data.matches.map((m) => ({ line1: m.line1, intelId: m.id }));
  } catch {
    return [];
  }
}

export async function fetchAddressList(postcode: string, signal?: AbortSignal): Promise<KnownAddress[]> {
  if (!isValidUkPostcode(postcode)) return [];
  try {
    const res = await fetch(`/api/addresses?postcode=${encodeURIComponent(postcode)}`, { signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { configured: boolean; addresses: string[] };
    return data.configured ? data.addresses.map((line1) => ({ line1 })) : [];
  } catch {
    return [];
  }
}

/** Both sources at once, records first, no duplicate lines. */
export async function fetchKnownAddresses(postcode: string, signal?: AbortSignal): Promise<KnownAddress[]> {
  const [intel, licensed] = await Promise.all([fetchIntelAddresses(postcode, signal), fetchAddressList(postcode, signal)]);
  const seen = new Set<string>();
  const out: KnownAddress[] = [];
  for (const a of [...intel, ...licensed]) {
    const key = addressKey(a.line1);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

export function addressKey(line: string): string {
  return line
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The address the customer meant, from what they typed and the addresses we
 * know at that postcode. "12" matches "12 Example Road" (not "112 Example
 * Road" or "12a"); a full line matches itself however it's punctuated; a
 * house name matches the line that starts with it. One match or none: an
 * ambiguous answer ("Flat 2" in a block of twelve) stays as typed, and the
 * customer completes it on the next screen.
 */
export function matchHouse(typed: string, known: KnownAddress[]): KnownAddress | undefined {
  const t = addressKey(typed);
  if (!t) return undefined;
  const exact = known.filter((k) => addressKey(k.line1) === t);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return undefined;
  const starts = known.filter((k) => addressKey(k.line1).startsWith(`${t} `));
  return starts.length === 1 ? starts[0] : undefined;
}
