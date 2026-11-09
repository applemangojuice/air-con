import { NextResponse } from "next/server";
import { lookupAddresses } from "@/lib/address-provider";
import { isValidUkPostcode } from "@/lib/format";
import { enforceRateLimit } from "@/lib/rate-limit";

/**
 * Postcode → every address at it, so the customer picks theirs instead of
 * typing. The form calls this only when the property database doesn't have
 * their home, because each lookup is paid (OS Places, or getAddress.io).
 * Unconfigured → { configured: false } and the form falls back to typing.
 */
export async function GET(request: Request) {
  // Proxies a metered third-party API; don't let a loop spend the quota.
  const limited = enforceRateLimit(request, "addresses", 30, 60_000);
  if (limited) return limited;

  const postcode = new URL(request.url).searchParams.get("postcode") ?? "";
  if (!isValidUkPostcode(postcode)) {
    return NextResponse.json({ error: "Invalid postcode" }, { status: 400 });
  }

  const { configured, addresses } = await lookupAddresses(postcode);
  return NextResponse.json({ configured, addresses });
}
