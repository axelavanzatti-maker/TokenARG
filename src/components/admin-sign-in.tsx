"use client";

import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { useSignIn } from "@/hooks/useSession";
import { useMounted } from "@/hooks/useMounted";
import { ConnectButton } from "./connect-button";

/** Ingreso al panel: conectar la billetera administradora y firmar (sin costo ni transacción). */
export function AdminSignIn({ signedInAs, configured }: { signedInAs: string | null; configured: boolean }) {
  const router = useRouter();
  const mounted = useMounted();
  const { isConnected } = useAccount();
  const signIn = useSignIn();

  return (
    <div className="max-w-[560px] rounded-[var(--radius-card)] border border-rule bg-card p-6">
      <h1 className="heading text-xl text-ink">Panel de administración</h1>
      {!configured ? (
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          Todavía no hay billeteras administradoras: cargalas en la variable <code className="font-mono text-xs">ADMIN_WALLETS</code>{" "}
          del proyecto en Vercel (o corré el workflow &quot;Publicar en Vercel&quot;, que la carga con la billetera del deploy).
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            {signedInAs
              ? `La billetera con la que entraste (${signedInAs}) no es administradora. Cambiá a la del deploy en tu billetera y volvé a firmar.`
              : "Conectá la billetera administradora y firmá para entrar. La firma no mueve fondos ni tiene costo."}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <ConnectButton />
            {mounted && isConnected && (
              <button
                type="button"
                disabled={signIn.isPending}
                onClick={() => signIn.mutate(undefined, { onSuccess: () => router.refresh() })}
                className="inline-flex items-center rounded-[var(--radius-control)] bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-deep disabled:opacity-70"
              >
                {signIn.isPending ? "Esperando la firma…" : "Firmar para entrar"}
              </button>
            )}
          </div>
          {signIn.error && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {signIn.error.message}
            </p>
          )}
        </>
      )}
    </div>
  );
}
