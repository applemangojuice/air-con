import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

/** Add-to-homescreen identity: brand colours, the square mark as icon. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND.name,
    short_name: BRAND.nameHot,
    description:
      "Home air conditioning: your price online in about two minutes, confirmed at a home survey, booked and tracked online.",
    start_url: "/",
    display: "standalone",
    background_color: "#f8f5ef",
    theme_color: "#201e1d",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
