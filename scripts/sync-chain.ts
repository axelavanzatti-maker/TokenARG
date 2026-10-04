/**
 * Importa las direcciones del último deploy de cada red activa
 * (blockchain/deployments/<chainId>.json) y sincroniza el índice de compras, reembolsos,
 * distribuciones y operaciones del mercado secundario desde la blockchain.
 *
 * Uso: npm run chain:sync
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { APP_CHAINS, NETWORK_MODE } from "@/lib/chains";
import { prisma } from "@/server/db";
import { importDeployment, syncAllProjects, type DeploymentFile } from "@/server/indexer";

const DEPLOYMENTS = path.resolve(import.meta.dirname, "..", "blockchain", "deployments");

async function main() {
  console.log(`Modo de red: ${NETWORK_MODE}`);
  let imported = 0;
  let failed = 0;

  // Cada red por separado: si una no responde, la otra se importa igual.
  for (const chain of APP_CHAINS) {
    const file = path.join(DEPLOYMENTS, `${chain.id}.json`);
    if (!existsSync(file)) {
      console.log(`- ${chain.name} (${chain.id}): sin deploy (${path.relative(process.cwd(), file)} no existe), se omite.`);
      continue;
    }
    const deployment = JSON.parse(await readFile(file, "utf8")) as DeploymentFile;
    console.log(`- ${chain.name} (${chain.id})`);
    try {
      for (const result of await importDeployment(deployment)) {
        if (!result.found) console.log(`  ! ${result.slug}: no está en la base (corré npm run db:seed)`);
        else if (result.changed) console.log(`  ↻ ${result.slug}: contratos nuevos o red reiniciada: índice rehecho`);
      }
      imported += 1;
    } catch (error) {
      failed += 1;
      console.log(`  ✗ no se pudo importar: ${error instanceof Error ? error.message.split("\n")[0] : error}`);
    }
  }

  if (imported === 0) {
    throw new Error("No se importó ningún deploy de las redes activas. Desplegá los contratos primero (por ejemplo, npm run demo:local).");
  }

  const { heads, report, markets, errors } = await syncAllProjects();
  for (const r of report) {
    console.log(`  ✓ [${r.chainId}] ${r.slug}: ${r.purchases} compras, ${r.refunds} reembolsos, ${r.distributions} distribuciones`);
  }
  for (const m of markets) console.log(`  ✓ [${m.chainId}] mercado secundario: ${m.trades} operaciones`);
  for (const [chainId, head] of Object.entries(heads)) console.log(`Red ${chainId} sincronizada hasta el bloque ${head}.`);
  for (const e of errors) console.log(`  ✗ [${e.chainId}] no se pudo sincronizar: ${e.error}`);
  if (failed > 0 || errors.length > 0) process.exitCode = 1;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await prisma.$disconnect();
    process.exit(1);
  });
