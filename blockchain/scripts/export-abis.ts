/**
 * Exporta los ABIs compilados a src/lib/contracts/abis.ts (con `as const`, para que viem y
 * wagmi infieran los tipos de cada función y evento en el frontend).
 *
 * Uso: npx hardhat run scripts/export-abis.ts   (compila antes de exportar)
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "./lib/common.js";

const CONTRACTS = [
  ["identityRegistryAbi", "IdentityRegistry.sol/IdentityRegistry.json"],
  ["assetTokenAbi", "AssetToken.sol/AssetToken.json"],
  ["tokenOfferingAbi", "TokenOffering.sol/TokenOffering.json"],
  ["p2pMarketAbi", "P2PMarket.sol/P2PMarket.json"],
  ["paymentRouterAbi", "payments/PaymentRouter.sol/PaymentRouter.json"],
  ["mockUsdcAbi", "mocks/MockUSDC.sol/MockUSDC.json"],
  ["mockErc20Abi", "mocks/MockERC20.sol/MockERC20.json"],
] as const;

const artifactsDir = path.resolve(import.meta.dirname, "..", "artifacts", "contracts");
const target = path.join(REPO_ROOT, "src", "lib", "contracts", "abis.ts");

let out = "// Archivo generado por blockchain/scripts/export-abis.ts. No editar a mano.\n";
out += "// Regenerar con: npm run abis\n";
for (const [name, file] of CONTRACTS) {
  const artifact = JSON.parse(await readFile(path.join(artifactsDir, file), "utf8")) as { abi: unknown[] };
  out += `\nexport const ${name} = ${JSON.stringify(artifact.abi, null, 2)} as const;\n`;
}
await writeFile(target, out);
console.log(`ABIs exportados a ${path.relative(REPO_ROOT, target)}`);
