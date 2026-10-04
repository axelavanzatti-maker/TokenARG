import { NextResponse } from "next/server";
import { generateSiweNonce } from "viem/siwe";
import { handle } from "@/server/http";
import { issueNonce } from "@/server/session";

export const dynamic = "force-dynamic";

/** Nonce de un solo uso para el mensaje "Sign-In with Ethereum" (EIP-4361). */
export const GET = handle(async () => {
  const nonce = generateSiweNonce();
  await issueNonce(nonce);
  return NextResponse.json({ nonce }, { headers: { "Cache-Control": "no-store" } });
});
