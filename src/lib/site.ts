/**
 * Dirección pública del sitio, para las URL absolutas (tarjetas para compartir, sitemap, robots).
 * NEXT_PUBLIC_APP_URL si está; si no, el dominio de producción que da Vercel; en local, localhost.
 */
import type { Metadata } from "next";

export function siteUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return vercel ? `https://${vercel}` : "http://localhost:3000";
}

/**
 * Datos para las tarjetas al compartir una página. Un openGraph propio reemplaza entero al del
 * layout, así que se repiten el nombre del sitio y el idioma. La imagen sale del opengraph-image
 * más cercano.
 */
export function shareMetadata(title: string, description: string, path: string): Pick<Metadata, "openGraph"> {
  return { openGraph: { title, description, url: path, siteName: "TokenARG", locale: "es_AR", type: "website" } };
}
