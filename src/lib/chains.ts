import { defineChain, type Chain } from "viem";
import { mainnet, polygon, polygonAmoy, sepolia } from "viem/chains";

/**
 * Redes de TokenARG. Cada proyecto vive en una red de una "familia" (Polygon o Ethereum) y la
 * app opera en un modo: local (dos nodos de Hardhat), testnet (Amoy + Sepolia) o mainnet.
 */
export type NetworkFamily = "polygon" | "ethereum";
export type NetworkMode = "local" | "testnet" | "mainnet";

export const polygonLocal = defineChain({
  id: 31337,
  name: "Polygon (red local)",
  nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  testnet: true,
});

export const ethereumLocal = defineChain({
  id: 31338,
  name: "Ethereum (red local)",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8546"] } },
  testnet: true,
});

const CHAINS_BY_MODE: Record<NetworkMode, Record<NetworkFamily, Chain>> = {
  local: { polygon: polygonLocal, ethereum: ethereumLocal },
  testnet: { polygon: polygonAmoy, ethereum: sepolia },
  mainnet: { polygon, ethereum: mainnet },
};

const mode = process.env.NEXT_PUBLIC_NETWORK_MODE;
export const NETWORK_MODE: NetworkMode = mode === "testnet" || mode === "mainnet" ? mode : "local";

/** Redes activas de la app: [Polygon, Ethereum] del modo configurado. */
export const APP_CHAINS = [CHAINS_BY_MODE[NETWORK_MODE].polygon, CHAINS_BY_MODE[NETWORK_MODE].ethereum] as const;
export const DEFAULT_CHAIN: Chain = APP_CHAINS[0];
export const IS_TESTNET = NETWORK_MODE !== "mainnet";

export const NETWORK_LABEL: Record<NetworkFamily, string> = { polygon: "Polygon", ethereum: "Ethereum" };

/** Color de identificación de cada red (un punto junto al nombre, nunca el texto). */
export const NETWORK_COLOR: Record<NetworkFamily, string> = { polygon: "#7b3fe4", ethereum: "#4c63c9" };

/** Etiqueta del modo para avisos: los activos de prueba no tienen valor. */
export const MODE_LABEL: Record<NetworkMode, string> = {
  local: "Redes locales de prueba",
  testnet: "Testnet: Amoy y Sepolia",
  mainnet: "Mainnet",
};

/** Canilla oficial de la moneda nativa de prueba (para pagar el gas en testnet). */
export const NATIVE_FAUCET: Record<number, { label: string; url: string } | undefined> = {
  80002: { label: "la canilla de Polygon", url: "https://faucet.polygon.technology/" },
  11155111: { label: "la canilla de Sepolia de Google Cloud", url: "https://cloud.google.com/application/web3/faucet/ethereum/sepolia" },
};

export function chainForFamily(family: NetworkFamily): Chain {
  return CHAINS_BY_MODE[NETWORK_MODE][family];
}

export function chainById(chainId: number | null | undefined): Chain | undefined {
  return APP_CHAINS.find((chain) => chain.id === chainId);
}

export function isAppChain(chainId: number | null | undefined): boolean {
  return chainById(chainId) !== undefined;
}

/** Nombre de la red para mostrar ("Polygon (red local)", "Polygon Amoy", "Sepolia"…). */
export function chainName(chainId: number | null | undefined): string {
  return chainById(chainId)?.name ?? (chainId ? `Red ${chainId}` : "Red sin configurar");
}

export function familyOfChain(chainId: number): NetworkFamily | undefined {
  if (APP_CHAINS[0].id === chainId) return "polygon";
  if (APP_CHAINS[1].id === chainId) return "ethereum";
  return undefined;
}

// Next.js solo inyecta en el navegador las variables NEXT_PUBLIC_* escritas literalmente.
const PUBLIC_RPC: Record<number, string | undefined> = {
  31337: process.env.NEXT_PUBLIC_RPC_URL_31337,
  31338: process.env.NEXT_PUBLIC_RPC_URL_31338,
  80002: process.env.NEXT_PUBLIC_RPC_URL_80002,
  11155111: process.env.NEXT_PUBLIC_RPC_URL_11155111,
  137: process.env.NEXT_PUBLIC_RPC_URL_137,
  1: process.env.NEXT_PUBLIC_RPC_URL_1,
};

/** RPC para el navegador. En producción conviene uno propio (Alchemy, Infura, QuickNode). */
export function publicRpcUrl(chain: Chain): string {
  return PUBLIC_RPC[chain.id] || chain.rpcUrls.default.http[0]!;
}

/** RPC para el servidor: RPC_URL_<chainId> si está definida (privado), si no el público. */
export function serverRpcUrl(chain: Chain): string {
  return process.env[`RPC_URL_${chain.id}`] || publicRpcUrl(chain);
}

export function explorerTxUrl(chainId: number, hash: string) {
  const url = chainById(chainId)?.blockExplorers?.default.url;
  return url ? `${url}/tx/${hash}` : undefined;
}

export function explorerAddressUrl(chainId: number, address: string) {
  const url = chainById(chainId)?.blockExplorers?.default.url;
  return url ? `${url}/address/${address}` : undefined;
}
