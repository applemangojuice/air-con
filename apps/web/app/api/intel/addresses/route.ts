import { NextResponse } from "next/server";
import { isValidUkPostcode } from "@/lib/format";
import { addressesForPostcode } from "@/lib/intel-server";
import { enforceRateLimit } from "@/lib/rate-limit";

/**
 * Known addresses for a postcode, from the Property Intelligence Engine.
 * Powers the funnel's address picker so the customer taps their house
 * instead of typing it, and we know exactly which property they mean.
 */
export async function GET(request: Request) {
  const limited = enforceRateLimit(request, "intel-addresses", 30, 60_000);
  if (limited) return limited;

  const postcode = new URL(request.url).searchParams.get("postcode") ?? "";
  if (!isValidUkPostcode(postcode)) {
    return NextResponse.json({ matches: [] });
  }
  const matches = await addressesForPostcode(postcode);
  return NextResponse.json({ matches });
}
