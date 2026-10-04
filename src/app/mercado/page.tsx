import type { Metadata } from "next";
import Link from "next/link";
import { ChangeTag } from "@/components/market/market-stats";
import { Sparkline } from "@/components/market/sparkline";
import { NetworkBadge } from "@/components/network-badge";
import { formatNumber, formatPrice, formatUSD } from "@/lib/format";
import { activeDeployments } from "@/server/deployments";
import { closingPrices } from "@/server/market";
import { bookSummary } from "@/server/orderbook";
import { listProjectIds, listProjects } from "@/server/projects";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mercado secundario",
  description: "Comprá y vendé tokens de proyectos fondeados con otros inversores verificados, con órdenes de precio fijo y 1 % de comisión.",
};

export default async function MarketPage() {
  const [projects, deployments, ids] = await Promise.all([listProjects({}), activeDeployments(), listProjectIds()]);
  const tradable = projects.filter((p) => p.tokenAddress && p.chainId !== null && p.status !== "CANCELADO");
  const marketByChain = new Map(deployments.map((d) => [d.chainId, d]));
  const sparks = await closingPrices(ids.map((p) => p.id), 30);
  const idBySlug = new Map(ids.map((p) => [p.slug, p.id]));

  const rows = await Promise.all(
    tradable.map(async (p) => {
      const deployment = marketByChain.get(p.chainId!);
      const book = deployment ? await bookSummary(p.chainId!, deployment.market, p.tokenAddress!) : null;
      return { project: p, book, spark: sparks.get(idBySlug.get(p.slug) ?? "") ?? [] };
    }),
  );
  // Primero los mercados abiertos, por volumen; después los que abren cuando se fondee la ronda.
  rows.sort(
    (a, b) =>
      Number(b.book?.open ?? false) - Number(a.book?.open ?? false) ||
      (b.project.market?.volume30dUSD ?? 0) - (a.project.market?.volume30dUSD ?? 0),
  );

  const volume30d = projects.reduce((sum, p) => sum + (p.market?.volume30dUSD ?? 0), 0);
  const trades30d = projects.reduce((sum, p) => sum + (p.market?.trades30d ?? 0), 0);
  const openMarkets = rows.filter((r) => r.book?.open).length;
  const fee = deployments[0] ? (deployments[0].buyerFeeBps + deployments[0].sellerFeeBps) / 100 : 1;
  const half = deployments[0] ? deployments[0].buyerFeeBps / 100 : 0.5;

  return (
    <div className="mx-auto max-w-[1200px] px-4 pt-10 pb-8 sm:px-6 lg:px-8">
      <h1 className="display text-[2rem] text-ink sm:text-[2.5rem]">Mercado secundario</h1>
      <p className="mt-3 max-w-[64ch] text-lg leading-relaxed text-ink-muted">
        Comprá y vendé tokens de proyectos ya fondeados con otros inversores verificados. Funciona como un P2P: publicás una
        orden con tu precio o tomás la de otra persona, y el intercambio token ↔ USDC se liquida en la blockchain, sin nadie
        que custodie tus fondos.
      </p>

      <dl className="mt-8 grid grid-cols-2 overflow-hidden rounded-[var(--radius-card)] border border-rule bg-card lg:grid-cols-4">
        <div className="px-5 py-4">
          <dt className="text-sm text-ink-muted">Volumen 30 días</dt>
          <dd className="figure mt-1 text-2xl text-ink">{formatUSD(volume30d)}</dd>
        </div>
        <div className="border-l border-rule px-5 py-4">
          <dt className="text-sm text-ink-muted">Operaciones 30 días</dt>
          <dd className="figure mt-1 text-2xl text-ink">{formatNumber(trades30d, 0)}</dd>
        </div>
        <div className="border-t border-rule px-5 py-4 lg:border-t-0 lg:border-l">
          <dt className="text-sm text-ink-muted">Tokens con mercado abierto</dt>
          <dd className="figure mt-1 text-2xl text-ink">{openMarkets}</dd>
        </div>
        <div className="border-t border-l border-rule px-5 py-4 lg:border-t-0">
          <dt className="text-sm text-ink-muted">Comisión por operación</dt>
          <dd className="figure mt-1 text-2xl text-ink">{fee.toLocaleString("es-AR")} %</dd>
          <dd className="mt-0.5 text-xs text-ink-muted">
            {half.toLocaleString("es-AR")} % quien compra y {half.toLocaleString("es-AR")} % quien vende
          </dd>
        </div>
      </dl>

      <section aria-labelledby="tokens" className="mt-10">
        <h2 id="tokens" className="heading text-xl text-ink">
          Tokens
        </h2>
        {rows.length === 0 ? (
          <p className="mt-3 rounded-[var(--radius-card)] border border-dashed border-rule-strong bg-card px-6 py-10 text-center text-sm text-ink-muted">
            Todavía no hay tokens emitidos en este entorno.
          </p>
        ) : (
          <div className="relative mt-3 overflow-x-auto rounded-[var(--radius-card)] border border-rule bg-card">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-rule text-left text-ink-muted">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium whitespace-nowrap">Token</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium whitespace-nowrap">Último precio</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium whitespace-nowrap">7 días</th>
                  <th scope="col" className="px-4 py-2.5 font-medium whitespace-nowrap">30 días</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium whitespace-nowrap">Volumen 30 d</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium whitespace-nowrap">Mejor compra</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium whitespace-nowrap">Mejor venta</th>
                  <th scope="col" className="px-4 py-2.5 font-medium whitespace-nowrap">
                    <span className="sr-only">Acción</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ project: p, book, spark }) => (
                  <tr key={p.slug} className="border-b border-rule last:border-0">
                    <td className="px-4 py-3">
                      <Link href={`/project/${p.slug}#mercado`} className="font-semibold text-ink hover:underline">
                        {p.tokenSymbol}
                      </Link>
                      <p className="mt-0.5 max-w-[30ch] truncate text-xs text-ink-muted">{p.title}</p>
                      <p className="mt-1">
                        <NetworkBadge network={p.network} />
                      </p>
                    </td>
                    <td className="tabular px-4 py-3 text-right font-semibold whitespace-nowrap text-ink">
                      {p.market ? formatPrice(p.market.lastPriceUSD) : <span className="font-normal text-ink-faint">—</span>}
                      <span className="block text-xs font-normal text-ink-muted">Emisión {formatPrice(p.tokenPriceUSD)}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-xs">
                      <ChangeTag value={p.market?.change7dPct ?? null} />
                    </td>
                    <td className="px-4 py-3">
                      {spark.length > 1 ? (
                        <Sparkline values={spark} label={`Precio de ${p.tokenSymbol} en los últimos 30 días`} />
                      ) : (
                        <span className="text-xs text-ink-faint">Sin datos</span>
                      )}
                    </td>
                    <td className="tabular px-4 py-3 text-right whitespace-nowrap">{formatUSD(p.market?.volume30dUSD ?? 0)}</td>
                    <td className="tabular px-4 py-3 text-right whitespace-nowrap">
                      {book?.bestBidUSD != null ? formatPrice(book.bestBidUSD) : <span className="text-ink-faint">—</span>}
                      {book && book.bids > 0 && <span className="block text-xs text-ink-muted">{book.bids} {book.bids === 1 ? "orden" : "órdenes"}</span>}
                    </td>
                    <td className="tabular px-4 py-3 text-right whitespace-nowrap">
                      {book?.bestAskUSD != null ? formatPrice(book.bestAskUSD) : <span className="text-ink-faint">—</span>}
                      {book && book.asks > 0 && <span className="block text-xs text-ink-muted">{book.asks} {book.asks === 1 ? "orden" : "órdenes"}</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {book?.open ? (
                        <Link
                          href={`/project/${p.slug}#mercado`}
                          className="inline-flex items-center rounded-[var(--radius-control)] bg-brand px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-brand-deep"
                        >
                          Operar
                        </Link>
                      ) : (
                        <span className="text-xs text-ink-muted">
                          {book === null
                            ? "La red no responde"
                            : p.status === "FONDEANDO" || p.status === "PROXIMAMENTE"
                              ? "Abre cuando cierre la ronda"
                              : "Todavía no habilitado"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="como-funciona" className="mt-12">
        <h2 id="como-funciona" className="heading text-xl text-ink">
          Cómo funciona
        </h2>
        <ol className="mt-4 grid gap-4 md:grid-cols-3">
          {[
            {
              title: "Verificá tu identidad una vez",
              body: "La misma verificación habilita tu billetera en Polygon y en Ethereum. Solo operan billeteras verificadas: el token lo exige en cada transferencia.",
            },
            {
              title: "Tomá una orden o publicá la tuya",
              body: "Cada orden tiene precio fijo, como un anuncio P2P. Podés tomarla entera o una parte. Publicar no inmoviliza tus fondos: solo autorizás al mercado.",
            },
            {
              title: "Liquidación al instante",
              body: `El contrato intercambia tokens por USDC en una sola transacción y cobra ${half.toLocaleString("es-AR")} % a cada parte. Las rentas futuras pasan a quien compra.`,
            },
          ].map((step, index) => (
            <li key={step.title} className="rounded-[var(--radius-card)] border border-rule bg-card p-5">
              <span className="figure flex h-7 w-7 items-center justify-center rounded-full bg-brand-soft text-sm text-brand-deep">{index + 1}</span>
              <h3 className="heading mt-3 text-base text-ink">{step.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{step.body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-4 max-w-[68ch] text-xs leading-relaxed text-ink-muted">
          El precio del mercado secundario lo fijan los inversores y puede ser mayor o menor al de emisión. Puede no haber
          compradores cuando quieras vender. Las rentas se devengan a nombre de quien tiene el token en cada distribución.
        </p>
      </section>
    </div>
  );
}
