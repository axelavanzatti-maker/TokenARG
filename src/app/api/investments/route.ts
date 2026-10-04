import { NextResponse } from "next/server";
import { handle, readJson, txBodySchema } from "@/server/http";
import { recordPurchaseTx } from "@/server/indexer";

export const dynamic = "force-dynamic";

/**
 * Registra una inversión a partir del hash de una transacción confirmada.
 * El servidor lee el recibo de la blockchain y solo indexa eventos TokensPurchased emitidos
 * por ofertas de TokenARG en esa red: el cliente no puede inventar montos ni proyectos.
 */
export const POST = handle(async (request: Request) => {
  const { chainId, txHash } = await readJson(request, txBodySchema);
  const investments = await recordPurchaseTx(chainId, txHash);
  return NextResponse.json({ investments });
});
