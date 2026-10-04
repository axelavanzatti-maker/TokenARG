/**
 * Revisa un deploy contra la cadena, solo con lecturas: que los contratos tengan código, que el
 * agente KYC tenga el rol y gas, y el estado de cada proyecto (ronda, transferencias y órdenes del
 * mercado). Los proyectos fondeados en la historia de demo tienen que quedar con la ronda cerrada,
 * las transferencias habilitadas y órdenes publicadas (lo hace seed-testnet.ts).
 *
 * En GitHub Actions deja el resultado como avisos visibles en la corrida y en el resumen.
 *
 * Uso: npx hardhat run scripts/verify-deployment.ts --network amoy | sepolia | localhost
 */
import { appendFileSync } from "node:fs";
import { network } from "hardhat";
import { formatEther, formatUnits, getAddress, type Address } from "viem";
import { chainInfo, loadDeployment, loadProjects } from "./lib/common.js";

const STATE_LABEL = ["próxima", "abierta", "cerrada sin finalizar", "exitosa", "fallida"] as const;
const SUCCESSFUL = 3;

const { viem, networkName } = await network.create();
const publicClient = await viem.getPublicClient();
const chainId = await publicClient.getChainId();
const chain = chainInfo(chainId);
const deployment = await loadDeployment(chainId);
const symbol = chain.family === "polygon" ? "POL" : "ETH";
const usd = (units: bigint) => Number(formatUnits(units, deployment.paymentToken.decimals)).toLocaleString("es-AR", { maximumFractionDigits: 4 });

const notes: string[] = [];
const problems: string[] = [];

// Contratos ----------------------------------------------------------------------------------------
const contracts: [string, Address][] = [
  ["IdentityRegistry", deployment.identityRegistry],
  ["P2PMarket", deployment.market.address],
  ["PaymentRouter", deployment.paymentRouter],
  [deployment.paymentToken.symbol, deployment.paymentToken.address],
  ...Object.entries(deployment.projects).flatMap(([slug, p]): [string, Address][] => [
    [`${slug} (token)`, p.token],
    [`${slug} (ronda)`, p.offering],
  ]),
];
const codes = await Promise.all(contracts.map(([, address]) => publicClient.getCode({ address })));
const missing = contracts.filter((_, i) => !codes[i] || codes[i] === "0x").map(([name, address]) => `${name} ${address}`);
if (missing.length > 0) problems.push(`Sin código en la red: ${missing.join(", ")}. ¿El deploy es de otra red o la red se reinició?`);
notes.push(`${contracts.length - missing.length} de ${contracts.length} contratos con código (deploy del ${deployment.deployedAt.slice(0, 10)}).`);

// Agente KYC ---------------------------------------------------------------------------------------
if (missing.length === 0) {
  const registry = await viem.getContractAt("IdentityRegistry", deployment.identityRegistry);
  const agentRole = await registry.read.AGENT_ROLE();
  const [isAgent, agentBalance] = await Promise.all([
    registry.read.hasRole([agentRole, deployment.kycAgent]),
    publicClient.getBalance({ address: deployment.kycAgent }),
  ]);
  notes.push(`Agente KYC ${deployment.kycAgent}: ${isAgent ? "con el rol" : "sin el rol"}, ${formatEther(agentBalance)} ${symbol} para el gas.`);
  if (!isAgent) problems.push(`El agente KYC ${deployment.kycAgent} no tiene AGENT_ROLE: no va a poder dar de alta inversores.`);
  if (chain.kind !== "local" && agentBalance === 0n) {
    problems.push(`El agente KYC ${deployment.kycAgent} no tiene ${symbol}: no va a poder pagar el gas de las altas.`);
  }

  // Proyectos ------------------------------------------------------------------------------------
  const catalog = new Map((await loadProjects()).map((p) => [p.slug, p]));
  const market = await viem.getContractAt("P2PMarket", deployment.market.address);
  for (const [slug, addresses] of Object.entries(deployment.projects)) {
    const offering = await viem.getContractAt("TokenOffering", addresses.offering);
    const token = await viem.getContractAt("AssetToken", addresses.token);
    const [state, raised, hardCap, transfers, orders] = await Promise.all([
      offering.read.state(),
      offering.read.totalRaised(),
      offering.read.hardCap(),
      token.read.transfersEnabled(),
      market.read.getActiveOrders([addresses.token]),
    ]);
    const sells = orders.filter((o) => o.side === 0);
    const buys = orders.filter((o) => o.side === 1);
    const bestAsk = sells.reduce<bigint | null>((best, o) => (best === null || o.price < best ? o.price : best), null);
    const bestBid = buys.reduce<bigint | null>((best, o) => (best === null || o.price > best ? o.price : best), null);
    const book =
      orders.length === 0
        ? "sin órdenes"
        : `${sells.length} ventas${bestAsk !== null ? ` (desde ${usd(bestAsk)})` : ""} y ${buys.length} compras${bestBid !== null ? ` (hasta ${usd(bestBid)})` : ""}`;
    notes.push(
      `${slug}: ronda ${STATE_LABEL[state] ?? state}, ${usd(raised)} de ${usd(hardCap)} ${deployment.paymentToken.symbol}; ` +
        `transferencias ${transfers ? "habilitadas" : "cerradas"}; mercado: ${book}.`,
    );

    // En testnet, los proyectos con mercado en la historia de demo tienen que quedar operables.
    const expectsMarket = chain.kind === "testnet" && catalog.get(slug)?.demo.market;
    if (expectsMarket) {
      if (state !== SUCCESSFUL) problems.push(`${slug}: la ronda quedó ${STATE_LABEL[state] ?? state} y la demo la espera exitosa. Corré la acción solo-datos-de-demo.`);
      else if (!transfers) problems.push(`${slug}: las transferencias siguen cerradas, así que el mercado no opera. Corré la acción solo-datos-de-demo.`);
      else if (orders.length === 0) problems.push(`${slug}: no hay órdenes publicadas en el mercado. Corré la acción solo-datos-de-demo.`);
    }
  }

  const deployer = getAddress(deployment.deployer);
  if (await registry.read.isVerified([deployer])) notes.push(`La billetera que desplegó (${deployer}) está dada de alta en el registro KYC.`);
}

// Resultado ------------------------------------------------------------------------------------------
const title = `Revisión de ${chain.name}`;
console.log(`\n${title} (${networkName}, chainId ${chainId})`);
for (const n of notes) console.log(`  ✓ ${n}`);
for (const p of problems) console.log(`  ✗ ${p}`);
if (problems.length === 0) console.log("Todo en orden.");

if (process.env.GITHUB_ACTIONS) {
  // Un aviso por línea: GitHub muestra hasta 10 de cada tipo por paso.
  for (const n of notes.slice(0, 10)) console.log(`::notice title=${title}::${n}`);
  for (const p of problems.slice(0, 10)) console.log(`::error title=${title}::${p}`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  const body = [...notes.map((n) => `- ${n}`), ...problems.map((p) => `- **Problema:** ${p}`)].join("\n");
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${title}\n\n${body}\n\n`);
}
if (problems.length > 0) process.exitCode = 1;
