/**
 * Guilloché determinístico: el mismo slug siempre dibuja el mismo patrón, como la trama de
 * seguridad de un título impreso. Se genera en el servidor y llega como SVG estático.
 */

function seededRandom(seed: string) {
  let state = [...seed].reduce((acc, ch) => (Math.imul(acc, 31) + ch.charCodeAt(0)) >>> 0, 2166136261);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

/** Bandas de ondas entrelazadas que cubren todo el ancho. */
export function guillocheWaves(seed: string, width = 400, height = 200, lines = 18) {
  const random = seededRandom(seed);
  const f1 = 1.2 + random() * 1.3;
  const f2 = 2.6 + random() * 2.4;
  const a1 = height * (0.07 + random() * 0.05);
  const a2 = height * (0.025 + random() * 0.025);
  const drift = 0.16 + random() * 0.18;
  const step = 6;

  let d = "";
  for (let i = 0; i < lines; i++) {
    const y0 = ((i + 0.5) * height) / lines;
    for (let x = 0; x <= width; x += step) {
      const t = (x / width) * Math.PI * 2;
      const y = y0 + a1 * Math.sin(f1 * t + i * drift) + a2 * Math.sin(f2 * t - i * drift * 1.7);
      d += `${x === 0 ? "M" : "L"}${fmt(x)} ${fmt(y)}`;
    }
  }
  return d;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Roseta (hipotrocoide), el "sello" de cada título. Centrada en (0, 0) con radio ~`radius`. */
export function guillocheRosette(seed: string, radius = 64) {
  const random = seededRandom(`${seed}:rosette`);
  const R = 120;
  const options = [35, 40, 45, 48, 50, 54];
  const r = options[Math.floor(random() * options.length)]!;
  const d = r * (0.75 + random() * 0.4);
  const turns = r / gcd(R, r);
  const steps = 720;
  const scale = radius / (R - r + d);

  let path = "";
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2 * turns;
    const k = (R - r) / r;
    const x = ((R - r) * Math.cos(t) + d * Math.cos(k * t)) * scale;
    const y = ((R - r) * Math.sin(t) - d * Math.sin(k * t)) * scale;
    path += `${i === 0 ? "M" : "L"}${fmt(x)} ${fmt(y)}`;
  }
  return `${path}Z`;
}
