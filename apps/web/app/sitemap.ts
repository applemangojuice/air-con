import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/brand";

/** The public marketing surface. Private/per-customer routes stay out. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = appUrl();
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
    page("/guides/air-conditioning-cost-uk", 0.8),
    page("/areas/sw16", 0.8),
    page("/areas/sw17", 0.8),
    page("/faq", 0.7),
    page("/about", 0.6),
    page("/privacy", 0.2),
    page("/terms", 0.2),
  ];
}
