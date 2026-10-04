"use client";

import { useCallback, useState } from "react";
import type { Hash, TransactionReceipt } from "viem";
import { useAccount, usePublicClient, useSwitchChain } from "wagmi";
import { chainName } from "@/lib/chains";
import { describeTxError } from "@/lib/contracts/errors";

/** Pide a la billetera que cambie a `target` (la red del proyecto) si está en otra. */
export function useEnsureChain(target: number) {
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  return useCallback(async () => {
    if (chainId === target) return;
    try {
      await switchChainAsync({ chainId: target });
    } catch (error) {
      if (error instanceof Error && /rejected|denied/i.test(error.message)) throw new Error("Cancelaste el cambio de red.");
      throw new Error(`Tu billetera no pudo cambiar a ${chainName(target)}. Agregala a mano (chainId ${target}) y volvé a intentar.`);
    }
  }, [chainId, switchChainAsync, target]);
}

export type ActionStatus = "idle" | "signing" | "confirming" | "success" | "error";

/**
 * Ejecuta una transacción de punta a punta en la red `chainId`: red correcta → firma →
 * confirmación. `send` debe simular antes de firmar (así los errores del contrato llegan
 * traducidos y la billetera no ofrece firmar algo que va a revertir).
 */
export function useContractAction(chainId: number) {
  const publicClient = usePublicClient({ chainId });
  const ensureChain = useEnsureChain(chainId);
  const [status, setStatus] = useState<ActionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<Hash | null>(null);

  const run = useCallback(
    async (send: () => Promise<Hash>): Promise<TransactionReceipt | null> => {
      setError(null);
      setHash(null);
      setStatus("signing");
      try {
        if (!publicClient) throw new Error("No hay conexión con la red.");
        await ensureChain();
        const txHash = await send();
        setHash(txHash);
        setStatus("confirming");
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        if (receipt.status !== "success") throw new Error("La transacción revirtió en la red.");
        setStatus("success");
        return receipt;
      } catch (e) {
        setError(describeTxError(e));
        setStatus("error");
        return null;
      }
    },
    [ensureChain, publicClient],
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
    setHash(null);
  }, []);

  return { run, status, error, hash, reset, busy: status === "signing" || status === "confirming" };
}
