import { Analytics } from "@vercel/analytics/next";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { cookieToInitialState } from "wagmi";
import { Providers } from "@/components/providers";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { siteUrl } from "@/lib/site";
import { getConfig } from "@/lib/web3Config";
import "./globals.css";

export const metadata: Metadata = {
  // Base de las URL absolutas de las tarjetas para compartir (og:image, og:url).
  metadataBase: new URL(siteUrl()),
  title: { default: "TokenARG: invertí en la economía real argentina", template: "%s | TokenARG" },
  description:
    "Fracciones de desarrollos inmobiliarios, campañas agrícolas y financiamiento PyME respaldadas por fideicomisos y registradas en Polygon y Ethereum, con mercado secundario entre inversores.",
  openGraph: { siteName: "TokenARG", locale: "es_AR", type: "website" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Recupera la conexión de la billetera desde la cookie para que el primer render ya la conozca.
  const initialState = cookieToInitialState(getConfig(), (await headers()).get("cookie"));

  return (
    <html lang="es-AR">
      <body className="min-h-screen antialiased">
        <Providers initialState={initialState}>
          <a
            href="#contenido"
            className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2"
          >
            Saltar al contenido
          </a>
          <SiteHeader />
          <main id="contenido">{children}</main>
          <SiteFooter />
        </Providers>
        {/* Visitas, páginas y de dónde llega la gente (sin cookies). Se activa en Vercel → Analytics. */}
        <Analytics />
      </body>
    </html>
  );
}
