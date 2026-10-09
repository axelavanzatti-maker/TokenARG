import { prisma } from "@/server/db";
import { isAdminWallet } from "@/server/growth";
import { HttpError, handle } from "@/server/http";
import { getSession } from "@/server/session";

export const dynamic = "force-dynamic";

const cell = (value: unknown) => {
  const text = value instanceof Date ? value.toISOString() : String(value ?? "");
  return /[",\n;]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

function csv(rows: Record<string, unknown>[], columns: string[]) {
  const lines = [columns.join(","), ...rows.map((row) => columns.map((c) => cell(row[c])).join(","))];
  // Con BOM, Excel abre bien las tildes.
  return `﻿${lines.join("\n")}\n`;
}

/** Descarga en CSV de postulaciones (?tipo=postulaciones) o de la lista de espera (?tipo=lista). Solo administradores. */
export const GET = handle(async (request: Request) => {
  const session = await getSession();
  if (!isAdminWallet(session?.address)) throw new HttpError(403, "Solo la billetera administradora puede descargar esto.", "forbidden");

  const tipo = new URL(request.url).searchParams.get("tipo");
  let body: string;
  if (tipo === "postulaciones") {
    const rows = await prisma.projectApplication.findMany({ orderBy: { createdAt: "desc" } });
    body = csv(rows, ["createdAt", "status", "companyName", "contactName", "email", "phone", "category", "location", "amountUSD", "hasTrust", "website", "source", "description"]);
  } else if (tipo === "lista") {
    const rows = await prisma.waitlistEntry.findMany({
      orderBy: { createdAt: "asc" },
      select: { createdAt: true, email: true, name: true, code: true, source: true, referredBy: { select: { code: true } }, _count: { select: { referrals: true } } },
    });
    body = csv(
      rows.map((r) => ({ ...r, referredBy: r.referredBy?.code ?? "", referrals: r._count.referrals })),
      ["createdAt", "email", "name", "code", "referredBy", "referrals", "source"],
    );
  } else {
    throw new HttpError(400, "Elegí tipo=postulaciones o tipo=lista", "bad_request");
  }

  const name = `tokenarg-${tipo}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(body, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });
});
