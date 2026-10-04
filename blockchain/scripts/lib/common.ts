import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Address, Hash, Hex, PublicClient } from "viem";

/** Raíz del repositorio (este archivo vive en blockchain/scripts/lib). */
export const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
export const DEPLOYMENTS_DIR = path.resolve(import.meta.dirname, "..", "..", "deployments");
export const CONFIG_DIR = path.resolve(import.meta.dirname, "..", "..", "config");

export const DAY = 86_400n;

export type NetworkFamily = "polygon" | "ethereum";

/** Cada chainId soportado: a qué familia pertenece y si es local, testnet o producción. */
export const CHAINS: Record<number, { family: NetworkFamily; kind: "local" | "testnet" | "mainnet"; name: string }> = {
  31337: { family: "polygon", kind: "local", name: "Polygon (red local)" },
  31338: { family: "ethereum", kind: "local", name: "Ethereum (red local)" },
  80002: { family: "polygon", kind: "testnet", name: "Polygon Amoy" },
  11155111: { family: "ethereum", kind: "testnet", name: "Ethereum Sepolia" },
  137: { family: "polygon", kind: "mainnet", name: "Polygon" },
  1: { family: "ethereum", kind: "mainnet", name: "Ethereum" },
};

export function chainInfo(chainId: number) {
  const info = CHAINS[chainId];
  if (!info) throw new Error(`Red no soportada: chainId ${chainId}`);
  return info;
}

/** Subconjunto de data/projects.json que usa la capa on-chain. */
export interface ProjectData {
  slug: string;
  title: string;
  network: NetworkFamily;
  status: "PROXIMAMENTE" | "FONDEANDO" | "FINALIZADO" | "LIQUIDADO" | "CANCELADO";
  targetAmountUSD: number;
  softCapUSD: number;
  minTicketUSD: number;
  tokenPriceUSD: number;
  estimatedIrr: number;
  assetValuationUSD: number;
  offering: { opensInDays: number; closesInDays: number };
  demo: {
    fundedPct: number;
    distributions: { daysAgo: number; amountUSD: number }[];
    market?: {
      startsDaysAgo: number;
      startPrice: number;
      endPrice: number;
      volatility: number;
      trades: number;
      openOrders: number;
    };
  };
  token: { name: string; symbol: string };
  documents: { type: string; title: string; file: string }[];
}

export interface ProjectDeployment {
  token: Address;
  offering: Address;
  documentHash: Hex;
  startTime: number;
  endTime: number;
}

/** Moneda con la que se puede pagar una inversión (además de USDC). */
export interface PaymentAsset {
  symbol: string;
  name: string;
  /** "native" = moneda de la red (ETH en Ethereum, POL en Polygon). */
  address: Address | "native";
  decimals: number;
  /** Solo testnet: el token de prueba tiene canilla. */
  isMock: boolean;
}

export interface Deployment {
  chainId: number;
  family: NetworkFamily;
  network: string;
  deployedAt: string;
  deployer: Address;
  startBlock: number;
  paymentToken: { address: Address; symbol: string; decimals: number; isMock: boolean };
  paymentAssets: PaymentAsset[];
  identityRegistry: Address;
  kycAgent: Address;
  treasury: Address;
  admin: Address;
  market: { address: Address; feeRecipient: Address; buyerFeeBps: number; sellerFeeBps: number; minOrderValueUSD: number };
  paymentRouter: Address;
  swapAdapter: { address: Address; kind: "mock" | "uniswap-v3" };
  projects: Record<string, ProjectDeployment>;
}

export async function loadProjects(): Promise<ProjectData[]> {
  return JSON.parse(await readFile(path.join(REPO_ROOT, "data", "projects.json"), "utf8")) as ProjectData[];
}

/** SHA-256 del PDF servido en public/docs: es lo que se ancla on-chain como legalDocumentHash. */
export async function sha256OfPublicFile(relativeToDocs: string): Promise<Hex> {
  const file = path.join(REPO_ROOT, "public", "docs", relativeToDocs);
  if (!existsSync(file)) {
    throw new Error(`No existe ${file}. Generá los documentos con: python3 scripts/generate-sample-docs.py`);
  }
  return `0x${createHash("sha256").update(await readFile(file)).digest("hex")}`;
}

export function primaryDocument(project: ProjectData) {
  const doc = project.documents.find((d) => d.type === "CONTRATO_FIDEICOMISO") ?? project.documents[0];
  if (!doc) throw new Error(`El proyecto ${project.slug} no tiene documentos`);
  return doc;
}

export function deploymentPath(chainId: number) {
  return path.join(DEPLOYMENTS_DIR, `${chainId}.json`);
}

export async function saveDeployment(deployment: Deployment) {
  await mkdir(DEPLOYMENTS_DIR, { recursive: true });
  await writeFile(deploymentPath(deployment.chainId), JSON.stringify(deployment, null, 2) + "\n");
}

export async function loadDeployment(chainId: number): Promise<Deployment> {
  const file = deploymentPath(chainId);
  if (!existsSync(file)) {
    throw new Error(`No hay deploy para la red ${chainId}. Corré primero scripts/deploy.ts`);
  }
  return JSON.parse(await readFile(file, "utf8")) as Deployment;
}

export interface MainnetConfig {
  usdc: Address;
  uniswapSwapRouter02: Address;
  uniswapQuoterV2: Address;
  wrappedNative: Address;
  assets: { symbol: string; name: string; address: Address | "native"; decimals: number; poolFee: number }[];
}

export async function loadMainnetConfig(chainId: number): Promise<MainnetConfig> {
  const all = JSON.parse(await readFile(path.join(CONFIG_DIR, "mainnet.json"), "utf8")) as Record<string, MainnetConfig>;
  const config = all[String(chainId)];
  if (!config) throw new Error(`Falta la configuración de producción para chainId ${chainId} en config/mainnet.json`);
  return config;
}

/** Espera la confirmación de una transacción y falla si revirtió. */
export async function confirm(publicClient: PublicClient, hash: Hash | Promise<Hash>) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash: await hash });
  if (receipt.status !== "success") throw new Error(`La transacción ${receipt.transactionHash} revirtió`);
  return receipt;
}

/** Montos en USD (número) → unidades de un token de 6 decimales. */
export function usdToUnits(amount: number, decimals = 6): bigint {
  const [whole, fraction = ""] = amount.toFixed(decimals).split(".");
  return BigInt(whole + fraction.padEnd(decimals, "0"));
}

/** Segundos UNIX del reloj real (no del bloque): las ventanas de las rondas se fijan con este. */
export function wallClockSeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}
