import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";
import { listProjectSlugs } from "@/server/projects";

// Incluye los proyectos de la base: se arma en cada pedido (los buscadores lo piden poco).
export const dynamic = "force-dynamic";

/** Mapa del sitio para los buscadores: páginas públicas y la ficha de cada proyecto. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const pages: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/como-funciona`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/mercado`, changeFrequency: "daily", priority: 0.7 },
    { url: `${base}/lista-de-espera`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/crea-tu-proyecto`, changeFrequency: "monthly", priority: 0.7 },
  ];
  const slugs = await listProjectSlugs().catch(() => []);
  return [...pages, ...slugs.map(({ slug }) => ({ url: `${base}/project/${slug}`, changeFrequency: "daily" as const, priority: 0.8 }))];
}
