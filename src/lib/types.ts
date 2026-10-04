import type { Address } from "viem";
import type { Category, DocumentType, Network, ProjectStatus } from "@/generated/prisma/enums";

/** Moneda aceptada para pagar una inversión además de USDC. */
export interface PaymentAssetInfo {
  symbol: string;
  name: string;
  /** "native" = moneda de la red (ETH o POL). */
  address: Address | "native";
  decimals: number;
  isMock: boolean;
}

/** Contratos y parámetros públicos de una red. */
export interface ChainInfo {
  chainId: number;
  name: string;
  network: Network;
  nativeSymbol: string;
  market: Address;
  paymentRouter: Address;
  paymentToken: Address;
  buyerFeeBps: number;
  sellerFeeBps: number;
  minOrderValueUSD: number;
  paymentAssets: PaymentAssetInfo[];
}

/** Resumen del mercado secundario de un token. */
export interface MarketStats {
  lastPriceUSD: number;
  /** Variación del último precio contra el de hace 24 h / 7 días (en %), si hubo operaciones antes. */
  change24hPct: number | null;
  change7dPct: number | null;
  volume30dUSD: number;
  trades30d: number;
  lastTradeAt: string;
}

/** Datos de un proyecto listos para serializar hacia componentes de cliente (sin Decimal). */
export interface ProjectSummary {
  slug: string;
  title: string;
  summary: string;
  category: Category;
  network: Network;
  status: ProjectStatus;
  location: string;
  images: string[];
  targetAmountUSD: number;
  softCapUSD: number;
  collectedAmountUSD: number;
  investorCount: number;
  minTicketUSD: number;
  tokenPriceUSD: number;
  estimatedIrr: number;
  capRate: number | null;
  termMonths: number;
  opensAt: string;
  closesAt: string;
  tokenSymbol: string;
  tokenAddress: string | null;
  offeringAddress: string | null;
  chainId: number | null;
  market: MarketStats | null;
}

export interface ProjectDocumentView {
  id: string;
  type: DocumentType;
  title: string;
  url: string;
  sha256: string;
  sizeBytes: number | null;
}

export interface DistributionView {
  id: string;
  amountUSD: number;
  txHash: string;
  executedAt: string;
}

export interface ProjectDetail extends ProjectSummary {
  description: string[];
  highlights: string[];
  risks: string[];
  issuer: string;
  trustee: string;
  assetValuationUSD: number;
  documents: ProjectDocumentView[];
  distributions: DistributionView[];
  /** Contratos de la red del proyecto (null si todavía no se desplegó). */
  chain: ChainInfo | null;
}

/** Un día del gráfico de precio: apertura, máximo, mínimo, cierre y volumen. */
export interface PricePoint {
  /** Fecha del día (AAAA-MM-DD, hora argentina). */
  day: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeUSD: number;
  trades: number;
}

export interface TradeView {
  id: string;
  priceUSD: number;
  tokenAmount: number;
  valueUSD: number;
  buyer: string;
  seller: string;
  txHash: string;
  executedAt: string;
}

export interface MarketChart {
  issuePriceUSD: number;
  points: PricePoint[];
  recentTrades: TradeView[];
  stats: MarketStats | null;
}

export interface PortfolioHolding {
  slug: string;
  title: string;
  category: Category;
  network: Network;
  chainId: number;
  tokenSymbol: string;
  tokenAddress: string;
  offeringAddress: string;
  offeringState: "Upcoming" | "Open" | "Closed" | "Successful" | "Failed";
  tokens: number;
  contributedUSD: number;
  tokenPriceUSD: number;
  /** Último precio del mercado secundario, si hubo operaciones. */
  lastPriceUSD: number | null;
  estimatedIrr: number;
  pendingDistributionsUSD: number;
  collectedDistributionsUSD: number;
  refundAvailable: boolean;
}

export interface PortfolioView {
  address: string;
  holdings: PortfolioHolding[];
  history: {
    id: string;
    slug: string;
    title: string;
    kind: "Suscripción" | "Compra en mercado" | "Venta en mercado";
    amountUSD: number;
    tokenAmount: number;
    status: "CONFIRMADA" | "REEMBOLSADA";
    chainId: number;
    txHash: string;
    executedAt: string;
  }[];
  totals: {
    investedUSD: number;
    marketValueUSD: number;
    pendingDistributionsUSD: number;
    collectedDistributionsUSD: number;
  };
  /** Estado de la billetera en el IdentityRegistry de cada red. */
  verifications: { chainId: number; name: string; verified: boolean; expiresAt: string | null; reachable: boolean }[];
}
