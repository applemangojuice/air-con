import type { MetadataRoute } from "next";

/** The public marketing surface. Private/per-customer routes stay out. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://dang.ac").replace(/\/$/, "");
  const page = (path: string, priority: number): MetadataRoute.Sitemap[number] => ({
    url: `${base}${path}`,
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority,
  });
  return [
    page("/", 1),
    page("/quote", 0.9),
    page("/how-it-works", 0.8),
    page("/faq", 0.7),
    page("/about", 0.6),
    page("/privacy", 0.2),
    page("/terms", 0.2),
  ];
}
