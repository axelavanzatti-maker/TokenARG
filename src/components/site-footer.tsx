import Link from "next/link";
import { BrandLogo } from "./brand-mark";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-rule bg-card">
      <div className="mx-auto grid max-w-[1200px] gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1fr_2fr] lg:px-8">
        <div>
          <BrandLogo size="sm" />
          <ul className="mt-5 space-y-2 text-sm">
            <li>
              <Link href="/" className="text-ink-muted hover:text-ink">
                Proyectos
              </Link>
            </li>
            <li>
              <Link href="/mercado" className="text-ink-muted hover:text-ink">
                Mercado secundario
              </Link>
            </li>
            <li>
              <Link href="/portfolio" className="text-ink-muted hover:text-ink">
                Mi cartera
              </Link>
            </li>
            <li>
              <Link href="/kyc" className="text-ink-muted hover:text-ink">
                Verificación de identidad
              </Link>
            </li>
          </ul>
        </div>
        <div className="max-w-[68ch] space-y-3 text-sm leading-relaxed text-ink-muted">
          <p>
            <strong className="font-semibold text-ink">Versión de demostración.</strong> Los proyectos, documentos y montos
            publicados son ejemplos ficticios y no constituyen una oferta pública de valores negociables.
          </p>
          <p>
            Invertir en activos reales tokenizados implica riesgos, incluida la pérdida total del capital. Los rendimientos
            estimados no están garantizados. Antes de invertir, leé el contrato de fideicomiso y los riesgos de cada
            proyecto.
          </p>
          <p>
            Cada token representa una cuotaparte de un fideicomiso. Las tenencias, los aportes en garantía, las
            distribuciones y las operaciones del mercado secundario se registran en Polygon o en Ethereum, según el
            proyecto, y se pueden auditar públicamente.
          </p>
        </div>
      </div>
    </footer>
  );
}
