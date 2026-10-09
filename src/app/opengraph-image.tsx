import { ImageResponse } from "next/og";
import { OG_SIZE, OgCard, ogOptions } from "@/components/og-card";
import { siteUrl } from "@/lib/site";

export const alt = "TokenARG: invertí en la economía real argentina desde pocos dólares";
export const size = OG_SIZE;
export const contentType = "image/png";

/** Tarjeta del sitio para WhatsApp, X, LinkedIn y buscadores. */
export default async function Image() {
  return new ImageResponse(
    (
      <OgCard
        eyebrow="Activos reales tokenizados"
        title="Invertí en la economía real argentina"
        subtitle="Inmuebles, campañas agrícolas y PyMEs desde pocos dólares, con rentas en USDC y mercado secundario."
        footer={new URL(siteUrl()).host}
      />
    ),
    await ogOptions(),
  );
}
