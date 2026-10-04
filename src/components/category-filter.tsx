import Link from "next/link";
import type { Category, Network, ProjectStatus } from "@/generated/prisma/enums";
import { CATEGORIES, STATUSES } from "@/lib/categories";
import { NETWORK_COLOR, NETWORK_LABEL } from "@/lib/chains";
import { pluralize } from "@/lib/format";
import { CategoryIcon } from "./category-icon";
import { SortSelect } from "./sort-select";

type Params = { categoria?: string; estado?: string; red?: string; orden?: string };

function hrefWith(params: Params, patch: Partial<Params>) {
  const next = new URLSearchParams();
  const merged = { ...params, ...patch };
  for (const [key, value] of Object.entries(merged)) if (value) next.set(key, value);
  const query = next.toString();
  return query ? `/?${query}#proyectos` : "/#proyectos";
}

const STATUS_FILTERS: ProjectStatus[] = ["FONDEANDO", "PROXIMAMENTE", "FINALIZADO"];

/**
 * Filtros como enlaces: funcionan sin JavaScript, se pueden compartir y el botón "atrás"
 * del navegador los respeta. Solo el orden usa un select con envío automático.
 */
const NETWORKS: Network[] = ["polygon", "ethereum"];

export function CategoryFilter({
  params,
  activeCategory,
  activeStatus,
  activeNetwork,
  count,
}: {
  params: Params;
  activeCategory?: Category;
  activeStatus?: ProjectStatus;
  activeNetwork?: Network;
  count: number;
}) {
  const chip = (active: boolean) =>
    `inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
      active ? "border-ink bg-ink text-white" : "border-rule bg-card text-ink hover:border-rule-strong"
    }`;

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Categorías" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex gap-2">
          <li>
            <Link href={hrefWith(params, { categoria: undefined })} className={chip(!activeCategory)} aria-current={!activeCategory ? "page" : undefined}>
              Todas las categorías
            </Link>
          </li>
          {(Object.keys(CATEGORIES) as Category[]).map((key) => {
            const active = activeCategory === key;
            return (
              <li key={key}>
                <Link
                  href={hrefWith(params, { categoria: CATEGORIES[key].slug })}
                  className={chip(active)}
                  aria-current={active ? "page" : undefined}
                >
                  <CategoryIcon
                    category={key}
                    className="h-4 w-4"
                    style={{ color: active ? "#ffffff" : CATEGORIES[key].ink }}
                  />
                  {CATEGORIES[key].label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule pb-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="text-ink-muted">{pluralize(count, "proyecto", "proyectos")}</span>
          <ul className="flex flex-wrap gap-1" aria-label="Estado de la ronda">
            <li>
              <Link
                href={hrefWith(params, { estado: undefined })}
                className={`rounded-md px-2.5 py-1 ${!activeStatus ? "bg-brand-soft font-semibold text-brand-deep" : "text-ink-muted hover:text-ink"}`}
              >
                Todos
              </Link>
            </li>
            {STATUS_FILTERS.map((status) => (
              <li key={status}>
                <Link
                  href={hrefWith(params, { estado: STATUSES[status].slug })}
                  className={`rounded-md px-2.5 py-1 ${activeStatus === status ? "bg-brand-soft font-semibold text-brand-deep" : "text-ink-muted hover:text-ink"}`}
                >
                  {STATUSES[status].label}
                </Link>
              </li>
            ))}
          </ul>
          <ul className="flex flex-wrap items-center gap-1" aria-label="Red">
            <li className="text-ink-muted" aria-hidden>
              Red:
            </li>
            <li>
              <Link
                href={hrefWith(params, { red: undefined })}
                className={`rounded-md px-2.5 py-1 ${!activeNetwork ? "bg-brand-soft font-semibold text-brand-deep" : "text-ink-muted hover:text-ink"}`}
              >
                Todas
              </Link>
            </li>
            {NETWORKS.map((network) => (
              <li key={network}>
                <Link
                  href={hrefWith(params, { red: network })}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 ${activeNetwork === network ? "bg-brand-soft font-semibold text-brand-deep" : "text-ink-muted hover:text-ink"}`}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: NETWORK_COLOR[network] }} aria-hidden />
                  {NETWORK_LABEL[network]}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <SortSelect params={params} />
      </div>
    </div>
  );
}
