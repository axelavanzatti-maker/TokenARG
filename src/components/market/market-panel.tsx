"use client";

import { Check, Loader2, ShieldAlert, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { getAddress } from "viem";
import { useAccount, useSwitchChain } from "wagmi";
import { useMounted } from "@/hooks/useMounted";
import { useMarketTx, useTokenMarket, type MarketAccount, type MarketBook, type MarketTxStep } from "@/hooks/useTokenMarket";
import { chainName } from "@/lib/chains";
import { formatChange, formatPrice, formatTokenUnits, formatUsdcUnits, shortAddress, usdcToNumber } from "@/lib/format";
import {
  MIN_FILL_VALUE,
  TOKEN_UNIT,
  feeOf,
  fillProblem,
  parseDecimalInput,
  sanitizeDecimalInput,
  takeable,
  tradeValue,
  type MarketOrder,
  type OrderSide,
} from "@/lib/market";
import { ChainLink } from "../chain-link";
import { ConnectButton } from "../connect-button";

type Market = ReturnType<typeof useTokenMarket>;
type Tx = ReturnType<typeof useMarketTx>;

const TOKEN_DECIMALS_INPUT = 6;
const PRICE_DECIMALS_INPUT = 6;
const pct = (bps: number) => (bps / 100).toLocaleString("es-AR", { maximumFractionDigits: 2 });

export interface MarketPanelProps {
  slug: string;
  chainId: number;
  market: string;
  token: string;
  paymentToken: string;
  symbol: string;
  issuePriceUSD: number;
  lastPriceUSD: number | null;
}

/**
 * Mercado P2P de un token, como los anuncios de Binance P2P: cada orden tiene un precio fijo y
 * cualquier inversor verificado la toma total o parcialmente. La liquidación es un intercambio
 * atómico token ↔ USDC en el contrato P2PMarket: nadie custodia los fondos.
 */
export function MarketPanel(props: MarketPanelProps) {
  const mounted = useMounted();
  const router = useRouter();
  const m = useTokenMarket({
    chainId: props.chainId,
    market: getAddress(props.market),
    token: getAddress(props.token),
    tokenSymbol: props.symbol,
    paymentToken: getAddress(props.paymentToken),
  });
  const [tab, setTab] = useState<"comprar" | "vender">("comprar");

  // Después de operar: el servidor re-sincroniza y la página vuelve a pedir el gráfico.
  const afterTrade = async () => {
    await fetch(`/api/projects/${props.slug}/sync`, { method: "POST" }).catch(() => undefined);
    router.refresh();
  };

  if (!mounted || m.isLoading) {
    return (
      <p className="flex items-center gap-2 rounded-[var(--radius-card)] border border-rule bg-card px-5 py-6 text-sm text-ink-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Leyendo el libro de órdenes en {chainName(props.chainId)}…
      </p>
    );
  }
  if (m.loadError || !m.book) {
    return (
      <Notice tone="danger" title="No pudimos leer el mercado">
        Revisá la conexión con {chainName(props.chainId)} y recargá la página.
      </Notice>
    );
  }

  const book = m.book;
  if (!book.listed || !book.transfersEnabled) {
    return (
      <Notice tone="muted" title="El mercado de este token todavía no abrió">
        {props.symbol} se puede operar entre inversores cuando la ronda cierra con éxito y el fiduciario habilita las
        transferencias. Hasta entonces, los tokens quedan en la billetera de cada inversor.
      </Notice>
    );
  }

  const orders = tab === "comprar" ? book.asks : book.bids;
  return (
    <div className="space-y-4">
      {book.paused && (
        <Notice tone="caution" title="Mercado pausado">
          La administración pausó el mercado. Las órdenes siguen publicadas y se pueden tomar cuando se reanude.
        </Notice>
      )}
      <section aria-labelledby="libro-titulo" className="min-w-0 rounded-[var(--radius-card)] border border-rule bg-card">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3">
          <h3 id="libro-titulo" className="heading text-base text-ink">
            Órdenes publicadas
          </h3>
          <div className="flex rounded-[var(--radius-control)] border border-rule p-0.5" role="tablist" aria-label="Lado del libro">
            {(["comprar", "vender"] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`rounded-[6px] px-3 py-1 text-sm font-semibold ${
                  tab === key ? (key === "comprar" ? "bg-yield text-white" : "bg-danger text-white") : "text-ink-muted hover:text-ink"
                }`}
              >
                {key === "comprar" ? `Comprar ${props.symbol}` : `Vender ${props.symbol}`}
              </button>
            ))}
          </div>
        </header>
        <p className="border-b border-rule bg-paper/60 px-4 py-2 text-xs text-ink-muted">
          {tab === "comprar"
            ? `Ofertas de venta, de menor a mayor precio. Pagás en USDC + ${pct(book.buyerFeeBps)} % de comisión.`
            : `Ofertas de compra, de mayor a menor precio. Cobrás en USDC − ${pct(book.sellerFeeBps)} % de comisión.`}
        </p>
        {orders.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-muted">
            {tab === "comprar" ? "No hay ofertas de venta ahora." : "No hay ofertas de compra ahora."} Podés publicar la tuya.
          </p>
        ) : (
          <ul className="divide-y divide-rule" role="tabpanel">
            {orders.map((order) => (
              <OrderRow key={order.id.toString()} order={order} m={m} props={props} onTraded={afterTrade} />
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <CreateOrder m={m} props={props} book={book} />
        <div className="space-y-4">
          <MyOrders m={m} props={props} book={book} />
          <FeeCard book={book} />
        </div>
      </div>
    </div>
  );
}

/** Cómo se cobra la comisión, con los números del contrato. */
function FeeCard({ book }: { book: MarketBook }) {
  return (
    <section aria-labelledby="comisiones-titulo" className="rounded-[var(--radius-card)] border border-rule bg-card p-4 text-sm">
      <h3 id="comisiones-titulo" className="heading text-base text-ink">
        Comisión: {pct(book.buyerFeeBps + book.sellerFeeBps)} % por operación
      </h3>
      <dl className="mt-2 space-y-1.5">
        <div className="flex justify-between gap-3">
          <dt className="text-ink-muted">Si comprás</dt>
          <dd className="text-right text-ink">precio + {pct(book.buyerFeeBps)} %</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-muted">Si vendés</dt>
          <dd className="text-right text-ink">precio − {pct(book.sellerFeeBps)} %</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-muted">Publicar o retirar una orden</dt>
          <dd className="text-right text-ink">sin comisión</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs leading-relaxed text-ink-muted">
        Se cobra en USDC dentro de la misma transacción del intercambio. Aparte, la red cobra su gas.
      </p>
    </section>
  );
}

/** Lo que falta para poder operar con la billetera conectada (null si puede operar). */
function useTradeGate(chainId: number, account: MarketAccount | undefined): ReactNode | null {
  const { isConnected, chainId: walletChain } = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  if (!isConnected) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-ink-muted">Conectá tu billetera para operar.</p>
        <ConnectButton size="lg" />
      </div>
    );
  }
  if (walletChain !== chainId) {
    return (
      <button
        type="button"
        onClick={() => switchChain({ chainId })}
        disabled={isPending}
        className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-ink px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        Cambiar a {chainName(chainId)} para operar
      </button>
    );
  }
  if (!account) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Leyendo tu billetera…
      </p>
    );
  }
  if (!account.verified) {
    return (
      <div className="flex gap-2.5 rounded-[var(--radius-control)] border border-caution/30 bg-caution-soft p-3 text-sm">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-caution" aria-hidden />
        <p className="text-ink">
          Para operar, tu billetera tiene que estar verificada en {chainName(chainId)}.{" "}
          <Link href="/kyc" className="font-semibold text-brand underline underline-offset-2">
            Verificar mi identidad
          </Link>
        </p>
      </div>
    );
  }
  return null;
}

function OrderRow({ order, m, props, onTraded }: { order: MarketOrder; m: Market; props: MarketPanelProps; onTraded: () => Promise<void> }) {
  const { address } = useAccount();
  const [open, setOpen] = useState(false);
  const mine = Boolean(address && getAddress(address) === order.maker);
  const available = takeable(order);
  const priceNumber = usdcToNumber(order.price);
  const vsIssue = props.issuePriceUSD > 0 ? ((priceNumber - props.issuePriceUSD) / props.issuePriceUSD) * 100 : 0;
  const maxValue = tradeValue(available, order.price);
  const minValue = maxValue < MIN_FILL_VALUE ? maxValue : MIN_FILL_VALUE;
  const isAsk = order.side === "sell";

  return (
    <li className="px-4 py-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto]">
        <div className="min-w-0 text-sm">
          <span className="font-mono text-[0.8125rem] text-ink">{shortAddress(order.maker)}</span>
          {mine && <span className="ml-1.5 rounded-full bg-brand-soft px-1.5 py-0.5 text-[0.6875rem] font-semibold text-brand-deep">Vos</span>}
        </div>
        <div className="text-right sm:text-left">
          <p className="figure text-base whitespace-nowrap text-ink">{formatPrice(priceNumber)}</p>
          <p className="text-xs whitespace-nowrap text-ink-muted">{formatChange(vsIssue)} vs. emisión</p>
        </div>
        <div className="col-span-2 text-xs text-ink-muted sm:col-span-1">
          <p>
            Disponible <span className="tabular font-semibold text-ink">{formatTokenUnits(available, props.symbol)}</span>
            {available < order.remaining && <span title="El anunciante no tiene saldo o autorización para todo lo que publicó"> (de {formatTokenUnits(order.remaining, props.symbol)})</span>}
          </p>
          <p>
            Límites{" "}
            <span className="tabular whitespace-nowrap text-ink">
              {formatUsdcUnits(minValue)} – {formatUsdcUnits(maxValue)}
            </span>
          </p>
        </div>
        <div className="col-start-2 row-start-1 sm:col-start-auto sm:row-start-auto">
          {mine ? (
            <span className="text-xs text-ink-faint">Tu orden</span>
          ) : (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              disabled={available === 0n}
              className={`rounded-[var(--radius-control)] px-3.5 py-1.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-rule-strong ${isAsk ? "bg-yield hover:bg-yield/90" : "bg-danger hover:bg-danger/90"}`}
            >
              {isAsk ? "Comprar" : "Vender"}
            </button>
          )}
        </div>
      </div>
      {open && !mine && <TakeForm order={order} m={m} props={props} onClose={() => setOpen(false)} onTraded={onTraded} />}
    </li>
  );
}

function TakeForm({
  order,
  m,
  props,
  onClose,
  onTraded,
}: {
  order: MarketOrder;
  m: Market;
  props: MarketPanelProps;
  onClose: () => void;
  onTraded: () => Promise<void>;
}) {
  const tx = useMarketTx(props.chainId);
  const book = m.book!;
  const account = m.account;
  const gate = useTradeGate(props.chainId, account);
  const isBuying = order.side === "sell"; // tomo una venta → compro
  const available = takeable(order);
  const [text, setText] = useState("");
  const amount = parseDecimalInput(text, 18) ?? 0n;

  // Máximo según mi saldo: comprando, el USDC (con la comisión); vendiendo, mis tokens.
  const affordable = (() => {
    if (!account) return available;
    if (isBuying) {
      const spendable = (account.usdcBalance * 10_000n) / (10_000n + BigInt(book.buyerFeeBps));
      return (spendable * TOKEN_UNIT) / order.price;
    }
    return account.tokenBalance;
  })();
  const max = affordable < available ? affordable : available;

  const value = tradeValue(amount, order.price);
  const fee = feeOf(value, isBuying ? book.buyerFeeBps : book.sellerFeeBps);
  const total = isBuying ? value + fee : value - fee;
  const problem =
    amount === 0n
      ? null
      : (fillProblem(order, amount) ??
        (account && isBuying && account.usdcBalance < value + fee ? "No tenés USDC suficientes (incluida la comisión)." : null) ??
        (account && !isBuying && account.tokenBalance < amount ? `No tenés tantos ${props.symbol}.` : null));

  if (tx.step === "done") {
    return (
      <div role="status" className="mt-3 flex gap-2.5 rounded-[var(--radius-control)] bg-yield-soft p-3 text-sm">
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-yield" aria-hidden />
        <div>
          <p className="font-semibold text-ink">
            {isBuying ? "Compraste" : "Vendiste"} {formatTokenUnits(amount, props.symbol)} a {formatPrice(usdcToNumber(order.price))}.
          </p>
          {tx.hash && (
            <p className="mt-0.5 text-ink-muted">
              Transacción: <ChainLink kind="tx" value={tx.hash} chainId={props.chainId} />
            </p>
          )}
          <button type="button" onClick={onClose} className="mt-1 text-xs font-semibold text-brand underline underline-offset-2">
            Cerrar
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="mt-3 space-y-3 rounded-[var(--radius-control)] border border-rule bg-paper/60 p-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (gate || problem || amount === 0n || tx.busy) return;
        const receipt = await m.take(tx, order, amount);
        if (receipt) await onTraded();
      }}
    >
      {gate ? (
        gate
      ) : (
        <>
          <div>
            <label htmlFor={`tomar-${order.id}`} className="text-xs font-semibold text-ink">
              {isBuying ? `¿Cuántos ${props.symbol} comprás?` : `¿Cuántos ${props.symbol} vendés?`}
            </label>
            <div className="mt-1 flex items-center rounded-[var(--radius-control)] border border-rule-strong bg-card focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
              <input
                id={`tomar-${order.id}`}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={text}
                disabled={tx.busy}
                onChange={(e) => setText(sanitizeDecimalInput(e.target.value, TOKEN_DECIMALS_INPUT))}
                className="figure w-full bg-transparent px-3 py-2 text-base text-ink outline-none"
              />
              <span className="pr-2 text-xs font-semibold text-ink-muted">{props.symbol}</span>
              <button
                type="button"
                disabled={tx.busy || max === 0n}
                onClick={() => setText(trimUnits(max))}
                className="mr-1.5 rounded-md px-2 py-1 text-xs font-semibold text-brand hover:bg-brand-soft disabled:opacity-50"
              >
                Máx.
              </button>
            </div>
          </div>
          <dl className="space-y-1 text-sm">
            <Row label="Valor" value={formatUsdcUnits(value)} />
            <Row label={`Comisión (${pct(isBuying ? book.buyerFeeBps : book.sellerFeeBps)} %)`} value={`${isBuying ? "+" : "−"} ${formatUsdcUnits(fee)}`} />
            <Row label={isBuying ? "Total a pagar" : "Recibís"} value={formatUsdcUnits(total > 0n ? total : 0n)} strong />
          </dl>
          {problem && <p className="text-sm text-caution">{problem}</p>}
          <TxProgress tx={tx} chainId={props.chainId} approveLabel={isBuying ? "Autorizá el uso de USDC" : `Autorizá el uso de ${props.symbol}`} />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={Boolean(problem) || amount === 0n || tx.busy}
              className={`inline-flex flex-1 items-center justify-center gap-2 rounded-[var(--radius-control)] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-rule-strong ${isBuying ? "bg-yield" : "bg-danger"}`}
            >
              {tx.busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {tx.busy ? "Esperando confirmación…" : `${isBuying ? "Comprar" : "Vender"} ${amount > 0n ? formatTokenUnits(amount, props.symbol) : props.symbol}`}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={tx.busy}
              className="rounded-[var(--radius-control)] border border-rule bg-card px-3 py-2.5 text-sm font-semibold text-ink hover:border-rule-strong disabled:opacity-60"
            >
              Cancelar
            </button>
          </div>
        </>
      )}
    </form>
  );
}

function CreateOrder({ m, props, book }: { m: Market; props: MarketPanelProps; book: MarketBook }) {
  const tx = useMarketTx(props.chainId);
  const account = m.account;
  const gate = useTradeGate(props.chainId, account);
  const [side, setSide] = useState<OrderSide>("sell");
  const [amountText, setAmountText] = useState("");
  const [priceText, setPriceText] = useState(() => {
    const reference = props.lastPriceUSD ?? props.issuePriceUSD;
    return reference.toFixed(reference < 10 ? 4 : 2).replace(".", ",");
  });
  const amount = parseDecimalInput(amountText, 18) ?? 0n;
  const price = parseDecimalInput(priceText, 6) ?? 0n;
  const value = tradeValue(amount, price);
  const fee = feeOf(value, side === "sell" ? book.sellerFeeBps : book.buyerFeeBps);
  const bestAsk = book.asks.find((o) => takeable(o) > 0n);
  const bestBid = book.bids.find((o) => takeable(o) > 0n);

  const problem = (() => {
    if (amount === 0n || price === 0n) return null;
    if (value < book.minOrderValue) return `El valor mínimo por orden es ${formatUsdcUnits(book.minOrderValue)}.`;
    if (!account) return null;
    if (side === "sell" && account.tokenBalance < account.sellCommitted + amount) {
      const free = account.tokenBalance > account.sellCommitted ? account.tokenBalance - account.sellCommitted : 0n;
      return `Podés ofrecer hasta ${formatTokenUnits(free, props.symbol)} (el resto ya está en otras órdenes de venta).`;
    }
    if (side === "buy") {
      const committed = account.buyCommittedValue + value;
      if (account.usdcBalance < committed + feeOf(committed, book.buyerFeeBps)) {
        return "No tenés USDC suficientes para respaldar esta orden y las que ya publicaste (con la comisión).";
      }
    }
    if (side === "sell" && bestBid && price <= bestBid.price) {
      return `Hay una oferta de compra a ${formatPrice(usdcToNumber(bestBid.price))}: podés venderle directo desde la pestaña "Vender".`;
    }
    if (side === "buy" && bestAsk && price >= bestAsk.price) {
      return `Hay una oferta de venta a ${formatPrice(usdcToNumber(bestAsk.price))}: podés comprarle directo desde la pestaña "Comprar".`;
    }
    return null;
  })();

  return (
    <section aria-labelledby="publicar-titulo" className="rounded-[var(--radius-card)] border border-rule bg-card p-4">
      <h3 id="publicar-titulo" className="heading text-base text-ink">
        Publicar una orden
      </h3>
      {tx.step === "done" ? (
        <div role="status" className="mt-3 space-y-2 text-sm">
          <p className="flex items-center gap-2 font-semibold text-yield">
            <Check className="h-4 w-4" aria-hidden /> Tu orden quedó publicada.
          </p>
          {tx.hash && (
            <p className="text-ink-muted">
              Transacción: <ChainLink kind="tx" value={tx.hash} chainId={props.chainId} />
            </p>
          )}
          <button
            type="button"
            onClick={() => {
              tx.reset();
              setAmountText("");
            }}
            className="text-xs font-semibold text-brand underline underline-offset-2"
          >
            Publicar otra
          </button>
        </div>
      ) : gate ? (
        <div className="mt-3">{gate}</div>
      ) : (
        <form
          className="mt-3 space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (problem || amount === 0n || price === 0n || tx.busy) return;
            await m.create(tx, side, amount, price);
          }}
        >
          <div className="grid grid-cols-2 rounded-[var(--radius-control)] border border-rule p-0.5" role="group" aria-label="Tipo de orden">
            {(["sell", "buy"] as const).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={side === key}
                disabled={tx.busy}
                onClick={() => {
                  setSide(key);
                  tx.reset();
                }}
                className={`rounded-[6px] py-1.5 text-sm font-semibold ${side === key ? "bg-ink text-white" : "text-ink-muted hover:text-ink"}`}
              >
                {key === "sell" ? "Quiero vender" : "Quiero comprar"}
              </button>
            ))}
          </div>
          <div>
            <label htmlFor="orden-cantidad" className="text-xs font-semibold text-ink">
              Cantidad de {props.symbol}
            </label>
            <input
              id="orden-cantidad"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={amountText}
              disabled={tx.busy}
              onChange={(e) => setAmountText(sanitizeDecimalInput(e.target.value, TOKEN_DECIMALS_INPUT))}
              className="figure mt-1 w-full rounded-[var(--radius-control)] border border-rule-strong bg-card px-3 py-2 text-base text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
            {account && (
              <p className="mt-1 text-xs text-ink-muted">
                {side === "sell"
                  ? `Tenés ${formatTokenUnits(account.tokenBalance, props.symbol)}${account.sellCommitted > 0n ? `, ${formatTokenUnits(account.sellCommitted, props.symbol)} ya ofrecidos` : ""}.`
                  : `Tenés ${formatUsdcUnits(account.usdcBalance)} en USDC.`}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="orden-precio" className="text-xs font-semibold text-ink">
              Precio por token (USD)
            </label>
            <input
              id="orden-precio"
              inputMode="decimal"
              autoComplete="off"
              value={priceText}
              disabled={tx.busy}
              onChange={(e) => setPriceText(sanitizeDecimalInput(e.target.value, PRICE_DECIMALS_INPUT))}
              className="figure mt-1 w-full rounded-[var(--radius-control)] border border-rule-strong bg-card px-3 py-2 text-base text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
            <p className="mt-1 text-xs text-ink-muted">
              {props.lastPriceUSD !== null ? `Último: ${formatPrice(props.lastPriceUSD)}` : `Emisión: ${formatPrice(props.issuePriceUSD)}`}
              {bestBid && ` · Mejor compra: ${formatPrice(usdcToNumber(bestBid.price))}`}
              {bestAsk && ` · Mejor venta: ${formatPrice(usdcToNumber(bestAsk.price))}`}
            </p>
          </div>
          <dl className="space-y-1 rounded-[var(--radius-control)] bg-paper px-3 py-2 text-sm">
            <Row label="Valor de la orden" value={formatUsdcUnits(value)} />
            <Row label={`Comisión al ejecutarse (${pct(side === "sell" ? book.sellerFeeBps : book.buyerFeeBps)} %)`} value={formatUsdcUnits(fee)} />
            <Row label={side === "sell" ? "Recibís si se toma toda" : "Pagás si se toma toda"} value={formatUsdcUnits(side === "sell" ? value - fee : value + fee)} strong />
          </dl>
          {problem && <p className="text-sm text-caution">{problem}</p>}
          <TxProgress tx={tx} chainId={props.chainId} approveLabel={side === "sell" ? `Autorizá el uso de ${props.symbol}` : "Autorizá el uso de USDC"} />
          <button
            type="submit"
            disabled={Boolean(problem) || amount === 0n || price === 0n || tx.busy}
            className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-deep disabled:cursor-not-allowed disabled:bg-rule-strong"
          >
            {tx.busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {tx.busy ? "Esperando confirmación…" : side === "sell" ? "Publicar orden de venta" : "Publicar orden de compra"}
          </button>
          <p className="text-xs leading-relaxed text-ink-muted">
            Publicar no inmoviliza tus fondos: autorizás al mercado a usarlos y la operación se liquida recién cuando alguien
            toma tu orden. Si los movés, la orden queda sin respaldo hasta que vuelvan. Mínimo por orden:{" "}
            {formatUsdcUnits(book.minOrderValue)}.
          </p>
        </form>
      )}
    </section>
  );
}

function MyOrders({ m, props, book }: { m: Market; props: MarketPanelProps; book: MarketBook }) {
  const { address } = useAccount();
  if (!address) return null;
  const me = getAddress(address);
  const mine = [...book.asks, ...book.bids].filter((o) => o.maker === me);
  if (mine.length === 0) return null;
  return (
    <section aria-labelledby="mis-ordenes" className="rounded-[var(--radius-card)] border border-rule bg-card p-4">
      <h3 id="mis-ordenes" className="heading text-base text-ink">
        Tus órdenes activas
      </h3>
      <ul className="mt-2 divide-y divide-rule">
        {mine.map((order) => (
          <MyOrderRow key={order.id.toString()} order={order} m={m} props={props} />
        ))}
      </ul>
    </section>
  );
}

function MyOrderRow({ order, m, props }: { order: MarketOrder; m: Market; props: MarketPanelProps }) {
  const tx = useMarketTx(props.chainId);
  const unbacked = order.fillable < order.remaining;
  return (
    <li className="py-2.5 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-ink">
            <span className={`font-semibold ${order.side === "sell" ? "text-danger" : "text-yield"}`}>{order.side === "sell" ? "Venta" : "Compra"}</span>{" "}
            de {formatTokenUnits(order.remaining, props.symbol)} a {formatPrice(usdcToNumber(order.price))}
          </p>
          {order.remaining < order.amount && <p className="text-xs text-ink-muted">Se tomaron {formatTokenUnits(order.amount - order.remaining, props.symbol)}.</p>}
          {unbacked && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-caution">
              <TriangleAlert className="h-3.5 w-3.5" aria-hidden /> Respaldo actual: {formatTokenUnits(order.fillable, props.symbol)}. Revisá tu saldo
              o la autorización.
            </p>
          )}
        </div>
        <button
          type="button"
          disabled={tx.busy}
          onClick={() => m.cancel(tx, order)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border border-rule px-2.5 py-1.5 text-xs font-semibold text-ink hover:border-rule-strong disabled:opacity-60"
        >
          {tx.busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          {tx.busy ? "Retirando…" : "Retirar"}
        </button>
      </div>
      {tx.step === "error" && tx.error && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {tx.error}
        </p>
      )}
    </li>
  );
}

function TxProgress({ tx, chainId, approveLabel }: { tx: Tx; chainId: number; approveLabel: string }) {
  if (tx.step === "error" && tx.error) {
    return (
      <p role="alert" className="flex gap-2 rounded-[var(--radius-control)] bg-danger-soft px-3 py-2 text-sm text-danger">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        {tx.error}
      </p>
    );
  }
  if (!tx.busy) return null;
  const labels: Partial<Record<MarketTxStep, string>> = {
    approving: approveLabel,
    signing: "Confirmá la operación en tu billetera",
    confirming: "Esperando la confirmación de la red",
    recording: "Registrando la operación",
  };
  return (
    <p className="flex items-center gap-2 text-sm text-ink" aria-live="polite">
      <Loader2 className="h-4 w-4 animate-spin text-brand" aria-hidden />
      {labels[tx.step]}
      {tx.hash && (
        <span className="text-xs text-ink-muted">
          · <ChainLink kind="tx" value={tx.hash} chainId={chainId} />
        </span>
      )}
    </p>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={`tabular whitespace-nowrap ${strong ? "font-semibold text-ink" : "text-ink"}`}>{value}</dd>
    </div>
  );
}

function Notice({ tone, title, children }: { tone: "caution" | "danger" | "muted"; title: string; children: ReactNode }) {
  const styles = {
    caution: "border-caution/30 bg-caution-soft text-caution",
    danger: "border-danger/30 bg-danger-soft text-danger",
    muted: "border-rule bg-card text-ink",
  }[tone];
  return (
    <div className={`rounded-[var(--radius-card)] border p-4 ${styles}`}>
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-sm text-ink">{children}</p>
    </div>
  );
}

/** Unidades de token → texto para el campo ("12,5"), sin ceros de más y con hasta 6 decimales. */
function trimUnits(units: bigint) {
  const whole = units / TOKEN_UNIT;
  const fraction = ((units % TOKEN_UNIT) / 10n ** 12n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole},${fraction}` : whole.toString();
}
