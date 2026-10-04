"use client";

import { Check, Loader2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { parseUnits } from "viem";
import { useAccount, useSwitchChain } from "wagmi";
import { useMounted } from "@/hooks/useMounted";
import {
  SLIPPAGE_BPS,
  purchaseProblem,
  quoteTokens,
  useAssetInvestment,
  usePaymentQuote,
  type InvestStep,
} from "@/hooks/useAssetInvestment";
import { IS_TESTNET, NATIVE_FAUCET, isAppChain } from "@/lib/chains";
import { formatAssetUnits, formatDate, formatTokenUnits, formatUSD, formatUsdcUnits, relativeDays, usdcToNumber } from "@/lib/format";
import type { ChainInfo, PaymentAssetInfo, ProjectSummary } from "@/lib/types";
import { ChainLink } from "./chain-link";
import { ConnectButton } from "./connect-button";
import { FundingProgress } from "./funding-progress";
import { KycAlert } from "./kyc-alert";
import { NetworkBadge } from "./network-badge";

const USDC = 1_000_000n;
const FAUCET_AMOUNT = 10_000n * USDC;
/** Cuánto entrega la canilla de prueba de cada moneda (dentro del límite del contrato). */
const TEST_ASSET_FAUCET: Record<string, string> = { WBTC: "1", WETH: "5", USDT: "10000" };

type Props = Pick<
  ProjectSummary,
  | "slug"
  | "tokenSymbol"
  | "tokenPriceUSD"
  | "minTicketUSD"
  | "targetAmountUSD"
  | "softCapUSD"
  | "collectedAmountUSD"
  | "investorCount"
  | "status"
  | "opensAt"
  | "closesAt"
  | "offeringAddress"
  | "tokenAddress"
  | "chainId"
  | "network"
> & {
  /** Contratos de la red del proyecto (router de pagos, monedas aceptadas). */
  chain: ChainInfo | null;
};

/** Montos rápidos: múltiplos del ticket mínimo que entran en el cupo, más "completar cupo". */
function quickAmounts(minPurchase: bigint, remaining: bigint) {
  const options = [1n, 2n, 5n, 10n].map((k) => minPurchase * k).filter((v) => v > 0n && v <= remaining);
  if (remaining > 0n && remaining < minPurchase * 10n && !options.includes(remaining)) options.push(remaining);
  return options;
}

function digitsToUnits(text: string) {
  return text ? BigInt(text) * USDC : 0n;
}

/** Panel de inversión de la ficha: lee la ronda on-chain y compra con USDC o con otra moneda. */
export function InvestmentPanel(props: Props) {
  const router = useRouter();
  const { address, isConnected, chainId } = useAccount();
  const mounted = useMounted();

  const deployed = Boolean(props.offeringAddress && props.tokenAddress && isAppChain(props.chainId));
  const inv = useAssetInvestment({
    chainId: deployed ? props.chainId : null,
    offeringAddress: deployed ? props.offeringAddress : null,
    tokenAddress: deployed ? props.tokenAddress : null,
    paymentRouter: props.chain?.paymentRouter ?? null,
  });
  const { offering, investor } = inv;

  // Cifras: on-chain si ya cargaron; si no, las del índice (lo que vino del servidor).
  const raised = offering ? usdcToNumber(offering.raised) : props.collectedAmountUSD;
  const target = offering ? usdcToNumber(offering.hardCap) : props.targetAmountUSD;
  const softCap = offering ? usdcToNumber(offering.softCap) : props.softCapUSD;
  const investors = offering ? offering.investors : props.investorCount;
  const closesAt = offering ? offering.endTime : new Date(props.closesAt);
  const opensAt = offering ? offering.startTime : new Date(props.opensAt);
  const roundStillOpen = offering
    ? offering.state === "Upcoming" || offering.state === "Open"
    : props.status === "PROXIMAMENTE" || props.status === "FONDEANDO";

  const afterChainChange = async () => {
    await fetch(`/api/projects/${props.slug}/sync`, { method: "POST" }).catch(() => undefined);
    router.refresh();
  };

  return (
    <section aria-labelledby="invertir-titulo" className="rounded-[var(--radius-card)] border border-rule bg-card">
      <header className="border-b border-rule px-5 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <h2 id="invertir-titulo" className="heading text-xl text-ink">
            Invertir en {props.tokenSymbol}
          </h2>
          <NetworkBadge network={props.network} className="mt-0.5" />
        </div>
        <p className="mt-1 text-sm text-ink-muted">
          Cada token cuesta {formatUSD(props.tokenPriceUSD)} y representa una cuotaparte del fideicomiso.
        </p>
      </header>

      <div className="border-b border-rule px-5 py-4">
        <FundingProgress collected={raised} target={target} softCap={softCap} />
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-ink-muted">Inversores</dt>
          <dd className="tabular text-right text-ink">{investors}</dd>
          <dt className="text-ink-muted">Mínimo para cerrar</dt>
          <dd className="tabular text-right text-ink">{formatUSD(softCap)}</dd>
          <dt className="text-ink-muted">{roundStillOpen ? "Cierre" : offering?.endsInFuture ? "Cierre previsto" : "Cerró"}</dt>
          <dd className="text-right text-ink">{formatDate(closesAt)}</dd>
        </dl>
      </div>

      <div className="px-5 py-5">
        {!deployed ? (
          <NotDeployed network={props.network} />
        ) : inv.isLoading || !mounted ? (
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Leyendo la ronda en {inv.chain.name}…
          </p>
        ) : inv.loadError || !offering ? (
          <Notice tone="danger" title="No pudimos leer la ronda">
            {inv.loadError ?? "Probá recargar la página."}
          </Notice>
        ) : offering.paused ? (
          <Notice tone="caution" title="Operaciones pausadas">
            El fiduciario pausó este proyecto. Las compras se reanudan cuando lo habilite de nuevo.
          </Notice>
        ) : offering.state === "Upcoming" ? (
          <div className="space-y-4">
            <p className="text-sm text-ink">
              La ronda abre el <strong className="font-semibold">{formatDate(opensAt)}</strong> ({relativeDays(opensAt)}).
            </p>
            {isConnected && address && investor && !investor.isKycApproved && (
              <KycAlert address={address} expiresAt={investor.kycExpiresAt} context="upcoming" />
            )}
            {!isConnected && <ConnectButton size="lg" />}
          </div>
        ) : offering.state === "Open" ? (
          !isConnected || !address ? (
            <div className="space-y-3">
              <p className="text-sm text-ink">
                Conectá una billetera compatible con {inv.chain.name} (MetaMask, Rabby o similar) para invertir. Antes de la
                primera compra te vamos a pedir que verifiques tu identidad.
              </p>
              <ConnectButton size="lg" />
            </div>
          ) : chainId !== inv.chainId ? (
            <WrongChain target={inv.chainId} name={inv.chain.name} />
          ) : inv.checkingKyc || !investor ? (
            <p className="flex items-center gap-2 text-sm text-ink-muted">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Verificando tu billetera…
            </p>
          ) : !investor.isKycApproved ? (
            <KycAlert address={address} expiresAt={investor.kycExpiresAt} />
          ) : (
            <BuyForm inv={inv} symbol={props.tokenSymbol} assets={props.chain?.paymentAssets ?? []} />
          )
        ) : offering.state === "Closed" ? (
          <div className="space-y-3">
            <p className="text-sm text-ink">
              {offering.endsInFuture ? "La ronda completó su cupo." : `La ronda cerró el ${formatDate(closesAt)}.`} Falta el
              cierre formal: si se alcanzó el mínimo, los fondos pasan al fideicomiso; si no, se habilitan los reembolsos.
              Cualquier persona puede ejecutarlo.
            </p>
            {isConnected ? (
              <ActionButton
                busy={inv.action.busy}
                onClick={async () => {
                  if (await inv.finalize()) await afterChainChange();
                }}
              >
                Ejecutar el cierre de la ronda
              </ActionButton>
            ) : (
              <ConnectButton size="lg" />
            )}
            <ActionFeedback action={inv.action} chainId={inv.chainId} />
          </div>
        ) : offering.state === "Successful" ? (
          <Notice tone="yield" title="Ronda fondeada">
            Se recaudaron {formatUsdcUnits(offering.raised)} y los fondos se transfirieron a la tesorería del fideicomiso.
            Las rentas se distribuyen en USDC a quienes tengan tokens.
          </Notice>
        ) : (
          <div className="space-y-3">
            <Notice tone="caution" title="La ronda no se concretó">
              No alcanzó el mínimo de {formatUsdcUnits(offering.softCap)} o el fiduciario la canceló. Cada inversor recupera el
              100 % de su aporte.
            </Notice>
            {investor && investor.contribution > 0n && (
              <ActionButton
                busy={inv.action.busy}
                onClick={async () => {
                  if (await inv.refund()) await afterChainChange();
                }}
              >
                Pedir el reembolso de {formatUsdcUnits(investor.contribution)}
              </ActionButton>
            )}
            {/* Fuera del condicional: después del reembolso el aporte queda en 0 y la confirmación tiene que seguir visible. */}
            <ActionFeedback action={inv.action} chainId={inv.chainId} />
          </div>
        )}
      </div>

      {deployed && mounted && offering && investor && (investor.tokenBalance > 0n || investor.collectedDistributions > 0n) && (
        <Position inv={inv} symbol={props.tokenSymbol} onChange={afterChainChange} />
      )}
    </section>
  );
}

type Inv = ReturnType<typeof useAssetInvestment>;

function BuyForm({ inv, symbol, assets }: { inv: Inv; symbol: string; assets: PaymentAssetInfo[] }) {
  const router = useRouter();
  const offering = inv.offering!;
  const investor = inv.investor!;
  const initial = offering.remaining < offering.minPurchase ? offering.remaining : offering.minPurchase;
  const [text, setText] = useState(() => (initial % USDC === 0n ? (initial / USDC).toString() : ""));
  const [exact, setExact] = useState<bigint | null>(() => (initial % USDC === 0n ? null : initial));
  const [payWith, setPayWith] = useState("USDC");
  const asset = assets.find((a) => a.symbol === payWith) ?? null; // null = USDC directo
  const amount = exact ?? digitsToUnits(text);
  const tokens = quoteTokens(amount, offering.pricePerToken);
  const baseProblem = purchaseProblem(amount, offering, investor, { payingWithUsdc: asset === null });
  const quote = usePaymentQuote({
    chainId: inv.chainId,
    router: inv.paymentRouter,
    asset,
    usdcAmount: asset && !baseProblem ? amount : 0n,
  });
  const quoteData = asset && !baseProblem ? quote.data : undefined;
  const assetProblem =
    asset && !baseProblem
      ? quote.isError
        ? `No pudimos cotizar ${asset.symbol}. Probá de nuevo en unos segundos o pagá con USDC.`
        : quoteData && quoteData.balance < quoteData.maxAmountIn
          ? `No tenés ${asset.symbol} suficiente: necesitás hasta ${formatAssetUnits(quoteData.maxAmountIn, asset.decimals, asset.symbol)}.`
          : null
      : null;
  const problem = baseProblem ?? assetProblem;
  const waitingQuote = Boolean(asset && !baseProblem && !quoteData && !quote.isError);
  const needsApproval = asset
    ? asset.address !== "native" && Boolean(quoteData && quoteData.allowance < quoteData.maxAmountIn)
    : investor.allowance < amount;
  const running = inv.step === "approving" || inv.step === "buying" || inv.step === "recording";
  const chips = useMemo(() => quickAmounts(offering.minPurchase, offering.remaining), [offering.minPurchase, offering.remaining]);
  const payOptions = ["USDC", ...assets.map((a) => a.symbol)];

  if (inv.step === "done" && inv.purchase) {
    const p = inv.purchase;
    return (
      <div className="space-y-4" role="status">
        <div className="flex gap-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-yield text-white">
            <Check className="h-4 w-4" aria-hidden />
          </span>
          <div className="text-sm">
            <p className="heading text-base text-ink">
              Invertiste {formatUsdcUnits(p.paymentAmount)}
              {p.paidWith && ` (pagaste ${formatAssetUnits(p.paidWith.amountIn, p.paidWith.decimals, p.paidWith.symbol)})`} y
              recibiste {formatTokenUnits(p.tokenAmount, symbol)}.
            </p>
            <p className="mt-1 text-ink-muted">
              Los USDC quedan en garantía en el contrato de la ronda hasta el cierre. Si no se alcanza el mínimo, los recuperás
              completos.
            </p>
            {!p.recorded && (
              <p className="mt-1 text-ink-muted">La compra está confirmada en la red; tu cartera la va a mostrar en unos minutos.</p>
            )}
            <p className="mt-2">
              Transacción: <ChainLink kind="tx" value={p.txHash} chainId={inv.chainId} />
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/portfolio"
            className="inline-flex items-center rounded-[var(--radius-control)] bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink/90"
          >
            Ver mi cartera
          </Link>
          <button
            type="button"
            onClick={() => {
              inv.resetPurchase();
              router.refresh();
            }}
            className="inline-flex items-center rounded-[var(--radius-control)] border border-rule px-4 py-2.5 text-sm font-semibold text-ink hover:border-rule-strong"
          >
            Hacer otra inversión
          </button>
        </div>
      </div>
    );
  }

  const submitLabel = (() => {
    if (running) return "Esperando confirmación…";
    const value = amount > 0n ? formatUsdcUnits(amount) : "";
    if (asset) return needsApproval ? `Autorizar ${asset.symbol} e invertir ${value}`.trim() : `Pagar con ${asset.symbol} e invertir ${value}`.trim();
    return needsApproval && amount > 0n ? `Autorizar e invertir ${value}` : `Invertir ${value}`.trim();
  })();

  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (problem || running || waitingQuote) return;
        const result = asset ? await inv.buyWithAsset(asset, amount) : await inv.buyAssetTokens(amount);
        if (result) router.refresh();
      }}
    >
      <div>
        <label htmlFor="monto" className="text-sm font-semibold text-ink">
          Monto a invertir
        </label>
        <div className="mt-1.5 flex items-center rounded-[var(--radius-control)] border border-rule-strong bg-card focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
          <span className="pl-3 text-sm font-semibold text-ink-muted">USD</span>
          <input
            id="monto"
            name="monto"
            inputMode="numeric"
            autoComplete="off"
            value={
              exact !== null
                ? usdcToNumber(exact).toFixed(2).replace(".", ",")
                : text && Number(text).toLocaleString("es-AR", { maximumFractionDigits: 0 })
            }
            onChange={(event) => {
              // Solo se escriben dólares enteros ("1.000" con punto de miles también vale).
              // Los centavos aparecen únicamente con "Completar cupo"; si se edita, se conservan los enteros.
              const raw = exact !== null ? (event.target.value.split(",")[0] ?? "") : event.target.value;
              setExact(null);
              setText(raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 12));
            }}
            disabled={running}
            aria-describedby="monto-ayuda"
            className="figure w-full bg-transparent px-2 py-2.5 text-xl text-ink outline-none"
          />
        </div>
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Montos sugeridos">
          {chips.map((value) => {
            const active = amount === value;
            const isRemaining = value === offering.remaining && value !== offering.minPurchase;
            return (
              <li key={value.toString()}>
                <button
                  type="button"
                  disabled={running}
                  onClick={() => {
                    if (value % USDC === 0n) {
                      setExact(null);
                      setText((value / USDC).toString());
                    } else {
                      setExact(value);
                    }
                  }}
                  className={`tabular rounded-full border px-2.5 py-1 text-xs font-medium ${active ? "border-ink bg-ink text-white" : "border-rule text-ink hover:border-rule-strong"}`}
                >
                  {isRemaining ? `Completar cupo: ${formatUsdcUnits(value)}` : formatUsdcUnits(value)}
                </button>
              </li>
            );
          })}
        </ul>
        <p id="monto-ayuda" className="mt-3 text-sm text-ink">
          {amount > 0n ? (
            <>
              Recibís <strong className="font-semibold">{formatTokenUnits(tokens, symbol)}</strong>
            </>
          ) : (
            "Ingresá el monto en dólares."
          )}
        </p>
      </div>

      {assets.length > 0 && (
        <fieldset disabled={running}>
          <legend className="text-sm font-semibold text-ink">Pagar con</legend>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {payOptions.map((option) => {
              const active = payWith === option;
              return (
                <label
                  key={option}
                  className={`cursor-pointer rounded-[var(--radius-control)] border px-3 py-1.5 text-sm font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand ${
                    active ? "border-ink bg-ink text-white" : "border-rule bg-card text-ink hover:border-rule-strong"
                  }`}
                >
                  <input
                    type="radio"
                    name="pagar-con"
                    value={option}
                    checked={active}
                    onChange={() => {
                      setPayWith(option);
                      inv.resetPurchase();
                    }}
                    className="sr-only"
                  />
                  {option}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      <div className="rounded-[var(--radius-control)] bg-paper px-3 py-2.5 text-sm">
        {asset ? (
          <AssetQuote
            asset={asset}
            amountReady={!baseProblem}
            quote={quoteData}
            loading={waitingQuote}
            onFaucet={
              asset.isMock && asset.address !== "native"
                ? () => inv.assetFaucet(asset, parseUnits(TEST_ASSET_FAUCET[asset.symbol] ?? "1", asset.decimals))
                : undefined
            }
            faucetBusy={inv.faucetAction.busy}
            faucetLabel={`Cargar ${TEST_ASSET_FAUCET[asset.symbol] ?? "1"} ${asset.symbol} de prueba`}
          />
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <span className="text-ink-muted">Tu saldo</span>
              <span className="tabular font-medium text-ink">{formatUsdcUnits(investor.paymentBalance)} en USDC</span>
            </div>
            {offering.faucetAvailable && (
              <div className="mt-2 flex items-center justify-between gap-3 border-t border-rule pt-2">
                <span className="text-xs text-ink-muted">Red de prueba: el USDC no tiene valor.</span>
                <button
                  type="button"
                  disabled={inv.faucetAction.busy || running}
                  onClick={() => inv.faucet(FAUCET_AMOUNT)}
                  className="shrink-0 text-xs font-semibold text-brand underline underline-offset-2 disabled:opacity-50"
                >
                  {inv.faucetAction.busy ? "Acreditando…" : "Cargar 10.000 USDC de prueba"}
                </button>
              </div>
            )}
          </>
        )}
        {investor.gasBalance === 0n && (
          <p className="mt-2 border-t border-rule pt-2 text-xs text-caution">
            Necesitás {inv.chain.nativeCurrency.symbol} para pagar la comisión de red.
            {IS_TESTNET && NATIVE_FAUCET[inv.chainId] && (
              <>
                {" "}
                <a href={NATIVE_FAUCET[inv.chainId]!.url} target="_blank" rel="noreferrer" className="underline">
                  Pedilo gratis en {NATIVE_FAUCET[inv.chainId]!.label}
                </a>
                .
              </>
            )}
          </p>
        )}
        {inv.faucetAction.error && <p className="mt-2 text-xs text-danger">{inv.faucetAction.error}</p>}
      </div>

      {running && <Progress step={inv.step} needsApproval={needsApproval} hash={inv.pendingHash} chainId={inv.chainId} asset={asset} />}

      {inv.step === "error" && inv.errorMsg && (
        <p role="alert" className="flex gap-2 rounded-[var(--radius-control)] bg-danger-soft px-3 py-2.5 text-sm text-danger">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {inv.errorMsg}
        </p>
      )}

      {amount > 0n && problem && !running && <p className="text-sm text-caution">{problem}</p>}

      <button
        type="submit"
        disabled={Boolean(problem) || running || waitingQuote}
        className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-brand px-4 py-3 text-base font-semibold text-white hover:bg-brand-deep disabled:cursor-not-allowed disabled:bg-rule-strong"
      >
        {running && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {submitLabel}
      </button>
      <p className="text-xs leading-relaxed text-ink-muted">
        {asset
          ? `${needsApproval ? `Tu billetera te va a pedir dos firmas: autorizar ${asset.symbol} por el máximo cotizado y confirmar el pago. ` : "Tu billetera te va a pedir que confirmes el pago. "}${asset.symbol} se convierte a USDC en la misma transacción: el fideicomiso siempre recibe dólares, y lo que sobre de la tolerancia vuelve a tu billetera.`
          : `${needsApproval && amount > 0n ? "Tu billetera te va a pedir dos firmas: autorizar el uso de USDC por este monto exacto y confirmar la inversión. " : "Tu billetera te va a pedir que confirmes la inversión. "}El USDC queda en garantía en el contrato de la ronda hasta el cierre.`}
      </p>
    </form>
  );
}

/** Cotización del pago con otra moneda: estimado, máximo con tolerancia y saldo. */
function AssetQuote({
  asset,
  amountReady,
  quote,
  loading,
  onFaucet,
  faucetBusy,
  faucetLabel,
}: {
  asset: PaymentAssetInfo;
  amountReady: boolean;
  quote: { amountIn: bigint; maxAmountIn: bigint; balance: bigint } | undefined;
  loading: boolean;
  onFaucet?: () => void;
  faucetBusy: boolean;
  faucetLabel: string;
}) {
  const fmt = (units: bigint) => formatAssetUnits(units, asset.decimals, asset.symbol);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-ink-muted">Pagás aproximadamente</span>
        <span className="tabular font-semibold text-ink">
          {!amountReady ? "—" : loading || !quote ? <Loader2 className="inline h-4 w-4 animate-spin text-ink-muted" aria-label="Cotizando" /> : fmt(quote.amountIn)}
        </span>
      </div>
      {quote && amountReady && (
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="text-ink-muted">Máximo, con {Number(SLIPPAGE_BPS) / 100} % de tolerancia</span>
          <span className="tabular text-ink">{fmt(quote.maxAmountIn)}</span>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 border-t border-rule pt-1.5">
        <span className="text-ink-muted">Tu saldo</span>
        <span className="tabular font-medium text-ink">{quote ? fmt(quote.balance) : "—"}</span>
      </div>
      {asset.isMock && (
        <div className="flex items-center justify-between gap-3 border-t border-rule pt-1.5">
          <span className="text-xs text-ink-muted">Conversión de prueba a precio fijo, no es el del mercado.</span>
          {onFaucet && (
            <button
              type="button"
              disabled={faucetBusy}
              onClick={onFaucet}
              className="shrink-0 text-xs font-semibold text-brand underline underline-offset-2 disabled:opacity-50"
            >
              {faucetBusy ? "Acreditando…" : faucetLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Progress({
  step,
  needsApproval,
  hash,
  chainId,
  asset,
}: {
  step: InvestStep;
  needsApproval: boolean;
  hash: string | null;
  chainId: number;
  asset: PaymentAssetInfo | null;
}) {
  const steps = [
    ...(needsApproval || step === "approving" ? [{ key: "approving", label: `Autorizá el uso de ${asset?.symbol ?? "USDC"}` }] : []),
    { key: "buying", label: asset ? `Confirmá el pago con ${asset.symbol}` : "Confirmá la inversión" },
    { key: "recording", label: "Registro en tu cartera" },
  ];
  const current = steps.findIndex((s) => s.key === step);
  return (
    <ol className="space-y-2 rounded-[var(--radius-control)] border border-rule px-3 py-3 text-sm" aria-live="polite">
      {steps.map((s, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={s.key} className="flex items-center gap-2.5">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-bold ${done ? "bg-yield text-white" : active ? "bg-brand text-white" : "bg-paper text-ink-faint ring-1 ring-rule"}`}
            >
              {done ? <Check className="h-3 w-3" aria-hidden /> : index + 1}
            </span>
            <span className={active ? "font-semibold text-ink" : done ? "text-ink-muted" : "text-ink-faint"}>{s.label}</span>
            {active && <Loader2 className="ml-auto h-4 w-4 animate-spin text-brand" aria-hidden />}
          </li>
        );
      })}
      {hash && (
        <li className="pt-1 text-xs text-ink-muted">
          Transacción enviada: <ChainLink kind="tx" value={hash} chainId={chainId} />
        </li>
      )}
    </ol>
  );
}

function Position({ inv, symbol, onChange }: { inv: Inv; symbol: string; onChange: () => Promise<void> }) {
  const { address } = useAccount();
  const investor = inv.investor!;
  // `inv.action` también lo usan el cierre y el reembolso: acá solo se muestra el resultado del cobro.
  const [claimRequested, setClaimRequested] = useState(false);
  return (
    <footer className="border-t border-rule bg-paper/60 px-5 py-4">
      <h3 className="text-sm font-semibold text-ink">Tu posición</h3>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-ink-muted">Tokens</dt>
        <dd className="tabular text-right font-medium text-ink">{formatTokenUnits(investor.tokenBalance, symbol)}</dd>
        {investor.contribution > 0n && (
          <>
            <dt className="text-ink-muted">Aportado en esta ronda</dt>
            <dd className="tabular text-right text-ink">{formatUsdcUnits(investor.contribution)}</dd>
          </>
        )}
        <dt className="text-ink-muted">Rentas cobradas</dt>
        <dd className="tabular text-right text-ink">{formatUsdcUnits(investor.collectedDistributions)}</dd>
        <dt className="text-ink-muted">Rentas a cobrar</dt>
        <dd className={`tabular text-right font-semibold ${investor.pendingDistributions > 0n ? "text-yield" : "text-ink"}`}>
          {formatUsdcUnits(investor.pendingDistributions)}
        </dd>
      </dl>
      {investor.pendingDistributions > 0n &&
        (investor.isKycApproved ? (
          <div className="mt-3">
            <ActionButton
              busy={inv.action.busy}
              variant="secondary"
              onClick={async () => {
                setClaimRequested(true);
                if (await inv.claimDistributions()) await onChange();
              }}
            >
              Cobrar {formatUsdcUnits(investor.pendingDistributions)}
            </ActionButton>
          </div>
        ) : (
          address && (
            <div className="mt-3">
              <KycAlert address={address} expiresAt={investor.kycExpiresAt} context="claim" />
            </div>
          )
        ))}
      {/* Fuera del condicional: después de cobrar, las rentas pendientes quedan en 0 y la confirmación sigue visible. */}
      {claimRequested && <ActionFeedback action={inv.action} chainId={inv.chainId} />}
    </footer>
  );
}

function NotDeployed({ network }: { network: ProjectSummary["network"] }) {
  return (
    <Notice tone="muted" title="Contratos pendientes">
      Este proyecto todavía no tiene su token ni su ronda desplegados en {network === "ethereum" ? "Ethereum" : "Polygon"}.
      {process.env.NODE_ENV !== "production" && (
        <>
          {" "}
          En desarrollo: corré <code className="font-mono text-xs">npm run demo:local</code> (despliega y sincroniza las dos
          redes locales).
        </>
      )}
    </Notice>
  );
}

function WrongChain({ target, name }: { target: number; name: string }) {
  const { switchChain, isPending, error } = useSwitchChain();
  return (
    <div className="space-y-3">
      <Notice tone="caution" title="Tu billetera está en otra red">
        Este proyecto opera en {name}. Cambiá de red para ver tu saldo e invertir.
      </Notice>
      <ActionButton busy={isPending} onClick={() => switchChain({ chainId: target })}>
        Cambiar a {name}
      </ActionButton>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {/rejected/i.test(error.message)
            ? "Cancelaste el cambio de red."
            : `Tu billetera no pudo cambiar de red. Agregá ${name} (chainId ${target}) a mano y volvé a intentar.`}
        </p>
      )}
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  busy,
  variant = "primary",
}: {
  children: ReactNode;
  onClick: () => void;
  busy: boolean;
  variant?: "primary" | "secondary";
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className={`inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] px-4 py-2.5 text-sm font-semibold disabled:opacity-60 ${
        variant === "primary" ? "bg-brand text-white hover:bg-brand-deep" : "border border-yield/40 bg-card text-yield hover:border-yield"
      }`}
    >
      {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {busy ? "Esperando confirmación…" : children}
    </button>
  );
}

function ActionFeedback({ action, chainId }: { action: Inv["action"]; chainId: number }) {
  if (action.status === "error" && action.error) {
    return (
      <p role="alert" className="mt-2 text-sm text-danger">
        {action.error}
      </p>
    );
  }
  if (action.status === "success" && action.hash) {
    return (
      <p role="status" className="mt-2 text-sm text-yield">
        Listo. Transacción <ChainLink kind="tx" value={action.hash} chainId={chainId} />
      </p>
    );
  }
  return null;
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: "yield" | "caution" | "danger" | "muted";
  title: string;
  children: ReactNode;
}) {
  const styles = {
    yield: "border-yield/25 bg-yield-soft text-yield",
    caution: "border-caution/30 bg-caution-soft text-caution",
    danger: "border-danger/30 bg-danger-soft text-danger",
    muted: "border-rule bg-paper text-ink",
  }[tone];
  return (
    <div className={`rounded-[var(--radius-control)] border p-4 ${styles}`}>
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-sm text-ink">{children}</p>
    </div>
  );
}
