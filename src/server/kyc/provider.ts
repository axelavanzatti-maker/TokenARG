import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Address } from "viem";
import { z } from "zod";
import { IS_TESTNET } from "@/lib/chains";
import { HttpError } from "@/server/errors";

/** Resultado normalizado de una verificación, venga del proveedor que venga. */
export interface KycDecision {
  /** Identificador de la sesión en el proveedor (User.kycReference). */
  reference: string;
  status: "APROBADO" | "RECHAZADO" | "PENDIENTE";
  reason?: string;
}

export interface StartVerificationInput {
  userId: string;
  wallet: Address;
  fullName: string;
  email: string;
  taxId: string;
}

/**
 * Contrato que tiene que cumplir cualquier proveedor KYC (Didit, Truora, Jumio, RENAPER vía
 * un integrador, etc.). Para sumar uno real:
 *   1. startVerification: crear la sesión con la API del proveedor y devolver su URL.
 *   2. parseWebhook: validar la firma del proveedor y mapear su estado a KycDecision.
 * El resto del flujo (alta on-chain, legajo en la base) no cambia.
 */
export interface KycProvider {
  readonly name: string;
  /** true si el proveedor permite simular el resultado desde la propia app (solo desarrollo). */
  readonly simulated: boolean;
  startVerification(input: StartVerificationInput): Promise<{ reference: string; redirectUrl: string | null }>;
  parseWebhook(rawBody: string, headers: Headers): Promise<KycDecision>;
}

/**
 * Webhook genérico firmado con HMAC-SHA256 (cabecera `x-tokenarg-signature: sha256=<hex>`).
 * Sirve para conectar un proveedor real a través de un adaptador propio, y es el formato que
 * también acepta el proveedor de prueba.
 */
const webhookSchema = z.object({
  reference: z.string().min(1).max(200),
  status: z.enum(["approved", "rejected", "pending"]),
  reason: z.string().max(500).optional(),
});

export function signWebhookBody(rawBody: string, secret: string) {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

function verifyHmacWebhook(rawBody: string, headers: Headers): KycDecision {
  const secret = process.env.KYC_WEBHOOK_SECRET;
  if (!secret) throw new HttpError(503, "KYC_WEBHOOK_SECRET no está configurada", "webhook_disabled");
  const received = headers.get("x-tokenarg-signature") ?? "";
  const expected = signWebhookBody(rawBody, secret);
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new HttpError(401, "Firma de webhook inválida", "bad_signature");
  }
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new HttpError(400, "El webhook no es JSON válido", "invalid_json");
  }
  const body = webhookSchema.parse(json);
  const status = body.status === "approved" ? "APROBADO" : body.status === "rejected" ? "RECHAZADO" : "PENDIENTE";
  return { reference: body.reference, status, reason: body.reason };
}

/** Proveedor de prueba: no valida documentos; el resultado se simula desde /kyc. */
const mockProvider: KycProvider = {
  name: "mock",
  simulated: true,
  async startVerification() {
    return { reference: `mock_${randomUUID()}`, redirectUrl: null };
  },
  async parseWebhook(rawBody, headers) {
    return verifyHmacWebhook(rawBody, headers);
  },
};

/** Proveedor externo detrás de un adaptador que habla el webhook genérico. */
const webhookProvider: KycProvider = {
  name: "webhook",
  simulated: false,
  async startVerification(input) {
    const url = process.env.KYC_PROVIDER_START_URL;
    if (!url) throw new HttpError(503, "KYC_PROVIDER_START_URL no está configurada", "kyc_unavailable");
    const reference = `kyc_${randomUUID()}`;
    const redirect = new URL(url);
    redirect.searchParams.set("reference", reference);
    redirect.searchParams.set("wallet", input.wallet);
    return { reference, redirectUrl: redirect.toString() };
  },
  async parseWebhook(rawBody, headers) {
    return verifyHmacWebhook(rawBody, headers);
  },
};

export function getKycProvider(): KycProvider {
  const name = process.env.KYC_PROVIDER ?? "mock";
  if (name === "webhook") return webhookProvider;
  if (name === "mock") {
    // Nunca con dinero real. En testnet se puede habilitar en un build de producción (una demo
    // pública en Amoy, por ejemplo) con ALLOW_MOCK_KYC=true.
    if (!IS_TESTNET) {
      throw new HttpError(503, "El proveedor KYC de prueba no se puede usar en mainnet", "kyc_unavailable");
    }
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_MOCK_KYC !== "true") {
      throw new HttpError(
        503,
        "El proveedor KYC de prueba está deshabilitado en producción (ALLOW_MOCK_KYC=true lo habilita en testnet)",
        "kyc_unavailable",
      );
    }
    return mockProvider;
  }
  throw new HttpError(503, `Proveedor KYC desconocido: ${name}`, "kyc_unavailable");
}
