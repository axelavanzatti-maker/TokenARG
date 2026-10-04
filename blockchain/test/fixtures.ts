import assert from "node:assert/strict";
import type { network } from "hardhat";
import { keccak256, parseUnits, stringToHex } from "viem";

export type Connection = Awaited<ReturnType<typeof network.create>>;

export const usdc = (n: number | string) => parseUnits(String(n), 6);
export const tokens = (n: number | string) => parseUnits(String(n), 18);
export const DAY = 86_400n;
export const YEAR = 365n * DAY;
export const DOC_HASH = keccak256(stringToHex("contrato-fideicomiso-torre-cordoba-v1.pdf"));

/** Estados de TokenOffering.State */
export const OfferingState = { Upcoming: 0, Open: 1, Closed: 2, Successful: 3, Failed: 4 } as const;

export interface OfferingParams {
  price: bigint;
  minPurchase: bigint;
  softCap: bigint;
  hardCap: bigint;
  startOffset: bigint;
  duration: bigint;
}

export const DEFAULT_PARAMS: OfferingParams = {
  price: usdc(1),
  minPurchase: usdc(100),
  softCap: usdc(5_000),
  hardCap: usdc(10_000),
  startOffset: 0n,
  duration: 30n * DAY,
};

/**
 * Despliega el sistema completo como lo hace scripts/deploy.ts:
 * USDC de prueba, registro de identidad, token del activo y oferta primaria.
 * Alice, Bob y Carol tienen KYC vigente; Mallory no.
 */
export async function deploySystem(conn: Connection, overrides: Partial<OfferingParams> = {}) {
  const { viem, networkHelpers } = conn;
  const [admin, agent, treasury, alice, bob, carol, mallory] = await viem.getWalletClients();
  const p = { ...DEFAULT_PARAMS, ...overrides };
  const now = BigInt(await networkHelpers.time.latest());

  const usdcToken = await viem.deployContract("MockUSDC");
  const registry = await viem.deployContract("IdentityRegistry", [admin.account.address]);
  await registry.write.grantRole([await registry.read.AGENT_ROLE(), agent.account.address]);

  const token = await viem.deployContract("AssetToken", [
    {
      name: "Torre Residencial Córdoba Centro",
      symbol: "TRCC",
      maxSupply: (p.hardCap * 10n ** 18n) / p.price,
      admin: admin.account.address,
      identityRegistry: registry.address,
      distributionToken: usdcToken.address,
      assetValuationUSD: 350_000n,
      expectedYieldBps: 1150n,
      legalDocumentURI: "https://tokenarg.example/docs/torre-cordoba.pdf",
      legalDocumentHash: DOC_HASH,
    },
  ]);

  const offering = await viem.deployContract("TokenOffering", [
    {
      assetToken: token.address,
      paymentToken: usdcToken.address,
      treasury: treasury.account.address,
      pricePerToken: p.price,
      minPurchase: p.minPurchase,
      softCap: p.softCap,
      hardCap: p.hardCap,
      startTime: now + p.startOffset,
      endTime: now + p.startOffset + p.duration,
    },
    admin.account.address,
  ]);
  await token.write.grantRole([await token.read.MINTER_ROLE(), offering.address]);

  for (const investor of [alice, bob, carol]) {
    await registry.write.registerInvestor([investor.account.address, now + YEAR], {
      account: agent.account,
    });
  }
  for (const wallet of [admin, alice, bob, carol, mallory]) {
    await usdcToken.write.mint([wallet.account.address, usdc(100_000)]);
  }

  return { usdcToken, registry, token, offering, admin, agent, treasury, alice, bob, carol, mallory, params: p, now };
}

export type System = Awaited<ReturnType<typeof deploySystem>>;
type Wallet = System["alice"];

/** approve + buy, como lo hace el panel de inversión. */
export async function invest(sys: System, wallet: Wallet, amount: bigint) {
  await sys.usdcToken.write.approve([sys.offering.address, amount], { account: wallet.account });
  await sys.offering.write.buy([amount], { account: wallet.account });
}

/** Deposita una distribución desde la cuenta del fiduciario. */
export async function distribute(sys: System, amount: bigint) {
  await sys.usdcToken.write.approve([sys.token.address, amount], { account: sys.admin.account });
  await sys.token.write.distribute([amount], { account: sys.admin.account });
}

/** Igualdad con tolerancia de redondeo (unidades mínimas de USDC). */
export function assertClose(actual: bigint, expected: bigint, tolerance = 2n, message?: string) {
  const diff = actual > expected ? actual - expected : expected - actual;
  assert.ok(diff <= tolerance, message ?? `esperado ${expected} ± ${tolerance}, obtenido ${actual}`);
}
