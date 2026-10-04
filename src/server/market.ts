import type { MarketChart, MarketStats, PricePoint, TradeView } from "@/lib/types";
import { prisma } from "@/server/db";

const DAY_MS = 86_400_000;

/** AAAA-MM-DD en hora argentina. */
const dayKey = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Argentina/Buenos_Aires",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

interface TradeRow {
  projectId: string;
  priceUSD: unknown;
  valueUSD: unknown;
  executedAt: Date;
}

function priceAtOrBefore(trades: TradeRow[], time: number): number | null {
  let price: number | null = null;
  for (const t of trades) {
    if (t.executedAt.getTime() > time) break;
    price = Number(t.priceUSD);
  }
  return price;
}

/** Estadísticas a partir de las operaciones de un token, ordenadas por fecha ascendente. */
function statsFrom(trades: TradeRow[], now: number): MarketStats | null {
  const last = trades.at(-1);
  if (!last) return null;
  const lastPrice = Number(last.priceUSD);
  const pct = (reference: number | null) => (reference ? ((lastPrice - reference) / reference) * 100 : null);
  const recent = trades.filter((t) => t.executedAt.getTime() >= now - 30 * DAY_MS);
  return {
    lastPriceUSD: lastPrice,
    change24hPct: pct(priceAtOrBefore(trades, now - DAY_MS)),
    change7dPct: pct(priceAtOrBefore(trades, now - 7 * DAY_MS)),
    volume30dUSD: recent.reduce((sum, t) => sum + Number(t.valueUSD), 0),
    trades30d: recent.length,
    lastTradeAt: last.executedAt.toISOString(),
  };
}

/** Estadísticas del mercado secundario de varios proyectos (una sola consulta). */
export async function marketStatsFor(projectIds: string[]): Promise<Map<string, MarketStats>> {
  if (projectIds.length === 0) return new Map();
  const trades = await prisma.trade.findMany({
    where: { projectId: { in: projectIds } },
    orderBy: [{ executedAt: "asc" }, { logIndex: "asc" }],
    select: { projectId: true, priceUSD: true, valueUSD: true, executedAt: true },
  });
  const byProject = new Map<string, TradeRow[]>();
  for (const t of trades) {
    const list = byProject.get(t.projectId) ?? [];
    list.push(t);
    byProject.set(t.projectId, list);
  }
  const now = Date.now();
  const result = new Map<string, MarketStats>();
  for (const [projectId, list] of byProject) {
    const stats = statsFrom(list, now);
    if (stats) result.set(projectId, stats);
  }
  return result;
}

/** Velas diarias, operaciones recientes y estadísticas de un token. */
export async function marketChart(projectId: string, issuePriceUSD: number): Promise<MarketChart> {
  const trades = await prisma.trade.findMany({
    where: { projectId },
    orderBy: [{ executedAt: "asc" }, { logIndex: "asc" }],
  });

  const points: PricePoint[] = [];
  for (const t of trades) {
    const day = dayKey.format(t.executedAt);
    const price = Number(t.priceUSD);
    const value = Number(t.valueUSD);
    const current = points.at(-1);
    if (current && current.day === day) {
      current.high = Math.max(current.high, price);
      current.low = Math.min(current.low, price);
      current.close = price;
      current.volumeUSD += value;
      current.trades += 1;
    } else {
      points.push({ day, open: price, high: price, low: price, close: price, volumeUSD: value, trades: 1 });
    }
  }

  const recentTrades: TradeView[] = trades
    .slice(-12)
    .reverse()
    .map((t) => ({
      id: t.id,
      priceUSD: Number(t.priceUSD),
      tokenAmount: Number(t.tokenAmount),
      valueUSD: Number(t.valueUSD),
      buyer: t.buyer,
      seller: t.seller,
      txHash: t.txHash,
      executedAt: t.executedAt.toISOString(),
    }));

  return { issuePriceUSD, points, recentTrades, stats: statsFrom(trades, Date.now()) };
}

/** Serie de cierres diarios de los últimos `days` días (para las mini curvas del listado). */
export async function closingPrices(projectIds: string[], days = 30): Promise<Map<string, number[]>> {
  if (projectIds.length === 0) return new Map();
  const since = new Date(Date.now() - days * DAY_MS);
  const trades = await prisma.trade.findMany({
    where: { projectId: { in: projectIds }, executedAt: { gte: since } },
    orderBy: [{ executedAt: "asc" }, { logIndex: "asc" }],
    select: { projectId: true, priceUSD: true, executedAt: true },
  });
  const result = new Map<string, { day: string; close: number }[]>();
  for (const t of trades) {
    const list = result.get(t.projectId) ?? [];
    const day = dayKey.format(t.executedAt);
    const last = list.at(-1);
    if (last && last.day === day) last.close = Number(t.priceUSD);
    else list.push({ day, close: Number(t.priceUSD) });
    result.set(t.projectId, list);
  }
  return new Map([...result].map(([id, list]) => [id, list.map((p) => p.close)]));
}
