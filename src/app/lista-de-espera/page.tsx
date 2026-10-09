import type { Metadata } from "next";
import Link from "next/link";
import { WaitlistForm } from "@/components/waitlist-form";
import { prisma } from "@/server/db";
import { PLACES_PER_REFERRAL, codeSchema } from "@/server/growth";
import { shareMetadata } from "@/lib/site";

export const dynamic = "force-dynamic";

const DESCRIPTION =
  "Sumate a la lista de espera de TokenARG: te avisamos primero cuando abramos con dinero real, y cada amigo que se sume con tu enlace te adelanta lugares.";

export const metadata: Metadata = {
  title: "Lista de espera",
  description: DESCRIPTION,
  ...shareMetadata("Sumate a la lista de espera de TokenARG", DESCRIPTION, "/lista-de-espera"),
};

const BENEFITS = [
  ["Acceso antes que nadie", "Abrimos el lanzamiento con dinero real en el orden de la lista."],
  ["Cada proyecto nuevo, primero a vos", "Te avisamos cuando se publique una ronda, antes de difundirla."],
  ["Subí invitando", `Cada persona que se sume con tu enlace te adelanta ${PLACES_PER_REFERRAL} lugares.`],
];

export default async function WaitlistPage({ searchParams }: { searchParams: Promise<{ ref?: string; utm_source?: string }> }) {
  const { ref, utm_source } = await searchParams;
  // Solo se muestra la invitación si el código existe de verdad.
  const candidate = codeSchema.safeParse(ref ?? "").data;
  const referralCode = candidate && (await prisma.waitlistEntry.findUnique({ where: { code: candidate }, select: { id: true } })) ? candidate : undefined;
  const source = /^[\w.\-]{1,60}$/.test(utm_source ?? "") ? utm_source : undefined;

  return (
    <div className="mx-auto max-w-[1200px] px-4 pt-10 pb-8 sm:px-6 lg:px-8">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
        <div>
          <h1 className="display text-[2rem] text-ink sm:text-[2.5rem]">Sumate a la lista de espera</h1>
          <p className="mt-3 max-w-[56ch] text-lg leading-relaxed text-ink-muted">
            Hoy TokenARG funciona en redes de prueba: podés probar todo con dinero de mentira. Cuando abramos con dinero real, la
            lista se entera primero.
          </p>
          <ul className="mt-8 space-y-4">
            {BENEFITS.map(([title, body]) => (
              <li key={title} className="rounded-[var(--radius-card)] border border-rule bg-card p-4">
                <p className="heading text-base text-ink">{title}</p>
                <p className="mt-1 text-sm leading-relaxed text-ink-muted">{body}</p>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-ink-muted">
            Mientras tanto,{" "}
            <Link href="/#proyectos" className="font-semibold text-brand underline underline-offset-2 hover:text-brand-deep">
              probá la demo
            </Link>{" "}
            o leé{" "}
            <Link href="/como-funciona" className="font-semibold text-brand underline underline-offset-2 hover:text-brand-deep">
              cómo funciona
            </Link>
            .
          </p>
        </div>
        <WaitlistForm referralCode={referralCode} source={source} placesPerReferral={PLACES_PER_REFERRAL} />
      </div>
    </div>
  );
}
