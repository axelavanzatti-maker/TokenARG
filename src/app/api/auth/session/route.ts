import { NextResponse } from "next/server";
import { onchainVerifications } from "@/server/agent";
import { prisma } from "@/server/db";
import { assertSameOrigin, handle } from "@/server/http";
import { destroySession, getSession } from "@/server/session";
import { getKycProvider } from "@/server/kyc/provider";

export const dynamic = "force-dynamic";

/** Sesión actual con el estado KYC del legajo y el de la blockchain en cada red. */
export const GET = handle(async () => {
  const session = await getSession();
  if (!session) return NextResponse.json({ session: null }, { headers: { "Cache-Control": "no-store" } });

  const [user, verifications] = await Promise.all([
    prisma.user.findUnique({ where: { walletAddress: session.address } }),
    onchainVerifications(session.address).catch(() => []),
  ]);
  let simulated = false;
  try {
    simulated = getKycProvider().simulated;
  } catch {
    simulated = false;
  }

  return NextResponse.json(
    {
      session: { address: session.address, chainId: session.chainId, expiresAt: new Date(session.exp * 1000).toISOString() },
      kyc: {
        status: user?.kycStatus ?? "NO_INICIADO",
        fullName: user?.fullName ?? null,
        email: user?.email ?? null,
        rejectionReason: user?.kycRejectionReason ?? null,
        expiresAt: user?.kycExpiresAt?.toISOString() ?? null,
        // Identidad aprobada y vigente (calculado acá para no comparar fechas en el render).
        active: Boolean(user?.kycStatus === "APROBADO" && user.kycExpiresAt && user.kycExpiresAt > new Date()),
        simulatedProvider: simulated,
      },
      onchain: verifications.map((v) => ({
        chainId: v.chainId,
        name: v.name,
        verified: v.verified,
        expiresAt: v.expiresAt?.toISOString() ?? null,
        reachable: v.reachable,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});

export const DELETE = handle(async (request: Request) => {
  assertSameOrigin(request);
  await destroySession();
  return NextResponse.json({ ok: true });
});
