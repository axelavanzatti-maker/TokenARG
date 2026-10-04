import { formatUnits, getAddress, parseEventLogs, type Address, type Hash } from "viem";
import type { Network, ProjectStatus } from "@/generated/prisma/enums";
import { assetTokenAbi, p2pMarketAbi, tokenOfferingAbi } from "@/lib/contracts/abis";
import { OFFERING_STATE, appChainIds, getPublicClient } from "@/server/chain";
import { prisma } from "@/server/db";
import { activeDeployments, getDeployment } from "@/server/deployments";
import { HttpError } from "@/server/errors";

/**
 * Índice off-chain de los eventos de ofertas, tokens y mercado secundario, red por red.
 * Todas las escrituras son idempotentes (clave única chainId + txHash + logIndex), así que
 * da igual si un evento llega primero por la API o por la sincronización periódica.
 */

const USDC_DECIMALS = 6;
const LOG_CHUNK = BigInt(process.env.SYNC_BLOCK_CHUNK ?? 5_000);

const STATUS_BY_STATE: Record<(typeof OFFERING_STATE)[number], ProjectStatus> = {
  Upcoming: "PROXIMAMENTE",
  Open: "FONDEANDO",
  Closed: "FINALIZADO",
  Successful: "FINALIZADO",
  Failed: "CANCELADO",
};

interface IndexedProject {
  id: string;
  slug: string;
  status: ProjectStatus;
  chainId: number | null;
  tokenAddress: string | null;
  offeringAddress: string | null;
  lastSyncedBlock: bigint | null;
}

const PROJECT_SELECT = {
  id: true,
  slug: true,
  status: true,
  chainId: true,
  tokenAddress: true,
  offeringAddress: true,
  lastSyncedBlock: true,
} as const;

const blockTimes = new Map<string, Date>();
async function blockTime(chainId: number, blockNumber: bigint) {
  const key = `${chainId}:${blockNumber}`;
  let time = blockTimes.get(key);
  if (!time) {
    const block = await getPublicClient(chainId).getBlock({ blockNumber });
    time = new Date(Number(block.timestamp) * 1000);
    blockTimes.set(key, time);
  }
  return time;
}

const usd = (units: bigint) => formatUnits(units, USDC_DECIMALS);

/** Actualiza recaudación, inversores, fechas y estado del proyecto desde el contrato de oferta. */
export async function refreshProjectSummary(project: IndexedProject) {
  if (!project.offeringAddress || project.chainId === null) return;
  const [state, raised, , investors, , , , , start, end] = await getPublicClient(project.chainId).readContract({
    address: getAddress(project.offeringAddress),
    abi: tokenOfferingAbi,
    functionName: "summary",
  });
  const stateName = OFFERING_STATE[state] ?? "Upcoming";
  await prisma.project.update({
    where: { id: project.id },
    data: {
      collectedAmountUSD: usd(raised),
      investorCount: Number(investors),
      // LIQUIDADO lo define el fiduciario al cerrar el fideicomiso; la oferta no lo conoce.
      status: project.status === "LIQUIDADO" ? "LIQUIDADO" : STATUS_BY_STATE[stateName],
      opensAt: new Date(Number(start) * 1000),
      closesAt: new Date(Number(end) * 1000),
    },
  });
}

async function upsertPurchase(
  project: IndexedProject,
  chainId: number,
  log: { transactionHash: Hash; logIndex: number; blockNumber: bigint; args: { investor: Address; paymentAmount: bigint; tokenAmount: bigint } },
) {
  const wallet = getAddress(log.args.investor);
  const user = await prisma.user.findUnique({ where: { walletAddress: wallet }, select: { id: true } });
  const key = { chainId, txHash: log.transactionHash, logIndex: log.logIndex };
  return prisma.investment.upsert({
    where: { chainId_txHash_logIndex: key },
    create: {
      ...key,
      projectId: project.id,
      userId: user?.id,
      investorWallet: wallet,
      amountUSD: usd(log.args.paymentAmount),
      tokenAmount: formatUnits(log.args.tokenAmount, 18),
      blockNumber: log.blockNumber,
      executedAt: await blockTime(chainId, log.blockNumber),
    },
    update: {},
  });
}

async function upsertTrade(
  projectId: string,
  chainId: number,
  log: {
    transactionHash: Hash;
    logIndex: number;
    blockNumber: bigint;
    args: { id: bigint; buyer: Address; seller: Address; price: bigint; amount: bigint; value: bigint; buyerFee: bigint; sellerFee: bigint };
  },
) {
  const key = { chainId, txHash: log.transactionHash, logIndex: log.logIndex };
  return prisma.trade.upsert({
    where: { chainId_txHash_logIndex: key },
    create: {
      ...key,
      projectId,
      orderId: log.args.id,
      buyer: getAddress(log.args.buyer),
      seller: getAddress(log.args.seller),
      priceUSD: usd(log.args.price),
      tokenAmount: formatUnits(log.args.amount, 18),
      valueUSD: usd(log.args.value),
      buyerFeeUSD: usd(log.args.buyerFee),
      sellerFeeUSD: usd(log.args.sellerFee),
      blockNumber: log.blockNumber,
      executedAt: await blockTime(chainId, log.blockNumber),
    },
    update: {},
  });
}

async function receiptOf(chainId: number, txHash: Hash) {
  const receipt = await getPublicClient(chainId)
    .getTransactionReceipt({ hash: txHash })
    .catch(() => null);
  if (!receipt) throw new HttpError(404, "La transacción todavía no está confirmada.", "tx_not_found");
  if (receipt.status !== "success") throw new HttpError(422, "La transacción revirtió.", "tx_reverted");
  return receipt;
}

/**
 * Registra las compras primarias de una transacción ya confirmada (directa en USDC o por el
 * router de pagos). Nunca confía en montos enviados por el cliente, solo en los eventos.
 */
export async function recordPurchaseTx(chainId: number, txHash: Hash) {
  const receipt = await receiptOf(chainId, txHash);
  const projects = await prisma.project.findMany({ where: { chainId, offeringAddress: { not: null } }, select: PROJECT_SELECT });
  const byOffering = new Map(projects.map((p) => [p.offeringAddress!.toLowerCase(), p]));

  const purchases = parseEventLogs({ abi: tokenOfferingAbi, logs: receipt.logs, eventName: "TokensPurchased" }).filter((log) =>
    byOffering.has(log.address.toLowerCase()),
  );
  if (purchases.length === 0) {
    throw new HttpError(422, "La transacción no contiene compras de proyectos de TokenARG.", "no_purchases");
  }

  const touched = new Map<string, IndexedProject>();
  const recorded = [];
  for (const log of purchases) {
    const project = byOffering.get(log.address.toLowerCase())!;
    recorded.push(await upsertPurchase(project, chainId, log));
    touched.set(project.id, project);
  }
  for (const project of touched.values()) await refreshProjectSummary(project);

  return recorded.map((inv) => ({
    id: inv.id,
    projectId: inv.projectId,
    investorWallet: inv.investorWallet,
    amountUSD: Number(inv.amountUSD),
    tokenAmount: Number(inv.tokenAmount),
    txHash: inv.txHash,
  }));
}

/** Registra las operaciones del mercado secundario de una transacción ya confirmada. */
export async function recordMarketTx(chainId: number, txHash: Hash) {
  const deployment = await getDeployment(chainId);
  if (!deployment) throw new HttpError(409, "No hay mercado configurado en esa red.", "no_market");
  const receipt = await receiptOf(chainId, txHash);
  const market = deployment.market.toLowerCase();
  const fills = parseEventLogs({ abi: p2pMarketAbi, logs: receipt.logs, eventName: "OrderFilled" }).filter(
    (log) => log.address.toLowerCase() === market,
  );
  if (fills.length === 0) throw new HttpError(422, "La transacción no contiene operaciones del mercado.", "no_trades");

  const projects = await prisma.project.findMany({ where: { chainId, tokenAddress: { not: null } }, select: { id: true, tokenAddress: true } });
  const byToken = new Map(projects.map((p) => [p.tokenAddress!.toLowerCase(), p.id]));
  const recorded = [];
  for (const log of fills) {
    const projectId = byToken.get(log.args.token.toLowerCase());
    if (projectId) recorded.push(await upsertTrade(projectId, chainId, log));
  }
  return recorded.map((t) => ({ id: t.id, priceUSD: Number(t.priceUSD), tokenAmount: Number(t.tokenAmount), txHash: t.txHash }));
}

/** Recorre los eventos de un proyecto desde el último bloque indexado hasta `toBlock`. */
export async function syncProjectEvents(project: IndexedProject, toBlock?: bigint) {
  if (!project.offeringAddress || !project.tokenAddress || project.chainId === null) {
    return { purchases: 0, refunds: 0, distributions: 0 };
  }
  const chainId = project.chainId;
  const client = getPublicClient(chainId);
  const offering = getAddress(project.offeringAddress);
  const token = getAddress(project.tokenAddress);
  const head = toBlock ?? (await client.getBlockNumber());
  let from = (project.lastSyncedBlock ?? -1n) + 1n;
  const totals = { purchases: 0, refunds: 0, distributions: 0 };

  while (from <= head) {
    const to = from + LOG_CHUNK - 1n < head ? from + LOG_CHUNK - 1n : head;
    // strict: descarta logs que no decodifican contra el ABI, así los args vienen siempre completos.
    const range = { fromBlock: from, toBlock: to, strict: true } as const;
    const [purchases, refunds, distributions] = await Promise.all([
      client.getContractEvents({ address: offering, abi: tokenOfferingAbi, eventName: "TokensPurchased", ...range }),
      client.getContractEvents({ address: offering, abi: tokenOfferingAbi, eventName: "Refunded", ...range }),
      client.getContractEvents({ address: token, abi: assetTokenAbi, eventName: "DistributionDeposited", ...range }),
    ]);

    for (const log of purchases) {
      await upsertPurchase(project, chainId, log);
      totals.purchases += 1;
    }
    for (const log of refunds) {
      // refund() devuelve todo el aporte del inversor en esa ronda.
      await prisma.investment.updateMany({
        where: { projectId: project.id, investorWallet: getAddress(log.args.investor) },
        data: { status: "REEMBOLSADA" },
      });
      totals.refunds += 1;
    }
    for (const log of distributions) {
      const key = { chainId, txHash: log.transactionHash, logIndex: log.logIndex };
      await prisma.distribution.upsert({
        where: { chainId_txHash_logIndex: key },
        create: {
          ...key,
          projectId: project.id,
          amountUSD: usd(log.args.amount),
          blockNumber: log.blockNumber,
          executedAt: await blockTime(chainId, log.blockNumber),
        },
        update: {},
      });
      totals.distributions += 1;
    }

    await prisma.project.update({ where: { id: project.id }, data: { lastSyncedBlock: to } });
    from = to + 1n;
  }

  await refreshProjectSummary(project);
  return totals;
}

/** Recorre las operaciones del mercado secundario de una red. */
export async function syncMarket(chainId: number, toBlock?: bigint) {
  const deployment = await getDeployment(chainId);
  if (!deployment) return { trades: 0 };
  const client = getPublicClient(chainId);
  const head = toBlock ?? (await client.getBlockNumber());
  const market = getAddress(deployment.market);
  const projects = await prisma.project.findMany({ where: { chainId, tokenAddress: { not: null } }, select: { id: true, tokenAddress: true } });
  const byToken = new Map(projects.map((p) => [p.tokenAddress!.toLowerCase(), p.id]));

  let from = (deployment.marketSyncedBlock ?? deployment.startBlock - 1n) + 1n;
  let trades = 0;
  while (from <= head) {
    const to = from + LOG_CHUNK - 1n < head ? from + LOG_CHUNK - 1n : head;
    const fills = await client.getContractEvents({
      address: market,
      abi: p2pMarketAbi,
      eventName: "OrderFilled",
      fromBlock: from,
      toBlock: to,
      strict: true,
    });
    for (const log of fills) {
      const projectId = byToken.get(log.args.token.toLowerCase());
      if (!projectId) continue;
      await upsertTrade(projectId, chainId, log);
      trades += 1;
    }
    await prisma.chainDeployment.update({ where: { chainId }, data: { marketSyncedBlock: to } });
    from = to + 1n;
  }
  return { trades };
}

export interface DeploymentFile {
  chainId: number;
  family: Network;
  startBlock: number;
  identityRegistry: string;
  paymentToken: { address: string };
  paymentRouter: string;
  paymentAssets: unknown[];
  market: { address: string; buyerFeeBps: number; sellerFeeBps: number; minOrderValueUSD: number };
  projects: Record<string, { token: string; offering: string }>;
}

/**
 * Carga en la base las direcciones de un deploy. Si cambiaron los contratos, o si es el mismo
 * deploy pero en otra instancia de la red (un nodo local reiniciado repite las direcciones),
 * descarta el índice viejo.
 */
export async function importDeployment(d: DeploymentFile) {
  if (!appChainIds().includes(d.chainId)) {
    throw new Error(`El deploy es de la red ${d.chainId}, que no está activa en este modo (NEXT_PUBLIC_NETWORK_MODE).`);
  }
  const client = getPublicClient(d.chainId);
  // Huella de esta instancia de la red: el hash del bloque en el que empezó el deploy.
  const startBlock = await client.getBlock({ blockNumber: BigInt(d.startBlock) }).catch(() => null);
  if (!startBlock?.hash) {
    throw new Error(`La red ${d.chainId} no tiene el bloque ${d.startBlock} del deploy. ¿Reiniciaste el nodo? Volvé a desplegar.`);
  }
  const deploymentRef = startBlock.hash;
  const market = getAddress(d.market.address);

  const identityRegistry = getAddress(d.identityRegistry);
  const existing = await prisma.chainDeployment.findUnique({ where: { chainId: d.chainId } });
  const chainChanged = !existing || existing.deploymentRef !== deploymentRef || existing.market !== market;
  if (chainChanged) await prisma.trade.deleteMany({ where: { chainId: d.chainId } });
  // Registro nuevo (o red reiniciada): las altas de billeteras de esa red ya no valen.
  if (!existing || existing.deploymentRef !== deploymentRef || existing.identityRegistry !== identityRegistry) {
    await prisma.walletVerification.deleteMany({ where: { chainId: d.chainId } });
  }

  const deploymentData = {
    network: d.family,
    identityRegistry,
    paymentToken: getAddress(d.paymentToken.address),
    paymentRouter: getAddress(d.paymentRouter),
    market,
    buyerFeeBps: d.market.buyerFeeBps,
    sellerFeeBps: d.market.sellerFeeBps,
    minOrderValueUSD: d.market.minOrderValueUSD,
    paymentAssets: d.paymentAssets as object[],
    startBlock: BigInt(d.startBlock),
    deploymentRef,
    ...(chainChanged ? { marketSyncedBlock: BigInt(d.startBlock - 1) } : {}),
  };
  await prisma.chainDeployment.upsert({
    where: { chainId: d.chainId },
    create: { chainId: d.chainId, ...deploymentData },
    update: deploymentData,
  });

  // Libera direcciones que otro proyecto tenía en esta red (la unicidad es por red).
  const slugs = Object.keys(d.projects);
  const tokens = Object.values(d.projects).map((p) => getAddress(p.token));
  const offerings = Object.values(d.projects).map((p) => getAddress(p.offering));
  await prisma.project.updateMany({
    where: { chainId: d.chainId, slug: { notIn: slugs }, OR: [{ tokenAddress: { in: tokens } }, { offeringAddress: { in: offerings } }] },
    data: { chainId: null, tokenAddress: null, offeringAddress: null, deploymentRef: null, lastSyncedBlock: null },
  });

  const results: { slug: string; changed: boolean; found: boolean }[] = [];
  for (const [slug, addresses] of Object.entries(d.projects)) {
    const project = await prisma.project.findUnique({ where: { slug } });
    if (!project) {
      results.push({ slug, changed: false, found: false });
      continue;
    }
    const tokenAddress = getAddress(addresses.token);
    const offeringAddress = getAddress(addresses.offering);
    const changed =
      project.tokenAddress !== tokenAddress ||
      project.offeringAddress !== offeringAddress ||
      project.chainId !== d.chainId ||
      project.deploymentRef !== deploymentRef;
    if (changed) {
      await prisma.$transaction([
        prisma.investment.deleteMany({ where: { projectId: project.id } }),
        prisma.distribution.deleteMany({ where: { projectId: project.id } }),
        prisma.trade.deleteMany({ where: { projectId: project.id } }),
        prisma.project.update({
          where: { id: project.id },
          data: {
            chainId: d.chainId,
            network: d.family,
            tokenAddress,
            offeringAddress,
            deploymentRef,
            lastSyncedBlock: BigInt(Math.max(d.startBlock - 1, -1)),
            collectedAmountUSD: 0,
            investorCount: 0,
          },
        }),
      ]);
    }
    results.push({ slug, changed, found: true });
  }
  return results;
}

/** Sincroniza proyectos y mercado de todas las redes activas. */
export async function syncAllProjects() {
  const report: { chainId: number; slug: string; purchases: number; refunds: number; distributions: number }[] = [];
  const markets: { chainId: number; trades: number }[] = [];
  const heads: Record<number, string> = {};
  for (const deployment of await activeDeployments()) {
    const chainId = deployment.chainId;
    const head = await getPublicClient(chainId).getBlockNumber();
    heads[chainId] = head.toString();
    const projects = await prisma.project.findMany({ where: { chainId, offeringAddress: { not: null } }, select: PROJECT_SELECT });
    for (const project of projects) {
      report.push({ chainId, slug: project.slug, ...(await syncProjectEvents(project, head)) });
    }
    markets.push({ chainId, ...(await syncMarket(chainId, head)) });
  }
  return { heads, report, markets };
}
