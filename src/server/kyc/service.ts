import "server-only";
import { getAddress, type Address } from "viem";
import { z } from "zod";
import { chainById } from "@/lib/chains";
import { isValidCuit, normalizeCuit } from "@/lib/cuit";
import { onchainVerification, onchainVerifications, removeInvestor, whitelistInvestor } from "@/server/agent";
import { prisma } from "@/server/db";
import { activeDeployments } from "@/server/deployments";
import { HttpError } from "@/server/errors";
import type { Session } from "@/server/session";
import { getKycProvider, type KycDecision } from "./provider";

export const kycStartSchema = z.object({
  fullName: z.string().trim().min(5, "Ingresá tu nombre y apellido completos").max(120),
  email: z.email("Ingresá un email válido").max(200),
  taxId: z.string().refine(isValidCuit, "El CUIT/CUIL no es válido: revisá los 11 dígitos"),
  isPep: z.boolean(),
  acceptTerms: z.literal(true, { error: "Tenés que aceptar los términos y la política de privacidad" }),
});

export type KycStartInput = z.infer<typeof kycStartSchema>;

const DAY_MS = 86_400_000;

function validityDays() {
  const days = Number(process.env.KYC_VALIDITY_DAYS ?? 365);
  return Number.isFinite(days) && days > 0 ? days : 365;
}

function isApproved(user: { kycStatus: string; kycExpiresAt: Date | null }) {
  return user.kycStatus === "APROBADO" && user.kycExpiresAt !== null && user.kycExpiresAt > new Date();
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Resultado del alta de una billetera en el registro de una red. */
export interface ChainEnableResult {
  chainId: number;
  name: string;
  /** "enabled": se mandó el alta; "already": ya estaba habilitada; "failed": no se pudo. */
  outcome: "enabled" | "already" | "failed";
  txHash?: string;
  error?: string;
}

/**
 * Da de alta la billetera en el IdentityRegistry de cada red activa (o de `only`) donde no esté
 * habilitada hasta `validUntil`. Primero lee la blockchain, así que repetirlo no gasta gas:
 * sirve para reintentos de webhooks y para redes que se agregaron o reiniciaron después.
 */
async function enableOnChains(user: { id: string; walletAddress: string }, validUntil: Date, only?: number[]) {
  const wallet = getAddress(user.walletAddress);
  const deployments = (await activeDeployments()).filter((d) => !only || only.includes(d.chainId));
  const results: ChainEnableResult[] = [];

  // Una red a la vez: cada alta espera su recibo y el agente es el mismo en todas.
  for (const { chainId } of deployments) {
    const name = chainById(chainId)?.name ?? `Red ${chainId}`;
    try {
      const current = await onchainVerification(chainId, wallet);
      const coversValidity = current.expiresAt !== null && current.expiresAt.getTime() >= validUntil.getTime() - 60_000;
      if (current.verified && coversValidity) {
        results.push({ chainId, name, outcome: "already" });
        continue;
      }
      const txHash = await whitelistInvestor(chainId, wallet, validUntil);
      await prisma.walletVerification.upsert({
        where: { userId_chainId: { userId: user.id, chainId } },
        create: { userId: user.id, chainId, txHash, validUntil },
        update: { txHash, validUntil },
      });
      results.push({ chainId, name, outcome: "enabled", txHash });
    } catch (error) {
      console.error(`[kyc] alta en la red ${chainId} falló:`, error);
      results.push({ chainId, name, outcome: "failed", error: errorMessage(error) });
    }
  }
  return results;
}

/** Inicia (o reinicia) la verificación del usuario de la sesión. */
export async function startKyc(session: Session, input: KycStartInput) {
  const provider = getKycProvider();
  const user = await prisma.user.upsert({
    where: { walletAddress: session.address },
    create: { walletAddress: session.address },
    update: {},
  });

  // Con la identidad aprobada no hace falta repetir el trámite: si falta alguna red, la
  // billetera se habilita desde /api/kyc/sync-chains.
  if (isApproved(user)) {
    throw new HttpError(409, "Tu identidad ya está verificada.", "already_verified");
  }

  const emailOwner = await prisma.user.findUnique({ where: { email: input.email } });
  if (emailOwner && emailOwner.id !== user.id) {
    throw new HttpError(409, "Ese email ya está asociado a otra billetera.", "email_taken");
  }

  const { reference, redirectUrl } = await provider.startVerification({
    userId: user.id,
    wallet: session.address,
    fullName: input.fullName,
    email: input.email,
    taxId: normalizeCuit(input.taxId),
  });

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      fullName: input.fullName,
      email: input.email,
      taxId: normalizeCuit(input.taxId),
      isPep: input.isPep,
      termsAcceptedAt: new Date(),
      kycStatus: "PENDIENTE",
      kycProvider: provider.name,
      kycReference: reference,
      kycRejectionReason: null,
    },
  });

  return { status: updated.kycStatus, redirectUrl, simulated: provider.simulated, reference };
}

/**
 * Aplica el resultado del proveedor. Idempotente: los proveedores reintentan los webhooks.
 *
 * - APROBADO: habilita la billetera en todas las redes activas. La aprobación se registra si
 *   el alta se confirmó en al menos una; si fallaron todas, se lanza el error para que el
 *   proveedor reintente. Las redes que fallaron se completan después con `enableMissingChains`.
 * - RECHAZADO: el legajo queda rechazado de inmediato y la billetera se da de baja en cada red
 *   donde figure habilitada. Si una baja falla, se lanza el error y el reintento la completa.
 */
export async function applyKycDecision(decision: KycDecision) {
  const user = await prisma.user.findUnique({ where: { kycReference: decision.reference } });
  if (!user) throw new HttpError(404, "Referencia KYC desconocida", "unknown_reference");
  const wallet: Address = getAddress(user.walletAddress);

  if (decision.status === "PENDIENTE") {
    return { user: await prisma.user.update({ where: { id: user.id }, data: { kycStatus: "PENDIENTE" } }), chains: [] };
  }

  if (decision.status === "APROBADO") {
    const alreadyApproved = isApproved(user);
    const expiresAt = alreadyApproved ? user.kycExpiresAt! : new Date(Date.now() + validityDays() * DAY_MS);
    const chains = await enableOnChains(user, expiresAt);
    if (!chains.some((c) => c.outcome !== "failed")) {
      const detail = chains.map((c) => `${c.name}: ${c.error}`).join("; ") || "no hay redes con contratos cargados";
      throw new Error(`No se pudo habilitar la billetera en ninguna red (${detail})`);
    }
    if (alreadyApproved) return { user, chains };
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { kycStatus: "APROBADO", kycVerifiedAt: new Date(), kycExpiresAt: expiresAt, kycRejectionReason: null },
    });
    return { user: updated, chains };
  }

  // Solo puede figurar habilitada si alguna vez se aprobó (o si quedó un alta registrada).
  const couldBeEnabled = user.kycStatus === "APROBADO";
  const enabledRows = await prisma.walletVerification.findMany({ where: { userId: user.id }, select: { chainId: true } });
  const enabledOn = new Set(enabledRows.map((row) => row.chainId));

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      kycStatus: "RECHAZADO",
      kycRejectionReason: decision.reason ?? "La verificación no fue aprobada.",
      kycExpiresAt: null,
    },
  });

  const failures: string[] = [];
  for (const { chainId } of await activeDeployments()) {
    try {
      const current = await onchainVerification(chainId, wallet);
      if (current.verified) await removeInvestor(chainId, wallet);
      await prisma.walletVerification.deleteMany({ where: { userId: user.id, chainId } });
    } catch (error) {
      if (couldBeEnabled || enabledOn.has(chainId)) failures.push(`${chainId}: ${errorMessage(error)}`);
    }
  }
  if (failures.length > 0) throw new Error(`No se pudo dar de baja la billetera en: ${failures.join("; ")}`);
  return { user: updated, chains: [] };
}

/**
 * Habilita la billetera de un usuario aprobado en las redes donde todavía no figura (una red
 * agregada después de su aprobación, un alta que falló o un nodo local reiniciado).
 */
export async function enableMissingChains(session: Session, chainId?: number) {
  const user = await prisma.user.findUnique({ where: { walletAddress: session.address } });
  if (!user || !isApproved(user)) {
    throw new HttpError(409, "Primero verificá tu identidad.", "kyc_not_approved");
  }
  const chains = await enableOnChains(user, user.kycExpiresAt!, chainId === undefined ? undefined : [chainId]);
  if (chainId !== undefined && chains.length === 0) {
    throw new HttpError(400, `La red ${chainId} no tiene contratos de TokenARG en este entorno.`, "unsupported_chain");
  }
  const verifications = await onchainVerifications(session.address);
  return { chains, verifications };
}
