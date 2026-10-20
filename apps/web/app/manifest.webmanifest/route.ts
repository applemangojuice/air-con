import { BRAND } from "@/lib/brand";

/**
 * Add-to-homescreen identity: brand colours, the square mark as icon.
 *
 * A route (linked from the root layout's metadata), not the `app/manifest.ts`
 * file convention: that one is stamped on every page and can't be
 * overridden, and the field app needs its own (`/field.webmanifest`, linked
 * from the field layout, §K45) so its Home Screen icon opens `/field`.
 */
export const dynamic = "force-static";

export function GET() {
  return Response.json(
    {
      name: BRAND.name,
      short_name: BRAND.nameHot,
      description:
        "Home air conditioning: your price online in about two minutes, confirmed at a home survey, booked and tracked online.",
      start_url: "/",
      display: "standalone",
      background_color: "#f8f5ef",
      theme_color: "#201e1d",
      icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
    },
    { headers: { "content-type": "application/manifest+json" } },
  );
}
