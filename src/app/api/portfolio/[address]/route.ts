import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { HttpError, handle } from "@/server/http";
import { getPortfolio } from "@/server/portfolio";

export const dynamic = "force-dynamic";

/** Cartera pública de una billetera (todo lo que devuelve ya es público en la blockchain). */
export const GET = handle(async (_request: Request, context: { params: Promise<{ address: string }> }) => {
  const { address } = await context.params;
  if (!isAddress(address)) throw new HttpError(400, "Dirección inválida", "bad_address");
  return NextResponse.json(await getPortfolio(address), { headers: { "Cache-Control": "no-store" } });
});
