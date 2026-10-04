import { createPublicClient, http, type PublicClient } from "viem";
import { APP_CHAINS, chainById, serverRpcUrl } from "@/lib/chains";
import { HttpError } from "@/server/errors";

export { OFFERING_STATE, type OfferingState } from "@/lib/offering";

const clients = new Map<number, PublicClient>();

/** Cliente de lectura por red. RPC_URL_<chainId> permite usar un endpoint privado. */
export function getPublicClient(chainId: number): PublicClient {
  const chain = chainById(chainId);
  if (!chain) throw new HttpError(400, `La red ${chainId} no está habilitada en esta app`, "unsupported_chain");
  let client = clients.get(chainId);
  if (!client) {
    client = createPublicClient({ chain, transport: http(serverRpcUrl(chain), { retryCount: 2 }) }) as PublicClient;
    clients.set(chainId, client);
  }
  return client;
}

export function appChainIds(): number[] {
  return APP_CHAINS.map((chain) => chain.id);
}
