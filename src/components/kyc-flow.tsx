"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, CircleAlert, Loader2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { useAccount } from "wagmi";
import { useMounted } from "@/hooks/useMounted";
import { SESSION_KEY, useSession, useSignIn, useSignOut, type ChainVerificationInfo, type KycStatus } from "@/hooks/useSession";
import { api } from "@/lib/api";
import { APP_CHAINS } from "@/lib/chains";
import { describeTxError } from "@/lib/contracts/errors";
import { formatCuit, isValidCuit, normalizeCuit } from "@/lib/cuit";
import { formatDate, shortAddress } from "@/lib/format";
import { ConnectButton } from "./connect-button";

type StepState = "done" | "current" | "pending";

interface StartResponse {
  status: KycStatus;
  redirectUrl: string | null;
  simulated: boolean;
}

/**
 * Onboarding KYC: billetera → firma SIWE → datos del legajo → validación del proveedor y
 * alta de la billetera en el IdentityRegistry de cada red (Polygon y Ethereum; la hace el
 * backend con su AGENT_ROLE). Una sola verificación sirve para las dos redes.
 */
export function KycFlow() {
  const { address, isConnected } = useAccount();
  const mounted = useMounted();
  const queryClient = useQueryClient();
  const session = useSession();
  const signIn = useSignIn();
  const signOut = useSignOut();

  const refreshAll = async () => {
    await queryClient.invalidateQueries({ queryKey: SESSION_KEY });
    // Las fichas abiertas en otras pestañas releen el KYC on-chain.
    await queryClient.invalidateQueries({ queryKey: ["investor"] });
  };

  const start = useMutation({
    mutationFn: (input: KycInput) => api<StartResponse>("/api/kyc/start", { body: input }),
    onSuccess: async (data) => {
      if (data.redirectUrl) window.location.assign(data.redirectUrl);
      else await refreshAll();
    },
  });
  const decide = useMutation({
    mutationFn: (decision: "approve" | "reject") => api("/api/kyc/mock/complete", { body: { decision } }),
    onSuccess: refreshAll,
  });
  const enable = useMutation({
    mutationFn: (chainId: number) => api("/api/kyc/sync-chains", { body: { chainId } }),
    onSettled: refreshAll,
  });

  if (!mounted || session.isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Cargando…
      </p>
    );
  }

  const data = session.data;
  const signedIn = session.matchesWallet;
  const kyc = signedIn ? data?.kyc : undefined;
  const status: KycStatus = kyc?.status ?? "NO_INICIADO";
  const chains: ChainVerificationInfo[] = signedIn ? (data?.onchain ?? []) : [];
  const verifiedChains = chains.filter((c) => c.verified);
  const identityActive = status === "APROBADO" && Boolean(kyc?.active);
  // Habilitada si la identidad está vigente y la billetera figura en al menos una red.
  const approved = identityActive && verifiedChains.length > 0;
  const needsData = status === "NO_INICIADO" || status === "RECHAZADO" || (status === "APROBADO" && !identityActive);

  const states: StepState[] = (() => {
    const done = [isConnected, signedIn, signedIn && !needsData, approved];
    const firstPending = done.findIndex((d) => !d);
    return done.map((d, i) => (d ? "done" : i === firstPending ? "current" : "pending"));
  })();

  return (
    <div className="space-y-8">
      {approved && (
        <div role="status" className="flex gap-3 rounded-[var(--radius-card)] border border-yield/25 bg-yield-soft p-5">
          <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-yield" aria-hidden />
          <div className="text-sm text-ink">
            <p className="heading text-lg text-yield">Tu billetera está habilitada para invertir</p>
            <p className="mt-1">
              {address ? shortAddress(address) : "Esta billetera"} puede comprar, vender y cobrar rentas en{" "}
              {verifiedChains.map((c) => c.name).join(" y ")} hasta el {kyc?.expiresAt ? formatDate(kyc.expiresAt) : "—"}.
            </p>
            <Link
              href="/#proyectos"
              className="mt-3 inline-flex rounded-[var(--radius-control)] bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-ink/90"
            >
              Ver proyectos
            </Link>
          </div>
        </div>
      )}

      <ol className="space-y-3">
        <Step index={1} state={states[0]!} title="Conectá tu billetera">
          {isConnected && address ? (
            <p className="text-sm text-ink-muted">
              Conectada: <span className="font-mono text-[0.8125rem] text-ink">{shortAddress(address, 6)}</span>
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-ink-muted">
                Usá una billetera compatible con {APP_CHAINS.map((c) => c.name).join(" y ")}, como MetaMask o Rabby. Es la
                billetera donde vas a recibir tus tokens y tus rentas, en las dos redes.
              </p>
              <div className="max-w-xs">
                <ConnectButton size="lg" />
              </div>
            </div>
          )}
        </Step>

        <Step index={2} state={states[1]!} title="Identificate con una firma">
          {signedIn ? (
            <p className="text-sm text-ink-muted">
              Firmaste con esta billetera.{" "}
              <button type="button" onClick={() => signOut.mutate()} className="text-brand underline underline-offset-2">
                Cerrar sesión
              </button>
            </p>
          ) : isConnected ? (
            <div className="space-y-3">
              <p className="max-w-[60ch] text-sm text-ink-muted">
                Firmás un mensaje para demostrar que la billetera es tuya. No es una transacción: no mueve fondos ni cuesta gas.
                {data?.session && !signedIn && (
                  <> Tenés una sesión abierta con otra billetera ({shortAddress(data.session.address)}): firmá de nuevo con la conectada.</>
                )}
              </p>
              <PrimaryButton pending={signIn.isPending} onClick={() => signIn.mutate()}>
                {signIn.isPending ? "Esperando la firma…" : "Firmar con mi billetera"}
              </PrimaryButton>
              {signIn.error && <ErrorText>{describeTxError(signIn.error)}</ErrorText>}
            </div>
          ) : null}
        </Step>

        <Step index={3} state={states[2]!} title="Completá tus datos">
          {signedIn && needsData ? (
            <div className="space-y-4">
              {status === "RECHAZADO" && (
                <p role="alert" className="rounded-[var(--radius-control)] bg-danger-soft px-3 py-2.5 text-sm text-danger">
                  La verificación anterior fue rechazada: {kyc?.rejectionReason ?? "sin detalle"}. Revisá tus datos y volvé a
                  enviarlos.
                </p>
              )}
              {status === "APROBADO" && !identityActive && (
                <p role="alert" className="rounded-[var(--radius-control)] bg-caution-soft px-3 py-2.5 text-sm text-caution">
                  Tu verificación venció. Enviá tus datos para actualizarla y volver a operar.
                </p>
              )}
              <KycForm
                defaults={{ fullName: kyc?.fullName ?? "", email: kyc?.email ?? "" }}
                pending={start.isPending}
                error={start.error ? start.error.message : null}
                onSubmit={(input) => start.mutate(input)}
              />
            </div>
          ) : signedIn && kyc?.fullName ? (
            <p className="text-sm text-ink-muted">
              {kyc.fullName}, {kyc.email}
            </p>
          ) : null}
        </Step>

        <Step index={4} state={states[3]!} title="Validación y alta en el registro">
          {signedIn && status === "PENDIENTE" ? (
            kyc?.simulatedProvider ? (
              <div className="space-y-3 rounded-[var(--radius-control)] border border-dashed border-rule-strong bg-paper p-4">
                <p className="text-sm font-semibold text-ink">Proveedor de verificación de prueba</p>
                <p className="max-w-[60ch] text-sm text-ink-muted">
                  En producción, en este paso validás tu DNI y una prueba de vida con el proveedor KYC. En este entorno simulás
                  su respuesta: al aprobar, el backend registra tu billetera en el contrato IdentityRegistry.
                </p>
                <div className="flex flex-wrap gap-2">
                  <PrimaryButton pending={decide.isPending && decide.variables === "approve"} onClick={() => decide.mutate("approve")}>
                    {decide.isPending && decide.variables === "approve" ? "Registrando tu billetera…" : "Simular aprobación"}
                  </PrimaryButton>
                  <button
                    type="button"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate("reject")}
                    className="rounded-[var(--radius-control)] border border-rule-strong bg-card px-4 py-2.5 text-sm font-semibold text-ink hover:border-ink/40 disabled:opacity-60"
                  >
                    Simular rechazo
                  </button>
                </div>
                {decide.error && <ErrorText>{decide.error.message}</ErrorText>}
              </div>
            ) : (
              <div className="space-y-2 text-sm text-ink-muted">
                <p>Estamos esperando el resultado del proveedor de verificación. Suele tardar unos minutos.</p>
                <button type="button" onClick={refreshAll} className="text-brand underline underline-offset-2">
                  Actualizar estado
                </button>
              </div>
            )
          ) : signedIn && identityActive ? (
            <ChainStatusList chains={chains} enable={enable} />
          ) : (
            <p className="text-sm text-ink-muted">
              El proveedor valida tu DNI y una prueba de vida. Al aprobarse, tu billetera queda habilitada en el registro de
              identidad de Polygon y de Ethereum.
            </p>
          )}
        </Step>
      </ol>

      <div className="max-w-[68ch] space-y-2 border-t border-rule pt-6 text-sm leading-relaxed text-ink-muted">
        <h2 className="font-semibold text-ink">Qué datos se guardan y dónde</h2>
        <p>
          Tu nombre, email y CUIT/CUIL quedan en tu legajo en TokenARG, protegidos según la Ley 25.326 de datos personales. Las
          imágenes de tu documento las conserva el proveedor de verificación. En la blockchain solo se publica que tu billetera
          está habilitada y hasta qué fecha: ningún dato personal.
        </p>
      </div>
    </div>
  );
}

/** Estado de la billetera en el registro de identidad de cada red, con la opción de habilitarla. */
function ChainStatusList({
  chains,
  enable,
}: {
  chains: ChainVerificationInfo[];
  enable: { mutate: (chainId: number) => void; isPending: boolean; variables?: number; error: Error | null };
}) {
  if (chains.length === 0) {
    return <p className="text-sm text-ink-muted">Validación aprobada. Todavía no hay redes con contratos de TokenARG en este entorno.</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-ink-muted">Validación aprobada. Estado de tu billetera en cada red:</p>
      <ul className="divide-y divide-rule rounded-[var(--radius-control)] border border-rule">
        {chains.map((c) => (
          <li key={c.chainId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
            <span className="flex items-center gap-2">
              {c.verified ? (
                <Check className="h-4 w-4 text-yield" aria-hidden />
              ) : (
                <CircleAlert className="h-4 w-4 text-caution" aria-hidden />
              )}
              <span className="font-medium text-ink">{c.name}</span>
              <span className="text-ink-muted">
                {c.verified
                  ? `habilitada hasta el ${c.expiresAt ? formatDate(c.expiresAt) : "—"}`
                  : c.reachable
                    ? "no habilitada"
                    : "no pudimos leer la red"}
              </span>
            </span>
            {!c.verified && c.reachable && (
              <button
                type="button"
                disabled={enable.isPending}
                onClick={() => enable.mutate(c.chainId)}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-rule-strong bg-card px-3 py-1.5 text-xs font-semibold text-ink hover:border-ink/40 disabled:opacity-60"
              >
                {enable.isPending && enable.variables === c.chainId && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                Habilitar en {c.name}
              </button>
            )}
          </li>
        ))}
      </ul>
      {enable.error && <ErrorText>{enable.error.message}</ErrorText>}
    </div>
  );
}

interface KycInput {
  fullName: string;
  email: string;
  taxId: string;
  isPep: boolean;
  acceptTerms: true;
}

function KycForm({
  defaults,
  pending,
  error,
  onSubmit,
}: {
  defaults: { fullName: string; email: string };
  pending: boolean;
  error: string | null;
  onSubmit: (input: KycInput) => void;
}) {
  const [fullName, setFullName] = useState(defaults.fullName);
  const [email, setEmail] = useState(defaults.email);
  const [taxId, setTaxId] = useState("");
  const [isPep, setIsPep] = useState(false);
  const [accept, setAccept] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const errors = {
    fullName: fullName.trim().length < 5 ? "Ingresá tu nombre y apellido completos." : null,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()) ? null : "Ingresá un email válido.",
    taxId: isValidCuit(taxId) ? null : "Revisá el CUIT/CUIL: son 11 dígitos y el último es verificador.",
    accept: accept ? null : "Necesitamos tu conformidad para validar tu identidad.",
  };
  const valid = Object.values(errors).every((e) => e === null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (!valid || pending) return;
    onSubmit({ fullName: fullName.trim(), email: email.trim(), taxId: normalizeCuit(taxId), isPep, acceptTerms: true });
  }

  const field =
    "mt-1.5 w-full rounded-[var(--radius-control)] border border-rule-strong bg-card px-3 py-2.5 text-base text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

  return (
    <form onSubmit={handleSubmit} noValidate className="grid max-w-[560px] gap-4">
      <div>
        <label htmlFor="kyc-nombre" className="text-sm font-semibold text-ink">
          Nombre y apellido, como figuran en tu DNI
        </label>
        <input
          id="kyc-nombre"
          autoComplete="name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          aria-invalid={submitted && Boolean(errors.fullName)}
          aria-describedby="kyc-nombre-error"
          className={field}
        />
        {submitted && errors.fullName && <FieldError id="kyc-nombre-error">{errors.fullName}</FieldError>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="kyc-email" className="text-sm font-semibold text-ink">
            Email
          </label>
          <input
            id="kyc-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={submitted && Boolean(errors.email)}
            aria-describedby="kyc-email-error"
            className={field}
          />
          {submitted && errors.email && <FieldError id="kyc-email-error">{errors.email}</FieldError>}
        </div>
        <div>
          <label htmlFor="kyc-cuit" className="text-sm font-semibold text-ink">
            CUIT o CUIL
          </label>
          <input
            id="kyc-cuit"
            inputMode="numeric"
            autoComplete="off"
            placeholder="20-12345678-6"
            value={taxId}
            onChange={(e) => {
              const digits = normalizeCuit(e.target.value).slice(0, 11);
              setTaxId(digits.length === 11 ? formatCuit(digits) : digits);
            }}
            aria-invalid={submitted && Boolean(errors.taxId)}
            aria-describedby="kyc-cuit-error"
            className={`${field} tabular`}
          />
          {submitted && errors.taxId && <FieldError id="kyc-cuit-error">{errors.taxId}</FieldError>}
        </div>
      </div>
      <label className="flex items-start gap-2.5 text-sm text-ink">
        <input type="checkbox" checked={isPep} onChange={(e) => setIsPep(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--color-brand)]" />
        <span>
          Soy persona expuesta políticamente (PEP), o familiar o allegado de una.
          <span className="block text-ink-muted">Incluye funcionarios públicos actuales o de los últimos dos años. Declararlo no te impide invertir.</span>
        </span>
      </label>
      <div>
        <label className="flex items-start gap-2.5 text-sm text-ink">
          <input
            type="checkbox"
            checked={accept}
            onChange={(e) => setAccept(e.target.checked)}
            aria-describedby="kyc-acepto-error"
            className="mt-1 h-4 w-4 accent-[var(--color-brand)]"
          />
          <span>Declaro que los datos son correctos y autorizo a TokenARG a usarlos para verificar mi identidad.</span>
        </label>
        {submitted && errors.accept && <FieldError id="kyc-acepto-error">{errors.accept}</FieldError>}
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      <div>
        <PrimaryButton pending={pending} type="submit">
          {pending ? "Enviando…" : "Enviar y validar mi identidad"}
        </PrimaryButton>
      </div>
    </form>
  );
}

function Step({ index, state, title, children }: { index: number; state: StepState; title: string; children: ReactNode }) {
  return (
    <li
      className={`rounded-[var(--radius-card)] border bg-card px-5 py-4 ${state === "current" ? "border-brand/50 shadow-[0_0_0_3px_var(--color-brand-soft)]" : "border-rule"}`}
      aria-current={state === "current" ? "step" : undefined}
    >
      <div className="flex items-center gap-3">
        <span
          className={`figure flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm ${
            state === "done" ? "bg-yield text-white" : state === "current" ? "bg-brand text-white" : "bg-paper text-ink-faint ring-1 ring-rule"
          }`}
          aria-hidden
        >
          {state === "done" ? <Check className="h-4 w-4" /> : index}
        </span>
        <h2 className={`heading text-base ${state === "pending" ? "text-ink-faint" : "text-ink"}`}>
          {title}
          {state === "done" && <span className="sr-only"> (completo)</span>}
        </h2>
      </div>
      {state !== "pending" && children && <div className="mt-3 pl-10">{children}</div>}
    </li>
  );
}

function PrimaryButton({
  children,
  pending,
  onClick,
  type = "button",
}: {
  children: ReactNode;
  pending: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-deep disabled:opacity-70"
    >
      {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1 text-sm text-danger">
      {children}
    </p>
  );
}

function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-sm text-danger">
      {children}
    </p>
  );
}
