import { NextResponse } from "next/server";
import { isValidUkPostcode } from "@/lib/format";
import { addressesForPostcode } from "@/lib/intel-server";
import { lookupPostcode } from "@/lib/property-lookup";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Known addresses for a postcode, from the Property Intelligence Engine.
 * Powers the funnel's address picker so the customer taps their house
 * instead of typing it, and we know exactly which property they mean.
 *
 * A postcode the book hasn't seen is looked up live in the EPC register
 * (when EPC_BEARER_TOKEN is set) and saved, so the next visitor from that
 * postcode gets an instant answer.
 */
export async function GET(request: Request) {
  const limited = enforceRateLimit(request, "intel-addresses", 30, 60_000);
  if (limited) return limited;

  const postcode = new URL(request.url).searchParams.get("postcode") ?? "";
  if (!isValidUkPostcode(postcode)) {
    return NextResponse.json({ matches: [] });
  }
  const matches = await addressesForPostcode(postcode);
  if (matches.length > 0) return NextResponse.json({ matches, source: "book" });

  const db = getServiceClient();
  if (!db) return NextResponse.json({ matches: [] });
  const found = await lookupPostcode(db, postcode);
  return NextResponse.json({
    matches: found.map((p) => ({ id: p.id, line1: p.address.line1 })),
    source: found.length > 0 ? "epc" : "none",
  });
}
