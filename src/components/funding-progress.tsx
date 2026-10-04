import { formatUSD } from "@/lib/format";

export function FundingProgress({
  collected,
  target,
  softCap,
  compact = false,
}: {
  collected: number;
  target: number;
  softCap?: number;
  compact?: boolean;
}) {
  const ratio = target > 0 ? Math.min(1, collected / target) : 0;
  const percent = Math.floor(ratio * 100);
  const softCapRatio = softCap && softCap < target ? softCap / target : null;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className={`tabular text-ink ${compact ? "text-sm" : "text-base"}`}>
          <strong className="font-semibold">{formatUSD(collected)}</strong>
          <span className="text-ink-muted"> de {formatUSD(target)}</span>
        </span>
        <span className={`figure text-ink ${compact ? "text-sm" : "text-base"}`}>{percent} %</span>
      </div>
      <div
        className="relative mt-2 h-2 overflow-hidden rounded-full bg-celeste-soft"
        role="progressbar"
        aria-label="Fondeo de la ronda"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className="funding-fill h-full rounded-full bg-celeste" style={{ width: `${ratio * 100}%` }} />
        {softCapRatio !== null && (
          <span
            className="absolute top-0 h-full w-px bg-ink/50"
            style={{ left: `${softCapRatio * 100}%` }}
            title={`Mínimo para cerrar la ronda: ${formatUSD(softCap!)}`}
          />
        )}
      </div>
    </div>
  );
}
