/**
 * Deposita una distribución (renta, intereses o liquidación) para los tenedores de un proyecto.
 * La cuenta que firma necesita DISTRIBUTOR_ROLE en el token y saldo de USDC.
 * En redes de prueba con MockUSDC, acuña el monto antes de distribuir.
 *
 * Uso: SLUG=pagare-logistica-rosario AMOUNT_USD=1275 npx hardhat run scripts/distribute.ts --network amoy
 */
import { network } from "hardhat";
import { confirm, loadDeployment, usdToUnits } from "./lib/common.js";

const slug = process.env.SLUG;
const amountUSD = Number(process.env.AMOUNT_USD);
if (!slug || !Number.isFinite(amountUSD) || amountUSD <= 0) {
  throw new Error("Indicá SLUG y AMOUNT_USD, por ejemplo: SLUG=pagare-logistica-rosario AMOUNT_USD=1275");
}

const { viem } = await network.create();
const publicClient = await viem.getPublicClient();
const [signer] = await viem.getWalletClients();
const deployment = await loadDeployment(await publicClient.getChainId());
const d = deployment.projects[slug];
if (!d || !signer) throw new Error(`No hay deploy para ${slug} en esta red`);

const token = await viem.getContractAt("AssetToken", d.token);
const usdc = await viem.getContractAt("MockUSDC", deployment.paymentToken.address);
const amount = usdToUnits(amountUSD);

if (deployment.paymentToken.isMock) {
  await confirm(publicClient, usdc.write.mint([signer.account.address, amount]));
}
await confirm(publicClient, usdc.write.approve([token.address, amount]));
await confirm(publicClient, token.write.distribute([amount]));

console.log(`${slug}: distribución de USD ${amountUSD} depositada. Total histórico: USD ${
  Number(await token.read.totalDistributed()) / 1e6
}`);
