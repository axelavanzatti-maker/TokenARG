import Link from "next/link";
import { formatPercent, formatUSD } from "@/lib/format";
import { roundTiming } from "@/lib/project-timing";
import type { ProjectSummary } from "@/lib/types";
import { CertificateCover } from "./certificate-cover";
import { FundingProgress } from "./funding-progress";

/** La ronda abierta que más cerca está de cerrar, presentada como el título que se emite. */
export function FeaturedProject({ project }: { project: ProjectSummary }) {
  return (
    <Link
      href={`/project/${project.slug}`}
      className="group block overflow-hidden rounded-[var(--radius-card)] border border-rule-strong bg-card shadow-[0_24px_48px_-28px_rgba(19,41,75,0.45)] transition-colors hover:border-ink/40"
    >
      <CertificateCover
        slug={project.slug}
        category={project.category}
        symbol={project.tokenSymbol}
        image={project.images[0]}
        title={project.title}
      />
      <div className="space-y-4 p-5 sm:p-6">
        <div>
          <p className="text-sm text-ink-muted">
            {project.location}. {roundTiming(project)}.
          </p>
          <h2 className="heading mt-1 text-xl text-ink decoration-1 underline-offset-4 group-hover:underline">{project.title}</h2>
        </div>
        <p className="text-sm leading-relaxed text-ink">
          TIR estimada de <strong className="figure text-yield">{formatPercent(project.estimatedIrr)}</strong> en{" "}
          {project.termMonths} meses, con un ticket mínimo de {formatUSD(project.minTicketUSD)}.
        </p>
        <FundingProgress collected={project.collectedAmountUSD} target={project.targetAmountUSD} softCap={project.softCapUSD} />
      </div>
    </Link>
  );
}
