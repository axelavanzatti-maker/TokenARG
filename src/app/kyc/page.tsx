import type { Metadata } from "next";
import { KycFlow } from "@/components/kyc-flow";

export const metadata: Metadata = {
  title: "Verificación de identidad",
  description: "Habilitá tu billetera para invertir en TokenARG.",
};

export default function KycPage() {
  return (
    <div className="mx-auto max-w-[760px] px-4 py-10 sm:px-6">
      <h1 className="display text-[2rem] text-ink sm:text-[2.4rem]">Verificación de identidad</h1>
      <p className="mt-3 max-w-[62ch] text-lg leading-relaxed text-ink-muted">
        Para invertir, tu billetera tiene que estar verificada. Es un requisito de prevención de lavado de activos y lo controla
        el propio contrato de cada proyecto: una billetera sin verificación no puede comprar ni recibir tokens.
      </p>
      <div className="mt-8">
        <KycFlow />
      </div>
    </div>
  );
}
