"use client";

import { useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatDay, formatNumber, formatPrice, formatUSD } from "@/lib/format";
import type { PricePoint } from "@/lib/types";

/*
 * Gráfico de precio del mercado secundario.
 *
 * Una sola serie (cierre diario), así que no lleva leyenda: el título la nombra. Línea de 2 px
 * con un lavado del 10 %, referencia del precio de emisión con su etiqueta, y el volumen en un
 * gráfico aparte debajo (mismo eje X, otra escala: nunca dos ejes Y en el mismo gráfico).
 * El trazo va en un SVG que se estira con el contenedor (vector-effect mantiene los 2 px) y
 * todo el texto, los puntos y el tooltip son HTML posicionado en porcentajes: no hace falta
 * medir nada, así que el render del servidor y el del navegador son iguales.
 */

const COLORS = {
  line: "var(--color-brand)", // #2453d6: 6,4:1 sobre blanco
  volume: "#6f8fe0", // un paso más claro del mismo azul: 3,1:1
  volumeActive: "var(--color-brand)",
  reference: "var(--color-ink-faint)", // #74839b: 3,8:1
  grid: "var(--color-rule)",
};

const RANGES = [
  { key: "1m", label: "1 mes", days: 30 },
  { key: "3m", label: "3 meses", days: 91 },
  { key: "todo", label: "Todo", days: null },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

const dayNumber = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / 86_400_000;

function niceStep(range: number, count: number) {
  const raw = range / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const step = normalized < 1.5 ? 1 : normalized < 3 ? 2 : normalized < 7 ? 5 : 10;
  return step * magnitude;
}

/** Marcas "redondas" del eje Y y el dominio que las contiene. */
function niceTicks(min: number, max: number, count = 4) {
  let lo = min;
  let hi = max;
  if (hi - lo < 1e-9) {
    const pad = Math.abs(lo) * 0.02 || 1;
    lo -= pad;
    hi += pad;
  }
  const step = niceStep(hi - lo, count);
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : step >= 0.001 ? 3 : 4;
  return { ticks, domain: [start, end] as const, decimals };
}

export function PriceChart({ points, issuePriceUSD, symbol }: { points: PricePoint[]; issuePriceUSD: number; symbol: string }) {
  const [range, setRange] = useState<RangeKey>("todo");
  const [active, setActive] = useState<number | null>(null);

  const view = useMemo(() => {
    const last = points.at(-1);
    if (!last) return null;
    const days = RANGES.find((r) => r.key === range)?.days ?? null;
    // El rango se ancla en el último día con operaciones (no en el reloj): mismo resultado en
    // el servidor y en el navegador.
    const cutoff = days === null ? -Infinity : dayNumber(last.day) - days;
    const visible = points.filter((p) => dayNumber(p.day) > cutoff);
    const first = visible[0]!;
    const d0 = dayNumber(first.day);
    const span = Math.max(1, dayNumber(last.day) - d0);

    const closes = visible.map((p) => p.close);
    const { ticks, domain, decimals } = niceTicks(Math.min(...closes, issuePriceUSD), Math.max(...closes, issuePriceUSD));
    const [lo, hi] = domain;
    const xOf = (p: PricePoint) => (visible.length === 1 ? 50 : 2 + ((dayNumber(p.day) - d0) / span) * 96);
    const yOf = (value: number) => 100 - ((value - lo) / (hi - lo)) * 100;
    const coords = visible.map((p) => ({ x: xOf(p), y: yOf(p.close) }));
    const maxVolume = Math.max(...visible.map((p) => p.volumeUSD), 1);
    const line = coords.map((c, i) => `${i === 0 ? "M" : "L"}${(c.x * 10).toFixed(1)} ${(c.y * 10).toFixed(1)}`).join("");
    const area = coords.length > 1 ? `${line}L${(coords.at(-1)!.x * 10).toFixed(1)} 1000L${(coords[0]!.x * 10).toFixed(1)} 1000Z` : "";
    // Etiquetas del eje X: primer día, último y uno en el medio si hay lugar.
    const labelIdx = visible.length >= 3 ? [0, Math.floor((visible.length - 1) / 2), visible.length - 1] : visible.map((_, i) => i);
    return {
      visible,
      coords,
      ticks: ticks.map((t) => ({ value: t, y: yOf(t) })),
      decimals,
      issueY: yOf(issuePriceUSD),
      line,
      area,
      maxVolume,
      barWidth: Math.max(0.6, Math.min(4, (100 / (span + 1)) * 0.6)),
      labels: [...new Set(labelIdx)].map((i) => ({ x: coords[i]!.x, day: visible[i]!.day })),
    };
  }, [points, range, issuePriceUSD]);

  if (!view) {
    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-rule-strong bg-card px-5 py-10 text-center">
        <p className="heading text-base text-ink">Todavía no hubo operaciones</p>
        <p className="mx-auto mt-1 max-w-[46ch] text-sm text-ink-muted">
          El primer precio aparece cuando alguien toma una orden del mercado. Hasta entonces, la referencia es el precio de
          emisión: {formatPrice(issuePriceUSD)} por token.
        </p>
      </div>
    );
  }

  const { visible, coords } = view;
  const lastIndex = visible.length - 1;
  const shown = active !== null && active <= lastIndex ? active : null;
  const focus = shown ?? lastIndex;
  const focusPoint = visible[focus]!;
  const focusCoord = coords[focus]!;

  const nearest = (clientX: number, rect: DOMRect) => {
    const x = ((clientX - rect.left) / rect.width) * 100;
    let best = 0;
    for (let i = 1; i < coords.length; i++) if (Math.abs(coords[i]!.x - x) < Math.abs(coords[best]!.x - x)) best = i;
    return best;
  };

  const onPointer = (event: PointerEvent<HTMLDivElement>) => setActive(nearest(event.clientX, event.currentTarget.getBoundingClientRect()));
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = shown ?? lastIndex;
    const next =
      event.key === "ArrowLeft" ? Math.max(0, current - 1)
      : event.key === "ArrowRight" ? Math.min(lastIndex, current + 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? lastIndex
      : null;
    if (next === null) {
      if (event.key === "Escape") setActive(null);
      return;
    }
    event.preventDefault();
    setActive(next);
  };

  const tooltipOnLeft = focusCoord.x > 62;
  const tickLabel = (value: number) => value.toLocaleString("es-AR", { minimumFractionDigits: view.decimals, maximumFractionDigits: view.decimals });

  return (
    <figure className="rounded-[var(--radius-card)] border border-rule bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <figcaption>
          <span className="heading text-base text-ink">Precio de {symbol}</span>
          <span className="block text-xs text-ink-muted">Cierre diario en USD por token, en hora argentina</span>
        </figcaption>
        <div className="flex rounded-[var(--radius-control)] border border-rule p-0.5" role="group" aria-label="Período del gráfico">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              aria-pressed={range === r.key}
              onClick={() => {
                setRange(r.key);
                setActive(null);
              }}
              className={`rounded-[6px] px-2.5 py-1 text-xs font-semibold ${range === r.key ? "bg-ink text-white" : "text-ink-muted hover:text-ink"}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)_3.75rem] gap-x-2">
        {/* Área del gráfico de precio */}
        <div
          className="relative h-[220px] cursor-crosshair touch-pan-y outline-offset-4"
          tabIndex={0}
          role="group"
          aria-roledescription="gráfico interactivo"
          aria-label={`Precio de ${symbol}: ${visible.length} días con operaciones. Usá las flechas para recorrerlos.`}
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={() => setActive(null)}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
        >
          <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
            {view.ticks.map((t) => (
              <line key={t.value} x1="0" x2="1000" y1={t.y * 10} y2={t.y * 10} stroke={COLORS.grid} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            <line x1="0" x2="1000" y1={view.issueY * 10} y2={view.issueY * 10} stroke={COLORS.reference} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            {view.area && <path d={view.area} fill={COLORS.line} fillOpacity={0.1} />}
            {coords.length > 1 && (
              <path d={view.line} fill="none" stroke={COLORS.line} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            )}
          </svg>

          {/* Etiqueta de la referencia: precio de emisión */}
          <span
            className="pointer-events-none absolute left-1 -translate-y-full bg-card/85 px-1 pb-0.5 text-[0.6875rem] leading-none text-ink-muted"
            style={{ top: `${view.issueY}%` }}
          >
            Emisión {formatPrice(issuePriceUSD)}
          </span>

          {/* Mira vertical y punto del día enfocado (o el último, con 2 px de anillo) */}
          {shown !== null && (
            <span className="pointer-events-none absolute top-0 bottom-0 w-px bg-ink/40" style={{ left: `${focusCoord.x}%` }} aria-hidden />
          )}
          <span
            className="pointer-events-none absolute h-[10px] w-[10px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand ring-2 ring-card"
            style={{ left: `${focusCoord.x}%`, top: `${focusCoord.y}%` }}
            aria-hidden
          />

          {shown !== null && (
            <div
              className="pointer-events-none absolute top-1 z-10 w-max min-w-[9.5rem] rounded-[var(--radius-control)] border border-rule bg-card px-3 py-2 text-xs shadow-[0_10px_28px_-14px_rgba(19,41,75,0.45)]"
              style={tooltipOnLeft ? { right: `calc(${100 - focusCoord.x}% + 10px)` } : { left: `calc(${focusCoord.x}% + 10px)` }}
            >
              <p className="text-ink-muted">{formatDay(focusPoint.day)}</p>
              <p className="mt-0.5 flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-3 rounded-full bg-brand" aria-hidden />
                <strong className="figure text-sm text-ink">{formatPrice(focusPoint.close)}</strong>
                <span className="text-ink-muted">cierre</span>
              </p>
              {focusPoint.high !== focusPoint.low && (
                <p className="mt-0.5 text-ink-muted">
                  Máx. {formatPrice(focusPoint.high)} · Mín. {formatPrice(focusPoint.low)}
                </p>
              )}
              <p className="mt-0.5 text-ink-muted">
                {formatUSD(focusPoint.volumeUSD)} en {focusPoint.trades} {focusPoint.trades === 1 ? "operación" : "operaciones"}
              </p>
            </div>
          )}
        </div>

        {/* Eje Y a la derecha, con el último precio destacado */}
        <div className="relative h-[220px] text-[0.6875rem] text-ink-muted tabular" aria-hidden>
          {view.ticks.map((t) => (
            <span key={t.value} className="absolute left-0 -translate-y-1/2" style={{ top: `${t.y}%` }}>
              {tickLabel(t.value)}
            </span>
          ))}
          <span
            className="absolute left-0 -translate-y-1/2 rounded-[4px] bg-brand px-1 py-0.5 font-semibold text-white"
            style={{ top: `${focusCoord.y}%` }}
          >
            {focusPoint.close.toLocaleString("es-AR", { minimumFractionDigits: focusPoint.close < 10 ? 4 : 2, maximumFractionDigits: focusPoint.close < 10 ? 4 : 2 })}
          </span>
        </div>

        {/* Volumen diario: gráfico aparte con su propia escala */}
        <div className="relative mt-3 h-12 border-b border-rule" aria-hidden>
          {visible.map((p, i) => (
            <span
              key={p.day}
              className="absolute bottom-0 max-w-6 -translate-x-1/2 rounded-t-[4px]"
              style={{
                left: `${coords[i]!.x}%`,
                width: `${view.barWidth}%`,
                height: `${Math.max(4, (p.volumeUSD / view.maxVolume) * 100)}%`,
                background: i === shown ? COLORS.volumeActive : COLORS.volume,
              }}
            />
          ))}
        </div>
        <div className="mt-3 flex h-12 items-end pb-0.5 text-[0.6875rem] leading-tight text-ink-muted" aria-hidden>
          Volumen
          <br />
          diario
        </div>

        {/* Eje X */}
        <div className="relative h-5 text-[0.6875rem] text-ink-muted" aria-hidden>
          {view.labels.map((label, i) => (
            <span
              key={label.day}
              className={`absolute top-1 whitespace-nowrap ${i === 0 && view.labels.length > 1 ? "" : i === view.labels.length - 1 && view.labels.length > 1 ? "-translate-x-full" : "-translate-x-1/2"}`}
              style={{ left: `${label.x}%` }}
            >
              {formatDay(label.day, { short: true })}
            </span>
          ))}
        </div>
      </div>

      {/* Lectura para lectores de pantalla del día enfocado con el teclado */}
      <p className="sr-only" aria-live="polite">
        {shown !== null
          ? `${formatDay(focusPoint.day)}: cierre ${formatPrice(focusPoint.close)}, volumen ${formatUSD(focusPoint.volumeUSD)}, ${focusPoint.trades} operaciones.`
          : ""}
      </p>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs font-semibold text-brand underline-offset-2 hover:underline">Ver los datos en una tabla</summary>
        <div className="relative mt-2 max-h-72 overflow-auto rounded-[var(--radius-control)] border border-rule">
          <table className="w-full min-w-[520px] text-xs">
            <thead className="sticky top-0 bg-card text-left text-ink-muted">
              <tr className="border-b border-rule">
                <th scope="col" className="px-3 py-2 font-medium">Día</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Apertura</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Máximo</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Mínimo</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Cierre</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Volumen</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Operaciones</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {[...visible].reverse().map((p) => (
                <tr key={p.day} className="border-b border-rule last:border-0">
                  <td className="px-3 py-1.5 whitespace-nowrap">{formatDay(p.day)}</td>
                  <td className="px-3 py-1.5 text-right">{formatPrice(p.open)}</td>
                  <td className="px-3 py-1.5 text-right">{formatPrice(p.high)}</td>
                  <td className="px-3 py-1.5 text-right">{formatPrice(p.low)}</td>
                  <td className="px-3 py-1.5 text-right font-semibold text-ink">{formatPrice(p.close)}</td>
                  <td className="px-3 py-1.5 text-right">{formatUSD(p.volumeUSD)}</td>
                  <td className="px-3 py-1.5 text-right">{formatNumber(p.trades, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
