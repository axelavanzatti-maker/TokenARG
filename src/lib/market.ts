import { parseUnits } from "viem";

/**
 * Cuentas del mercado secundario, idénticas a las de P2PMarket.sol (todo en bigint):
 * precio = unidades de USDC (6 decimales) por 1 token entero (1e18 unidades).
 */
export const TOKEN_UNIT = 10n ** 18n;
const BPS = 10_000n;
/** Valor mínimo de una toma parcial (MIN_FILL_VALUE en el contrato): 1 USDC. */
export const MIN_FILL_VALUE = 1_000_000n;

export type OrderSide = "sell" | "buy";

export interface MarketOrder {
  id: bigint;
  maker: `0x${string}`;
  side: OrderSide;
  /** USDC (6 decimales) por token entero. */
  price: bigint;
  amount: bigint;
  remaining: bigint;
  /** Lo que hoy se puede tomar según el saldo y la autorización del anunciante. */
  fillable: bigint;
  createdAt: number;
}

/** Valor en USDC de `amount` tokens a `price` (Math.mulDiv redondea hacia abajo). */
export function tradeValue(amount: bigint, price: bigint) {
  return (amount * price) / TOKEN_UNIT;
}

export function feeOf(value: bigint, bps: number) {
  return (value * BigInt(bps)) / BPS;
}

/** USDC que tiene que tener autorizados quien compra: compromisos abiertos + esta operación. */
export function buyerAllowanceNeeded(committedValue: bigint, value: bigint, buyerFeeBps: number) {
  const total = committedValue + value;
  return total + feeOf(total, buyerFeeBps);
}

/** Tokens que se pueden tomar de una orden hoy (lo menor entre lo pendiente y lo respaldado). */
export function takeable(order: MarketOrder) {
  return order.fillable < order.remaining ? order.fillable : order.remaining;
}

/** Por qué no se puede tomar `amount` de una orden (null si se puede). Replica fillOrder(). */
export function fillProblem(order: MarketOrder, amount: bigint): string | null {
  if (amount <= 0n) return "Ingresá la cantidad de tokens.";
  if (amount > order.remaining) return "La orden no tiene tantos tokens disponibles.";
  if (amount > order.fillable) return "El anunciante no tiene respaldo para tanto en este momento: probá con menos.";
  const value = tradeValue(amount, order.price);
  if (value === 0n || (amount !== order.remaining && value < MIN_FILL_VALUE)) return "Cada toma parcial tiene que valer al menos USD 1.";
  return null;
}

/**
 * Convierte lo que escribe el usuario ("12,5", "12.5", "1000") en unidades. Acepta coma o
 * punto como separador decimal, sin separador de miles. null si no es un número válido.
 */
export function parseDecimalInput(text: string, decimals: number): bigint | null {
  const clean = text.trim().replace(",", ".");
  if (!/^\d*\.?\d*$/.test(clean) || clean === "" || clean === ".") return null;
  const [whole = "0", fraction = ""] = clean.split(".");
  try {
    return parseUnits(`${whole || "0"}.${fraction.slice(0, decimals) || "0"}`, decimals);
  } catch {
    return null;
  }
}

/** Filtra lo que se escribe en un campo numérico: dígitos y un separador decimal. */
export function sanitizeDecimalInput(text: string, maxDecimals: number) {
  const cleaned = text.replace(/[^\d.,]/g, "");
  const match = /^(\d*)([.,]?)(\d*)/.exec(cleaned);
  if (!match) return "";
  const [, whole = "", separator = "", fraction = ""] = match;
  return `${whole.replace(/^0+(?=\d)/, "").slice(0, 12)}${separator}${fraction.slice(0, maxDecimals)}`;
}
