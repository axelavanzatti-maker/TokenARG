import Link from "next/link";
import { CategoryFilter } from "@/components/category-filter";
import { FeaturedProject } from "@/components/featured-project";
import { HowItWorks } from "@/components/how-it-works";
import { ProjectCard } from "@/components/project-card";
import { CATEGORY_BY_SLUG, STATUS_BY_SLUG } from "@/lib/categories";
import { formatUSD, pluralize } from "@/lib/format";
import { guillocheWaves } from "@/lib/guilloche";
import { closingPrices } from "@/server/market";
import { listProjectIds, listProjects, platformTotals, type SortKey } from "@/server/projects";
import type { Network } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

const SORTS: SortKey[] = ["destacados", "tir", "ticket", "cierre"];
const HERO_WAVES = guillocheWaves("tokenarg-portada", 1200, 420, 34);

type SearchParams = Record<"categoria" | "estado" | "red" | "orden", string | string[] | undefined>;
const NETWORKS: Network[] = ["polygon", "ethereum"];
const first = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value);

export default async function Marketplace({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const raw = await searchParams;
  const category = CATEGORY_BY_SLUG[first(raw.categoria) ?? ""];
  const status = STATUS_BY_SLUG[first(raw.estado) ?? ""];
  const requestedNetwork = first(raw.red) as Network | undefined;
  const network = requestedNetwork && NETWORKS.includes(requestedNetwork) ? requestedNetwork : undefined;
  const requestedSort = first(raw.orden) as SortKey | undefined;
  const sort: SortKey = requestedSort && SORTS.includes(requestedSort) ? requestedSort : "destacados";
  // Solo se conservan en los enlaces los filtros válidos.
  const params = {
    categoria: category ? first(raw.categoria) : undefined,
    estado: status ? first(raw.estado) : undefined,
    red: network,
    orden: sort === "destacados" ? undefined : sort,
  };

  const [projects, all, totals, ids] = await Promise.all([
    listProjects({ category, status, network, sort }),
    listProjects({}),
    platformTotals(),
    listProjectIds(),
  ]);
  const sparks = await closingPrices(ids.map((p) => p.id), 30);
  const sparkFor = (slug: string) => sparks.get(ids.find((p) => p.slug === slug)?.id ?? "") ?? [];

  const openRounds = all.filter((p) => p.status === "FONDEANDO" && p.collectedAmountUSD < p.targetAmountUSD);
  const featured = [...openRounds].sort((a, b) => a.closesAt.localeCompare(b.closesAt))[0] ?? all[0];
  const minTicket = all.length > 0 ? Math.min(...all.map((p) => p.minTicketUSD)) : null;
  const filtered = Boolean(category || status || network);

  return (
    <>
      <section className="relative overflow-hidden border-b border-rule bg-card">
        <svg
          viewBox="0 0 1200 420"
          preserveAspectRatio="xMidYMid slice"
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden
        >
          <path d={HERO_WAVES} fill="none" stroke="var(--color-brand)" strokeOpacity={0.09} strokeWidth={0.7} />
        </svg>
        <div className="relative mx-auto grid max-w-[1200px] gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:items-center lg:gap-14 lg:px-8 lg:py-16">
          <div>
            <h1 className="display max-w-[16ch] text-[2.5rem] text-ink sm:text-[3.4rem]">Invertí en la economía real argentina</h1>
            <p className="mt-5 max-w-[52ch] text-lg leading-relaxed text-ink-muted">
              Cuotapartes de fideicomisos que financian edificios, cosechas y PyMEs
              {minTicket !== null ? `, desde ${formatUSD(minTicket)}` : ""}. Cada cuotaparte es un token en Polygon o en
              Ethereum: tu tenencia y tus rentas quedan a tu nombre, y podés venderla a otros inversores en el mercado
              secundario.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a
                href="#proyectos"
                className="inline-flex items-center rounded-[var(--radius-control)] bg-brand px-5 py-3 text-base font-semibold text-white hover:bg-brand-deep"
              >
                Ver proyectos
              </a>
              <Link
                href="/kyc"
                className="inline-flex items-center rounded-[var(--radius-control)] border border-rule-strong bg-card px-5 py-3 text-base font-semibold text-ink hover:border-ink/40"
              >
                Verificar mi identidad
              </Link>
            </div>
            <p className="mt-4 text-sm text-ink-muted">
              ¿Es tu primera vez?{" "}
              <Link href="/como-funciona" className="font-semibold text-brand underline underline-offset-2 hover:text-brand-deep">
                Mirá cómo funciona
              </Link>
              , sin tecnicismos.
            </p>
            {totals.collectedUSD > 0 && (
              <p className="mt-8 max-w-[52ch] text-sm text-ink-muted">
                Hasta hoy se invirtieron <strong className="figure text-ink">{formatUSD(totals.collectedUSD)}</strong> en{" "}
                {pluralize(all.length, "proyecto", "proyectos")}.{" "}
                {totals.openProjects > 0
                  ? `${totals.openProjects === 1 ? "Hay una ronda abierta" : `Hay ${totals.openProjects} rondas abiertas`} ahora.`
                  : "Por ahora no hay rondas abiertas."}
                {totals.marketVolumeUSD > 0 && (
                  <>
                    {" "}
                    En el mercado secundario se operaron <strong className="figure text-ink">{formatUSD(totals.marketVolumeUSD)}</strong>.
                  </>
                )}
              </p>
            )}
          </div>
          {featured && <FeaturedProject project={featured} />}
        </div>
      </section>

      <section aria-labelledby="proyectos-titulo" className="mx-auto max-w-[1200px] scroll-mt-20 px-4 pt-12 sm:px-6 lg:px-8" id="proyectos">
        <h2 id="proyectos-titulo" className="display text-[1.75rem] text-ink sm:text-[2rem]">
          Proyectos
        </h2>
        <div className="mt-6">
          <CategoryFilter params={params} activeCategory={category} activeStatus={status} activeNetwork={network} count={projects.length} />
        </div>

        {all.length === 0 ? (
          <div className="mt-10 rounded-[var(--radius-card)] border border-dashed border-rule-strong bg-card px-6 py-12 text-center">
            <p className="heading text-lg text-ink">Todavía no hay proyectos publicados</p>
            <p className="mx-auto mt-2 max-w-[48ch] text-sm text-ink-muted">
              Cuando el fiduciario publique una ronda, va a aparecer acá con su ficha y sus documentos.
              {process.env.NODE_ENV !== "production" && (
                <>
                  {" "}
                  En desarrollo, cargá los de ejemplo con <code className="font-mono text-xs">npm run db:seed</code>.
                </>
              )}
            </p>
          </div>
        ) : projects.length === 0 ? (
          <div className="mt-10 rounded-[var(--radius-card)] border border-dashed border-rule-strong bg-card px-6 py-12 text-center">
            <p className="heading text-lg text-ink">No hay proyectos con esos filtros</p>
            <Link href="/#proyectos" className="mt-3 inline-block text-sm font-semibold text-brand underline underline-offset-2">
              Ver todos los proyectos
            </Link>
          </div>
        ) : (
          <ul className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3" aria-label={filtered ? "Proyectos filtrados" : "Todos los proyectos"}>
            {projects.map((project) => (
              <li key={project.slug} className="flex">
                <ProjectCard project={project} spark={sparkFor(project.slug)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <HowItWorks />
    </>
  );
}
