/**
 * Control previo al deploy en una red pública: muestra la billetera que despliega y corta con
 * un mensaje claro si no le alcanza el saldo para el gas (un deploy completo usa ~19 M de gas).
 *
 * Uso: npx hardhat run scripts/preflight.ts --network amoy | sepolia
 */
import { appendFileSync } from "node:fs";
import { network } from "hardhat";
import { formatEther, formatGwei } from "viem";
import { chainInfo } from "./lib/common.js";

/** Gas medido en un deploy completo en la red local (19 M) más margen. */
const DEPLOY_GAS = 22_000_000n;
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
const needed = (DEPLOY_GAS * gasPrice * 13n) / 10n;

const lines = [
  `Red: ${chain.name} (${networkName}, chainId ${chainId})`,
  `Billetera que despliega: ${address}`,
  `Saldo: ${formatEther(balance)} ${symbol}`,
  `Gas: ${formatGwei(gasPrice)} gwei → el deploy necesita ~${formatEther(needed)} ${symbol}`,
];
console.log(lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Control previo: ${chain.name}\n\n${lines.map((l) => `- ${l}`).join("\n")}\n\n`);
}

if (balance < needed) {
  const faucet = FAUCETS[chainId];
  console.error(
    `\nSaldo insuficiente: faltan ~${formatEther(needed - balance)} ${symbol}.` +
      (faucet ? ` Cargá ${symbol} de prueba en ${faucet} para ${address} y volvé a correr el deploy.` : ""),
  );
  process.exitCode = 1;
}
