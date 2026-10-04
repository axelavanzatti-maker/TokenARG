import { NextResponse } from "next/server";
import { HttpError, handle } from "@/server/http";
import { syncAllProjects } from "@/server/indexer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Sincronización periódica con la blockchain (por ejemplo, un cron de Vercel cada 5 minutos).
 * Recupera, en cada red activa, compras y operaciones del mercado de quienes cerraron la
 * pestaña antes de que el frontend las registrara, reembolsos y distribuciones.
 * Protegida con `Authorization: Bearer <CRON_SECRET>`.
 */
export const GET = handle(async (request: Request) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    throw new HttpError(401, "No autorizado", "unauthorized");
  }
  return NextResponse.json(await syncAllProjects());
});
