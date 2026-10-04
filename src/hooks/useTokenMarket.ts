"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { erc20Abi, getAddress, type Address, type Hash, type TransactionReceipt } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { api } from "@/lib/api";
import { assetTokenAbi, identityRegistryAbi, p2pMarketAbi } from "@/lib/contracts/abis";
import { describeTxError } from "@/lib/contracts/errors";
import { buyerAllowanceNeeded, fillProblem, tradeValue, type MarketOrder, type OrderSide } from "@/lib/market";
import { useEnsureChain } from "./useContractAction";

const REFRESH_MS = 12_000;

export interface MarketBook {
  listed: boolean;
  transfersEnabled: boolean;
  paused: boolean;
  buyerFeeBps: number;
  sellerFeeBps: number;
  minOrderValue: bigint;
  /** Órdenes de venta (quien las toma compra), de menor a mayor precio. */
  asks: MarketOrder[];
  /** Órdenes de compra (quien las toma vende), de mayor a menor precio. */
  bids: MarketOrder[];
  identityRegistry: Address;
}

export interface MarketAccount {
  verified: boolean;
  tokenBalance: bigint;
  usdcBalance: bigint;
  tokenAllowance: bigint;
  usdcAllowance: bigint;
  /** Tokens comprometidos en órdenes de venta activas de esta billetera. */
  sellCommitted: bigint;
  /** USDC (sin comisión) comprometidos en órdenes de compra activas. */
  buyCommittedValue: bigint;
  gasBalance: bigint;
}

export type MarketTxStep = "idle" | "approving" | "signing" | "confirming" | "recording" | "done" | "error";

/**
 * Una operación del mercado de punta a punta: red correcta → autorización (si falta) → firma →
 * confirmación → registro en el índice. Cada formulario usa la suya, así los estados no se mezclan.
 */
export function useMarketTx(chainId: number) {
  const publicClient = usePublicClient({ chainId });
  const ensureChain = useEnsureChain(chainId);
  const { writeContractAsync } = useWriteContract();
  const [step, setStep] = useState<MarketTxStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<Hash | null>(null);

  const run = useCallback(
    async ({
      approve,
      send,
      record,
    }: {
      /** Autorización previa: solo se pide si la actual no alcanza. */
      approve?: { token: Address; spender: Address; amount: bigint; current: bigint; symbol: string };
      /** Simula y envía la transacción principal. */
      send: () => Promise<Hash>;
      /** Registro en el índice (si falla, la sincronización periódica lo recupera). */
      record?: (hash: Hash) => Promise<unknown>;
    }): Promise<TransactionReceipt | null> => {
      setError(null);
      setHash(null);
      try {
        if (!publicClient) throw new Error("No hay conexión con la red.");
        setStep("signing");
        await ensureChain();
        if (approve && approve.current < approve.amount) {
          setStep("approving");
          const approveHash = await writeContractAsync({
            address: approve.token,
            abi: erc20Abi,
            functionName: "approve",
            args: [approve.spender, approve.amount],
            chainId,
          });
          setHash(approveHash);
          const approval = await publicClient.waitForTransactionReceipt({ hash: approveHash });
          if (approval.status !== "success") throw new Error(`La autorización de ${approve.symbol} revirtió.`);
          setHash(null);
        }
        setStep("signing");
        const txHash = await send();
        setHash(txHash);
        setStep("confirming");
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        if (receipt.status !== "success") throw new Error("La operación revirtió en la red.");
        if (record) {
          setStep("recording");
          await record(txHash).catch(() => undefined);
        }
        setStep("done");
        return receipt;
      } catch (e) {
        setError(describeTxError(e));
        setStep("error");
        return null;
      }
    },
    [chainId, ensureChain, publicClient, writeContractAsync],
  );

  const reset = useCallback(() => {
    setStep("idle");
    setError(null);
    setHash(null);
  }, []);

  /** Muestra un problema detectado antes de firmar (sin mandar nada a la billetera). */
  const fail = useCallback((message: string) => {
    setHash(null);
    setError(message);
    setStep("error");
    return null;
  }, []);

  const busy = step === "approving" || step === "signing" || step === "confirming" || step === "recording";
  return { run, step, error, hash, reset, fail, busy };
}

const toOrder = (o: {
  id: bigint;
  maker: Address;
  side: number;
  price: bigint;
  amount: bigint;
  remaining: bigint;
  fillable: bigint;
  createdAt: bigint;
}): MarketOrder => ({
  id: o.id,
  maker: getAddress(o.maker),
  side: o.side === 0 ? "sell" : "buy",
  price: o.price,
  amount: o.amount,
  remaining: o.remaining,
  fillable: o.fillable,
  createdAt: Number(o.createdAt) * 1000,
});

/**
 * Libro de órdenes P2P de un token (leído de la blockchain) y lo que la billetera conectada
 * puede operar, con las acciones: tomar una orden, publicar una y retirarla.
 */
export function useTokenMarket({
  chainId,
  market,
  token,
  tokenSymbol,
  paymentToken,
}: {
  chainId: number;
  market: Address;
  token: Address;
  tokenSymbol: string;
  paymentToken: Address;
}) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId });
  const queryClient = useQueryClient();
  const { writeContractAsync } = useWriteContract();

  const bookQuery = useQuery({
    queryKey: ["market-book", chainId, market, token],
    enabled: Boolean(publicClient),
    refetchInterval: REFRESH_MS,
    queryFn: async (): Promise<MarketBook> => {
      const client = publicClient!;
      const [orders, listed, transfersEnabled, paused, buyerFeeBps, sellerFeeBps, minOrderValue, identityRegistry] = await Promise.all([
        client.readContract({ address: market, abi: p2pMarketAbi, functionName: "getActiveOrders", args: [token] }),
        client.readContract({ address: market, abi: p2pMarketAbi, functionName: "isListed", args: [token] }),
        client.readContract({ address: token, abi: assetTokenAbi, functionName: "transfersEnabled" }),
        client.readContract({ address: market, abi: p2pMarketAbi, functionName: "paused" }),
        client.readContract({ address: market, abi: p2pMarketAbi, functionName: "buyerFeeBps" }),
        client.readContract({ address: market, abi: p2pMarketAbi, functionName: "sellerFeeBps" }),
        client.readContract({ address: market, abi: p2pMarketAbi, functionName: "minOrderValue" }),
        client.readContract({ address: token, abi: assetTokenAbi, functionName: "identityRegistry" }),
      ]);
      const all = orders.map(toOrder);
      const byPrice = (a: MarketOrder, b: MarketOrder) => (a.price === b.price ? Number(a.id - b.id) : a.price < b.price ? -1 : 1);
      return {
        listed,
        transfersEnabled,
        paused,
        buyerFeeBps: Number(buyerFeeBps),
        sellerFeeBps: Number(sellerFeeBps),
        minOrderValue,
        asks: all.filter((o) => o.side === "sell").sort(byPrice),
        bids: all.filter((o) => o.side === "buy").sort((a, b) => byPrice(b, a)),
        identityRegistry: getAddress(identityRegistry),
      };
    },
  });

  const registry = bookQuery.data?.identityRegistry;
  const accountQuery = useQuery({
    queryKey: ["market-account", chainId, market, token, address],
    enabled: Boolean(publicClient && address && registry),
    refetchInterval: REFRESH_MS,
    queryFn: async (): Promise<MarketAccount> => {
      const client = publicClient!;
      const me = address!;
      const [verified, tokenBalance, usdcBalance, tokenAllowance, usdcAllowance, sellCommitted, buyCommittedValue, gasBalance] =
        await Promise.all([
          client.readContract({ address: registry!, abi: identityRegistryAbi, functionName: "isVerified", args: [me] }),
          client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [me] }),
          client.readContract({ address: paymentToken, abi: erc20Abi, functionName: "balanceOf", args: [me] }),
          client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [me, market] }),
          client.readContract({ address: paymentToken, abi: erc20Abi, functionName: "allowance", args: [me, market] }),
          client.readContract({ address: market, abi: p2pMarketAbi, functionName: "sellCommitted", args: [me, token] }),
          client.readContract({ address: market, abi: p2pMarketAbi, functionName: "buyCommittedValue", args: [me] }),
          client.getBalance({ address: me }),
        ]);
      return { verified, tokenBalance, usdcBalance, tokenAllowance, usdcAllowance, sellCommitted, buyCommittedValue, gasBalance };
    },
  });

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["market-book", chainId, market, token] }),
      queryClient.invalidateQueries({ queryKey: ["market-account", chainId, market, token] }),
      // La posición del panel de inversión (tokens y USDC) también cambia.
      queryClient.invalidateQueries({ queryKey: ["investor", chainId] }),
    ]);
  }, [chainId, market, queryClient, token]);

  /** Registra en el índice las operaciones de la transacción (el servidor relee el recibo). */
  const recordFill = useCallback((hash: Hash) => api("/api/market/trades", { body: { chainId, txHash: hash } }), [chainId]);

  /** Toma `amount` tokens de una orden: si es de venta, comprás; si es de compra, vendés. */
  const take = useCallback(
    async (tx: ReturnType<typeof useMarketTx>, order: MarketOrder, amount: bigint) => {
      const [{ data: book }, { data: me }] = await Promise.all([bookQuery.refetch(), accountQuery.refetch()]);
      if (!book || !me || !address) return null;
      const fresh = [...book.asks, ...book.bids].find((o) => o.id === order.id) ?? order;
      const problem = fillProblem(fresh, amount);
      if (problem) return tx.fail(problem);
      if (!me.verified) return tx.fail("Tu billetera no tiene una verificación de identidad vigente en esta red.");
      const value = tradeValue(amount, fresh.price);
      const approve =
        fresh.side === "sell"
          ? {
              token: paymentToken,
              spender: market,
              amount: buyerAllowanceNeeded(me.buyCommittedValue, value, book.buyerFeeBps),
              current: me.usdcAllowance,
              symbol: "USDC",
            }
          : { token, spender: market, amount: me.sellCommitted + amount, current: me.tokenAllowance, symbol: tokenSymbol };
      const receipt = await tx.run({
        approve,
        send: async () => {
          await publicClient!.simulateContract({ account: address, address: market, abi: p2pMarketAbi, functionName: "fillOrder", args: [fresh.id, amount] });
          return writeContractAsync({ address: market, abi: p2pMarketAbi, functionName: "fillOrder", args: [fresh.id, amount], chainId });
        },
        record: recordFill,
      });
      await refresh();
      return receipt;
    },
    [accountQuery, address, bookQuery, chainId, market, paymentToken, publicClient, recordFill, refresh, token, tokenSymbol, writeContractAsync],
  );

  /** Publica una orden con precio fijo. No inmoviliza fondos: autoriza al mercado. */
  const create = useCallback(
    async (tx: ReturnType<typeof useMarketTx>, side: OrderSide, amount: bigint, price: bigint) => {
      const [{ data: book }, { data: me }] = await Promise.all([bookQuery.refetch(), accountQuery.refetch()]);
      if (!book || !me || !address) return null;
      const value = tradeValue(amount, price);
      const approve =
        side === "sell"
          ? { token, spender: market, amount: me.sellCommitted + amount, current: me.tokenAllowance, symbol: tokenSymbol }
          : {
              token: paymentToken,
              spender: market,
              amount: buyerAllowanceNeeded(me.buyCommittedValue, value, book.buyerFeeBps),
              current: me.usdcAllowance,
              symbol: "USDC",
            };
      if (!me.verified) return tx.fail("Tu billetera no tiene una verificación de identidad vigente en esta red.");
      const sideIndex = side === "sell" ? 0 : 1;
      const receipt = await tx.run({
        approve,
        send: async () => {
          await publicClient!.simulateContract({
            account: address,
            address: market,
            abi: p2pMarketAbi,
            functionName: "createOrder",
            args: [token, sideIndex, amount, price],
          });
          return writeContractAsync({ address: market, abi: p2pMarketAbi, functionName: "createOrder", args: [token, sideIndex, amount, price], chainId });
        },
      });
      await refresh();
      return receipt;
    },
    [accountQuery, address, bookQuery, chainId, market, paymentToken, publicClient, refresh, token, tokenSymbol, writeContractAsync],
  );

  /** Retira una orden propia. */
  const cancel = useCallback(
    async (tx: ReturnType<typeof useMarketTx>, order: MarketOrder) => {
      if (!address) return null;
      const receipt = await tx.run({
        send: async () => {
          await publicClient!.simulateContract({ account: address, address: market, abi: p2pMarketAbi, functionName: "cancelOrder", args: [order.id] });
          return writeContractAsync({ address: market, abi: p2pMarketAbi, functionName: "cancelOrder", args: [order.id], chainId });
        },
      });
      await refresh();
      return receipt;
    },
    [address, chainId, market, publicClient, refresh, writeContractAsync],
  );

  return {
    book: bookQuery.data,
    account: accountQuery.data,
    isLoading: bookQuery.isLoading,
    loadError: bookQuery.isError,
    refresh,
    take,
    create,
    cancel,
  };
}
