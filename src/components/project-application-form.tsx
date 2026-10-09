"use client";

import { useMutation } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { CATEGORIES as CATEGORY_INFO } from "@/lib/categories";
import { FieldError, Honeypot, Label, SubmitButton, fieldClass } from "./form-parts";

const CATEGORIES = ["INMUEBLES", "AGRO", "DEUDA_PYME", "EMPRESAS"] as const;
type Category = (typeof CATEGORIES)[number];

const EXAMPLES: Record<Category, string> = {
  INMUEBLES: "Por ejemplo: edificio de 24 departamentos en Rosario, terminado en 2025, con 80 % alquilado.",
  AGRO: "Por ejemplo: campaña de soja 2026/27 en 1.200 hectáreas propias en el sur de Córdoba.",
  DEUDA_PYME: "Por ejemplo: pagarés a 180 días de una distribuidora de alimentos con 12 años de historia.",
  EMPRESAS: "Por ejemplo: el 10 % de una cervecería con tres locales que quiere abrir una planta nueva.",
};

/** Postulación de un emisor: los datos para evaluar la factibilidad antes de cotizar. */
export function ProjectApplicationForm({ source }: { source?: string }) {
  const [form, setForm] = useState({
    companyName: "",
    contactName: "",
    email: "",
    phone: "",
    category: "INMUEBLES" as Category,
    location: "",
    amount: "",
    description: "",
    hasTrust: false,
    website: "",
    accept: false,
  });
  const [trap, setTrap] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const amountUSD = Number(form.amount.replace(/\./g, "").replace(",", "."));
  const errors: Partial<Record<keyof typeof form, string>> = {
    companyName: form.companyName.trim().length >= 2 ? undefined : "Contanos el nombre de la empresa o del proyecto",
    contactName: form.contactName.trim().length >= 2 ? undefined : "Falta tu nombre",
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) ? undefined : "Ingresá un email válido",
    location: form.location.trim().length >= 2 ? undefined : "Decinos dónde está el activo",
    amount: Number.isFinite(amountUSD) && amountUSD > 0 ? undefined : "Ingresá cuánto querés recaudar, en dólares",
    description: form.description.trim().length >= 30 ? undefined : "Contanos un poco más: 30 caracteres como mínimo",
    website: !form.website.trim() || /^https?:\/\/\S+\.\S+/.test(form.website.trim()) ? undefined : "Escribila completa, con https://",
    accept: form.accept ? undefined : "Tenés que aceptar que te contactemos",
  };
  const invalid = Object.values(errors).some(Boolean);

  const send = useMutation({ mutationFn: (body: object) => api("/api/applications", { body }) });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (invalid || send.isPending) return;
    send.mutate({
      companyName: form.companyName.trim(),
      contactName: form.contactName.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      category: form.category,
      location: form.location.trim(),
      amountUSD,
      description: form.description.trim(),
      hasTrust: form.hasTrust,
      website: form.website.trim(),
      source,
      acceptTerms: true,
      empresaWeb: trap,
    });
  }

  if (send.isSuccess) {
    return (
      <div role="status" className="rounded-[var(--radius-card)] border border-yield/30 bg-yield-soft p-6">
        <p className="heading flex items-center gap-2 text-xl text-ink">
          <CheckCircle2 className="h-5 w-5 text-yield" aria-hidden /> Recibimos tu proyecto
        </p>
        <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-ink">
          Lo revisamos y te escribimos a <strong>{form.email.trim()}</strong> en los próximos días hábiles. Si es viable, te
          mandamos una propuesta con los pasos, los plazos y el costo.
        </p>
      </div>
    );
  }

  const show = (key: keyof typeof form) => (submitted ? errors[key] : undefined);

  return (
    <form onSubmit={onSubmit} noValidate className="relative grid gap-4 rounded-[var(--radius-card)] border border-rule bg-card p-5 sm:p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="pp-empresa">Empresa o proyecto</Label>
          <input id="pp-empresa" autoComplete="organization" value={form.companyName} onChange={(e) => set("companyName", e.target.value)} aria-invalid={Boolean(show("companyName"))} aria-describedby="pp-empresa-error" className={fieldClass} />
          <FieldError id="pp-empresa-error">{show("companyName")}</FieldError>
        </div>
        <div>
          <Label htmlFor="pp-nombre">Tu nombre</Label>
          <input id="pp-nombre" autoComplete="name" value={form.contactName} onChange={(e) => set("contactName", e.target.value)} aria-invalid={Boolean(show("contactName"))} aria-describedby="pp-nombre-error" className={fieldClass} />
          <FieldError id="pp-nombre-error">{show("contactName")}</FieldError>
        </div>
        <div>
          <Label htmlFor="pp-email">Email</Label>
          <input id="pp-email" type="email" autoComplete="email" value={form.email} onChange={(e) => set("email", e.target.value)} aria-invalid={Boolean(show("email"))} aria-describedby="pp-email-error" className={fieldClass} />
          <FieldError id="pp-email-error">{show("email")}</FieldError>
        </div>
        <div>
          <Label htmlFor="pp-telefono" optional>
            Teléfono o WhatsApp
          </Label>
          <input id="pp-telefono" type="tel" autoComplete="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} className={fieldClass} />
        </div>
      </div>

      <fieldset>
        <legend className="text-sm font-semibold text-ink">¿Qué querés tokenizar?</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {CATEGORIES.map((c) => (
            <label
              key={c}
              className={`flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-control)] border px-3 py-2.5 text-sm ${form.category === c ? "border-brand bg-brand-soft text-ink" : "border-rule-strong bg-card text-ink"}`}
            >
              <input type="radio" name="pp-categoria" value={c} checked={form.category === c} onChange={() => set("category", c)} className="h-4 w-4 accent-[var(--color-brand)]" />
              {CATEGORY_INFO[c].label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="pp-ubicacion">¿Dónde está?</Label>
          <input id="pp-ubicacion" placeholder="Ciudad y provincia" value={form.location} onChange={(e) => set("location", e.target.value)} aria-invalid={Boolean(show("location"))} aria-describedby="pp-ubicacion-error" className={fieldClass} />
          <FieldError id="pp-ubicacion-error">{show("location")}</FieldError>
        </div>
        <div>
          <Label htmlFor="pp-monto">¿Cuánto querés recaudar? (USD)</Label>
          <input id="pp-monto" inputMode="numeric" placeholder="300.000" value={form.amount} onChange={(e) => set("amount", e.target.value.replace(/[^\d.,]/g, ""))} aria-invalid={Boolean(show("amount"))} aria-describedby="pp-monto-error" className={`${fieldClass} tabular`} />
          <FieldError id="pp-monto-error">{show("amount")}</FieldError>
        </div>
      </div>

      <div>
        <Label htmlFor="pp-descripcion">Contanos el proyecto</Label>
        <textarea
          id="pp-descripcion"
          rows={5}
          placeholder={EXAMPLES[form.category]}
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          aria-invalid={Boolean(show("description"))}
          aria-describedby="pp-descripcion-error"
          className={fieldClass}
        />
        <FieldError id="pp-descripcion-error">{show("description")}</FieldError>
      </div>

      <div>
        <Label htmlFor="pp-web" optional>
          Web o redes
        </Label>
        <input id="pp-web" type="url" placeholder="https://" value={form.website} onChange={(e) => set("website", e.target.value)} aria-invalid={Boolean(show("website"))} aria-describedby="pp-web-error" className={fieldClass} />
        <FieldError id="pp-web-error">{show("website")}</FieldError>
      </div>

      <label className="flex items-start gap-2.5 text-sm text-ink">
        <input type="checkbox" checked={form.hasTrust} onChange={(e) => set("hasTrust", e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--color-brand)]" />
        <span>
          El activo ya está en un fideicomiso.
          <span className="block text-ink-muted">Si no, no pasa nada: te ayudamos a armarlo con un fiduciario.</span>
        </span>
      </label>

      <div>
        <label className="flex items-start gap-2.5 text-sm text-ink">
          <input type="checkbox" checked={form.accept} onChange={(e) => set("accept", e.target.checked)} aria-describedby="pp-acepto-error" className="mt-1 h-4 w-4 accent-[var(--color-brand)]" />
          <span>Acepto que TokenARG use estos datos para evaluar el proyecto y contactarme.</span>
        </label>
        <FieldError id="pp-acepto-error">{show("accept")}</FieldError>
      </div>

      <Honeypot value={trap} onChange={setTrap} />
      {send.error && (
        <p role="alert" className="text-sm text-danger">
          {send.error.message}
        </p>
      )}
      <div>
        <SubmitButton pending={send.isPending}>{send.isPending ? "Enviando…" : "Enviar para evaluar"}</SubmitButton>
      </div>
    </form>
  );
}
