import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

/** Piezas comunes de los formularios públicos (postulación y lista de espera). */
export const fieldClass =
  "mt-1.5 w-full rounded-[var(--radius-control)] border border-rule-strong bg-card px-3 py-2.5 text-base text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

export function Label({ htmlFor, children, optional }: { htmlFor: string; children: ReactNode; optional?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="text-sm font-semibold text-ink">
      {children}
      {optional && <span className="ml-1 font-normal text-ink-faint">(opcional)</span>}
    </label>
  );
}

export function FieldError({ id, children }: { id: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} className="mt-1 text-sm text-danger">
      {children}
    </p>
  );
}

export function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-brand px-5 py-3 text-base font-semibold text-white hover:bg-brand-deep disabled:opacity-70"
    >
      {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/** Campo trampa para bots: invisible y fuera del orden de tabulación. */
export function Honeypot({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
      <label>
        Web de la empresa
        <input tabIndex={-1} autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}
