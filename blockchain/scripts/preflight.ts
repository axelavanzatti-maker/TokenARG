/**
 * Control previo al deploy en una red pública: muestra la billetera que despliega y corta con
 * un mensaje claro si no le alcanza el saldo para el gas. Un deploy completo usa ~19 M de gas y
 * los datos de demo (seed-testnet.ts) ~2,2 M más; además, en testnet el deployer le pasa gas al
 * agente KYC si es otra billetera.
 *
 * Uso: npx hardhat run scripts/preflight.ts --network amoy | sepolia
 *      (WITH_DEMO=0 si no se van a cargar los datos de demo)
 */
import { appendFileSync } from "node:fs";
import { network } from "hardhat";
import { formatEther, formatGwei, getAddress, isAddress, parseEther } from "viem";
import { chainInfo } from "./lib/common.js";

/** Gas medido en un nodo local con los proyectos de Polygon: deploy 18,8 M; datos de demo 2,2 M. */
const DEPLOY_GAS = 19_000_000n;
const DEMO_GAS = 2_500_000n;
/** En Amoy el gas suele estar entre 25 y 35 gwei; por encima, conviene esperar a que baje. */
const AMOY_USUAL_GWEI = 35n;
const FAUCETS: Record<number, string> = {
  80002: "https://faucet.polygon.technology/",
  11155111: "https://cloud.google.com/application/web3/faucet/ethereum/sepolia",
};

const { viem, networkName } = await network.create();
const client = await viem.getPublicClient();
const [wallet] = await viem.getWalletClients();
if (!wallet) throw new Error("No hay billetera para desplegar: configurá DEPLOYER_PRIVATE_KEY.");

const address = wallet.account.address;
const [chainId, balance, gasPrice] = await Promise.all([client.getChainId(), client.getBalance({ address }), client.getGasPrice()]);
const chain = chainInfo(chainId);
const symbol = chain.family === "polygon" ? "POL" : "ETH";
const withDemo = process.env.WITH_DEMO !== "0" && chain.kind === "testnet";
const agent = process.env.KYC_AGENT_ADDRESS?.trim();
const agentTopUp =
  chain.kind === "testnet" && agent && isAddress(agent) && getAddress(agent) !== getAddress(address)
    ? parseEther(process.env.AGENT_GAS_TOPUP ?? (chain.family === "polygon" ? "0.2" : "0.01"))
    : 0n;
// 30 % de margen: el precio del gas cambia entre el control y el deploy.
const needed = ((DEPLOY_GAS + (withDemo ? DEMO_GAS : 0n)) * gasPrice * 13n) / 10n + agentTopUp;

const lines = [
  `Red: ${chain.name} (${networkName}, chainId ${chainId})`,
  `Billetera que despliega: ${address}`,
  `Saldo: ${formatEther(balance)} ${symbol}`,
  `Gas: ${formatGwei(gasPrice)} gwei → hacen falta ~${formatEther(needed)} ${symbol}` +
    `${withDemo ? " (con los datos de demo)" : ""}${agentTopUp > 0n ? ` (incluye ${formatEther(agentTopUp)} ${symbol} para el agente KYC)` : ""}`,
];
console.log(lines.join("\n"));
// En GitHub Actions, además, como aviso visible en el resumen de la corrida.
if (process.env.GITHUB_ACTIONS) console.log(`::notice title=Gas en ${chain.name}::${lines.slice(1).join(" · ")}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Control previo: ${chain.name}\n\n${lines.map((l) => `- ${l}`).join("\n")}\n\n`);
}

if (balance < needed) {
  const faucet = FAUCETS[chainId];
  const expensive = chain.family === "polygon" && gasPrice > AMOY_USUAL_GWEI * 10n ** 9n;
  const message =
    `Saldo insuficiente en ${chain.name}: faltan ~${formatEther(needed - balance)} ${symbol}.` +
    (faucet ? ` Cargá ${symbol} de prueba en ${faucet} para ${address} y volvé a correr el deploy.` : "") +
    (expensive ? ` Ahora el gas está caro (${formatGwei(gasPrice)} gwei; lo habitual es 25 a 35): si baja, alcanza con menos.` : "");
  console.error(`\n${message}`);
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=Falta gas en ${chain.name}::${message}`);
  process.exitCode = 1;
}
