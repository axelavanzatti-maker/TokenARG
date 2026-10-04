import type { Category, Network, ProjectStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import type { MarketStats, ProjectDetail, ProjectSummary } from "@/lib/types";
import { prisma } from "@/server/db";
import { getDeployment, toChainInfo } from "@/server/deployments";
import { marketStatsFor } from "@/server/market";

export type SortKey = "destacados" | "tir" | "ticket" | "cierre";

const STATUS_PRIORITY: Record<ProjectStatus, number> = {
  FONDEANDO: 0,
  PROXIMAMENTE: 1,
  FINALIZADO: 2,
  LIQUIDADO: 3,
  CANCELADO: 4,
};

type ProjectRow = Prisma.ProjectGetPayload<object>;

function toSummary(p: ProjectRow, market: MarketStats | null): ProjectSummary {
  return {
    slug: p.slug,
    title: p.title,
    summary: p.summary,
    category: p.category,
    network: p.network,
    status: p.status,
    location: p.location,
    images: p.images,
    targetAmountUSD: Number(p.targetAmountUSD),
    softCapUSD: Number(p.softCapUSD),
    collectedAmountUSD: Number(p.collectedAmountUSD),
    investorCount: p.investorCount,
    minTicketUSD: Number(p.minTicketUSD),
    tokenPriceUSD: Number(p.tokenPriceUSD),
    estimatedIrr: Number(p.estimatedIrr),
    capRate: p.capRate === null ? null : Number(p.capRate),
    termMonths: p.termMonths,
    opensAt: p.opensAt.toISOString(),
    closesAt: p.closesAt.toISOString(),
    tokenSymbol: p.tokenSymbol,
    tokenAddress: p.tokenAddress,
    offeringAddress: p.offeringAddress,
    chainId: p.chainId,
    market,
  };
}

export async function listProjects(filters: { category?: Category; status?: ProjectStatus; network?: Network; sort?: SortKey }) {
  const rows = await prisma.project.findMany({
    where: { category: filters.category, status: filters.status, network: filters.network },
  });
  const stats = await marketStatsFor(rows.map((r) => r.id));
  const projects = rows.map((r) => toSummary(r, stats.get(r.id) ?? null));

  const byFeatured = (a: ProjectSummary, b: ProjectSummary) =>
    STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status] || a.closesAt.localeCompare(b.closesAt);

  switch (filters.sort) {
    case "tir":
      return projects.sort((a, b) => b.estimatedIrr - a.estimatedIrr);
    case "ticket":
      return projects.sort((a, b) => a.minTicketUSD - b.minTicketUSD || byFeatured(a, b));
    case "cierre":
      return projects.sort((a, b) => {
        const aOpen = a.status === "FONDEANDO" ? 0 : 1;
        const bOpen = b.status === "FONDEANDO" ? 0 : 1;
        return aOpen - bOpen || a.closesAt.localeCompare(b.closesAt);
      });
    default:
      return projects.sort(byFeatured);
  }
}

export async function getProject(slug: string): Promise<(ProjectDetail & { id: string }) | null> {
  const p = await prisma.project.findUnique({
    where: { slug },
    include: {
      documents: { orderBy: { sortOrder: "asc" } },
      distributions: { orderBy: { executedAt: "desc" } },
    },
  });
  if (!p) return null;
  const [stats, deployment] = await Promise.all([marketStatsFor([p.id]), p.chainId === null ? null : getDeployment(p.chainId)]);
  return {
    id: p.id,
    ...toSummary(p, stats.get(p.id) ?? null),
    description: p.description.split(/\n{2,}/).filter(Boolean),
    highlights: p.highlights,
    risks: p.risks,
    issuer: p.issuer,
    trustee: p.trustee,
    assetValuationUSD: Number(p.assetValuationUSD),
    documents: p.documents.map((d) => ({
      id: d.id,
      type: d.type,
      title: d.title,
      url: d.url,
      sha256: d.sha256,
      sizeBytes: d.sizeBytes,
    })),
    distributions: p.distributions.map((d) => ({
      id: d.id,
      amountUSD: Number(d.amountUSD),
      txHash: d.txHash,
      executedAt: d.executedAt.toISOString(),
    })),
    chain: deployment ? toChainInfo(deployment) : null,
  };
}

export async function listProjectSlugs() {
  return prisma.project.findMany({ select: { slug: true } });
}

export async function listProjectIds() {
  return prisma.project.findMany({ select: { id: true, slug: true } });
}

/** Cifras de la plataforma para la portada. */
export async function platformTotals() {
  const [aggregate, openCount, volume] = await Promise.all([
    prisma.project.aggregate({ _sum: { collectedAmountUSD: true, investorCount: true } }),
    prisma.project.count({ where: { status: "FONDEANDO" } }),
    prisma.trade.aggregate({ _sum: { valueUSD: true } }),
  ]);
  return {
    collectedUSD: Number(aggregate._sum.collectedAmountUSD ?? 0),
    investorPositions: aggregate._sum.investorCount ?? 0,
    openProjects: openCount,
    marketVolumeUSD: Number(volume._sum.valueUSD ?? 0),
  };
}
