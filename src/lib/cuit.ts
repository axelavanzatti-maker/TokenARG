/**
 * Validación de CUIT / CUIL (AFIP/ARCA): 11 dígitos, prefijo válido y dígito verificador
 * módulo 11 con pesos 5-4-3-2-7-6-5-4-3-2.
 */
const WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
const VALID_PREFIXES = new Set(["20", "23", "24", "25", "26", "27", "30", "33", "34"]);

export function normalizeCuit(value: string) {
  return value.replace(/\D/g, "");
}

export function isValidCuit(value: string) {
  const digits = normalizeCuit(value);
  if (!/^\d{11}$/.test(digits) || !VALID_PREFIXES.has(digits.slice(0, 2))) return false;
  const sum = WEIGHTS.reduce((acc, weight, i) => acc + weight * Number(digits[i]), 0);
  const remainder = 11 - (sum % 11);
  // Un resultado 10 nunca es válido: en ese caso ARCA asigna el prefijo 23/33, y con ese
  // prefijo la fórmula ya da el dígito correcto.
  if (remainder === 10) return false;
  const check = remainder === 11 ? 0 : remainder;
  return check === Number(digits[10]);
}

/** "20-12345678-6" */
export function formatCuit(value: string) {
  const digits = normalizeCuit(value);
  if (digits.length !== 11) return value;
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}
