"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getAddress } from "viem";
import { createSiweMessage } from "viem/siwe";
import { useAccount, useSignMessage } from "wagmi";
import { api } from "@/lib/api";
import { DEFAULT_CHAIN, isAppChain } from "@/lib/chains";

export type KycStatus = "NO_INICIADO" | "PENDIENTE" | "APROBADO" | "RECHAZADO";

/** Alta de la billetera en el IdentityRegistry de una red. */
export interface ChainVerificationInfo {
  chainId: number;
  name: string;
  verified: boolean;
  expiresAt: string | null;
  /** false si no se pudo leer la red (RPC caído o nodo local apagado). */
  reachable: boolean;
}

export interface SessionInfo {
  session: { address: string; chainId: number; expiresAt: string } | null;
  kyc?: {
    status: KycStatus;
    fullName: string | null;
    email: string | null;
    rejectionReason: string | null;
    expiresAt: string | null;
    /** Aprobada y vigente según el legajo. */
    active: boolean;
    simulatedProvider: boolean;
  };
  onchain?: ChainVerificationInfo[];
}

/** Estado de la billetera de la sesión en una red (undefined si no hay datos de esa red). */
export function verificationOn(info: SessionInfo | undefined, chainId: number | null | undefined) {
  return info?.onchain?.find((v) => v.chainId === chainId);
}

export const SESSION_KEY = ["session"] as const;

/** Sesión del servidor (cookie firmada) con el estado del legajo KYC y del registro on-chain. */
export function useSession() {
  const { address } = useAccount();
  const query = useQuery({
    queryKey: SESSION_KEY,
    queryFn: () => api<SessionInfo>("/api/auth/session"),
    staleTime: 5_000,
  });
  const sessionAddress = query.data?.session?.address;
  // La sesión es de una billetera: si el usuario cambió de cuenta, hay que volver a firmar.
  const matchesWallet = Boolean(sessionAddress && address && getAddress(sessionAddress) === getAddress(address));
  return { ...query, matchesWallet };
}

/**
 * Sign-In with Ethereum (EIP-4361): demuestra que el usuario controla la billetera sin mover
 * fondos. El servidor valida dominio, nonce de un solo uso, red y vencimiento del mensaje.
 * Una sesión sirve para todas las redes: la billetera es la misma en Polygon y en Ethereum.
 */
export function useSignIn() {
  const { address, chainId } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!address) throw new Error("Conectá tu billetera primero.");
      const { nonce } = await api<{ nonce: string }>("/api/auth/nonce");
      const now = new Date();
      const message = createSiweMessage({
        domain: window.location.host,
        uri: window.location.origin,
        address,
        // Se firma con la red en la que esté la billetera si es una de la app (no hace falta
        // cambiarla para ingresar); si no, con la red principal.
        chainId: isAppChain(chainId) ? chainId! : DEFAULT_CHAIN.id,
        nonce,
        version: "1",
        statement: "Ingresá a TokenARG con tu billetera. Esta firma no autoriza transacciones ni tiene costo.",
        issuedAt: now,
        expirationTime: new Date(now.getTime() + 10 * 60 * 1000),
      });
      const signature = await signMessageAsync({ message });
      return api<{ address: string; kycStatus: KycStatus }>("/api/auth/verify", { body: { message, signature } });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SESSION_KEY }),
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api("/api/auth/session", { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SESSION_KEY }),
  });
}
