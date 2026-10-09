import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { CertificateCover } from "@/components/certificate-cover";
import { ChainLink } from "@/components/chain-link";
import { DocumentViewer } from "@/components/document-viewer";
import { InvestmentPanel } from "@/components/investment-panel";
import { TokenMarketSection } from "@/components/market/token-market-section";
import { MetricStrip } from "@/components/metric-strip";
import { NetworkBadge } from "@/components/network-badge";
import { chainName, isAppChain } from "@/lib/chains";
import { CATEGORIES, STATUSES } from "@/lib/categories";
import { formatDate, formatNumber, formatPercent, formatPrice, formatUSD } from "@/lib/format";
import { STATUS_TONE, isRoundDeployed, roundTiming } from "@/lib/project-timing";
import { marketChart } from "@/server/market";
import { getProject } from "@/server/projects";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

// generateMetadata y la página piden el mismo proyecto: cache() evita la segunda consulta.
const loadProject = cache(getProject);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const project = await loadProject(slug);
  if (!project) return { title: "Proyecto no encontrado" };
  return { title: project.title, description: project.summary };
}

export default async function ProjectPage({ params }: Props) {
  const { slug } = await params;
  const project = await loadProject(slug);
  if (!project) notFound();

  const category = CATEGORIES[project.category];
  const deployed = Boolean(project.tokenAddress && project.offeringAddress && isAppChain(project.chainId));
  const tokensPerTicket = project.minTicketUSD / project.tokenPriceUSD;
  const chart = await marketChart(project.id, project.tokenPriceUSD);
  // El mercado se muestra completo cuando la ronda ya se fondeó o si alguna vez hubo operaciones.
  const marketRelevant = project.status === "FINALIZADO" || project.status === "LIQUIDADO" || chart.points.length > 0;

  return (
    <div className="mx-auto max-w-[1200px] px-4 pb-8 sm:px-6 lg:px-8">
      <nav aria-label="Ruta de navegación" className="pt-6 text-sm text-ink-muted">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/" className="hover:text-ink">
              Proyectos
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li>
            <Link href={`/?categoria=${category.slug}#proyectos`} className="hover:text-ink">
              {category.label}
            </Link>
          </li>
        </ol>
      </nav>

      <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-x-10">
        {/* Encabezado: portada, título y cifras clave */}
        <div className="min-w-0 lg:col-start-1">
          <div className="overflow-hidden rounded-[var(--radius-card)] border border-rule">
            <CertificateCover
              variant="hero"
              slug={project.slug}
              category={project.category}
              symbol={project.tokenSymbol}
              image={project.images[0]}
              title={project.title}
            />
          </div>

          <header className="mt-6">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[project.status]}`}>
                {STATUSES[project.status].label}
              </span>
              <NetworkBadge network={project.network} />
              <span className="text-ink-muted">{project.location}</span>
              <span className="font-medium text-ink">{roundTiming(project)}</span>
              {project.market && (
                <a href="#mercado" className="font-medium text-brand underline-offset-2 hover:underline">
                  Último precio {formatPrice(project.market.lastPriceUSD)}
                </a>
              )}
            </div>
            <h1 className="display mt-3 text-[2rem] text-ink sm:text-[2.5rem]">{project.title}</h1>
            <p className="mt-3 max-w-[65ch] text-lg leading-relaxed text-ink-muted">{project.summary}</p>
          </header>

          <div className="mt-6">
            <MetricStrip
              metrics={[
                { label: "TIR estimada", value: formatPercent(project.estimatedIrr), note: "Anual, en dólares. No garantizada.", tone: "yield" },
                project.capRate !== null
                  ? { label: "Cap rate", value: formatPercent(project.capRate), note: "Renta neta anual sobre el valor del inmueble." }
                  : { label: "Cap rate", value: "No aplica", note: "Solo para inmuebles que generan renta.", tone: "muted" },
                {
                  label: "Plazo",
                  value: `${project.termMonths} meses`,
                  note: isRoundDeployed(project) ? `Cierre de la ronda: ${formatDate(project.closesAt)}.` : "Fechas de la ronda a confirmar.",
                },
                {
                  label: "Ticket mínimo",
                  value: formatUSD(project.minTicketUSD),
                  note: `${formatNumber(tokensPerTicket)} tokens a ${formatUSD(project.tokenPriceUSD)} c/u.`,
                },
              ]}
            />
          </div>
        </div>

        {/* Panel de inversión: en escritorio queda fijo a la derecha; en el celular, debajo de las cifras */}
        <aside className="lg:col-start-2 lg:row-span-2 lg:row-start-1" aria-label="Inversión">
          <div className="lg:sticky lg:top-24">
            <InvestmentPanel
              slug={project.slug}
              tokenSymbol={project.tokenSymbol}
              tokenPriceUSD={project.tokenPriceUSD}
              minTicketUSD={project.minTicketUSD}
              targetAmountUSD={project.targetAmountUSD}
              softCapUSD={project.softCapUSD}
              collectedAmountUSD={project.collectedAmountUSD}
              investorCount={project.investorCount}
              status={project.status}
              opensAt={project.opensAt}
              closesAt={project.closesAt}
              offeringAddress={project.offeringAddress}
              tokenAddress={project.tokenAddress}
              chainId={project.chainId}
              network={project.network}
              chain={project.chain}
            />
          </div>
        </aside>

        {/* Contenido */}
        <div className="min-w-0 space-y-12 lg:col-start-1">
          {deployed && project.chain && marketRelevant ? (
            <TokenMarketSection
              slug={project.slug}
              symbol={project.tokenSymbol}
              tokenAddress={project.tokenAddress!}
              chain={project.chain}
              chart={chart}
            />
          ) : (
            deployed && (
              <section aria-labelledby="mercado-titulo" id="mercado" className="scroll-mt-24">
                <h2 id="mercado-titulo" className="heading text-xl text-ink">
                  Mercado secundario
                </h2>
                <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-ink-muted">
                  Cuando la ronda cierre con éxito y el fiduciario habilite las transferencias, vas a poder comprar y vender{" "}
                  {project.tokenSymbol} con otros inversores verificados, con órdenes de precio fijo como en un P2P. Comisión: 0,5 %
                  quien compra y 0,5 % quien vende.
                </p>
              </section>
            )
          )}

          <section aria-labelledby="proyecto">
            <h2 id="proyecto" className="heading text-xl text-ink">
              El proyecto
            </h2>
            <div className="mt-3 max-w-[68ch] space-y-4 leading-relaxed text-ink">
              {project.description.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
          </section>

          <section aria-label="Fortalezas y riesgos" className="grid gap-4 md:grid-cols-2">
            <div className="rounded-[var(--radius-card)] border border-rule bg-card p-5">
              <h2 className="heading text-lg text-ink">Fortalezas</h2>
              <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-ink">
                {project.highlights.map((item) => (
                  <li key={item} className="flex gap-2.5">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-yield" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-[var(--radius-card)] border border-rule bg-card p-5">
              <h2 className="heading text-lg text-ink">Riesgos principales</h2>
              <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-ink">
                {project.risks.map((item) => (
                  <li key={item} className="flex gap-2.5">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-caution" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs leading-relaxed text-ink-muted">
                Podés perder parte o la totalidad del capital. Leé el contrato de fideicomiso antes de invertir.
              </p>
            </div>
          </section>

          <section aria-labelledby="ficha">
            <h2 id="ficha" className="heading text-xl text-ink">
              Ficha técnica
            </h2>
            <dl className="mt-3 grid overflow-hidden rounded-[var(--radius-card)] border border-rule bg-card text-sm sm:grid-cols-2">
              {[
                ["Emisor", project.issuer],
                ["Fiduciario", project.trustee],
                ["Valuación del activo", formatUSD(project.assetValuationUSD)],
                ["Precio por token", formatUSD(project.tokenPriceUSD)],
                ["Cupo de la ronda", formatUSD(project.targetAmountUSD)],
                ["Mínimo para cerrar la ronda", formatUSD(project.softCapUSD)],
                ["Apertura", isRoundDeployed(project) ? formatDate(project.opensAt) : "A confirmar"],
                ["Cierre", isRoundDeployed(project) ? formatDate(project.closesAt) : "A confirmar"],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 border-b border-rule px-4 py-3 sm:[&:nth-child(odd)]:border-r">
                  <dt className="text-ink-muted">{label}</dt>
                  <dd className="tabular text-right font-medium text-ink">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 max-w-[68ch] text-sm leading-relaxed text-ink-muted">
              Si la ronda no alcanza el mínimo al cierre, cada inversor recupera el 100 % de su aporte desde el contrato. Si lo
              alcanza, los fondos pasan a la tesorería del fideicomiso.
            </p>
          </section>

          <section aria-labelledby="documentos" id="documentos-seccion">
            <h2 id="documentos" className="heading text-xl text-ink">
              Documentos
            </h2>
            <p className="mt-1 mb-4 max-w-[68ch] text-sm text-ink-muted">
              El contrato de fideicomiso define tus derechos como tenedor de tokens. Su hash quedó registrado en el token al
              emitirlo: si alguien cambiara el archivo, la verificación lo detectaría.
            </p>
            <DocumentViewer
              documents={project.documents}
              tokenAddress={project.tokenAddress}
              tokenSymbol={project.tokenSymbol}
              chainId={project.chainId}
              deployed={deployed}
            />
          </section>

          <section aria-labelledby="distribuciones">
            <h2 id="distribuciones" className="heading text-xl text-ink">
              Distribuciones
            </h2>
            {project.distributions.length === 0 ? (
              <p className="mt-2 max-w-[68ch] text-sm text-ink-muted">
                Todavía no hubo distribuciones. Cuando el fiduciario deposite rentas, intereses o la liquidación final, cada
                tenedor las cobra en USDC desde su cartera, a prorrata de sus tokens.
              </p>
            ) : (
              <div className="relative mt-3 overflow-x-auto rounded-[var(--radius-card)] border border-rule bg-card">
                <table className="w-full text-sm">
                  <thead className="border-b border-rule text-left text-ink-muted">
                    <tr>
                      <th scope="col" className="px-4 py-2.5 font-medium">
                        Fecha
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-right font-medium">
                        Monto distribuido
                      </th>
                      <th scope="col" className="px-4 py-2.5 font-medium">
                        Transacción
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {project.distributions.map((d) => (
                      <tr key={d.id} className="border-b border-rule last:border-0">
                        <td className="px-4 py-2.5">{formatDate(d.executedAt)}</td>
                        <td className="tabular px-4 py-2.5 text-right font-medium text-yield">
                          {formatUSD(d.amountUSD, { cents: true })}
                        </td>
                        <td className="px-4 py-2.5">
                          <ChainLink kind="tx" value={d.txHash} chainId={project.chainId} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="onchain">
            <h2 id="onchain" className="heading text-xl text-ink">
              En la blockchain
            </h2>
            {deployed ? (
              <>
                <dl className="mt-3 overflow-hidden rounded-[var(--radius-card)] border border-rule bg-card text-sm">
                  <div className="flex flex-wrap justify-between gap-2 border-b border-rule px-4 py-3">
                    <dt className="text-ink-muted">Red</dt>
                    <dd className="text-ink">
                      {chainName(project.chainId)} (chainId {project.chainId})
                    </dd>
                  </div>
                  <div className="flex flex-wrap justify-between gap-2 border-b border-rule px-4 py-3">
                    <dt className="text-ink-muted">Token {project.tokenSymbol} (ERC-20 con KYC)</dt>
                    <dd>
                      <ChainLink kind="address" value={project.tokenAddress!} chainId={project.chainId} full />
                    </dd>
                  </div>
                  <div className="flex flex-wrap justify-between gap-2 border-b border-rule px-4 py-3">
                    <dt className="text-ink-muted">Contrato de la ronda</dt>
                    <dd>
                      <ChainLink kind="address" value={project.offeringAddress!} chainId={project.chainId} full />
                    </dd>
                  </div>
                  {project.chain && (
                    <>
                      <div className="flex flex-wrap justify-between gap-2 border-b border-rule px-4 py-3">
                        <dt className="text-ink-muted">Mercado secundario (P2P)</dt>
                        <dd>
                          <ChainLink kind="address" value={project.chain.market} chainId={project.chainId} full />
                        </dd>
                      </div>
                      <div className="flex flex-wrap justify-between gap-2 px-4 py-3">
                        <dt className="text-ink-muted">Pagos con {project.chain.paymentAssets.map((a) => a.symbol).join(", ")}</dt>
                        <dd>
                          <ChainLink kind="address" value={project.chain.paymentRouter} chainId={project.chainId} full />
                        </dd>
                      </div>
                    </>
                  )}
                </dl>
                <p className="mt-3 max-w-[68ch] text-sm text-ink-muted">
                  Los aportes, las tenencias, las distribuciones y las operaciones del mercado de este proyecto son públicos y se
                  pueden auditar en estos contratos.
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm text-ink-muted">
                Los contratos de este proyecto todavía no están desplegados en {project.network === "ethereum" ? "Ethereum" : "Polygon"}.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
