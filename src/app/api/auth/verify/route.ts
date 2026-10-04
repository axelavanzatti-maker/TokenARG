import { NextResponse } from "next/server";
import { getAddress } from "viem";
import { parseSiweMessage } from "viem/siwe";
import { z } from "zod";
import { APP_CHAINS, isAppChain } from "@/lib/chains";
import { getPublicClient } from "@/server/chain";
import { prisma } from "@/server/db";
import { HttpError, assertSameOrigin, handle, readJson } from "@/server/http";
import { consumeNonce, createSession } from "@/server/session";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  message: z.string().min(1).max(4_000),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/, "Firma inválida"),
});

/**
 * Verifica la firma SIWE y abre la sesión. Valida dominio, nonce, red y vigencia del mensaje;
 * la verificación de la firma admite billeteras EOA y de contrato (ERC-1271 / ERC-6492).
 * Se puede firmar desde cualquiera de las redes de la app (Polygon o Ethereum).
 */
export const POST = handle(async (request: Request) => {
  assertSameOrigin(request);
  const { message, signature } = await readJson(request, bodySchema);

  const nonce = await consumeNonce();
  if (!nonce) throw new HttpError(401, "La solicitud de firma venció. Volvé a intentarlo.", "nonce_expired");

  const fields = parseSiweMessage(message);
  if (!fields.address) throw new HttpError(400, "El mensaje no incluye una dirección.", "bad_message");
  if (fields.chainId === undefined || !isAppChain(fields.chainId)) {
    const names = APP_CHAINS.map((chain) => chain.name).join(" o ");
    throw new HttpError(400, `Firmá conectado a ${names}.`, "wrong_chain");
  }

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  const valid = await getPublicClient(fields.chainId).verifySiweMessage({
    message,
    signature: signature as `0x${string}`,
    domain: host,
    nonce,
  });
  if (!valid) throw new HttpError(401, "No pudimos validar la firma. Volvé a intentarlo.", "bad_signature");

  const address = getAddress(fields.address);
  await createSession(address, fields.chainId);
  const user = await prisma.user.upsert({
    where: { walletAddress: address },
    create: { walletAddress: address },
    update: {},
  });

  return NextResponse.json({ address, kycStatus: user.kycStatus });
});
