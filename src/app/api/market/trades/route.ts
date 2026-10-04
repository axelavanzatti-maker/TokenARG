import { NextResponse } from "next/server";
import { handle, readJson, txBodySchema } from "@/server/http";
import { recordMarketTx } from "@/server/indexer";

export const dynamic = "force-dynamic";

/**
 * Registra las operaciones del mercado secundario de una transacción confirmada. Igual que
 * las inversiones, se leen los eventos OrderFilled del recibo: el cliente solo manda el hash.
 */
export const POST = handle(async (request: Request) => {
  const { chainId, txHash } = await readJson(request, txBodySchema);
  const trades = await recordMarketTx(chainId, txHash);
  return NextResponse.json({ trades });
});
