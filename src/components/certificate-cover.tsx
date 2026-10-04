import type { Category } from "@/generated/prisma/enums";
import { CATEGORIES } from "@/lib/categories";
import { guillocheRosette, guillocheWaves } from "@/lib/guilloche";
import { Vignette } from "./vignette";

/**
 * Portada con forma de título valor: trama guilloché en la tinta de la categoría, viñeta con
 * la foto del activo y el símbolo del token como "denominación".
 */
export function CertificateCover({
  slug,
  category,
  symbol,
  image,
  title,
  variant = "card",
}: {
  slug: string;
  category: Category;
  symbol: string;
  image?: string;
  title: string;
  variant?: "card" | "hero";
}) {
  const { ink, inkSoft, label } = CATEGORIES[category];
  const hero = variant === "hero";
  const waves = guillocheWaves(slug, 400, 200, hero ? 22 : 18);
  const rosette = guillocheRosette(slug, 62);

  return (
    <div
      className={`relative w-full overflow-hidden ${hero ? "aspect-[2/1] sm:aspect-[5/2]" : "aspect-[2/1]"}`}
      style={{ background: inkSoft }}
    >
      <svg
        viewBox="0 0 400 200"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
        aria-hidden
      >
        <path d={waves} fill="none" stroke={ink} strokeOpacity={0.26} strokeWidth={0.55} />
        <g transform="translate(318 100)">
          <circle r="70" fill={inkSoft} fillOpacity={0.82} />
          <path d={rosette} fill="none" stroke={ink} strokeOpacity={0.6} strokeWidth={0.5} />
          <circle r="70" fill="none" stroke={ink} strokeOpacity={0.35} strokeWidth={0.6} />
          <circle r="73" fill="none" stroke={ink} strokeOpacity={0.2} strokeWidth={0.4} />
        </g>
      </svg>

      <div className="absolute top-1/2 left-[6%] h-[76%] -translate-y-1/2" style={{ aspectRatio: "4 / 5" }}>
        <Vignette
          image={image}
          category={category}
          alt={title}
          sizes={hero ? "(min-width: 1024px) 300px, 40vw" : "(min-width: 1024px) 140px, 30vw"}
          priority={hero}
        />
      </div>

      <div className="absolute top-[9%] right-[5%] text-right">
        <span
          className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
          style={{ color: ink, background: "rgba(255,255,255,0.86)" }}
        >
          {label}
        </span>
      </div>
      <div
        className={`display absolute right-[5%] bottom-[8%] ${hero ? "text-4xl sm:text-5xl" : "text-[1.65rem]"}`}
        style={{ color: ink }}
      >
        {symbol}
      </div>
    </div>
  );
}
