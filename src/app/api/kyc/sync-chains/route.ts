import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError, assertSameOrigin, handle, readJson } from "@/server/http";
import { enableMissingChains } from "@/server/kyc/service";
import { getSession } from "@/server/session";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ chainId: z.number().int().positive().optional() });

/**
 * Habilita la billetera de la sesión en las redes donde todavía no figura (o en `chainId`).
 * Solo para usuarios con la identidad aprobada; si ya está habilitada, no manda transacciones.
 */
export const POST = handle(async (request: Request) => {
  assertSameOrigin(request);
  const session = await getSession();
  if (!session) throw new HttpError(401, "Firmá con tu billetera para continuar.", "no_session");
  const { chainId } = await readJson(request, bodySchema);
  const { chains, verifications } = await enableMissingChains(session, chainId);
  return NextResponse.json({
    chains,
    verifications: verifications.map((v) => ({ ...v, expiresAt: v.expiresAt?.toISOString() ?? null })),
  });
});
