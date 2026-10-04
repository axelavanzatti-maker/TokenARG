"use client";

import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-[640px] px-4 py-24 text-center sm:px-6">
      <h1 className="display text-[2rem] text-ink">No pudimos cargar esta página</h1>
      <p className="mt-3 text-ink-muted">
        Falló la conexión con la base de datos o con la red. Probá de nuevo en unos segundos.
        {process.env.NODE_ENV !== "production" && (
          <span className="mt-2 block font-mono text-xs text-danger">{error.message}</span>
        )}
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 inline-flex rounded-[var(--radius-control)] bg-brand px-5 py-3 font-semibold text-white hover:bg-brand-deep"
      >
        Reintentar
      </button>
    </div>
  );
}
