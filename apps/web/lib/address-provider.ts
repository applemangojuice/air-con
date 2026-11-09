/**
 * Postcode → the full list of addresses at it, from a licensed provider.
 *
 * Server side. The address forms ask the property database first (free, and
 * it knows the house; see lib/address-lookup.ts); this is the fallback for
 * postcodes the database holds no homes at, so it only runs when needed:
 * every call here is paid.
 *
 * Providers, in order:
 *  - OS Places API (OS_PLACES_API_KEY): Ordnance Survey's address base, with
 *    the UPRN that EPC records carry too. One request returns up to 100
 *    addresses and is one paid transaction.
 *  - getAddress.io (GETADDRESS_API_KEY): kept for anyone already set up on it.
 * Neither set → not configured, and customers type their address.
 */

import { isPlaceholderValue } from "./env-placeholders";

export interface AddressLookupResult {
  configured: boolean;
  provider?: "os-places" | "getaddress";
  /** First line of each address ("Flat 2, 12 Example Road"), de-duplicated and sorted. */
  addresses: string[];
}

type Fetcher = (url: string, init?: RequestInit & { next?: { revalidate?: number } }) => Promise<Response>;

/** Addresses at a postcode rarely change; a day's cache stops repeat visits paying again. */
const CACHE_SECONDS = 86_400;
/** A page is 100 addresses and one paid transaction. Three covers all but the biggest blocks. */
const OS_MAX_PAGES = 3;
const OS_PAGE_SIZE = 100;

export function addressProvider(env: Record<string, string | undefined> = process.env) {
  const os = env.OS_PLACES_API_KEY;
  if (os && !isPlaceholderValue(os)) return { provider: "os-places" as const, key: os };
  const ga = env.GETADDRESS_API_KEY;
  if (ga && !isPlaceholderValue(ga)) return { provider: "getaddress" as const, key: ga };
  return null;
}

/* ------------------------------------------------------------------ */
/* OS Places                                                           */
/* ------------------------------------------------------------------ */

/** The DPA (Royal Mail delivery point) fields we use from an OS Places result. */
export interface OsDpa {
  UPRN?: string;
  ADDRESS?: string;
  ORGANISATION_NAME?: string;
  SUB_BUILDING_NAME?: string;
  BUILDING_NAME?: string;
  BUILDING_NUMBER?: string;
  DEPENDENT_THOROUGHFARE_NAME?: string;
  THOROUGHFARE_NAME?: string;
  DOUBLE_DEPENDENT_LOCALITY?: string;
  DEPENDENT_LOCALITY?: string;
  POST_TOWN?: string;
  POSTCODE?: string;
}

/**
 * OS returns addresses in capitals. Title-case them for the form, leaving
 * anything with a digit alone ("12A", "SW16") and keeping "St. John's" right.
 */
export function titleCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/(^|[\s\-(/])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase())
    .replace(/\b([a-z0-9]*\d[a-z0-9]*)\b/gi, (m) => m.toUpperCase());
}

/** "Flat 2, Rose Court, 12 Example Road" from one OS Places DPA record. */
export function osFirstLine(dpa: OsDpa): string {
  const street = [dpa.DEPENDENT_THOROUGHFARE_NAME, dpa.THOROUGHFARE_NAME].filter(Boolean).join(", ");
  const locality = dpa.DEPENDENT_LOCALITY || dpa.DOUBLE_DEPENDENT_LOCALITY || "";
  const numbered = dpa.BUILDING_NUMBER
    ? [dpa.BUILDING_NUMBER, street || locality].filter(Boolean).join(" ")
    : street || "";
  // A home has no organisation; an address that's only an organisation keeps it.
  const parts = [dpa.SUB_BUILDING_NAME, dpa.BUILDING_NAME, numbered].filter((p): p is string => Boolean(p));
  if (parts.length === 0 && dpa.ORGANISATION_NAME) parts.push(dpa.ORGANISATION_NAME);
  if (parts.length > 0) return titleCase(parts.join(", "));

  // Fall back to the one-line address, without the town and postcode at its end.
  const whole = (dpa.ADDRESS ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  const town = dpa.POST_TOWN?.toUpperCase();
  const trimmed = whole.filter((p) => p.toUpperCase() !== dpa.POSTCODE?.toUpperCase() && p.toUpperCase() !== town);
  return titleCase(trimmed.join(", "));
}

async function osPlaces(postcode: string, key: string, fetcher: Fetcher): Promise<string[] | null> {
  const lines: string[] = [];
  for (let page = 0; page < OS_MAX_PAGES; page++) {
    const url = new URL("https://api.os.uk/search/places/v1/postcode");
    url.searchParams.set("postcode", postcode);
    url.searchParams.set("dataset", "DPA");
    url.searchParams.set("maxresults", String(OS_PAGE_SIZE));
    if (page > 0) url.searchParams.set("offset", String(page * OS_PAGE_SIZE));
    url.searchParams.set("key", key);

    const res = await fetcher(url.toString(), { next: { revalidate: CACHE_SECONDS } });
    // 400 is OS saying it doesn't know the postcode: an empty list, not an outage.
    if (res.status === 400) return lines;
    if (!res.ok) {
      console.error("OS Places lookup failed:", res.status);
      return page === 0 ? null : lines;
    }
    const data = (await res.json()) as {
      header?: { totalresults?: number };
      results?: { DPA?: OsDpa }[];
    };
    const results = data.results ?? [];
    for (const r of results) if (r.DPA) lines.push(osFirstLine(r.DPA));
    const total = data.header?.totalresults ?? results.length;
    if (results.length < OS_PAGE_SIZE || (page + 1) * OS_PAGE_SIZE >= total) break;
  }
  return lines;
}

/* ------------------------------------------------------------------ */
/* getAddress.io                                                       */
/* ------------------------------------------------------------------ */

async function getAddress(postcode: string, key: string, fetcher: Fetcher): Promise<string[] | null> {
  const res = await fetcher(
    `https://api.getaddress.io/find/${encodeURIComponent(postcode)}?api-key=${encodeURIComponent(key)}&sort=true`,
    { next: { revalidate: CACHE_SECONDS } },
  );
  if (!res.ok) {
    console.error("getAddress lookup failed:", res.status);
    return null;
  }
  const data = (await res.json()) as { addresses?: string[] };
  // `find` returns "line1, line2, line3, locality, town, county".
  return (data.addresses ?? []).map((a) =>
    a
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(", "),
  );
}

/* ------------------------------------------------------------------ */

const collator = new Intl.Collator("en-GB", { numeric: true, sensitivity: "base" });

export async function lookupAddresses(
  postcode: string,
  env: Record<string, string | undefined> = process.env,
  fetcher: Fetcher = fetch,
): Promise<AddressLookupResult> {
  const chosen = addressProvider(env);
  if (!chosen) return { configured: false, addresses: [] };

  const compact = postcode.toUpperCase().replace(/\s+/g, "");
  try {
    const raw =
      chosen.provider === "os-places"
        ? await osPlaces(compact, chosen.key, fetcher)
        : await getAddress(compact, chosen.key, fetcher);
    // A provider outage looks like "not configured" to the form: it lets people type.
    if (raw === null) return { configured: false, addresses: [] };
    const addresses = [...new Set(raw.map((a) => a.trim()).filter((a) => a.length > 0))].sort(collator.compare);
    return { configured: true, provider: chosen.provider, addresses };
  } catch (err) {
    console.error("address lookup failed:", err);
    return { configured: false, addresses: [] };
  }
}
