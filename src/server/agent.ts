import "server-only";
import { createWalletClient, getAddress, http, type Address, type Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainById, serverRpcUrl } from "@/lib/chains";
import { identityRegistryAbi } from "@/lib/contracts/abis";
import { getPublicClient } from "@/server/chain";
import { activeDeployments, getDeployment } from "@/server/deployments";
import { HttpError } from "@/server/errors";

/**
 * Billetera del backend con AGENT_ROLE en el IdentityRegistry de cada red. Solo puede dar de
 * alta y de baja inversores: no tiene permisos sobre tokens ni fondos. Necesita un poco de
 * moneda nativa (POL/ETH) en cada red para pagar el gas. En producción, la clave va en un KMS.
 */
function agentAccount() {
  // MetaMask exporta la clave sin "0x": se acepta de las dos formas.
  const raw = process.env.KYC_AGENT_PRIVATE_KEY?.trim() ?? "";
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? `0x${raw}` : raw;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new HttpError(503, "KYC_AGENT_PRIVATE_KEY no está configurada o no es una clave válida", "chain_not_configured");
  }
  return privateKeyToAccount(key as `0x${string}`);
}

async function registryOf(chainId: number): Promise<Address> {
  const deployment = await getDeployment(chainId);
  if (!deployment) {
    throw new HttpError(503, `No hay contratos cargados para la red ${chainId}. Corré npm run chain:sync.`, "chain_not_configured");
  }
  return getAddress(deployment.identityRegistry);
}

// Las transacciones del agente se serializan por red para no pisar nonces entre pedidos.
const queues = new Map<number, Promise<unknown>>();
function serialize<T>(chainId: number, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(chainId) ?? Promise.resolve();
  const run = previous.then(task, task);
  queues.set(
    chainId,
    run.catch(() => undefined),
  );
  return run;
}

async function sendAndConfirm(chainId: number, write: () => Promise<Hash>): Promise<Hash> {
  return serialize(chainId, async () => {
    const hash = await write();
    const receipt = await getPublicClient(chainId).waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`La transacción ${hash} revirtió en la red ${chainId}`);
    return hash;
  });
}

function walletClient(chainId: number) {
  const chain = chainById(chainId);
  if (!chain) throw new HttpError(400, `Red no soportada: ${chainId}`, "unsupported_chain");
  return createWalletClient({ account: agentAccount(), chain, transport: http(serverRpcUrl(chain)) });
}

export async function whitelistInvestor(chainId: number, wallet: Address, validUntil: Date): Promise<Hash> {
  const address = await registryOf(chainId);
  const client = walletClient(chainId);
  const expiry = BigInt(Math.floor(validUntil.getTime() / 1000));
  return sendAndConfirm(chainId, () =>
    client.writeContract({ address, abi: identityRegistryAbi, functionName: "registerInvestor", args: [wallet, expiry] }),
  );
}

export async function removeInvestor(chainId: number, wallet: Address): Promise<Hash> {
  const address = await registryOf(chainId);
  const client = walletClient(chainId);
  return sendAndConfirm(chainId, () =>
    client.writeContract({ address, abi: identityRegistryAbi, functionName: "removeInvestor", args: [wallet] }),
  );
}

/** Estado on-chain de la verificación de una billetera en una red. */
export async function onchainVerification(chainId: number, wallet: Address) {
  const client = getPublicClient(chainId);
  const address = await registryOf(chainId);
  const [verified, expiry] = await Promise.all([
    client.readContract({ address, abi: identityRegistryAbi, functionName: "isVerified", args: [wallet] }),
    client.readContract({ address, abi: identityRegistryAbi, functionName: "verificationExpiry", args: [wallet] }),
  ]);
  return { verified, expiresAt: expiry > 0n ? new Date(Number(expiry) * 1000) : null };
}

export interface ChainVerification {
  chainId: number;
  name: string;
  verified: boolean;
  expiresAt: Date | null;
  /** false si no se pudo leer la red (RPC caído o nodo local apagado). */
  reachable: boolean;
}

/** Verificación de la billetera en cada red activa con contratos desplegados. */
export async function onchainVerifications(wallet: Address): Promise<ChainVerification[]> {
  const deployments = await activeDeployments();
  return Promise.all(
    deployments.map(async (d) => {
      const name = chainById(d.chainId)?.name ?? `Red ${d.chainId}`;
      try {
        const status = await onchainVerification(d.chainId, wallet);
        return { chainId: d.chainId, name, ...status, reachable: true };
      } catch {
        return { chainId: d.chainId, name, verified: false, expiresAt: null, reachable: false };
      }
    }),
  );
}
