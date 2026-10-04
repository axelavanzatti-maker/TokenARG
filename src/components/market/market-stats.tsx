import { TrendingDown, TrendingUp } from "lucide-react";
import { formatChange, formatNumber, formatPrice, formatUSD } from "@/lib/format";
import type { MarketStats } from "@/lib/types";

/** Variación con signo, flecha y color (nunca solo color). */
export function ChangeTag({ value, label }: { value: number | null; label?: string }) {
  if (value === null) return <span className="text-ink-faint">—</span>;
  const rounded = Number(value.toFixed(1));
  const tone = rounded > 0 ? "text-yield" : rounded < 0 ? "text-danger" : "text-ink-muted";
  const Icon = rounded > 0 ? TrendingUp : rounded < 0 ? TrendingDown : null;
  return (
    <span className={`inline-flex items-center gap-1 font-semibold whitespace-nowrap ${tone}`}>
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}
      {formatChange(value)}
      {label && <span className="font-normal text-ink-muted">{label}</span>}
    </span>
  );
}

/** Cifras del mercado secundario de un token: último precio, variaciones y volumen. */
export function MarketStatsStrip({ stats, issuePriceUSD }: { stats: MarketStats | null; issuePriceUSD: number }) {
  const last = stats?.lastPriceUSD ?? null;
  const vsIssue = last !== null && issuePriceUSD > 0 ? ((last - issuePriceUSD) / issuePriceUSD) * 100 : null;
  return (
    <dl className="grid grid-cols-2 overflow-hidden rounded-[var(--radius-card)] border border-rule bg-card">
      <div className="px-4 py-4 sm:px-5">
        <dt className="text-sm text-ink-muted">Último precio</dt>
        <dd className="mt-1 text-xl font-bold tracking-tight whitespace-nowrap text-ink [font-stretch:112.5%] sm:text-2xl">{last !== null ? formatPrice(last) : "Sin operaciones"}</dd>
        <dd className="mt-1 text-xs">
          <ChangeTag value={vsIssue} label=" vs. emisión" />
        </dd>
      </div>
      <div className="border-l border-rule px-4 py-4 sm:px-5">
        <dt className="text-sm text-ink-muted">Variación</dt>
        <dd className="mt-1.5 space-y-1 text-sm">
          <span className="flex justify-between gap-2">
            <span className="text-ink-muted">24 h</span>
            <ChangeTag value={stats?.change24hPct ?? null} />
          </span>
          <span className="flex justify-between gap-2">
            <span className="text-ink-muted">7 días</span>
            <ChangeTag value={stats?.change7dPct ?? null} />
          </span>
        </dd>
      </div>
      <div className="border-t border-rule px-4 py-4 sm:px-5">
        <dt className="text-sm text-ink-muted">Volumen 30 días</dt>
        <dd className="mt-1 text-xl font-bold tracking-tight whitespace-nowrap text-ink [font-stretch:112.5%] sm:text-2xl">{formatUSD(stats?.volume30dUSD ?? 0)}</dd>
        <dd className="mt-1 text-xs text-ink-muted">
          {formatNumber(stats?.trades30d ?? 0, 0)} {stats?.trades30d === 1 ? "operación" : "operaciones"}
        </dd>
      </div>
      <div className="border-t border-l border-rule px-4 py-4 sm:px-5">
        <dt className="text-sm text-ink-muted">Precio de emisión</dt>
        <dd className="mt-1 text-xl font-bold tracking-tight whitespace-nowrap text-ink [font-stretch:112.5%] sm:text-2xl">{formatPrice(issuePriceUSD)}</dd>
        <dd className="mt-1 text-xs text-ink-muted">Lo que costó cada token en la ronda</dd>
      </div>
    </dl>
  );
}
