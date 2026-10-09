import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

/** Qué pueden recorrer los buscadores: todo lo público, menos la API, el panel y lo personal. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/admin", "/portfolio", "/kyc"] },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
