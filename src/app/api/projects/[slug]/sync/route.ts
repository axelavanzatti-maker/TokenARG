import { NextResponse } from "next/server";
import { isAppChain } from "@/lib/chains";
import { prisma } from "@/server/db";
import { HttpError, handle } from "@/server/http";
import { syncMarket, syncProjectEvents } from "@/server/indexer";

export const dynamic = "force-dynamic";

const MIN_INTERVAL_MS = 5_000;
const lastRun = new Map<string, number>();

/**
 * Re-sincroniza un proyecto con la blockchain. La llama la ficha después de un cierre,
 * reembolso, cobro de rentas u operación del mercado para que el catálogo refleje el cambio
 * sin esperar al cron. Solo lee la blockchain, así que es pública; se limita a una corrida
 * cada 5 s por proyecto.
 */
export const POST = handle(async (_request: Request, context: { params: Promise<{ slug: string }> }) => {
  const { slug } = await context.params;
  const project = await prisma.project.findUnique({
    where: { slug },
    select: { id: true, slug: true, status: true, chainId: true, tokenAddress: true, offeringAddress: true, lastSyncedBlock: true },
  });
  if (!project) throw new HttpError(404, "Proyecto inexistente", "not_found");
  if (project.chainId === null || !isAppChain(project.chainId) || !project.offeringAddress) {
    throw new HttpError(409, "El proyecto no tiene contratos en las redes de este entorno", "not_deployed");
  }

  const now = Date.now();
  if (now - (lastRun.get(slug) ?? 0) < MIN_INTERVAL_MS) {
    return NextResponse.json({ skipped: true });
  }
  lastRun.set(slug, now);

  const [totals, market] = await Promise.all([syncProjectEvents(project), syncMarket(project.chainId)]);
  return NextResponse.json({ skipped: false, ...totals, ...market });
});
