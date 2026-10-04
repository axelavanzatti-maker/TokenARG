import Link from "next/link";
import { STATUSES } from "@/lib/categories";
import { formatPercent, formatPrice, formatUSD, pluralize } from "@/lib/format";
import { STATUS_TONE, roundTiming } from "@/lib/project-timing";
import type { ProjectSummary } from "@/lib/types";
import { CertificateCover } from "./certificate-cover";
import { FundingProgress } from "./funding-progress";
import { ChangeTag } from "./market/market-stats";
import { Sparkline } from "./market/sparkline";
import { NetworkBadge } from "./network-badge";

export function ProjectCard({ project, spark = [] }: { project: ProjectSummary; spark?: number[] }) {
  return (
    <Link
      href={`/project/${project.slug}`}
      className="group flex w-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-rule bg-card transition-colors hover:border-rule-strong"
    >
      <CertificateCover
        slug={project.slug}
        category={project.category}
        symbol={project.tokenSymbol}
        image={project.images[0]}
        title={project.title}
      />

      <div className="flex flex-1 flex-col gap-4 p-5">
        <div>
          <div className="flex items-center justify-between gap-3 text-sm">
            {/* w-0 + flex-1: el lugar se recorta con "…" y no ensancha la tarjeta en pantallas angostas. */}
            <span className="w-0 flex-1 truncate text-ink-muted">{project.location}</span>
            <span className="flex shrink-0 items-center gap-1.5">
              <NetworkBadge network={project.network} />
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[project.status]}`}>
                {STATUSES[project.status].label}
              </span>
            </span>
          </div>
          <h3 className="heading mt-1.5 line-clamp-2 text-[1.075rem] text-ink decoration-1 underline-offset-4 group-hover:underline">
            {project.title}
          </h3>
        </div>

        <dl className="grid grid-cols-3 border-y border-rule py-3">
          <div className="pr-3">
            <dt className="text-xs text-ink-muted">TIR estimada</dt>
            <dd className="figure mt-0.5 text-base whitespace-nowrap text-yield">{formatPercent(project.estimatedIrr)}</dd>
          </div>
          <div className="border-l border-rule px-3">
            <dt className="text-xs text-ink-muted">Plazo</dt>
            <dd className="figure mt-0.5 text-base whitespace-nowrap">{project.termMonths} meses</dd>
          </div>
          <div className="border-l border-rule pl-3">
            <dt className="text-xs text-ink-muted">Ticket mínimo</dt>
            <dd className="figure mt-0.5 text-base whitespace-nowrap">{formatUSD(project.minTicketUSD)}</dd>
          </div>
        </dl>

        {project.market ? (
          <div className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] bg-paper px-3 py-2">
            <div className="text-sm">
              <p className="text-xs text-ink-muted">Mercado secundario</p>
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="figure text-base text-ink">{formatPrice(project.market.lastPriceUSD)}</span>
                <span className="text-xs">
                  <ChangeTag value={project.market.change7dPct} label=" 7 d" />
                </span>
              </p>
            </div>
            <Sparkline values={spark} label={`Precio de ${project.tokenSymbol} en los últimos 30 días`} />
          </div>
        ) : (
          <FundingProgress compact collected={project.collectedAmountUSD} target={project.targetAmountUSD} />
        )}

        <p className="mt-auto flex items-center justify-between gap-3 text-sm text-ink-muted">
          <span>
            {project.investorCount > 0 ? pluralize(project.investorCount, "inversor", "inversores") : "Sin inversiones aún"}
          </span>
          <span className="font-medium text-ink">{roundTiming(project)}</span>
        </p>
      </div>
    </Link>
  );
}
