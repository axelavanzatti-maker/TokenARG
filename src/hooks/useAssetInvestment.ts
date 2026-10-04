"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { erc20Abi, getAddress, parseEventLogs, zeroAddress, type Address, type Hash, type TransactionReceipt } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { api } from "@/lib/api";
import { DEFAULT_CHAIN, IS_TESTNET, chainById } from "@/lib/chains";
import { assetTokenAbi, identityRegistryAbi, mockErc20Abi, mockUsdcAbi, paymentRouterAbi, tokenOfferingAbi } from "@/lib/contracts/abis";
import { describeTxError } from "@/lib/contracts/errors";
import { formatUsdcUnits } from "@/lib/format";
import { offeringStateFromIndex, type OfferingState } from "@/lib/offering";
import type { PaymentAssetInfo } from "@/lib/types";
import { useContractAction, useEnsureChain } from "./useContractAction";

const TOKEN_UNIT = 10n ** 18n;
const REFRESH_MS = 15_000;
/** Tolerancia de precio al pagar con otra moneda: 1 % sobre la cotización. */
export const SLIPPAGE_BPS = 100n;
/** Vigencia de una cotización firmada (el contrato rechaza la compra después). */
const QUOTE_TTL_SECONDS = 20 * 60;

/** Estado on-chain de la ronda (TokenOffering) y del registro KYC que usa su token. */
export interface OfferingSnapshot {
  state: OfferingState;
  paused: boolean;
  raised: bigint;
  tokensSold: bigint;
  investors: number;
  pricePerToken: bigint;
  minPurchase: bigint;
  softCap: bigint;
  hardCap: bigint;
  remaining: bigint;
  startTime: Date;
  endTime: Date;
  paymentToken: Address;
  identityRegistry: Address;
  /** true si la moneda de pago es el USDC de prueba con canilla (solo testnet / red local). */
  faucetAvailable: boolean;
  /** true si la fecha de cierre todavía no llegó (la ronda terminó antes: cupo completo o cancelación). */
  endsInFuture: boolean;
}

/** Lo que la billetera conectada tiene y puede hacer en este proyecto. */
export interface InvestorSnapshot {
  isKycApproved: boolean;
  kycExpiresAt: Date | null;
  paymentBalance: bigint;
  allowance: bigint;
  /** Saldo de la moneda nativa (POL o ETH) para pagar gas. */
  gasBalance: bigint;
  tokenBalance: bigint;
  contribution: bigint;
  pendingDistributions: bigint;
  collectedDistributions: bigint;
}

export type InvestStep = "idle" | "approving" | "buying" | "recording" | "done" | "error";

export interface PurchaseResult {
  txHash: Hash;
  paymentAmount: bigint;
  tokenAmount: bigint;
  /** Moneda con la que se pagó y cuánto se gastó (null si fue USDC directo). */
  paidWith: { symbol: string; decimals: number; amountIn: bigint } | null;
  /** false si la API no pudo indexar la compra (la sincronización periódica la recupera). */
  recorded: boolean;
}

/** Tokens (18 decimales) que se reciben por `paymentAmount`, igual que TokenOffering.quote(). */
export function quoteTokens(paymentAmount: bigint, pricePerToken: bigint) {
  return pricePerToken > 0n ? (paymentAmount * TOKEN_UNIT) / pricePerToken : 0n;
}

/** Máximo a pagar con otra moneda: la cotización más la tolerancia de precio. */
export function withSlippage(amountIn: bigint) {
  return amountIn + (amountIn * SLIPPAGE_BPS + 9_999n) / 10_000n;
}

/**
 * Por qué un monto no se puede invertir (null si se puede). Replica las reglas de buy().
 * Con `investor` y pago en USDC, también controla el saldo de USDC.
 */
export function purchaseProblem(
  amount: bigint,
  offering: OfferingSnapshot,
  investor?: InvestorSnapshot,
  { payingWithUsdc = true } = {},
): string | null {
  if (amount <= 0n) return "Ingresá el monto que querés invertir.";
  if (amount > offering.remaining) return `El cupo disponible es de ${formatUsdcUnits(offering.remaining)}.`;
  if (amount < offering.minPurchase && amount !== offering.remaining) {
    return `El ticket mínimo es de ${formatUsdcUnits(offering.minPurchase)}.`;
  }
  if (payingWithUsdc && investor && amount > investor.paymentBalance) return "No tenés USDC suficientes en esta billetera.";
  return null;
}

const assetAddress = (asset: PaymentAssetInfo): Address => (asset.address === "native" ? zeroAddress : asset.address);

/** Cotización y saldos para pagar `usdcAmount` con `asset` a través del PaymentRouter. */
export function usePaymentQuote({
  chainId,
  router,
  asset,
  usdcAmount,
}: {
  chainId: number;
  router: Address | null;
  asset: PaymentAssetInfo | null;
  usdcAmount: bigint;
}) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId });
  return useQuery({
    queryKey: ["payment-quote", chainId, router, asset?.symbol, usdcAmount.toString(), address],
    enabled: Boolean(publicClient && router && asset && usdcAmount > 0n),
    refetchInterval: REFRESH_MS,
    placeholderData: (previous) => previous,
    queryFn: async () => {
      const client = publicClient!;
      const a = asset!;
      // quote() no es view (el adaptador de Uniswap simula el swap): se lee con eth_call.
      const { result: amountIn } = await client.simulateContract({
        address: router!,
        abi: paymentRouterAbi,
        functionName: "quote",
        args: [assetAddress(a), usdcAmount],
      });
      let balance = 0n;
      let allowance = 0n;
      if (address) {
        if (a.address === "native") {
          balance = await client.getBalance({ address });
        } else {
          [balance, allowance] = await Promise.all([
            client.readContract({ address: a.address, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
            client.readContract({ address: a.address, abi: erc20Abi, functionName: "allowance", args: [address, router!] }),
          ]);
        }
      }
      return { amountIn, maxAmountIn: withSlippage(amountIn), balance, allowance };
    },
  });
}

/**
 * Lógica Web3 de la ficha de un proyecto en su red (Polygon o Ethereum): lectura de la ronda y
 * de la posición del inversor, verificación KYC on-chain y las operaciones (comprar con USDC o
 * con otra moneda vía PaymentRouter, cobrar rentas, reembolso, cierre de la ronda y, en redes
 * de prueba, USDC de la canilla).
 *
 * La compra con USDC NO es un transfer() desde la billetera del inversor, sino
 * approve(USDC) + TokenOffering.buy(), que deja los fondos en garantía y emite los tokens en la
 * misma transacción. Con otra moneda, PaymentRouter.buyWithAsset() la convierte a USDC y compra
 * a nombre del inversor, todo en una sola transacción.
 */
export function useAssetInvestment({
  chainId: projectChainId,
  offeringAddress,
  tokenAddress,
  paymentRouter,
}: {
  chainId: number | null;
  offeringAddress?: string | null;
  tokenAddress?: string | null;
  paymentRouter?: string | null;
}) {
  const chainId = projectChainId ?? DEFAULT_CHAIN.id;
  const chain = chainById(chainId) ?? DEFAULT_CHAIN;
  const offering = offeringAddress ? getAddress(offeringAddress) : undefined;
  const token = tokenAddress ? getAddress(tokenAddress) : undefined;
  const router = paymentRouter ? getAddress(paymentRouter) : null;
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId });
  const queryClient = useQueryClient();
  const { writeContractAsync } = useWriteContract();
  const ensureChain = useEnsureChain(chainId);
  const action = useContractAction(chainId);
  // La canilla de prueba tiene su propio estado para que su confirmación no se mezcle con la
  // de cobrar rentas, reembolsar o cerrar la ronda.
  const faucetAction = useContractAction(chainId);

  const offeringQuery = useQuery({
    queryKey: ["offering", chainId, offering],
    enabled: Boolean(publicClient && offering && token),
    refetchInterval: REFRESH_MS,
    queryFn: async (): Promise<OfferingSnapshot> => {
      const client = publicClient!;
      const [summary, paused, paymentToken, identityRegistry] = await Promise.all([
        client.readContract({ address: offering!, abi: tokenOfferingAbi, functionName: "summary" }),
        client.readContract({ address: offering!, abi: tokenOfferingAbi, functionName: "paused" }),
        client.readContract({ address: offering!, abi: tokenOfferingAbi, functionName: "paymentToken" }),
        client.readContract({ address: token!, abi: assetTokenAbi, functionName: "identityRegistry" }),
      ]);
      const [state, raised, tokensSold, investors, price, minimum, soft, hard, start, end] = summary;
      // El MockUSDC expone FAUCET_LIMIT; el USDC real no. Así se detecta sin configuración extra.
      const faucetAvailable =
        IS_TESTNET &&
        (await client
          .readContract({ address: paymentToken, abi: mockUsdcAbi, functionName: "FAUCET_LIMIT" })
          .then(
            () => true,
            () => false,
          ));
      return {
        faucetAvailable,
        endsInFuture: Number(end) * 1000 > Date.now(),
        state: offeringStateFromIndex(state),
        paused,
        raised,
        tokensSold,
        investors: Number(investors),
        pricePerToken: price,
        minPurchase: minimum,
        softCap: soft,
        hardCap: hard,
        remaining: hard - raised,
        startTime: new Date(Number(start) * 1000),
        endTime: new Date(Number(end) * 1000),
        paymentToken: getAddress(paymentToken),
        identityRegistry: getAddress(identityRegistry),
      };
    },
  });

  const snapshot = offeringQuery.data;
  const investorQuery = useQuery({
    queryKey: ["investor", chainId, offering, address],
    enabled: Boolean(publicClient && snapshot && address && token),
    refetchInterval: REFRESH_MS,
    queryFn: async (): Promise<InvestorSnapshot> => {
      const client = publicClient!;
      const who = address!;
      const s = snapshot!;
      const [verified, expiry, paymentBalance, allowance, gasBalance, tokenBalance, contribution, pending, withdrawn] =
        await Promise.all([
          client.readContract({ address: s.identityRegistry, abi: identityRegistryAbi, functionName: "isVerified", args: [who] }),
          client.readContract({ address: s.identityRegistry, abi: identityRegistryAbi, functionName: "verificationExpiry", args: [who] }),
          client.readContract({ address: s.paymentToken, abi: erc20Abi, functionName: "balanceOf", args: [who] }),
          client.readContract({ address: s.paymentToken, abi: erc20Abi, functionName: "allowance", args: [who, offering!] }),
          client.getBalance({ address: who }),
          client.readContract({ address: token!, abi: assetTokenAbi, functionName: "balanceOf", args: [who] }),
          client.readContract({ address: offering!, abi: tokenOfferingAbi, functionName: "contributionOf", args: [who] }),
          client.readContract({ address: token!, abi: assetTokenAbi, functionName: "withdrawableDistributionOf", args: [who] }),
          client.readContract({ address: token!, abi: assetTokenAbi, functionName: "withdrawnDistributionOf", args: [who] }),
        ]);
      return {
        isKycApproved: verified,
        kycExpiresAt: expiry > 0n ? new Date(Number(expiry) * 1000) : null,
        paymentBalance,
        allowance,
        gasBalance,
        tokenBalance,
        contribution,
        pendingDistributions: pending,
        collectedDistributions: withdrawn,
      };
    },
  });

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["offering", chainId, offering] }),
      queryClient.invalidateQueries({ queryKey: ["investor", chainId, offering] }),
      queryClient.invalidateQueries({ queryKey: ["payment-quote", chainId] }),
    ]);
  }, [queryClient, chainId, offering]);

  // --- Compra ---------------------------------------------------------------------------------
  const [step, setStep] = useState<InvestStep>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [purchase, setPurchase] = useState<PurchaseResult | null>(null);
  const [pendingHash, setPendingHash] = useState<Hash | null>(null);

  /** Lectura fresca y controles comunes antes de firmar. */
  const preflight = useCallback(
    async (amount: bigint, payingWithUsdc: boolean) => {
      if (!publicClient || !offering || !token) throw new Error("Este proyecto todavía no tiene contratos en la red.");
      if (!address) throw new Error("Conectá tu billetera para invertir.");
      // El KYC, el cupo y los saldos pueden haber cambiado desde que se cargó la página.
      const [{ data: fresh }, { data: me }] = await Promise.all([offeringQuery.refetch(), investorQuery.refetch()]);
      if (!fresh || !me) throw new Error("No pudimos leer el estado de la ronda. Probá de nuevo.");
      if (fresh.state !== "Open" || fresh.paused) throw new Error("La ronda no está recibiendo inversiones en este momento.");
      if (!me.isKycApproved) {
        throw new Error(`Billetera no verificada en ${chain.name}. Completá la verificación de identidad antes de operar.`);
      }
      const problem = purchaseProblem(amount, fresh, me, { payingWithUsdc });
      if (problem) throw new Error(problem);
      if (me.gasBalance === 0n) {
        throw new Error(`Necesitás ${chain.nativeCurrency.symbol} en tu billetera para pagar la comisión de red.`);
      }
      await ensureChain();
      return { client: publicClient, fresh, me, who: address, offeringAddress: offering };
    },
    [address, chain, ensureChain, investorQuery, offering, offeringQuery, publicClient, token],
  );

  /** Registra la compra en el índice (el servidor relee el recibo) y deja el resultado. */
  const finishPurchase = useCallback(
    async (
      receipt: TransactionReceipt,
      txHash: Hash,
      amount: bigint,
      pricePerToken: bigint,
      paidWith: PurchaseResult["paidWith"],
    ) => {
      const [event] = parseEventLogs({ abi: tokenOfferingAbi, logs: receipt.logs, eventName: "TokensPurchased" });
      const tokenAmount = event?.args.tokenAmount ?? quoteTokens(amount, pricePerToken);
      setStep("recording");
      const recorded = await api("/api/investments", { body: { chainId, txHash } })
        .then(() => true)
        .catch(() => false);
      const result: PurchaseResult = { txHash, paymentAmount: amount, tokenAmount, paidWith, recorded };
      setPurchase(result);
      setStep("done");
      await refresh();
      return result;
    },
    [chainId, refresh],
  );

  const startPurchase = useCallback(() => {
    setErrorMsg(null);
    setPurchase(null);
    setPendingHash(null);
  }, []);

  /** Compra con USDC: approve (por el monto exacto) + buy(). */
  const buyAssetTokens = useCallback(
    async (amount: bigint): Promise<PurchaseResult | null> => {
      startPurchase();
      try {
        const { client, fresh, me, offeringAddress: target } = await preflight(amount, true);

        if (me.allowance < amount) {
          setStep("approving");
          // Se autoriza exactamente el monto de esta compra, nunca un cheque en blanco.
          const approveHash = await writeContractAsync({
            address: fresh.paymentToken,
            abi: erc20Abi,
            functionName: "approve",
            args: [target, amount],
            chainId,
          });
          setPendingHash(approveHash);
          const approval = await client.waitForTransactionReceipt({ hash: approveHash });
          if (approval.status !== "success") throw new Error("La autorización de USDC revirtió.");
        }

        setStep("buying");
        setPendingHash(null);
        await client.simulateContract({ account: address, address: target, abi: tokenOfferingAbi, functionName: "buy", args: [amount] });
        const buyHash = await writeContractAsync({ address: target, abi: tokenOfferingAbi, functionName: "buy", args: [amount], chainId });
        setPendingHash(buyHash);
        const receipt = await client.waitForTransactionReceipt({ hash: buyHash });
        if (receipt.status !== "success") throw new Error("La compra revirtió en la red.");
        return await finishPurchase(receipt, buyHash, amount, fresh.pricePerToken, null);
      } catch (error) {
        setErrorMsg(describeTxError(error));
        setStep("error");
        return null;
      }
    },
    [address, chainId, finishPurchase, preflight, startPurchase, writeContractAsync],
  );

  /**
   * Compra pagando con otra moneda (ETH/POL, WBTC, USDT, WETH). Se cotiza de nuevo justo antes
   * de firmar y se autoriza como máximo la cotización + 1 %: si el precio se mueve más, el
   * contrato revierte y no se cobra nada. Lo que sobra vuelve a la billetera en la misma
   * transacción.
   */
  const buyWithAsset = useCallback(
    async (asset: PaymentAssetInfo, amount: bigint): Promise<PurchaseResult | null> => {
      startPurchase();
      try {
        if (!router) throw new Error("Esta red no tiene habilitado el pago con otras monedas.");
        const { client, fresh, who, offeringAddress: target } = await preflight(amount, false);
        const assetAddr = assetAddress(asset);
        const isNative = asset.address === "native";

        const { result: amountIn } = await client.simulateContract({
          address: router,
          abi: paymentRouterAbi,
          functionName: "quote",
          args: [assetAddr, amount],
        });
        const maxAmountIn = withSlippage(amountIn);
        const balance = isNative
          ? await client.getBalance({ address: who })
          : await client.readContract({ address: assetAddr, abi: erc20Abi, functionName: "balanceOf", args: [who] });
        if (balance < maxAmountIn) throw new Error(`No tenés ${asset.symbol} suficiente para este monto (con la tolerancia de precio).`);

        if (!isNative) {
          const allowance = await client.readContract({ address: assetAddr, abi: erc20Abi, functionName: "allowance", args: [who, router] });
          if (allowance < maxAmountIn) {
            setStep("approving");
            const approveHash = await writeContractAsync({
              address: assetAddr,
              abi: erc20Abi,
              functionName: "approve",
              args: [router, maxAmountIn],
              chainId,
            });
            setPendingHash(approveHash);
            const approval = await client.waitForTransactionReceipt({ hash: approveHash });
            if (approval.status !== "success") throw new Error(`La autorización de ${asset.symbol} revirtió.`);
          }
        }

        setStep("buying");
        setPendingHash(null);
        const deadline = BigInt(Math.floor(Date.now() / 1000) + QUOTE_TTL_SECONDS);
        const request = {
          address: router,
          abi: paymentRouterAbi,
          functionName: "buyWithAsset",
          args: [target, assetAddr, amount, maxAmountIn, deadline],
          value: isNative ? maxAmountIn : 0n,
        } as const;
        await client.simulateContract({ account: who, ...request });
        const txHash = await writeContractAsync({ ...request, chainId });
        setPendingHash(txHash);
        const receipt = await client.waitForTransactionReceipt({ hash: txHash });
        if (receipt.status !== "success") throw new Error("La compra revirtió en la red.");
        const [paid] = parseEventLogs({ abi: paymentRouterAbi, logs: receipt.logs, eventName: "PaidWithAsset" });
        return await finishPurchase(receipt, txHash, amount, fresh.pricePerToken, {
          symbol: asset.symbol,
          decimals: asset.decimals,
          amountIn: paid?.args.amountIn ?? amountIn,
        });
      } catch (error) {
        setErrorMsg(describeTxError(error));
        setStep("error");
        return null;
      }
    },
    [chainId, finishPurchase, preflight, router, startPurchase, writeContractAsync],
  );

  const resetPurchase = useCallback(() => {
    setStep("idle");
    setErrorMsg(null);
    setPurchase(null);
    setPendingHash(null);
  }, []);

  // --- Otras operaciones ---------------------------------------------------------------------
  const runAndRefresh = useCallback(
    async (send: () => Promise<Hash>) => {
      const receipt = await action.run(send);
      if (receipt) await refresh();
      return receipt;
    },
    [action, refresh],
  );

  /** Cobra las rentas/intereses pendientes del token. */
  const claimDistributions = useCallback(
    () =>
      runAndRefresh(async () => {
        await publicClient!.simulateContract({ account: address!, address: token!, abi: assetTokenAbi, functionName: "claimDistributions" });
        return writeContractAsync({ address: token!, abi: assetTokenAbi, functionName: "claimDistributions", chainId });
      }),
    [address, chainId, publicClient, runAndRefresh, token, writeContractAsync],
  );

  /** Recupera el aporte si la ronda no alcanzó el mínimo o fue cancelada (quema los tokens). */
  const refund = useCallback(
    () =>
      runAndRefresh(async () => {
        await publicClient!.simulateContract({ account: address!, address: offering!, abi: tokenOfferingAbi, functionName: "refund" });
        return writeContractAsync({ address: offering!, abi: tokenOfferingAbi, functionName: "refund", chainId });
      }),
    [address, chainId, offering, publicClient, runAndRefresh, writeContractAsync],
  );

  /** Cierre formal de una ronda vencida o completa. Cualquiera puede ejecutarlo. */
  const finalize = useCallback(
    () =>
      runAndRefresh(async () => {
        await publicClient!.simulateContract({ account: address!, address: offering!, abi: tokenOfferingAbi, functionName: "finalize" });
        return writeContractAsync({ address: offering!, abi: tokenOfferingAbi, functionName: "finalize", chainId });
      }),
    [address, chainId, offering, publicClient, runAndRefresh, writeContractAsync],
  );

  /** Solo redes de prueba: acuña USDC de prueba (MockUSDC) en la billetera conectada. */
  const faucet = useCallback(
    async (amount: bigint) => {
      const receipt = await faucetAction.run(async () => {
        const paymentToken = snapshot!.paymentToken;
        await publicClient!.simulateContract({
          account: address!,
          address: paymentToken,
          abi: mockUsdcAbi,
          functionName: "mint",
          args: [address!, amount],
        });
        return writeContractAsync({ address: paymentToken, abi: mockUsdcAbi, functionName: "mint", args: [address!, amount], chainId });
      });
      if (receipt) await refresh();
      return receipt;
    },
    [address, chainId, faucetAction, publicClient, refresh, snapshot, writeContractAsync],
  );

  /** Solo redes de prueba: acuña WBTC/USDT/WETH de prueba (MockERC20) para probar el pago. */
  const assetFaucet = useCallback(
    async (asset: PaymentAssetInfo, amount: bigint) => {
      if (asset.address === "native" || !asset.isMock) return null;
      const target = asset.address;
      const receipt = await faucetAction.run(async () => {
        await publicClient!.simulateContract({ account: address!, address: target, abi: mockErc20Abi, functionName: "mint", args: [address!, amount] });
        return writeContractAsync({ address: target, abi: mockErc20Abi, functionName: "mint", args: [address!, amount], chainId });
      });
      if (receipt) await refresh();
      return receipt;
    },
    [address, chainId, faucetAction, publicClient, refresh, writeContractAsync],
  );

  return {
    chainId,
    chain,
    paymentRouter: router,
    offering: snapshot,
    investor: investorQuery.data,
    isLoading: offeringQuery.isLoading,
    loadError: offeringQuery.isError ? `No pudimos leer el contrato de la ronda en ${chain.name}. Revisá la conexión con la red.` : null,
    // Mismos nombres que el borrador original del hook:
    isKycApproved: investorQuery.data?.isKycApproved ?? false,
    checkingKyc: Boolean(address) && investorQuery.isLoading,
    buyAssetTokens,
    buyWithAsset,
    errorMsg,
    // Estado de la compra en curso
    step,
    purchase,
    pendingHash,
    resetPurchase,
    // Otras operaciones: cobrar, reembolsar y cerrar comparten `action`; la canilla usa `faucetAction`
    claimDistributions,
    refund,
    finalize,
    faucet,
    assetFaucet,
    action,
    faucetAction,
    refresh,
  };
}
