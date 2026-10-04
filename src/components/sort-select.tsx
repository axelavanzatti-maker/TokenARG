"use client";

import { useRouter } from "next/navigation";

const OPTIONS = [
  { value: "", label: "Destacados" },
  { value: "tir", label: "Mayor TIR estimada" },
  { value: "ticket", label: "Menor ticket mínimo" },
  { value: "cierre", label: "Cierre más próximo" },
];

export function SortSelect({ params }: { params: { categoria?: string; estado?: string; red?: string; orden?: string } }) {
  const router = useRouter();
  return (
    <form method="get" action="/" className="flex items-center gap-2 text-sm">
      {params.categoria && <input type="hidden" name="categoria" value={params.categoria} />}
      {params.estado && <input type="hidden" name="estado" value={params.estado} />}
      {params.red && <input type="hidden" name="red" value={params.red} />}
      <label htmlFor="orden" className="text-ink-muted">
        Ordenar por
      </label>
      <select
        id="orden"
        name="orden"
        defaultValue={params.orden ?? ""}
        className="rounded-[var(--radius-control)] border border-rule bg-card px-2.5 py-1.5 text-sm text-ink"
        onChange={(event) => {
          const next = new URLSearchParams();
          if (params.categoria) next.set("categoria", params.categoria);
          if (params.estado) next.set("estado", params.estado);
          if (params.red) next.set("red", params.red);
          if (event.target.value) next.set("orden", event.target.value);
          const query = next.toString();
          router.push(query ? `/?${query}#proyectos` : "/#proyectos", { scroll: false });
        }}
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit" className="rounded-md border border-rule px-2 py-1">
          Aplicar
        </button>
      </noscript>
    </form>
  );
}
