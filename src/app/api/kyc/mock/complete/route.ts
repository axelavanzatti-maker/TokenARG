import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { HttpError, assertSameOrigin, handle, readJson } from "@/server/http";
import { getKycProvider } from "@/server/kyc/provider";
import { applyKycDecision } from "@/server/kyc/service";
import { getSession } from "@/server/session";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ decision: z.enum(["approve", "reject"]) });

/**
 * SOLO con el proveedor de prueba: simula la respuesta del proveedor para la propia sesión.
 * Recorre exactamente el mismo camino que un webhook real (incluida el alta on-chain).
 */
export const POST = handle(async (request: Request) => {
  assertSameOrigin(request);
  if (!getKycProvider().simulated) throw new HttpError(404, "No disponible", "not_found");

  const session = await getSession();
  if (!session) throw new HttpError(401, "Firmá con tu billetera para continuar.", "no_session");
  const { decision } = await readJson(request, bodySchema);

  const user = await prisma.user.findUnique({ where: { walletAddress: session.address } });
  if (!user?.kycReference) throw new HttpError(409, "Primero completá tus datos.", "kyc_not_started");

  const { user: updated, chains } = await applyKycDecision({
    reference: user.kycReference,
    status: decision === "approve" ? "APROBADO" : "RECHAZADO",
    reason: decision === "reject" ? "Rechazo simulado desde el entorno de prueba." : undefined,
  });

  return NextResponse.json({
    status: updated.kycStatus,
    expiresAt: updated.kycExpiresAt?.toISOString() ?? null,
    chains,
  });
});
