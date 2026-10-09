import { NETWORK_LABEL, isAppChain } from "@/lib/chains";
import type { ProjectSummary } from "@/lib/types";
import { formatDate, relativeDays } from "./format";

type TimingFields = "status" | "opensAt" | "closesAt" | "collectedAmountUSD" | "targetAmountUSD" | "network" | "chainId" | "offeringAddress";

/** Si la ronda del proyecto ya está desplegada en una red activa de la app. */
export function isRoundDeployed(p: Pick<ProjectSummary, "chainId" | "offeringAddress">) {
  return Boolean(p.offeringAddress && isAppChain(p.chainId));
}

/** Línea de estado de la ronda, en lenguaje llano. */
export function roundTiming(p: Pick<ProjectSummary, TimingFields>) {
  // Sin contratos en su red, las fechas todavía no están fijadas.
  if (!isRoundDeployed(p)) return `Próximamente en ${NETWORK_LABEL[p.network]}`;
  switch (p.status) {
    case "PROXIMAMENTE":
      return `Abre el ${formatDate(p.opensAt)}`;
    case "FONDEANDO": {
      const when = relativeDays(p.closesAt);
      return when === "hoy" ? "Cierra hoy" : `Cierra ${when}`;
    }
    case "FINALIZADO":
      return p.collectedAmountUSD >= p.targetAmountUSD ? "Cupo completo" : "Ronda cerrada";
    case "CANCELADO":
      return "Reembolsos habilitados";
    case "LIQUIDADO":
      return "Fideicomiso liquidado";
  }
}

export const STATUS_TONE: Record<ProjectSummary["status"], string> = {
  FONDEANDO: "bg-brand-soft text-brand-deep",
  PROXIMAMENTE: "bg-paper text-ink-muted ring-1 ring-rule",
  FINALIZADO: "bg-yield-soft text-yield",
  LIQUIDADO: "bg-paper text-ink-muted ring-1 ring-rule",
  CANCELADO: "bg-danger-soft text-danger",
};
