import { getAddress, isAddress, type Address } from "viem";
import type { ChainDeployment } from "@/generated/prisma/client";
import { chainById } from "@/lib/chains";
import type { ChainInfo, PaymentAssetInfo } from "@/lib/types";
import { appChainIds } from "@/server/chain";
import { prisma } from "@/server/db";

/** Contratos de la plataforma en las redes activas (cargados por `npm run chain:sync`). */
export async function activeDeployments(): Promise<ChainDeployment[]> {
  return prisma.chainDeployment.findMany({ where: { chainId: { in: appChainIds() } }, orderBy: { chainId: "asc" } });
}

export async function getDeployment(chainId: number): Promise<ChainDeployment | null> {
  if (!appChainIds().includes(chainId)) return null;
  return prisma.chainDeployment.findUnique({ where: { chainId } });
}

function parseAssets(value: unknown): PaymentAssetInfo[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const a = raw as Partial<PaymentAssetInfo>;
    if (!a.symbol || typeof a.decimals !== "number") return [];
    const address = a.address === "native" ? "native" : a.address && isAddress(a.address) ? getAddress(a.address) : null;
    if (!address) return [];
    return [{ symbol: a.symbol, name: a.name ?? a.symbol, address, decimals: a.decimals, isMock: Boolean(a.isMock) }];
  });
}

/** Datos públicos de una red para los componentes de cliente. */
export function toChainInfo(d: ChainDeployment): ChainInfo {
  const chain = chainById(d.chainId);
  return {
    chainId: d.chainId,
    name: chain?.name ?? `Red ${d.chainId}`,
    network: d.network,
    nativeSymbol: chain?.nativeCurrency.symbol ?? "ETH",
    market: getAddress(d.market) as Address,
    paymentRouter: getAddress(d.paymentRouter) as Address,
    paymentToken: getAddress(d.paymentToken) as Address,
    buyerFeeBps: d.buyerFeeBps,
    sellerFeeBps: d.sellerFeeBps,
    minOrderValueUSD: Number(d.minOrderValueUSD),
    paymentAssets: parseAssets(d.paymentAssets),
  };
}
