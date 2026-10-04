import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

// Las variables `configVariable(...)` se leen de variables de entorno o del keystore cifrado
// de Hardhat (`npx hardhat keystore set DEPLOYER_PRIVATE_KEY`). Solo se resuelven cuando
// se usa la red correspondiente, así que no hacen falta para compilar ni para testear.

const solc = {
  version: "0.8.28",
  settings: {
    // Polygon PoS y Ethereum soportan Cancun. Se fija explícitamente para que un cambio de
    // versión de solc no cambie el bytecode objetivo sin que nos enteremos.
    evmVersion: "cancun",
    optimizer: { enabled: true, runs: 200 },
  },
};

/**
 * Los dos nodos locales de la demo arrancan con la fecha de hace 120 días: así la simulación
 * puede "vivir" la historia (rondas, rentas, mercado secundario con precios que cambian) y
 * terminar en la fecha de hoy. Ver scripts/simulate-activity.ts.
 */
const DEMO_HISTORY_DAYS = 120;
const demoStart = new Date(Date.now() - DEMO_HISTORY_DAYS * 86_400_000);

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: solc,
      production: solc,
    },
  },
  networks: {
    // --- Nodos locales: `npm run chain:node` levanta los dos ---------------------------------
    polygonLocal: { type: "edr-simulated", chainType: "l1", chainId: 31337, initialDate: demoStart },
    ethereumLocal: { type: "edr-simulated", chainType: "l1", chainId: 31338, initialDate: demoStart },
    // Conexión a esos nodos para desplegar y simular
    localhost: { type: "http", chainType: "l1", url: "http://127.0.0.1:8545" },
    localhostEthereum: { type: "http", chainType: "l1", url: "http://127.0.0.1:8546" },

    // --- Testnets ------------------------------------------------------------------------------
    // Polygon Amoy (chainId 80002)
    amoy: {
      type: "http",
      chainType: "l1",
      url: configVariable("AMOY_RPC_URL"),
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
    },
    // Ethereum Sepolia (chainId 11155111)
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
    },

    // --- Redes principales (solo después de auditar) ------------------------------------------
    polygon: {
      type: "http",
      chainType: "l1",
      url: configVariable("POLYGON_RPC_URL"),
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
    },
    ethereum: {
      type: "http",
      chainType: "l1",
      url: configVariable("ETHEREUM_RPC_URL"),
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
    },
  },
  verify: {
    // Etherscan API V2: una sola API key sirve para Etherscan y Polygonscan (mainnet y testnets).
    etherscan: {
      apiKey: configVariable("ETHERSCAN_API_KEY"),
    },
  },
});
