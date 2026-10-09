import type { Metadata } from "next";
import Link from "next/link";
import { ProjectApplicationForm } from "@/components/project-application-form";
import { shareMetadata } from "@/lib/site";

const DESCRIPTION =
  "Tokenizá un inmueble, una campaña agrícola, el financiamiento de tu PyME o una parte de tu empresa. Postulá tu proyecto: lo evaluamos sin costo y te pasamos una propuesta cerrada.";

export const metadata: Metadata = {
  title: "Creá tu proyecto",
  description: DESCRIPTION,
  ...shareMetadata("Tokenizá tu proyecto en TokenARG", DESCRIPTION, "/crea-tu-proyecto"),
};

const WE_PROVIDE = [
  ["Los contratos inteligentes", "Ya están hechos y probados: no tenés que programar nada ni contratar desarrolladores."],
  ["Inversores verificados", "Cada inversor pasa la verificación de identidad antes de comprar, como en un bróker."],
  ["La ronda, con garantía", "Los fondos quedan en el contrato hasta el cierre. Si no se llega al mínimo, cada inversor recupera lo suyo."],
  ["Las rentas, automáticas", "Depositás los ingresos una vez y el contrato le paga a cada inversor su parte en USDC."],
  ["Mercado secundario", "Tus inversores pueden vender sus tokens a otros, así que invertir con vos no los ata hasta el final."],
  ["Transparencia", "Todo queda en la blockchain con enlaces públicos: cualquiera puede comprobar cuánto se juntó y qué se pagó."],
];

const YOU_BRING = [
  "El activo y sus papeles: escritura, planos y habilitaciones, contratos de la cosecha, o estados contables de la empresa.",
  "Una empresa o persona que se pueda verificar (CUIT, estatuto, autoridades).",
  "Una tasación o valuación independiente. Si no la tenés, te recomendamos con quién hacerla.",
  "Un plan claro: cuánto necesitás, para qué, y de dónde salen las rentas o la devolución.",
];

const PROCESS = [
  ["Postulación", "Completás el formulario de abajo. Te lleva cinco minutos."],
  ["Evaluación", "Revisamos el activo, los papeles y los números. No tiene costo."],
  ["Propuesta", "Si es viable, te mandamos una propuesta cerrada: estructura, plazos y todos los costos."],
  ["Estructuración", "Se arma el fideicomiso con un fiduciario, la tasación y los documentos para los inversores."],
  ["Publicación", "Publicamos la ficha y abrimos la ronda, con un mínimo para cerrar y un cupo máximo."],
  ["Después de la ronda", "Recibís los fondos, pagás las rentas desde el contrato y tus inversores operan en el mercado secundario."],
];

const FAQ = [
  ["¿Tengo que saber de blockchain o de cripto?", "No. Los contratos, la verificación de los inversores y la publicación los ponemos nosotros. Vos te ocupás del proyecto."],
  [
    "¿Cuánto cuesta?",
    "Depende del activo y de si ya está en un fideicomiso: lo que más pesa es la parte legal y la escribanía. La evaluación no tiene costo y, si el proyecto es viable, la propuesta trae el costo total antes de que decidas nada.",
  ],
  ["¿Qué pasa si la ronda no se completa?", "Si no se llega al mínimo, el contrato le devuelve a cada inversor lo que puso. Nadie se queda con fondos de una ronda que no cerró."],
  ["¿Puedo tokenizar solo una parte?", "Sí. Podés ofrecer una parte del activo o del financiamiento que necesitás, y el resto lo manejás como siempre."],
  ["¿Cuánto tarda?", "Sobre todo, lo que tarde la parte legal: armar el fideicomiso y los documentos. La propuesta te dice los plazos de tu caso."],
];

export default async function CreateProjectPage({ searchParams }: { searchParams: Promise<{ utm_source?: string }> }) {
  const { utm_source } = await searchParams;
  const source = /^[\w.\-]{1,60}$/.test(utm_source ?? "") ? utm_source : undefined;

  return (
    <div className="mx-auto max-w-[1200px] px-4 pt-10 pb-8 sm:px-6 lg:px-8">
      <h1 className="display text-[2rem] text-ink sm:text-[2.5rem]">Creá tu proyecto</h1>
      <p className="mt-3 max-w-[66ch] text-lg leading-relaxed text-ink-muted">
        Si tenés un inmueble, una campaña agrícola, una PyME que necesita financiamiento o una empresa que quiere sumar socios,
        te ayudamos a convertirlo en tokens que cualquier persona puede comprar desde pocos dólares.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <a
          href="#postulacion"
          className="inline-flex items-center rounded-[var(--radius-control)] bg-brand px-5 py-3 text-base font-semibold text-white hover:bg-brand-deep"
        >
          Postular mi proyecto
        </a>
        <Link
          href="/como-funciona"
          className="inline-flex items-center rounded-[var(--radius-control)] border border-rule-strong bg-card px-5 py-3 text-base font-semibold text-ink hover:border-ink/40"
        >
          Cómo funciona para los inversores
        </Link>
      </div>

      <section aria-labelledby="ponemos-titulo" className="mt-12">
        <h2 id="ponemos-titulo" className="display text-[1.5rem] text-ink sm:text-[1.75rem]">
          Lo que ponemos nosotros
        </h2>
        <ul className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {WE_PROVIDE.map(([title, body]) => (
            <li key={title} className="rounded-[var(--radius-card)] border border-rule bg-card p-5">
              <p className="heading text-lg text-ink">{title}</p>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{body}</p>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="necesitas-titulo" className="rounded-[var(--radius-card)] border border-rule bg-card p-5 sm:p-6">
          <h2 id="necesitas-titulo" className="heading text-xl text-ink">
            Lo que necesitás vos
          </h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-muted">
            {YOU_BRING.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-ink">
            ¿Te falta algo? Postulá igual: en la evaluación te decimos qué hace falta y cómo conseguirlo.
          </p>
        </section>

        <section aria-labelledby="proceso-titulo" className="rounded-[var(--radius-card)] border border-rule bg-card p-5 sm:p-6">
          <h2 id="proceso-titulo" className="heading text-xl text-ink">
            Cómo es el proceso
          </h2>
          <ol className="mt-4 space-y-3">
            {PROCESS.map(([title, body], i) => (
              <li key={title} className="flex gap-3">
                <span className="figure flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm text-brand-deep">
                  {i + 1}
                </span>
                <p className="text-sm leading-relaxed text-ink-muted">
                  <strong className="font-semibold text-ink">{title}.</strong> {body}
                </p>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <section aria-labelledby="postulacion-titulo" id="postulacion" className="mt-12 scroll-mt-24">
        <h2 id="postulacion-titulo" className="display text-[1.5rem] text-ink sm:text-[1.75rem]">
          Postulá tu proyecto
        </h2>
        <p className="mt-2 max-w-[64ch] text-sm leading-relaxed text-ink-muted">
          Con estos datos hacemos la evaluación inicial. No es un compromiso: si el proyecto es viable, te escribimos con una
          propuesta.
        </p>
        <div className="mt-6 max-w-[760px]">
          <ProjectApplicationForm source={source} />
        </div>
      </section>

      <section aria-labelledby="crea-preguntas-titulo" className="mt-12">
        <h2 id="crea-preguntas-titulo" className="display text-[1.5rem] text-ink sm:text-[1.75rem]">
          Preguntas frecuentes
        </h2>
        <div className="mt-6 divide-y divide-rule overflow-hidden rounded-[var(--radius-card)] border border-rule bg-card">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group px-5 py-4">
              <summary className="heading flex cursor-pointer list-none items-center justify-between gap-4 text-base text-ink [&::-webkit-details-marker]:hidden">
                {q}
                <span aria-hidden className="text-ink-faint transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-2 max-w-[72ch] text-sm leading-relaxed text-ink-muted">{a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
