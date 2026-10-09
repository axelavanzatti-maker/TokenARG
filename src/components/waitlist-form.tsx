"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useMounted } from "@/hooks/useMounted";
import { api } from "@/lib/api";
import { FieldError, Honeypot, Label, SubmitButton, fieldClass } from "./form-parts";
import { ShareButtons } from "./share-buttons";

interface WaitlistStatus {
  code: string;
  position: number;
  total: number;
  referrals: number;
}

const STORAGE_KEY = "tokenarg_lista_codigo";

function savedCode() {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveCode(code: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Sin almacenamiento (modo privado): se muestra el lugar igual, solo no se recuerda.
  }
}

/** Inscripción a la lista de espera y, después, el lugar y el enlace para invitar. */
export function WaitlistForm({ referralCode, source, placesPerReferral }: { referralCode?: string; source?: string; placesPerReferral: number }) {
  const mounted = useMounted();
  const [code, setCode] = useState<string | null>(null);
  const known = code ?? (mounted ? savedCode() : null);

  const status = useQuery({
    queryKey: ["lista", known],
    queryFn: () => api<WaitlistStatus>(`/api/waitlist/${known}`),
    enabled: Boolean(known),
    retry: false,
  });

  const join = useMutation({
    mutationFn: (body: object) => api<WaitlistStatus>("/api/waitlist", { body }),
    onSuccess: (data) => {
      saveCode(data.code);
      setCode(data.code);
    },
  });

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [accept, setAccept] = useState(false);
  const [trap, setTrap] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const emailError = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? undefined : "Ingresá un email válido";
  const acceptError = accept ? undefined : "Tenés que aceptar que te escribamos para avisarte";

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (emailError || acceptError || join.isPending) return;
    join.mutate({ email: email.trim(), name: name.trim(), ref: referralCode ?? "", source, acceptTerms: true, empresaWeb: trap });
  }

  const current = status.data ?? join.data;
  if (current) {
    const link = `/lista-de-espera?ref=${current.code}`;
    return (
      <div className="rounded-[var(--radius-card)] border border-yield/30 bg-yield-soft p-5 sm:p-6">
        <p className="heading text-xl text-ink">Ya estás en la lista</p>
        <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-[var(--radius-control)] bg-card px-2 py-3">
            <dt className="text-xs text-ink-muted">Tu lugar</dt>
            <dd className="figure mt-1 text-2xl text-ink">{current.position.toLocaleString("es-AR")}</dd>
          </div>
          <div className="rounded-[var(--radius-control)] bg-card px-2 py-3">
            <dt className="text-xs text-ink-muted">Inscriptos</dt>
            <dd className="figure mt-1 text-2xl text-ink">{current.total.toLocaleString("es-AR")}</dd>
          </div>
          <div className="rounded-[var(--radius-control)] bg-card px-2 py-3">
            <dt className="text-xs text-ink-muted">Invitaste</dt>
            <dd className="figure mt-1 text-2xl text-ink">{current.referrals.toLocaleString("es-AR")}</dd>
          </div>
        </dl>
        <p className="mt-4 text-sm leading-relaxed text-ink">
          Cada persona que se sume con tu enlace te adelanta <strong>{placesPerReferral} lugares</strong>. Abrimos el acceso en el
          orden de la lista.
        </p>
        <div className="mt-4 rounded-[var(--radius-control)] bg-card px-3 py-2.5 font-mono text-sm break-all text-ink">
          {mounted ? `${window.location.origin}${link}` : link}
        </div>
        <div className="mt-4">
          <ShareButtons
            url={link}
            text="Me sumé a TokenARG: invertir en inmuebles, campos y PyMEs argentinas desde pocos dólares. Sumate con mi enlace:"
            label="Invitá a tus amigos"
          />
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="relative grid gap-4 rounded-[var(--radius-card)] border border-rule bg-card p-5 sm:p-6">
      {referralCode && (
        <p className="rounded-[var(--radius-control)] bg-brand-soft px-3 py-2 text-sm text-brand-deep">
          Te invitaron: si te sumás con este enlace, la persona que te invitó sube en la lista.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="lista-email">Email</Label>
          <input
            id="lista-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={submitted && Boolean(emailError)}
            aria-describedby="lista-email-error"
            className={fieldClass}
          />
          <FieldError id="lista-email-error">{submitted && emailError}</FieldError>
        </div>
        <div>
          <Label htmlFor="lista-nombre" optional>
            Nombre
          </Label>
          <input id="lista-nombre" autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} />
        </div>
      </div>
      <div>
        <label className="flex items-start gap-2.5 text-sm text-ink">
          <input
            type="checkbox"
            checked={accept}
            onChange={(e) => setAccept(e.target.checked)}
            aria-describedby="lista-acepto-error"
            className="mt-1 h-4 w-4 accent-[var(--color-brand)]"
          />
          <span>Acepto que TokenARG me escriba para avisarme del lanzamiento. Me puedo dar de baja cuando quiera.</span>
        </label>
        <FieldError id="lista-acepto-error">{submitted && acceptError}</FieldError>
      </div>
      <Honeypot value={trap} onChange={setTrap} />
      {join.error && (
        <p role="alert" className="text-sm text-danger">
          {join.error.message}
        </p>
      )}
      <div>
        <SubmitButton pending={join.isPending}>{join.isPending ? "Sumándote…" : "Sumarme a la lista"}</SubmitButton>
      </div>
    </form>
  );
}
