import { ImageResponse } from "next/og";
import { OG_SIZE, OgCard, ogOptions } from "@/components/og-card";
import { CATEGORIES } from "@/lib/categories";
import { NETWORK_LABEL } from "@/lib/chains";
import { formatPercent, formatUSD } from "@/lib/format";
import { siteUrl } from "@/lib/site";
import { getProject } from "@/server/projects";

export const alt = "Proyecto en TokenARG";
export const size = OG_SIZE;
export const contentType = "image/png";
// Los datos cambian con la ronda: se arma cuando se pide y se cachea una hora.
export const revalidate = 3600;

/** Tarjeta de un proyecto para compartirlo: categoría, título, lugar y números clave. */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const project = await getProject(slug).catch(() => null);
  const host = new URL(siteUrl()).host;

  if (!project) {
    return new ImageResponse(<OgCard title="Invertí en la economía real argentina" footer={host} />, await ogOptions());
  }
  const category = CATEGORIES[project.category];
  return new ImageResponse(
    (
      <OgCard
        eyebrow={`${category.label} · ${NETWORK_LABEL[project.network]}`}
        eyebrowColor={category.ink}
        title={project.title}
        subtitle={project.location}
        facts={[
          { label: "TIR estimada", value: formatPercent(project.estimatedIrr) },
          { label: "Desde", value: formatUSD(project.minTicketUSD) },
          { label: "Plazo", value: `${project.termMonths} meses` },
        ]}
        footer={`${host}/project/${project.slug}`}
      />
    ),
    await ogOptions(),
  );
}
