import Link from "next/link";

const STEPS = [
  {
    title: "Verificá tu identidad",
    body: "Conectá tu billetera y completá la validación (KYC). Tus datos quedan en tu legajo; en la blockchain solo se registra que la billetera está habilitada.",
  },
  {
    title: "Elegí un proyecto",
    body: "Cada ficha incluye el contrato de fideicomiso, la tasación y los riesgos. El hash del contrato queda registrado en el token, así podés comprobar que nadie lo cambió.",
  },
  {
    title: "Invertí con la moneda que tengas",
    body: "USDC directo, o USDT, ETH, POL o WBTC, que se convierten a USDC en la misma transacción. Los fondos quedan en garantía hasta el cierre: si no se alcanza el mínimo, recuperás el 100 %.",
  },
  {
    title: "Cobrá o vendé cuando quieras",
    body: "Rentas, intereses y la liquidación final se reparten en USDC a prorrata de tus tokens. Si querés salir antes, vendés tus tokens a otros inversores en el mercado secundario.",
  },
];

/** Los cuatro pasos de una inversión. Es una secuencia real, por eso van numerados. */
export function HowItWorks() {
  return (
    <section aria-labelledby="como-funciona" className="mx-auto mt-20 max-w-[1200px] px-4 sm:px-6 lg:px-8">
      <h2 id="como-funciona" className="display text-[1.75rem] text-ink sm:text-[2rem]">
        Cómo funciona
      </h2>
      <ol className="mt-8 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, index) => (
          <li key={step.title} className="relative">
            <span
              className="figure flex h-10 w-10 items-center justify-center rounded-full border border-brand/30 bg-brand-soft text-lg text-brand-deep"
              aria-hidden
            >
              {index + 1}
            </span>
            <h3 className="heading mt-4 text-lg text-ink">{step.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">{step.body}</p>
          </li>
        ))}
      </ol>
      <p className="mt-8 text-sm text-ink-muted">
        ¿Qué es un token, una blockchain o un contrato inteligente?{" "}
        <Link href="/como-funciona" className="font-semibold text-brand underline underline-offset-2 hover:text-brand-deep">
          Te lo explicamos sin tecnicismos
        </Link>
        .
      </p>
    </section>
  );
}
