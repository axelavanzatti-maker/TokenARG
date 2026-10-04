/**
 * Mini curva de cierres diarios para tarjetas y tablas. Es un acompañante de la cifra (el
 * precio y la variación van en texto al lado), así que no lleva ejes ni etiquetas.
 */
export function Sparkline({ values, className = "h-8 w-24", label }: { values: number[]; className?: string; label?: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => ({ x: (i / (values.length - 1)) * 100, y: 90 - ((v - min) / span) * 80 }));
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join("");
  const last = pts.at(-1)!;
  return (
    <span className={`relative inline-block ${className}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
        <path d={`${d}L100 100L0 100Z`} fill="var(--color-brand)" fillOpacity={0.08} />
        <path d={d} fill="none" stroke="var(--color-brand)" strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span
        className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand ring-2 ring-card"
        style={{ left: `${last.x}%`, top: `${last.y}%` }}
      />
    </span>
  );
}
