import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/brand";

/**
 * Crawl policy: index the marketing surface, keep everything private or
 * per-customer out (ops console, APIs, saved quotes/projects, per-address
 * mailing pages — those also carry robots:noindex belt-and-braces).
 */
export default function robots(): MetadataRoute.Robots {
  const base = appUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/ops/", "/api/", "/q/", "/p/", "/a/"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
