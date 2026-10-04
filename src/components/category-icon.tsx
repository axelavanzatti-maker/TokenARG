import { Briefcase, Building2, Factory, Tractor, type LucideProps } from "lucide-react";
import type { Category } from "@/generated/prisma/enums";

const ICONS = {
  INMUEBLES: Building2,
  AGRO: Tractor,
  DEUDA_PYME: Briefcase,
  EMPRESAS: Factory,
} satisfies Record<Category, unknown>;

export function CategoryIcon({ category, ...props }: { category: Category } & LucideProps) {
  const Icon = ICONS[category];
  return <Icon aria-hidden {...props} />;
}
