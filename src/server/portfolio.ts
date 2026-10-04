import { formatUnits, getAddress, type Address } from "viem";
import { assetTokenAbi, tokenOfferingAbi } from "@/lib/contracts/abis";
import type { PortfolioHolding, PortfolioView } from "@/lib/types";
import { onchainVerifications } from "@/server/agent";
import { OFFERING_STATE, appChainIds, getPublicClient } from "@/server/chain";
import { prisma } from "@/server/db";
import { marketStatsFor } from "@/server/market";

const usd = (units: bigint) => Number(formatUnits(units, 6));

/**
 * Cartera de una billetera en todas las redes activas: tenencias y rentas se leen de la
 * blockchain (fuente de verdad); el historial sale del índice en la base.
 */
export async function getPortfolio(wallet: Address): Promise<PortfolioView> {
  const address = getAddress(wallet);
  const projects = await prisma.project.findMany({
    where: { chainId: { in: appChainIds() }, tokenAddress: { not: null }, offeringAddress: { not: null } },
    orderBy: { title: "asc" },
  });
  const stats = await marketStatsFor(projects.map((p) => p.id));

  const holdings = await Promise.all(
    projects.map(async (p): Promise<PortfolioHolding | null> => {
      const chainId = p.chainId!;
      const client = getPublicClient(chainId);
      const token = getAddress(p.tokenAddress!);
      const offering = getAddress(p.offeringAddress!);
      try {
        const [balance, pending, withdrawn, contribution, state] = await Promise.all([
          client.readContract({ address: token, abi: assetTokenAbi, functionName: "balanceOf", args: [address] }),
          client.readContract({ address: token, abi: assetTokenAbi, functionName: "withdrawableDistributionOf", args: [address] }),
          client.readContract({ address: token, abi: assetTokenAbi, functionName: "withdrawnDistributionOf", args: [address] }),
          client.readContract({ address: offering, abi: tokenOfferingAbi, functionName: "contributionOf", args: [address] }),
          client.readContract({ address: offering, abi: tokenOfferingAbi, functionName: "state" }),
        ]);
        if (balance === 0n && pending === 0n && withdrawn === 0n && contribution === 0n) return null;
        const offeringState = OFFERING_STATE[state] ?? "Upcoming";
        return {
          slug: p.slug,
          title: p.title,
          category: p.category,
          network: p.network,
          chainId,
          tokenSymbol: p.tokenSymbol,
          tokenAddress: token,
          offeringAddress: offering,
          offeringState,
          tokens: Number(formatUnits(balance, 18)),
          contributedUSD: usd(contribution),
          tokenPriceUSD: Number(p.tokenPriceUSD),
          lastPriceUSD: stats.get(p.id)?.lastPriceUSD ?? null,
          estimatedIrr: Number(p.estimatedIrr),
          pendingDistributionsUSD: usd(pending),
          collectedDistributionsUSD: usd(withdrawn),
          refundAvailable: offeringState === "Failed" && contribution > 0n,
        };
      } catch {
        return null; // red caída: no se muestra esa tenencia antes que mostrar datos inventados
      }
    }),
  );

  const [subscriptions, buys, sells] = await Promise.all([
    prisma.investment.findMany({
      where: { investorWallet: address, chainId: { in: appChainIds() } },
      include: { project: { select: { slug: true, title: true } } },
      orderBy: { executedAt: "desc" },
      take: 100,
    }),
    prisma.trade.findMany({
      where: { buyer: address, chainId: { in: appChainIds() } },
      include: { project: { select: { slug: true, title: true } } },
      orderBy: { executedAt: "desc" },
      take: 100,
    }),
    prisma.trade.findMany({
      where: { seller: address, chainId: { in: appChainIds() } },
      include: { project: { select: { slug: true, title: true } } },
      orderBy: { executedAt: "desc" },
      take: 100,
    }),
  ]);

  const history: PortfolioView["history"] = [
    ...subscriptions.map((h) => ({
      id: h.id,
      slug: h.project.slug,
      title: h.project.title,
      kind: "Suscripción" as const,
      amountUSD: Number(h.amountUSD),
      tokenAmount: Number(h.tokenAmount),
      status: h.status,
      chainId: h.chainId,
      txHash: h.txHash,
      executedAt: h.executedAt.toISOString(),
    })),
    ...buys.map((t) => ({
      id: `${t.id}-c`,
      slug: t.project.slug,
      title: t.project.title,
      kind: "Compra en mercado" as const,
      amountUSD: Number(t.valueUSD) + Number(t.buyerFeeUSD),
      tokenAmount: Number(t.tokenAmount),
      status: "CONFIRMADA" as const,
      chainId: t.chainId,
      txHash: t.txHash,
      executedAt: t.executedAt.toISOString(),
    })),
    ...sells.map((t) => ({
      id: `${t.id}-v`,
      slug: t.project.slug,
      title: t.project.title,
      kind: "Venta en mercado" as const,
      amountUSD: Number(t.valueUSD) - Number(t.sellerFeeUSD),
      tokenAmount: Number(t.tokenAmount),
      status: "CONFIRMADA" as const,
      chainId: t.chainId,
      txHash: t.txHash,
      executedAt: t.executedAt.toISOString(),
    })),
  ]
    .sort((a, b) => b.executedAt.localeCompare(a.executedAt))
    .slice(0, 150);

  const owned = holdings.filter((h): h is PortfolioHolding => h !== null);
  const verifications = await onchainVerifications(address).catch(() => []);
  const live = owned.filter((h) => h.offeringState !== "Failed");
  return {
    address,
    holdings: owned,
    history,
    totals: {
      investedUSD: live.reduce((sum, h) => sum + h.tokens * h.tokenPriceUSD, 0),
      marketValueUSD: live.reduce((sum, h) => sum + h.tokens * (h.lastPriceUSD ?? h.tokenPriceUSD), 0),
      pendingDistributionsUSD: owned.reduce((sum, h) => sum + h.pendingDistributionsUSD, 0),
      collectedDistributionsUSD: owned.reduce((sum, h) => sum + h.collectedDistributionsUSD, 0),
    },
    verifications: verifications.map((v) => ({
      chainId: v.chainId,
      name: v.name,
      verified: v.verified,
      expiresAt: v.expiresAt?.toISOString() ?? null,
      reachable: v.reachable,
    })),
  };
}
