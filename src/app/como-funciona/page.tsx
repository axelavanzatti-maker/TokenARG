import type { Metadata } from "next";
import Link from "next/link";
import { IS_TESTNET } from "@/lib/chains";
import { activeDeployments } from "@/server/deployments";
import { shareMetadata } from "@/lib/site";

export const dynamic = "force-dynamic";

const DESCRIPTION =
  "Qué es un token, una blockchain y un contrato inteligente, qué comprás cuando invertís en TokenARG, de dónde sale la ganancia y cuáles son los riesgos. Explicado sin tecnicismos.";

export const metadata: Metadata = {
  title: "Cómo funciona",
  description: DESCRIPTION,
  ...shareMetadata("Cómo funciona", DESCRIPTION, "/como-funciona"),
};

const STEPS = [
  {
    title: "Conectá tu billetera",
    body: "Es tu cuenta en la blockchain, por ejemplo MetaMask. La controlás vos con una clave que nadie más conoce: TokenARG nunca la tiene.",
  },
  {
    title: "Verificá tu identidad",
    body: "Una sola vez, como en cualquier banco o bróker: lo exige la ley para prevenir el lavado de dinero. Tus datos quedan en TokenARG; en la blockchain solo se anota que tu billetera está verificada y hasta cuándo.",
  },
  {
    title: "Invertí en una ronda",
    body: "Elegís un proyecto y cuánto poner. Pagás en USDC, o en otra moneda que se convierte a USDC en el momento, y recibís tokens al precio fijo de la ronda. Si la ronda no llega al mínimo, recuperás todo lo que pusiste.",
  },
  {
    title: "Cobrá tus rentas",
    body: "Cuando el activo genera ingresos (alquileres, la venta de la cosecha, los intereses de un pagaré), el fiduciario los deposita y cada token cobra su parte en USDC, en proporción a lo que tenés.",
  },
  {
    title: "Vendé cuando quieras",
    body: "En el mercado secundario, a otro inversor verificado y al precio que acuerden. El contrato cambia tus tokens por USDC en la misma operación, sin nadie en el medio que guarde la plata.",
  },
];

const GLOSSARY = [
  {
    term: "Blockchain",
    body: "Un registro público que comparten miles de computadoras. Lo que se anota ahí queda a la vista de todos y nadie lo puede borrar ni cambiar por su cuenta: es como un libro contable que audita todo el mundo.",
  },
  {
    term: "Token",
    body: "Una unidad digital registrada en la blockchain. En TokenARG cada token es una cuotaparte del fideicomiso dueño del activo: si tenés el 1 % de los tokens, te corresponde el 1 % de las rentas.",
  },
  {
    term: "Contrato inteligente",
    english: "Smart contract",
    body: "Un programa publicado en la blockchain que cumple reglas fijas sin intermediarios: vende los tokens al precio de la ronda, devuelve la plata si no se llega al mínimo, reparte las rentas y liquida las operaciones del mercado. Su código es público y nadie lo puede cambiar a escondidas.",
  },
  {
    term: "Billetera",
    english: "Wallet",
    body: "Tu cuenta en la blockchain. Se maneja con una clave privada o una frase de 12 palabras: quien la tenga controla los fondos, así que nunca la compartas, ni siquiera con TokenARG.",
  },
  {
    term: "USDC",
    body: "Un dólar digital (stablecoin): cada USDC está respaldado por un dólar. Las inversiones y las rentas se pagan en USDC.",
  },
  {
    term: "Fideicomiso",
    body: "La figura legal que protege el activo: queda separado del patrimonio de quien lo desarrolla y lo administra un fiduciario con las reglas del contrato. Los tokens son cuotapartes de ese fideicomiso.",
  },
  {
    term: "Verificación de identidad",
    english: "KYC",
    body: "Los datos que pide la ley para saber quién invierte. Se cargan una vez y no se publican: el token solo puede pasar de una billetera verificada a otra.",
  },
  {
    term: "Red",
    body: "La blockchain en la que vive cada proyecto: Polygon, rápida y barata, o Ethereum, la más grande y probada. La ficha de cada proyecto te dice cuál usa.",
  },
  {
    term: "Gas",
    body: "Lo que cobra la red por procesar cada operación. Se paga en la moneda de la red (POL en Polygon, ETH en Ethereum) y en Polygon suele ser de centavos.",
  },
];

const RISKS = [
  "El activo puede perder valor o no generar las rentas que se estiman. La TIR de cada ficha es una estimación, no una promesa.",
  "Vender depende de que haya compradores: puede que no consigas el precio que querés cuando lo necesitás.",
  "Si perdés la clave de tu billetera, no podés operar. El fiduciario puede pasar tus tokens a una billetera nueva verificando tu identidad, si el contrato del fideicomiso lo prevé.",
  "Los contratos y las redes pueden tener fallas, y las reglas para estos activos todavía están cambiando.",
];

const FAQ = (fees: { buyer: number; seller: number }) => [
  {
    q: "¿Necesito saber de cripto?",
    a: "Lo justo: tener una billetera y un poco de la moneda de la red para pagar el gas. La app te guía en cada paso y te avisa qué te falta.",
  },
  {
    q: "¿Qué pasa si la ronda no llega al mínimo?",
    a: "El contrato habilita el reembolso y recuperás todo tu USDC. Nadie puede quedarse con fondos de una ronda que no se completó.",
  },
  {
    q: "¿Quién tiene el activo?",
    a: "El fideicomiso, administrado por el fiduciario. El contrato del fideicomiso está en la ficha de cada proyecto, y su huella digital (el hash) quedó registrada en la blockchain: si alguien lo cambiara, se notaría.",
  },
  {
    q: "¿Puedo mandar mis tokens a cualquier billetera?",
    a: "Solo a billeteras verificadas. El token lo controla en cada movimiento, así se cumplen las normas para inversores.",
  },
  {
    q: "¿Cuánto cuesta?",
    a:
      "Invertir en una ronda no tiene comisión de TokenARG: pagás el gas de la red y, si pagás con otra moneda, lo que cuesta cambiarla a USDC. " +
      `En el mercado secundario la comisión es de ${percent(fees.buyer)} para quien compra y ${percent(fees.seller)} para quien vende, y la ves antes de confirmar.`,
  },
  {
    q: "¿Puedo ver todo lo que pasa?",
    a: "Sí. Cada compra, renta y operación queda en la blockchain y tiene un enlace al explorador público de la red, para que lo puedas comprobar sin depender de nosotros.",
  },
];

const percent = (value: number) => `${value.toLocaleString("es-AR", { maximumFractionDigits: 2 })} %`;

async function marketFees() {
  try {
    const [deployment] = await activeDeployments();
    if (deployment) return { buyer: deployment.buyerFeeBps / 100, seller: deployment.sellerFeeBps / 100 };
  } catch {
    // Sin base o sin deploy: se muestran las comisiones con las que se despliega el mercado.
  }
  return { buyer: 0.5, seller: 0.5 };
}

export default async function HowItWorksPage() {
  const fees = await marketFees();

  return (
    <div className="mx-auto max-w-[1200px] px-4 pt-10 pb-8 sm:px-6 lg:px-8">
      <h1 className="display text-[2rem] text-ink sm:text-[2.5rem]">Cómo funciona</h1>
      <p className="mt-3 max-w-[64ch] text-lg leading-relaxed text-ink-muted">
        TokenARG te deja invertir en una parte de un activo real argentino: un departamento que se alquila, una campaña de
        soja o el financiamiento de una PyME. Acá te contamos, sin tecnicismos, qué comprás y cómo queda registrado.
      </p>

      {/* El camino del activo al inversor y de las rentas de vuelta. */}
      <section aria-labelledby="esquema-titulo" className="mt-10 rounded-[var(--radius-card)] border border-rule bg-card p-5 sm:p-8">
        <h2 id="esquema-titulo" className="heading text-xl text-ink">
          En una imagen
        </h2>
        <ol className="mt-6 grid gap-3 md:grid-cols-4">
          {[
            ["Activo real", "Un inmueble, una cosecha o un pagaré, con sus documentos y su tasación."],
            ["Fideicomiso", "Lo tiene a su nombre y lo administra un fiduciario, separado de quien lo desarrolla."],
            ["Tokens", "El fideicomiso se divide en cuotapartes, y cada una es un token en la blockchain."],
            ["Vos", "Comprás tokens desde pocos dólares, cobrás tu parte de las rentas y podés venderlos."],
          ].map(([title, body], i) => (
            <li key={title} className="relative rounded-[var(--radius-control)] border border-rule bg-paper p-4">
              <span className="figure text-sm text-brand">{i + 1}</span>
              <p className="heading mt-1 text-base text-ink">{title}</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-muted">{body}</p>
              {i < 3 && (
                <span aria-hidden className="absolute top-1/2 -right-2.5 hidden -translate-y-1/2 text-lg text-ink-faint md:block">
                  →
                </span>
              )}
            </li>
          ))}
        </ol>
        <p className="mt-4 text-sm text-ink-muted">
          <span aria-hidden className="mr-1.5 text-yield">↺</span>
          Las rentas hacen el camino inverso: el fiduciario las deposita en el contrato y cada token cobra su parte en USDC.
        </p>
      </section>

      <section aria-labelledby="pasos-titulo" className="mt-12">
        <h2 id="pasos-titulo" className="display text-[1.5rem] text-ink sm:text-[1.75rem]">
          Paso a paso
        </h2>
        <ol className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="rounded-[var(--radius-card)] border border-rule bg-card p-5">
              <p className="flex items-baseline gap-3">
                <span className="figure text-2xl text-brand">{i + 1}</span>
                <span className="heading text-lg text-ink">{step.title}</span>
              </p>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                {step.body}
                {i === 4 && ` La comisión es de ${percent(fees.buyer)} para quien compra y ${percent(fees.seller)} para quien vende.`}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="glosario-titulo" className="mt-12">
        <h2 id="glosario-titulo" className="display text-[1.5rem] text-ink sm:text-[1.75rem]">
          Las palabras que vas a ver
        </h2>
        <dl className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {GLOSSARY.map((item) => (
            <div key={item.term} className="rounded-[var(--radius-card)] border border-rule bg-card p-5">
              <dt className="heading text-lg text-ink">
                {item.term}
                {item.english && <span className="ml-2 text-sm font-normal text-ink-faint">({item.english})</span>}
              </dt>
              <dd className="mt-2 text-sm leading-relaxed text-ink-muted">{item.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="ganancia-titulo" className="rounded-[var(--radius-card)] border border-rule bg-card p-5 sm:p-6">
          <h2 id="ganancia-titulo" className="heading text-xl text-ink">
            ¿De dónde sale la ganancia?
          </h2>
          <ul className="mt-4 space-y-3 text-sm leading-relaxed text-ink-muted">
            <li>
              <strong className="font-semibold text-ink">Rentas.</strong> Los alquileres, la venta de la cosecha o los intereses
              del pagaré se reparten entre los tokens en USDC. Las cobrás desde tu cartera cuando quieras.
            </li>
            <li>
              <strong className="font-semibold text-ink">Valorización.</strong> Si el activo vale más, tus tokens también: podés
              venderlos más caros en el mercado secundario o esperar la liquidación final del fideicomiso.
            </li>
          </ul>
        </section>

        <section aria-labelledby="riesgos-titulo" className="rounded-[var(--radius-card)] border border-rule bg-card p-5 sm:p-6">
          <h2 id="riesgos-titulo" className="heading text-xl text-ink">
            Los riesgos, claros
          </h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-muted">
            {RISKS.map((risk) => (
              <li key={risk}>{risk}</li>
            ))}
          </ul>
          <p className="mt-4 text-sm font-medium text-ink">Invertí solo lo que puedas dejar quieto durante el plazo del proyecto.</p>
        </section>
      </div>

      <section aria-labelledby="preguntas-titulo" className="mt-12">
        <h2 id="preguntas-titulo" className="display text-[1.5rem] text-ink sm:text-[1.75rem]">
          Preguntas frecuentes
        </h2>
        <div className="mt-6 divide-y divide-rule overflow-hidden rounded-[var(--radius-card)] border border-rule bg-card">
          {FAQ(fees).map((item) => (
            <details key={item.q} className="group px-5 py-4">
              <summary className="heading flex cursor-pointer list-none items-center justify-between gap-4 text-base text-ink [&::-webkit-details-marker]:hidden">
                {item.q}
                <span aria-hidden className="text-ink-faint transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-2 max-w-[72ch] text-sm leading-relaxed text-ink-muted">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      {IS_TESTNET && (
        <p className="mt-8 max-w-[72ch] rounded-[var(--radius-card)] bg-caution-soft px-5 py-4 text-sm leading-relaxed text-caution">
          <strong className="font-semibold">Versión de demostración.</strong> Funciona en redes de prueba: los tokens, el USDC y
          las monedas no tienen valor real, así que podés probar todo sin arriesgar nada.
        </p>
      )}

      <div className="mt-10 flex flex-wrap gap-3">
        <Link
          href="/#proyectos"
          className="inline-flex items-center rounded-[var(--radius-control)] bg-brand px-5 py-3 text-base font-semibold text-white hover:bg-brand-deep"
        >
          Ver proyectos
        </Link>
        <Link
          href="/kyc"
          className="inline-flex items-center rounded-[var(--radius-control)] border border-rule-strong bg-card px-5 py-3 text-base font-semibold text-ink hover:border-ink/40"
        >
          Verificar mi identidad
        </Link>
      </div>
    </div>
  );
}
