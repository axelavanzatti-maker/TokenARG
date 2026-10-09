import type { Metadata } from "next";
import { AdminSignIn } from "@/components/admin-sign-in";
import { CATEGORIES } from "@/lib/categories";
import { formatDate, formatUSD } from "@/lib/format";
import { prisma } from "@/server/db";
import { adminWallets, isAdminWallet } from "@/server/growth";
import { getSession } from "@/server/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Administración",
  robots: { index: false, follow: false },
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-rule bg-card px-5 py-4">
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="figure mt-1 text-2xl text-ink">{value}</p>
    </div>
  );
}

export default async function AdminPage() {
  const session = await getSession();
  if (!isAdminWallet(session?.address)) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 pt-10 pb-8 sm:px-6 lg:px-8">
        <AdminSignIn signedInAs={session?.address ?? null} configured={adminWallets().length > 0} />
      </div>
    );
  }

  const [applications, applicationCount, waitlistCount, invited, topInviters, sources] = await Promise.all([
    prisma.projectApplication.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.projectApplication.count(),
    prisma.waitlistEntry.count(),
    prisma.waitlistEntry.count({ where: { referredById: { not: null } } }),
    prisma.waitlistEntry.findMany({
      where: { referrals: { some: {} } },
      select: { email: true, name: true, code: true, _count: { select: { referrals: true } } },
      orderBy: { referrals: { _count: "desc" } },
      take: 10,
    }),
    prisma.waitlistEntry.groupBy({ by: ["source"], _count: { _all: true }, orderBy: { _count: { source: "desc" } }, take: 10 }),
  ]);

  const button =
    "inline-flex items-center rounded-[var(--radius-control)] border border-rule-strong bg-card px-4 py-2 text-sm font-semibold text-ink hover:border-ink/40";

  return (
    <div className="mx-auto max-w-[1200px] px-4 pt-10 pb-8 sm:px-6 lg:px-8">
      <h1 className="display text-[2rem] text-ink">Administración</h1>
      <p className="mt-2 text-sm text-ink-muted">Entraste con {session!.address}.</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Postulaciones de proyectos" value={applicationCount.toLocaleString("es-AR")} />
        <Stat label="Lista de espera" value={waitlistCount.toLocaleString("es-AR")} />
        <Stat label="Llegaron invitados" value={invited.toLocaleString("es-AR")} />
      </div>

      <section aria-labelledby="admin-postulaciones" className="mt-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="admin-postulaciones" className="heading text-xl text-ink">
            Postulaciones (últimas 50)
          </h2>
          <a href="/api/admin/export?tipo=postulaciones" className={button}>
            Descargar CSV
          </a>
        </div>
        {applications.length === 0 ? (
          <p className="mt-4 text-sm text-ink-muted">Todavía no hay postulaciones.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {applications.map((a) => (
              <li key={a.id} className="rounded-[var(--radius-card)] border border-rule bg-card p-4 text-sm">
                <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="heading text-base text-ink">{a.companyName}</span>
                  <span className="text-ink-muted">
                    {CATEGORIES[a.category].label} · {a.location} · {formatUSD(Number(a.amountUSD))}
                    {a.hasTrust ? " · con fideicomiso" : ""}
                  </span>
                </p>
                <p className="mt-1 text-ink-muted">
                  {a.contactName} · <a className="text-brand underline" href={`mailto:${a.email}`}>{a.email}</a>
                  {a.phone ? ` · ${a.phone}` : ""} · {formatDate(a.createdAt.toISOString())}
                  {a.source ? ` · vino de ${a.source}` : ""}
                </p>
                <p className="mt-2 leading-relaxed whitespace-pre-line text-ink">{a.description}</p>
                {a.website && (
                  <a href={a.website} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block break-all text-brand underline">
                    {a.website}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="admin-lista" className="mt-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="admin-lista" className="heading text-xl text-ink">
            Lista de espera
          </h2>
          <a href="/api/admin/export?tipo=lista" className={button}>
            Descargar CSV
          </a>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-[var(--radius-card)] border border-rule bg-card p-4 text-sm">
            <p className="font-semibold text-ink">Quiénes más invitaron</p>
            {topInviters.length === 0 ? (
              <p className="mt-2 text-ink-muted">Nadie invitó todavía.</p>
            ) : (
              <ol className="mt-2 space-y-1">
                {topInviters.map((w) => (
                  <li key={w.code} className="flex justify-between gap-3">
                    <span className="truncate text-ink">{w.name ? `${w.name} (${w.email})` : w.email}</span>
                    <span className="tabular shrink-0 text-ink-muted">{w._count.referrals}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div className="rounded-[var(--radius-card)] border border-rule bg-card p-4 text-sm">
            <p className="font-semibold text-ink">De dónde llegan (utm_source)</p>
            {sources.length === 0 ? (
              <p className="mt-2 text-ink-muted">Todavía no hay inscriptos.</p>
            ) : (
              <ol className="mt-2 space-y-1">
                {sources.map((s) => (
                  <li key={s.source ?? "directo"} className="flex justify-between gap-3">
                    <span className="truncate text-ink">{s.source ?? "directo o sin etiqueta"}</span>
                    <span className="tabular shrink-0 text-ink-muted">{s._count._all}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
