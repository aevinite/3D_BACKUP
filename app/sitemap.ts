import type { MetadataRoute } from "next";

// Served as /sitemap.xml. ONLY the home page (owner, 2026-10-12): café menus reach guests by QR and
// are kept out of Google on purpose (next.config.ts → NOINDEX_PATHS). Do not add restaurant URLs here.
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: "https://www.aevinite.shop/", changeFrequency: "monthly", priority: 1 }];
}
