/**
 * Isotipo de TokenARG: la bandera argentina con una moneda de oro con el signo ₿ en lugar del
 * Sol de Mayo. Colores de la bandera: celeste #74ACDF y el amarillo del sol #F6B40E.
 *
 * Es un dibujo propio (no una imagen de la bandera oficial). Ojo si se registra como marca:
 * la Ley 22.362 (art. 3, inc. f) no admite registrar como marca los símbolos que usa la Nación; conviene
 * consultarlo con un agente de la propiedad industrial antes de presentarla en el INPI.
 */

const CELESTE = "#74ACDF";
const GOLD = "#F6B40E";
const GOLD_LIGHT = "#FCC93F";
const GOLD_EDGE = "#B57A0A";
const GLYPH = "#6B3F05";

/** Signo ₿ dibujado con trazos, centrado en (0, 0) y de 8,6 unidades de alto. */
const BITCOIN_GLYPH =
  "M-1.8 -3.1V3.1M-1.8 -3.1H0.4C1.6 -3.1 2.3 -2.5 2.3 -1.6C2.3 -0.7 1.6 -0.1 0.4 -0.1H-1.8M0.4 -0.1H0.8C2.1 -0.1 2.8 0.6 2.8 1.5C2.8 2.5 2.1 3.1 0.8 3.1H-1.8M-0.8 -4.3V-3.1M0.8 -4.3V-3.1M-0.8 3.1V4.3M0.8 3.1V4.3";

/**
 * Canto estriado de la moneda: 28 marcas cortas entre r = 5,5 y r = 6,15 alrededor de (18, 12).
 * Precalculado (y no con Math.cos en el render) para que el SVG del servidor y el del navegador
 * sean idénticos byte a byte.
 */
const COIN_REEDING =
  "M23.5 12L24.15 12M23.36 13.22L24 13.37M22.96 14.39L23.54 14.67M22.3 15.43L22.81 15.83M21.43 16.3L21.83 16.81M20.39 16.96L20.67 17.54M19.22 17.36L19.37 18M18 17.5L18 18.15M16.78 17.36L16.63 18M15.61 16.96L15.33 17.54M14.57 16.3L14.17 16.81M13.7 15.43L13.19 15.83M13.04 14.39L12.46 14.67M12.64 13.22L12 13.37M12.5 12L11.85 12M12.64 10.78L12 10.63M13.04 9.61L12.46 9.33M13.7 8.57L13.19 8.17M14.57 7.7L14.17 7.19M15.61 7.04L15.33 6.46M16.78 6.64L16.63 6M18 6.5L18 5.85M19.22 6.64L19.37 6M20.39 7.04L20.67 6.46M21.43 7.7L21.83 7.19M22.3 8.57L22.81 8.17M22.96 9.61L23.54 9.33M23.36 10.78L24 10.63";

export function BrandMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 36 24" className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      {/* Bandera: celeste, blanco, celeste */}
      <rect width="36" height="24" rx="3.5" fill={CELESTE} />
      <rect y="8" width="36" height="8" fill="#FFFFFF" />
      <rect x="0.4" y="0.4" width="35.2" height="23.2" rx="3.1" fill="none" stroke="#13294B" strokeOpacity={0.16} strokeWidth={0.8} />
      {/* Moneda en lugar del sol */}
      <circle cx="18" cy="12" r="6.6" fill={GOLD} stroke={GOLD_EDGE} strokeWidth={0.7} />
      <path d={COIN_REEDING} stroke={GOLD_EDGE} strokeOpacity={0.55} strokeWidth={0.4} />
      <circle cx="18" cy="12" r="5.1" fill={GOLD_LIGHT} />
      <g transform="translate(18 12) rotate(-12) scale(0.98)">
        <path d={BITCOIN_GLYPH} fill="none" stroke={GLYPH} strokeWidth={1.15} strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

/** Logo completo: isotipo + nombre. */
export function BrandLogo({ size = "md" }: { size?: "md" | "sm" }) {
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark className={size === "md" ? "h-7 w-auto" : "h-6 w-auto"} />
      <span className={`display text-ink ${size === "md" ? "text-[1.35rem]" : "text-lg"}`}>TokenARG</span>
    </span>
  );
}
