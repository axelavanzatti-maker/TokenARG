import type { ReactNode } from "react";

export interface Metric {
  label: string;
  value: ReactNode;
  /** Aclaración breve debajo de la cifra. */
  note?: string;
  tone?: "yield" | "default" | "muted";
}

/**
 * Las cifras clave de la ficha, como los casilleros de datos de un título impreso:
 * una sola banda con divisiones, no tarjetas sueltas.
 */
export function MetricStrip({ metrics }: { metrics: Metric[] }) {
  return (
    <dl className="grid grid-cols-2 overflow-hidden rounded-[var(--radius-card)] border border-rule bg-card sm:grid-cols-4">
      {metrics.map((metric, index) => (
        <div
          key={metric.label}
          className={`px-4 py-4 sm:px-5 ${index % 2 === 1 ? "border-l border-rule" : ""} ${index >= 2 ? "border-t border-rule sm:border-t-0" : ""} ${index > 0 ? "sm:border-l" : ""}`}
        >
          <dt className="text-sm text-ink-muted">{metric.label}</dt>
          <dd
            className={`figure mt-1 text-2xl ${metric.tone === "yield" ? "text-yield" : metric.tone === "muted" ? "text-ink-faint" : "text-ink"}`}
          >
            {metric.value}
          </dd>
          {metric.note && <dd className="mt-1 text-xs leading-snug text-ink-muted">{metric.note}</dd>}
        </div>
      ))}
    </dl>
  );
}
