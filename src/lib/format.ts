import { formatUnits } from "viem";

const usdFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "USD",
  currencyDisplay: "code",
  maximumFractionDigits: 0,
});

const usdCentsFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "USD",
  currencyDisplay: "code",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "USD 245.000" */
export function formatUSD(value: number, { cents = false } = {}) {
  return (cents ? usdCentsFormatter : usdFormatter).format(value).replace(/ /g, " ");
}

const priceFormatters = [2, 4].map(
  (digits) =>
    new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "USD",
      currencyDisplay: "code",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }),
);

/**
 * Precio de un token en el mercado secundario: "USD 11,35" o, para tokens de alrededor de un
 * dólar (pagarés), "USD 1,0127" (ahí 2 decimales esconderían toda la variación).
 */
export function formatPrice(value: number) {
  return priceFormatters[value < 10 ? 1 : 0]!.format(value).replace(/\u00a0/g, " ");
}

/** Variación porcentual con signo: "+3,4 %", "−1,2 %", "0 %". */
export function formatChange(value: number, digits = 1) {
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return "0 %";
  const text = Math.abs(rounded).toLocaleString("es-AR", { maximumFractionDigits: digits });
  return `${rounded > 0 ? "+" : "−"}${text} %`;
}

// Días calendario (AAAA-MM-DD, ya en hora argentina): se formatean en UTC para no correrlos.
const dayFormatter = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const shortDayFormatter = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: "UTC" });

/** "2026-07-12" → "12 de jul de 2026" (o "12 jul", compacto para ejes, con short). */
export function formatDay(day: string, { short = false } = {}) {
  const date = new Date(`${day}T12:00:00Z`);
  if (!short) return dayFormatter.format(date).replace(".", "");
  const parts = shortDayFormatter.formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("day")} ${value("month").replace(".", "")}`;
}

/** "11,5 %" */
export function formatPercent(value: number, digits = 1) {
  return `${value.toLocaleString("es-AR", { maximumFractionDigits: digits })} %`;
}

export function formatNumber(value: number, maxDigits = 2) {
  return value.toLocaleString("es-AR", { maximumFractionDigits: maxDigits });
}

/** Unidades de USDC (6 decimales) → número en USD. */
export function usdcToNumber(units: bigint, decimals = 6) {
  return Number(formatUnits(units, decimals));
}

/** Unidades de un AssetToken (18 decimales) → número. */
export function tokensToNumber(units: bigint) {
  return Number(formatUnits(units, 18));
}

/** Unidades de USDC → "USD 1.250" o "USD 12,34" (centavos solo cuando hacen falta). */
export function formatUsdcUnits(units: bigint, decimals = 6) {
  const value = usdcToNumber(units, decimals);
  return formatUSD(value, { cents: !Number.isInteger(value) });
}

/** Unidades de un AssetToken → "1.250,5 TCBA". */
export function formatTokenUnits(units: bigint, symbol: string) {
  return `${formatNumber(tokensToNumber(units), 4)} ${symbol}`;
}

/**
 * Unidades de una moneda cripto → "0,0334 ETH", "1,25 WBTC", "9.998,2 POL". Las cantidades
 * chicas conservan 4 cifras significativas para que no se vean como cero.
 */
export function formatAssetUnits(units: bigint, decimals: number, symbol: string) {
  const value = Number(formatUnits(units, decimals));
  const text =
    value !== 0 && Math.abs(value) < 1
      ? value.toLocaleString("es-AR", { maximumSignificantDigits: 4 })
      : value.toLocaleString("es-AR", { maximumFractionDigits: 4 });
  return `${text} ${symbol}`;
}

export function shortAddress(address: string, chars = 4) {
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`;
}

export function shortHash(hash: string, chars = 6) {
  const clean = hash.replace(/^0x/, "");
  return `${clean.slice(0, chars)}…${clean.slice(-chars)}`;
}

// Hora argentina explícita: el servidor suele correr en UTC y, sin esto, una fecha cercana a la
// medianoche se mostraría distinta en el HTML del servidor y en el navegador.
const dateFormatter = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "America/Argentina/Buenos_Aires",
});

export function formatDate(date: Date | string | number) {
  return dateFormatter.format(new Date(date)).replace(".", "");
}

/** "en 9 días", "mañana", "hoy", "hace 3 días" */
export function relativeDays(target: Date | string | number, now = Date.now()) {
  const days = Math.round((new Date(target).getTime() - now) / 86_400_000);
  if (days === 0) return "hoy";
  if (days === 1) return "mañana";
  if (days === -1) return "ayer";
  return days > 0 ? `en ${days} días` : `hace ${-days} días`;
}

export function pluralize(count: number, singular: string, plural: string) {
  return `${formatNumber(count, 0)} ${count === 1 ? singular : plural}`;
}
