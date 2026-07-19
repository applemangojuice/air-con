import type { MetadataRoute } from "next";

/**
 * Crawl policy: index the marketing surface, keep everything private or
 * per-customer out (ops console, APIs, saved quotes/projects, per-address
 * mailing pages — those also carry robots:noindex belt-and-braces).
 */
export default function robots(): MetadataRoute.Robots {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://dang.ac").replace(/\/$/, "");
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
