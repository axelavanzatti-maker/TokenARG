import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-[640px] px-4 py-24 text-center sm:px-6">
      <h1 className="display text-[2rem] text-ink">No encontramos esa página</h1>
      <p className="mt-3 text-ink-muted">Puede que el proyecto haya cambiado de dirección o que el enlace esté incompleto.</p>
      <Link
        href="/#proyectos"
        className="mt-6 inline-flex rounded-[var(--radius-control)] bg-brand px-5 py-3 font-semibold text-white hover:bg-brand-deep"
      >
        Ver todos los proyectos
      </Link>
    </div>
  );
}
