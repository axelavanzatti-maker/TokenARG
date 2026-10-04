"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { type ReactNode } from "react";
import { getAddress } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { useMounted } from "@/hooks/useMounted";
import { useContractAction } from "@/hooks/useContractAction";
import { api } from "@/lib/api";
import { APP_CHAINS } from "@/lib/chains";
import { CATEGORIES } from "@/lib/categories";
import { assetTokenAbi, tokenOfferingAbi } from "@/lib/contracts/abis";
import { formatChange, formatDate, formatNumber, formatPrice, formatUSD, shortAddress } from "@/lib/format";
import { OFFERING_STATE_LABEL } from "@/lib/offering";
import type { PortfolioHolding, PortfolioView as Portfolio } from "@/lib/types";
import { CategoryIcon } from "./category-icon";
import { ChainLink } from "./chain-link";
import { ConnectButton } from "./connect-button";
import { KycAlert } from "./kyc-alert";
import { NetworkBadge } from "./network-badge";

/** Cartera de la billetera conectada: tenencias y rentas (on-chain) e historial (índice). */
export function PortfolioView() {
  const { address, isConnected } = useAccount();
  const mounted = useMounted();

  const portfolio = useQuery({
    queryKey: ["portfolio", address],
    enabled: Boolean(address),
    queryFn: () => api<Portfolio>(`/api/portfolio/${address}`),
    refetchInterval: 30_000,
  });

  if (!mounted) return <Loading />;

  if (!isConnected || !address) {
    return (
      <div className="rounded-[var(--radius-card)] border border-rule bg-card p-6">
        <p className="heading text-lg text-ink">Conectá tu billetera para ver tu cartera</p>
        <p className="mt-1 max-w-[56ch] text-sm text-ink-muted">
          Tus tokens y tus rentas están registrados en {APP_CHAINS.map((c) => c.name).join(" y ")} a nombre de tu billetera:
          no hace falta usuario ni contraseña.
        </p>
        <div className="mt-4 max-w-xs">
          <ConnectButton size="lg" />
        </div>
      </div>
    );
  }

  if (portfolio.isLoading) return <Loading />;
  if (portfolio.isError || !portfolio.data) {
    return (
      <p role="alert" className="rounded-[var(--radius-control)] bg-danger-soft px-4 py-3 text-sm text-danger">
        No pudimos leer tu cartera: {portfolio.error?.message ?? "error desconocido"}.{" "}
        <button type="button" onClick={() => portfolio.refetch()} className="underline">
          Reintentar
        </button>
      </p>
    );
  }

  const data = portfolio.data;
  const verifiedOn = data.verifications.filter((v) => v.verified);
  const verifiedChainIds = new Set(verifiedOn.map((v) => v.chainId));
  // Si venció en todas las redes, el registro conserva la fecha: se avisa que hay que actualizarla.
  const lastExpiry = data.verifications.map((v) => v.expiresAt).filter((d): d is string => d !== null).sort().at(-1) ?? null;
  const chainsWithoutKyc = [...new Set(data.holdings.filter((h) => !verifiedChainIds.has(h.chainId)).map((h) => h.chainId))];
  const marketGain = data.totals.marketValueUSD - data.totals.investedUSD;

  return (
    <div className="space-y-10">
      <p className="text-sm text-ink-muted">
        Billetera <span className="font-mono text-[0.8125rem] text-ink">{shortAddress(address, 6)}</span>
        {verifiedOn.length > 0 && (
          <>
            {" "}
            — verificada en {verifiedOn.map((v) => `${v.name}${v.expiresAt ? ` (hasta el ${formatDate(v.expiresAt)})` : ""}`).join(" y ")}
          </>
        )}
      </p>

      {verifiedOn.length === 0 ? (
        <KycAlert address={address} expiresAt={lastExpiry ? new Date(lastExpiry) : null} context={data.holdings.length > 0 ? "claim" : "invest"} />
      ) : (
        chainsWithoutKyc.length > 0 && (
          <p role="alert" className="rounded-[var(--radius-control)] border border-caution/30 bg-caution-soft px-4 py-3 text-sm text-ink">
            Tenés tokens en{" "}
            {chainsWithoutKyc.map((id) => data.verifications.find((v) => v.chainId === id)?.name ?? `la red ${id}`).join(" y ")}, donde tu
            billetera no está habilitada: no vas a poder cobrar rentas ni operar ahí.{" "}
            <Link href="/kyc" className="font-semibold text-brand underline underline-offset-2">
              Habilitala desde Verificación
            </Link>
            .
          </p>
        )
      )}

      <dl className="grid grid-cols-2 overflow-hidden rounded-[var(--radius-card)] border border-rule bg-card lg:grid-cols-4">
        <div className="px-5 py-4">
          <dt className="text-sm text-ink-muted">A precio de emisión</dt>
          <dd className="figure mt-1 text-2xl text-ink">{formatUSD(data.totals.investedUSD)}</dd>
        </div>
        <div className="border-l border-rule px-5 py-4">
          <dt className="text-sm text-ink-muted">A precio de mercado</dt>
          <dd className="figure mt-1 text-2xl text-ink">{formatUSD(data.totals.marketValueUSD)}</dd>
          {data.totals.investedUSD > 0 && Math.abs(marketGain) >= 0.5 && (
            <dd className={`mt-0.5 text-xs font-semibold ${marketGain > 0 ? "text-yield" : "text-danger"}`}>
              {marketGain > 0 ? "+" : "−"}
              {formatUSD(Math.abs(marketGain))} ({formatChange((marketGain / data.totals.investedUSD) * 100)})
            </dd>
          )}
        </div>
        <div className="border-t border-rule px-5 py-4 lg:border-t-0 lg:border-l">
          <dt className="text-sm text-ink-muted">Rentas cobradas</dt>
          <dd className="figure mt-1 text-2xl text-ink">{formatUSD(data.totals.collectedDistributionsUSD, { cents: true })}</dd>
        </div>
        <div className="border-t border-l border-rule px-5 py-4 lg:border-t-0">
          <dt className="text-sm text-ink-muted">Rentas a cobrar</dt>
          <dd className={`figure mt-1 text-2xl ${data.totals.pendingDistributionsUSD > 0 ? "text-yield" : "text-ink"}`}>
            {formatUSD(data.totals.pendingDistributionsUSD, { cents: true })}
          </dd>
        </div>
      </dl>

      <section aria-labelledby="tenencias">
        <h2 id="tenencias" className="heading text-xl text-ink">
          Tenencias
        </h2>
        {data.holdings.length === 0 ? (
          <div className="mt-3 rounded-[var(--radius-card)] border border-dashed border-rule-strong bg-card px-6 py-10 text-center">
            <p className="heading text-lg text-ink">Todavía no invertiste con esta billetera</p>
            <Link href="/#proyectos" className="mt-3 inline-block text-sm font-semibold text-brand underline underline-offset-2">
              Ver proyectos abiertos
            </Link>
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-rule overflow-hidden rounded-[var(--radius-card)] border border-rule bg-card">
            {data.holdings.map((holding) => (
              <HoldingRow key={holding.slug} holding={holding} verified={verifiedChainIds.has(holding.chainId)} onDone={() => portfolio.refetch()} />
            ))}
          </ul>
        )}
      </section>

      {data.history.length > 0 && (
        <section aria-labelledby="historial">
          <h2 id="historial" className="heading text-xl text-ink">
            Historial de operaciones
          </h2>
          <div className="relative mt-3 overflow-x-auto rounded-[var(--radius-card)] border border-rule bg-card">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-rule text-left text-ink-muted">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Fecha
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Operación
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Proyecto
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    Monto
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    Tokens
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Estado
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Transacción
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.history.map((row) => (
                  <tr key={row.id} className="border-b border-rule last:border-0">
                    <td className="px-4 py-2.5 whitespace-nowrap">{formatDate(row.executedAt)}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{row.kind}</td>
                    <td className="px-4 py-2.5">
                      <Link href={`/project/${row.slug}`} className="text-ink underline decoration-rule-strong underline-offset-2 hover:decoration-ink">
                        {row.title}
                      </Link>
                    </td>
                    <td className="tabular px-4 py-2.5 text-right">{formatUSD(row.amountUSD, { cents: !Number.isInteger(row.amountUSD) })}</td>
                    <td className="tabular px-4 py-2.5 text-right">{formatNumber(row.tokenAmount, 4)}</td>
                    <td className="px-4 py-2.5">{row.status === "CONFIRMADA" ? "Confirmada" : "Reembolsada"}</td>
                    <td className="px-4 py-2.5">
                      <ChainLink kind="tx" value={row.txHash} chainId={row.chainId} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function HoldingRow({ holding, verified, onDone }: { holding: PortfolioHolding; verified: boolean; onDone: () => void }) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: holding.chainId });
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const action = useContractAction(holding.chainId);
  const category = CATEGORIES[holding.category];
  const token = getAddress(holding.tokenAddress);
  const offering = getAddress(holding.offeringAddress);

  const after = async () => {
    await fetch(`/api/projects/${holding.slug}/sync`, { method: "POST" }).catch(() => undefined);
    await queryClient.invalidateQueries({ queryKey: ["investor"] });
    onDone();
  };

  const claim = async () => {
    const receipt = await action.run(async () => {
      await publicClient!.simulateContract({ account: address!, address: token, abi: assetTokenAbi, functionName: "claimDistributions" });
      return writeContractAsync({ address: token, abi: assetTokenAbi, functionName: "claimDistributions", chainId: holding.chainId });
    });
    if (receipt) await after();
  };

  const refund = async () => {
    const receipt = await action.run(async () => {
      await publicClient!.simulateContract({ account: address!, address: offering, abi: tokenOfferingAbi, functionName: "refund" });
      return writeContractAsync({ address: offering, abi: tokenOfferingAbi, functionName: "refund", chainId: holding.chainId });
    });
    if (receipt) await after();
  };

  return (
    <li className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))_auto] md:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
          style={{ background: category.inkSoft, color: category.ink, boxShadow: `inset 0 0 0 1px ${category.ink}33` }}
        >
          <CategoryIcon category={holding.category} className="h-5 w-5" strokeWidth={1.5} />
        </span>
        <div className="min-w-0">
          <Link href={`/project/${holding.slug}`} className="heading line-clamp-2 text-base text-ink hover:underline">
            {holding.title}
          </Link>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
            <NetworkBadge network={holding.network} />
            Ronda {OFFERING_STATE_LABEL[holding.offeringState].toLowerCase()}
          </p>
        </div>
      </div>
      <Cell label="Tokens" value={`${formatNumber(holding.tokens, 4)} ${holding.tokenSymbol}`} />
      <Cell label="A precio de emisión" value={formatUSD(holding.tokens * holding.tokenPriceUSD)} />
      <Cell
        label={holding.lastPriceUSD !== null ? `A ${formatPrice(holding.lastPriceUSD)} (mercado)` : "Precio de mercado"}
        value={holding.lastPriceUSD !== null ? formatUSD(holding.tokens * holding.lastPriceUSD) : "Sin operaciones"}
      />
      <Cell
        label="Rentas a cobrar"
        value={formatUSD(holding.pendingDistributionsUSD, { cents: true })}
        tone={holding.pendingDistributionsUSD > 0 ? "yield" : undefined}
      />
      <div className="md:text-right">
        {holding.refundAvailable ? (
          <ActionButton busy={action.busy} onClick={refund}>
            Pedir reembolso de {formatUSD(holding.contributedUSD, { cents: !Number.isInteger(holding.contributedUSD) })}
          </ActionButton>
        ) : holding.pendingDistributionsUSD > 0 ? (
          <ActionButton busy={action.busy} onClick={claim} disabled={!verified} title={verified ? undefined : "Necesitás una verificación de identidad vigente en esta red"}>
            Cobrar
          </ActionButton>
        ) : holding.offeringState === "Successful" && holding.tokens > 0 ? (
          <Link
            href={`/project/${holding.slug}#mercado`}
            className="inline-flex items-center rounded-[var(--radius-control)] border border-rule px-3.5 py-2 text-sm font-semibold text-ink hover:border-rule-strong"
          >
            Vender
          </Link>
        ) : null}
        {action.status === "error" && action.error && (
          <p role="alert" className="mt-1 text-xs text-danger md:max-w-[220px] md:text-right">
            {action.error}
          </p>
        )}
        {action.status === "success" && action.hash && (
          <p role="status" className="mt-1 text-xs text-yield">
            Listo: <ChainLink kind="tx" value={action.hash} chainId={holding.chainId} />
          </p>
        )}
      </div>
    </li>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: "yield" }) {
  return (
    <div className="flex items-baseline justify-between gap-3 md:block">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className={`tabular block font-semibold ${tone === "yield" ? "text-yield" : "text-ink"}`}>{value}</span>
    </div>
  );
}

function ActionButton({
  children,
  busy,
  onClick,
  disabled = false,
  title,
}: {
  children: ReactNode;
  busy: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      title={title}
      className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-yield/40 bg-card px-3.5 py-2 text-sm font-semibold text-yield hover:border-yield disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {busy ? "Confirmando…" : children}
    </button>
  );
}

function Loading() {
  return (
    <p className="flex items-center gap-2 text-sm text-ink-muted">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Cargando tu cartera…
    </p>
  );
}
