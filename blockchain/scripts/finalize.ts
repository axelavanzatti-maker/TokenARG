/**
 * Cierra las rondas vencidas o con el cupo completo (cualquiera puede hacerlo).
 * Si alcanzaron el mínimo, los fondos pasan a la tesorería; si no, se habilitan los reembolsos.
 *
 * Uso: [SLUG=torre-cordoba-centro] npx hardhat run scripts/finalize.ts --network amoy
 */
import { network } from "hardhat";
import { confirm, loadDeployment } from "./lib/common.js";

const STATES = ["Próxima", "Abierta", "Cerrada (falta finalizar)", "Exitosa", "Fallida / cancelada"];

const { viem } = await network.create();
const publicClient = await viem.getPublicClient();
const deployment = await loadDeployment(await publicClient.getChainId());
const only = process.env.SLUG;

for (const [slug, d] of Object.entries(deployment.projects)) {
  if (only && only !== slug) continue;
  const offering = await viem.getContractAt("TokenOffering", d.offering);
  const state = await offering.read.state();
  if (state === 2) {
    await confirm(publicClient, offering.write.finalize());
    console.log(`${slug}: finalizada → ${STATES[await offering.read.state()]}`);
  } else {
    console.log(`${slug}: ${STATES[state]} (sin cambios)`);
  }
}
