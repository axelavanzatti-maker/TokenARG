import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReactNode } from "react";

/**
 * Tarjeta para compartir en redes (1200 × 630), para ImageResponse: solo estilos en línea y
 * flexbox. La bandera con la moneda es una versión simple del isotipo.
 */
export const OG_SIZE = { width: 1200, height: 630 };

const FONTS = join(process.cwd(), "src/assets/fonts");

/** Archivo (Omnibus-Type, Buenos Aires), la tipografía del sitio, en los dos pesos de la tarjeta. */
export async function ogOptions() {
  const [regular, heavy] = await Promise.all([
    readFile(join(FONTS, "archivo-latin-400-normal.woff")),
    readFile(join(FONTS, "archivo-latin-800-normal.woff")),
  ]);
  return {
    ...OG_SIZE,
    fonts: [
      { name: "Archivo", data: regular, weight: 400 as const, style: "normal" as const },
      { name: "Archivo", data: heavy, weight: 800 as const, style: "normal" as const },
    ],
  };
}

const INK = "#13294b";
const MUTED = "#4a5b76";
const CELESTE = "#74ACDF";
const GOLD = "#F6B40E";

function Flag({ width }: { width: number }) {
  const height = (width * 2) / 3;
  return (
    <div style={{ display: "flex", flexDirection: "column", width, height, borderRadius: width * 0.1, overflow: "hidden", position: "relative" }}>
      <div style={{ flex: 1, background: CELESTE }} />
      <div style={{ flex: 1, background: "#ffffff" }} />
      <div style={{ flex: 1, background: CELESTE }} />
      <div
        style={{
          position: "absolute",
          left: width / 2 - height * 0.28,
          top: height / 2 - height * 0.28,
          width: height * 0.56,
          height: height * 0.56,
          borderRadius: height,
          background: GOLD,
          border: `${Math.max(2, width * 0.02)}px solid #B57A0A`,
        }}
      />
    </div>
  );
}

export function OgCard({ eyebrow, eyebrowColor, title, subtitle, facts, footer }: {
  eyebrow?: string;
  eyebrowColor?: string;
  title: string;
  subtitle?: string;
  facts?: { label: string; value: string }[];
  footer: string;
}): ReactNode {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: "#f3f6fa", color: INK, padding: "56px 64px 0", fontFamily: "Archivo" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <Flag width={66} />
        <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: -0.5 }}>TokenARG</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
        {eyebrow && (
          <div style={{ display: "flex", fontSize: 26, fontWeight: 800, color: eyebrowColor ?? "#2453d6", textTransform: "uppercase", letterSpacing: 2 }}>
            {eyebrow}
          </div>
        )}
        <div style={{ display: "flex", fontSize: title.length > 48 ? 58 : 70, fontWeight: 800, lineHeight: 1.05, marginTop: 12, letterSpacing: -1.5 }}>
          {title}
        </div>
        {subtitle && <div style={{ display: "flex", fontSize: 30, color: MUTED, marginTop: 18, lineHeight: 1.3 }}>{subtitle}</div>}
        {facts && facts.length > 0 && (
          <div style={{ display: "flex", gap: 20, marginTop: 34 }}>
            {facts.map((f) => (
              <div key={f.label} style={{ display: "flex", flexDirection: "column", background: "#ffffff", border: "2px solid #d6dee9", borderRadius: 14, padding: "14px 22px" }}>
                <div style={{ display: "flex", fontSize: 22, color: MUTED }}>{f.label}</div>
                <div style={{ display: "flex", fontSize: 36, fontWeight: 800, marginTop: 4 }}>{f.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 24, color: MUTED, paddingBottom: 22 }}>
        <div style={{ display: "flex" }}>{footer}</div>
      </div>
      <div style={{ display: "flex", height: 18, margin: "0 -64px" }}>
        <div style={{ flex: 1, background: CELESTE }} />
        <div style={{ flex: 1, background: "#ffffff" }} />
        <div style={{ flex: 1, background: CELESTE }} />
      </div>
    </div>
  );
}
