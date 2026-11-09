import { NextResponse } from "next/server";
import { isValidUkPostcode } from "@/lib/format";
import { neighbourGuessForPostcode } from "@/lib/intel-server";
import { enforceRateLimit } from "@/lib/rate-limit";

/**
 * A best guess at a home from its neighbours (same postcode), for the
 * instant price when the exact address isn't on record. Only the shape of
 * the home comes back (type, era, bedrooms, floor area, how many homes it
 * rests on): never which neighbours, or anything about them.
 */
export async function GET(request: Request) {
  const limited = enforceRateLimit(request, "intel-guess", 30, 60_000);
  if (limited) return limited;

  const postcode = new URL(request.url).searchParams.get("postcode") ?? "";
  if (!isValidUkPostcode(postcode)) {
    return NextResponse.json({ guess: null });
  }
  const guess = await neighbourGuessForPostcode(postcode);
  return NextResponse.json({ guess });
}
