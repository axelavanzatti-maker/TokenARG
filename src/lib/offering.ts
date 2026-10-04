/** Estados de TokenOffering.State, en el mismo orden que el enum de Solidity. */
export const OFFERING_STATE = ["Upcoming", "Open", "Closed", "Successful", "Failed"] as const;
export type OfferingState = (typeof OFFERING_STATE)[number];

export const OFFERING_STATE_LABEL: Record<OfferingState, string> = {
  Upcoming: "Próxima",
  Open: "Abierta",
  Closed: "Cerrada, falta el cierre formal",
  Successful: "Fondeada",
  Failed: "No alcanzó el mínimo o fue cancelada",
};

export function offeringStateFromIndex(index: number): OfferingState {
  return OFFERING_STATE[index] ?? "Upcoming";
}
