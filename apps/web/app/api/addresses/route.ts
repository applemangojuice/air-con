import { NextResponse } from "next/server";
import { isValidUkPostcode } from "@/lib/format";

/**
 * Postcode → address list, so the first line autofills instead of being
 * typed. Uses getAddress.io when GETADDRESS_API_KEY is set (UK PAF data
 * requires a licensed provider; postcodes.io has no address lines).
 * Unconfigured → { configured: false } and the UI falls back to manual entry.
 */
export async function GET(request: Request) {
  const postcode = new URL(request.url).searchParams.get("postcode") ?? "";
  if (!isValidUkPostcode(postcode)) {
    return NextResponse.json({ error: "Invalid postcode" }, { status: 400 });
  }

  const apiKey = process.env.GETADDRESS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ configured: false, addresses: [] });
  }

  try {
    const res = await fetch(
      `https://api.getaddress.io/find/${encodeURIComponent(postcode.replace(/\s+/g, ""))}?api-key=${apiKey}&sort=true`,
      { next: { revalidate: 86400 } }, // addresses at a postcode rarely change
    );
    if (!res.ok) {
      console.error("address lookup failed:", res.status);
      return NextResponse.json({ configured: false, addresses: [] });
    }
    const data = (await res.json()) as { addresses?: string[] };
    // getAddress `find` returns "line1, line2, line3, locality, town, county".
    const addresses = (data.addresses ?? [])
      .map((a) =>
        a
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean)
          .slice(0, 2)
          .join(", "),
      )
      .filter((a, i, all) => a.length > 0 && all.indexOf(a) === i);
    return NextResponse.json({ configured: true, addresses });
  } catch (err) {
    console.error("address lookup failed:", err);
    return NextResponse.json({ configured: false, addresses: [] });
  }
}
