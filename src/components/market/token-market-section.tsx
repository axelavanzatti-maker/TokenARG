import { ChainLink } from "@/components/chain-link";
import { formatDate, formatNumber, formatPrice, formatUSD } from "@/lib/format";
import type { ChainInfo, MarketChart } from "@/lib/types";
import { MarketPanel } from "./market-panel";
import { MarketStatsStrip } from "./market-stats";
import { PriceChart } from "./price-chart";

/**
 * Sección "Mercado secundario" de la ficha: cifras, gráfico de precio (del índice de
 * operaciones), libro de órdenes P2P (leído de la blockchain) y últimas operaciones.
 */
export function TokenMarketSection({
  slug,
  symbol,
  tokenAddress,
  chain,
  chart,
}: {
  slug: string;
  symbol: string;
  tokenAddress: string;
  chain: ChainInfo;
  chart: MarketChart;
}) {
  const totalFee = (chain.buyerFeeBps + chain.sellerFeeBps) / 100;
  return (
    <section aria-labelledby="mercado-titulo" id="mercado" className="scroll-mt-24 space-y-4">
      <div>
        <h2 id="mercado-titulo" className="heading text-xl text-ink">
          Mercado secundario
        </h2>
        <p className="mt-1 max-w-[68ch] text-sm leading-relaxed text-ink-muted">
          Comprá y vendé {symbol} con otros inversores verificados, como en un P2P: cada orden tiene un precio fijo y, cuando
          alguien la toma, el intercambio token ↔ USDC se liquida al instante en {chain.name}. Comisión:{" "}
          {totalFee.toLocaleString("es-AR")} % por operación, la mitad cada parte.
        </p>
      </div>

      <MarketStatsStrip stats={chart.stats} issuePriceUSD={chart.issuePriceUSD} />
      <PriceChart points={chart.points} issuePriceUSD={chart.issuePriceUSD} symbol={symbol} />
      <MarketPanel
        slug={slug}
        chainId={chain.chainId}
        market={chain.market}
        token={tokenAddress}
        paymentToken={chain.paymentToken}
        symbol={symbol}
        issuePriceUSD={chart.issuePriceUSD}
        lastPriceUSD={chart.stats?.lastPriceUSD ?? null}
      />

      {chart.recentTrades.length > 0 && (
        <div>
          <h3 className="heading text-base text-ink">Últimas operaciones</h3>
          <div className="relative mt-2 overflow-x-auto rounded-[var(--radius-card)] border border-rule bg-card">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-rule text-left text-ink-muted">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">Fecha</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Precio</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Cantidad</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Valor</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Transacción</th>
                </tr>
              </thead>
              <tbody>
                {chart.recentTrades.map((t) => (
                  <tr key={t.id} className="border-b border-rule last:border-0">
                    <td className="px-4 py-2.5 whitespace-nowrap">{formatDate(t.executedAt)}</td>
                    <td className="tabular px-4 py-2.5 text-right font-medium whitespace-nowrap text-ink">{formatPrice(t.priceUSD)}</td>
                    <td className="tabular px-4 py-2.5 text-right whitespace-nowrap">
                      {formatNumber(t.tokenAmount, 4)} {symbol}
                    </td>
                    <td className="tabular px-4 py-2.5 text-right whitespace-nowrap">{formatUSD(t.valueUSD, { cents: true })}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <ChainLink kind="tx" value={t.txHash} chainId={chain.chainId} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
