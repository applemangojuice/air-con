/**
 * What the funnel's postcode step does with a lookup result. Coverage comes
 * from the outcode (settings.serviceArea), never from the lookup: postcodes.io
 * lags Royal Mail by months, so a new-build postcode can be real and still
 * answer 404. In an outcode we cover, that's a soft note and they carry on;
 * outside our area, an unknown postcode is most likely a typo, so it stops
 * there and asks them to check it.
 */
export type LookupState = "idle" | "checking" | "offline" | "found" | "not-found";

export interface PostcodeOutcome {
  /** Show the address field and let them continue. */
  inArea: boolean;
  /** Show the waitlist (we don't cover them yet). */
  outOfArea: boolean;
  /** In our area, but the lookup didn't know it: say so gently. */
  unverified: boolean;
  /** Not in our area and not a known postcode: ask them to check it. */
  unknown: boolean;
}

export function postcodeOutcome(formatOk: boolean, lookup: LookupState, covered: boolean): PostcodeOutcome {
  const none = { inArea: false, outOfArea: false, unverified: false, unknown: false };
  if (!formatOk || lookup === "idle" || lookup === "checking") return none;
  if (lookup === "not-found") return covered ? { ...none, inArea: true, unverified: true } : { ...none, unknown: true };
  return { ...none, inArea: covered, outOfArea: !covered };
}
