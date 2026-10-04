import type { Category, ProjectStatus } from "@/generated/prisma/enums";

/**
 * Cada categoría tiene su "tinta", como las denominaciones de un billete: se usa en el
 * guilloché de la portada, el sello de la ficha y los chips.
 */
export const CATEGORIES: Record<
  Category,
  { label: string; slug: string; ink: string; inkSoft: string; noun: string }
> = {
  INMUEBLES: { label: "Inmuebles", slug: "inmuebles", ink: "#A33B2B", inkSoft: "#F6E5E1", noun: "inmueble" },
  AGRO: { label: "Agro", slug: "agro", ink: "#5E6B12", inkSoft: "#EEF0DA", noun: "campaña agrícola" },
  DEUDA_PYME: { label: "Deuda PyME", slug: "deuda-pyme", ink: "#1F6474", inkSoft: "#DFEEF1", noun: "financiamiento PyME" },
  EMPRESAS: { label: "Empresas", slug: "empresas", ink: "#73284A", inkSoft: "#F3E2EA", noun: "participación societaria" },
};

export const CATEGORY_BY_SLUG: Record<string, Category> = Object.fromEntries(
  Object.entries(CATEGORIES).map(([key, value]) => [value.slug, key as Category]),
);

export const STATUSES: Record<ProjectStatus, { label: string; slug: string }> = {
  FONDEANDO: { label: "En fondeo", slug: "en-fondeo" },
  PROXIMAMENTE: { label: "Próximamente", slug: "proximos" },
  FINALIZADO: { label: "Fondeado", slug: "fondeados" },
  LIQUIDADO: { label: "Liquidado", slug: "liquidados" },
  CANCELADO: { label: "Cancelado", slug: "cancelados" },
};

export const STATUS_BY_SLUG: Record<string, ProjectStatus> = Object.fromEntries(
  Object.entries(STATUSES).map(([key, value]) => [value.slug, key as ProjectStatus]),
);
