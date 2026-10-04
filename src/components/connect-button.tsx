"use client";

import { ChevronDown, LogOut, Wallet } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain, type Connector } from "wagmi";
import { useMounted } from "@/hooks/useMounted";
import { APP_CHAINS, chainName, isAppChain } from "@/lib/chains";
import { shortAddress } from "@/lib/format";

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

/** Billeteras detectadas (EIP-6963) primero; el conector genérico solo si no hay otra. */
function usableConnectors(connectors: readonly Connector[]) {
  const discovered = connectors.filter((c) => c.type === "injected" && c.id !== "injected");
  const others = connectors.filter((c) => c.type !== "injected");
  if (discovered.length > 0) return [...discovered, ...others];
  const hasInjected = typeof window !== "undefined" && "ethereum" in window;
  return [...(hasInjected ? connectors.filter((c) => c.id === "injected") : []), ...others];
}

export function ConnectButton({ size = "md" }: { size?: "md" | "lg" }) {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending, error, reset } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const mounted = useMounted();

  const base =
    size === "lg"
      ? "inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] px-4 py-3 text-base font-semibold"
      : "inline-flex items-center gap-2 rounded-[var(--radius-control)] px-3.5 py-2 text-sm font-semibold";

  if (!isConnected || !address) {
    const options = mounted ? usableConnectors(connectors) : [];
    return (
      <div className="relative" ref={ref}>
        <button
          type="button"
          className={`${base} bg-brand text-white hover:bg-brand-deep`}
          onClick={() => {
            reset();
            setOpen((value) => !value);
          }}
          aria-expanded={open}
          aria-haspopup="menu"
        >
          <Wallet className="h-4 w-4" aria-hidden />
          {isPending ? "Conectando…" : "Conectar billetera"}
        </button>
        {open && (
          <div
            role="menu"
            className={`absolute z-40 mt-2 w-72 rounded-[var(--radius-card)] border border-rule bg-card p-2 shadow-[0_12px_32px_-12px_rgba(19,41,75,0.35)] ${size === "lg" ? "left-0" : "right-0"}`}
          >
            {options.length === 0 ? (
              <div className="p-3 text-sm text-ink-muted">
                <p className="font-semibold text-ink">No encontramos una billetera en este navegador.</p>
                <p className="mt-1">
                  Instalá{" "}
                  <a className="text-brand underline" href="https://metamask.io/download" target="_blank" rel="noreferrer">
                    MetaMask
                  </a>{" "}
                  o{" "}
                  <a className="text-brand underline" href="https://rabby.io" target="_blank" rel="noreferrer">
                    Rabby
                  </a>
                  . Desde el celular, abrí TokenARG dentro del navegador de tu billetera.
                </p>
              </div>
            ) : (
              options.map((connector) => (
                <button
                  key={connector.uid}
                  role="menuitem"
                  type="button"
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium text-ink hover:bg-paper"
                  onClick={() => {
                    // Sin forzar red: cada ficha pide la suya (Polygon o Ethereum) al momento de operar.
                    connect({ connector });
                    setOpen(false);
                  }}
                >
                  {connector.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element -- ícono data: provisto por la billetera
                    <img src={connector.icon} alt="" className="h-6 w-6 rounded" />
                  ) : (
                    <Wallet className="h-5 w-5 text-ink-muted" aria-hidden />
                  )}
                  {connector.id === "injected" ? "Billetera del navegador" : connector.name}
                </button>
              ))
            )}
          </div>
        )}
        {error && !open && (
          <p className="absolute right-0 mt-2 w-64 rounded-md bg-danger-soft p-2 text-xs text-danger" role="alert">
            {/rejected/i.test(error.message) ? "Cancelaste la conexión." : "No se pudo conectar la billetera."}
          </p>
        )}
      </div>
    );
  }

  const wrongChain = !isAppChain(chainId);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className={`${base} border ${wrongChain ? "border-caution bg-caution-soft text-caution" : "border-rule bg-card text-ink hover:border-rule-strong"}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className={`h-2 w-2 rounded-full ${wrongChain ? "bg-caution" : "bg-yield"}`} aria-hidden />
        <span className="font-mono text-[0.8125rem] whitespace-nowrap">{shortAddress(address)}</span>
        <ChevronDown className="hidden h-4 w-4 sm:block" aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-64 rounded-[var(--radius-card)] border border-rule bg-card p-2 shadow-[0_12px_32px_-12px_rgba(19,41,75,0.35)]"
        >
          <p className={`mb-1 rounded-md px-3 py-2 text-xs ${wrongChain ? "bg-caution-soft text-caution" : "text-ink-muted"}`}>
            {wrongChain ? "Tu billetera está en una red que TokenARG no usa." : `Red: ${chainName(chainId)}`}
          </p>
          {APP_CHAINS.filter((chain) => chain.id !== chainId).map((chain) => (
            <button
              key={chain.id}
              role="menuitem"
              type="button"
              disabled={switching}
              className={`mb-1 w-full rounded-md px-3 py-2.5 text-left text-sm font-medium hover:bg-paper ${wrongChain ? "font-semibold text-caution" : "text-ink"}`}
              onClick={() => switchChain({ chainId: chain.id })}
            >
              {switching ? "Cambiando de red…" : `Cambiar a ${chain.name}`}
            </button>
          ))}
          <Link role="menuitem" href="/portfolio" className="block rounded-md px-3 py-2.5 text-sm font-medium hover:bg-paper" onClick={() => setOpen(false)}>
            Mi cartera
          </Link>
          <Link role="menuitem" href="/kyc" className="block rounded-md px-3 py-2.5 text-sm font-medium hover:bg-paper" onClick={() => setOpen(false)}>
            Verificación de identidad
          </Link>
          <button
            role="menuitem"
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm font-medium text-ink-muted hover:bg-paper"
            onClick={() => {
              disconnect();
              setOpen(false);
            }}
          >
            <LogOut className="h-4 w-4" aria-hidden />
            Desconectar
          </button>
        </div>
      )}
    </div>
  );
}
