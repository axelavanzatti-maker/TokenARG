import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { formatDate, shortAddress } from "@/lib/format";

/**
 * Aviso para una billetera conectada que no tiene KYC vigente en IdentityRegistry.
 * No es solo un aviso de interfaz: el contrato rechaza la compra igual.
 */
export function KycAlert({
  address,
  expiresAt,
  context = "invest",
}: {
  address: string;
  expiresAt: Date | null;
  context?: "invest" | "upcoming" | "claim";
}) {
  // Este aviso solo se muestra si isVerified() dio false. Si además el registro tiene una fecha
  // (verificationExpiry > 0), la única explicación es que venció: una baja borra la fecha.
  const expired = expiresAt !== null;
  const title = expired ? "Tu verificación de identidad venció" : "Billetera no verificada en TokenARG";
  const body = expired
    ? `Venció el ${formatDate(expiresAt)}. Actualizá tus datos para volver a operar con esta billetera.`
    : context === "upcoming"
      ? `Para invertir cuando abra la ronda, la billetera ${shortAddress(address)} tiene que completar la verificación de identidad (KYC). Hacelo ahora y llegás a tiempo.`
      : context === "claim"
        ? `Para cobrar rentas, la billetera ${shortAddress(address)} necesita una verificación de identidad vigente.`
        : `La billetera ${shortAddress(address)} todavía no completó la verificación de identidad (KYC). El contrato del proyecto solo acepta inversiones de billeteras verificadas.`;

  return (
    <div role="alert" className="rounded-[var(--radius-control)] border border-caution/30 bg-caution-soft p-4">
      <div className="flex gap-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-caution" aria-hidden />
        <div className="text-sm">
          <p className="font-semibold text-caution">{title}</p>
          <p className="mt-1 text-ink">{body}</p>
          <Link
            href="/kyc"
            className="mt-3 inline-flex items-center rounded-[var(--radius-control)] bg-ink px-3.5 py-2 text-sm font-semibold text-white hover:bg-ink/90"
          >
            {expired ? "Actualizar verificación" : "Verificar mi identidad"}
          </Link>
        </div>
      </div>
    </div>
  );
}
