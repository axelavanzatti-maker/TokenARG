import "server-only";
import { formatUnits, getAddress } from "viem";
import { assetTokenAbi, p2pMarketAbi } from "@/lib/contracts/abis";
import { getPublicClient } from "@/server/chain";

export interface BookSummary {
  /** Token habilitado en el mercado y con transferencias activas. */
  open: boolean;
  asks: number;
  bids: number;
  bestAskUSD: number | null;
  bestBidUSD: number | null;
}

/**
 * Resumen del libro de órdenes de un token, leído de la blockchain (las órdenes no se indexan:
 * cambian a cada rato y el contrato ya las devuelve con lo que hoy se puede tomar de cada una).
 * null si la red no responde.
 */
export async function bookSummary(chainId: number, market: string, token: string): Promise<BookSummary | null> {
  try {
    const client = getPublicClient(chainId);
    const [orders, listed, transfersEnabled] = await Promise.all([
      client.readContract({ address: getAddress(market), abi: p2pMarketAbi, functionName: "getActiveOrders", args: [getAddress(token)] }),
      client.readContract({ address: getAddress(market), abi: p2pMarketAbi, functionName: "isListed", args: [getAddress(token)] }),
      client.readContract({ address: getAddress(token), abi: assetTokenAbi, functionName: "transfersEnabled" }),
    ]);
    const live = orders.filter((o) => o.fillable > 0n);
    const asks = live.filter((o) => o.side === 0).map((o) => Number(formatUnits(o.price, 6)));
    const bids = live.filter((o) => o.side === 1).map((o) => Number(formatUnits(o.price, 6)));
    return {
      open: listed && transfersEnabled,
      asks: asks.length,
      bids: bids.length,
      bestAskUSD: asks.length > 0 ? Math.min(...asks) : null,
      bestBidUSD: bids.length > 0 ? Math.max(...bids) : null,
    };
  } catch {
    return null;
  }
}
