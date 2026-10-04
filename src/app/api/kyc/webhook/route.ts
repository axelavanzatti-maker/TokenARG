import { NextResponse } from "next/server";
import { handle } from "@/server/http";
import { getKycProvider } from "@/server/kyc/provider";
import { applyKycDecision } from "@/server/kyc/service";

export const dynamic = "force-dynamic";

/**
 * Callback del proveedor KYC. Se valida la firma sobre el cuerpo crudo antes de parsearlo.
 * Si el alta falla en todas las redes (o una baja falla), responde 500 y el proveedor reintenta
 * (applyKycDecision es idempotente).
 */
export const POST = handle(async (request: Request) => {
  const rawBody = await request.text();
  const decision = await getKycProvider().parseWebhook(rawBody, request.headers);
  const { user, chains } = await applyKycDecision(decision);
  return NextResponse.json({ ok: true, status: user.kycStatus, chains: chains.map(({ chainId, outcome }) => ({ chainId, outcome })) });
});
