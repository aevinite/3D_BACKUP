import type { MetadataRoute } from "next";

// Served as /robots.txt. Lets search engines fetch everything — which pages may actually be LISTED
// is decided by the X-Robots-Tag header in next.config.ts (a page Google may not fetch can't be told
// "noindex"). The sitemap names the one page we want in Google: the aevinite.shop home page.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: "https://www.aevinite.shop/sitemap.xml",
  };
}
