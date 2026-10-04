/**
 * Datos de demo para testnet (Amoy / Sepolia): deja los proyectos que en la historia de demo ya
 * estaban fondeados con la ronda completa y el mercado secundario abierto, con órdenes de compra
 * y de venta publicadas, para que la demo pública se pueda usar de punta a punta.
 *
 * Lo hace la billetera que desplegó (tiene los roles de administración):
 *   1. se da de alta en el registro KYC (si no es el agente, toma el rol un momento y lo devuelve);
 *   2. compra el cupo de la ronda con USDC de prueba y la cierra (finalize);
 *   3. habilita las transferencias del token y publica órdenes alrededor del precio de la demo.
 *
 * Es idempotente: si se corre de nuevo, saltea lo que ya está hecho. Nunca corre en mainnet.
 *
 * Uso: npx hardhat run scripts/seed-testnet.ts --network amoy | sepolia
 *      (en una red local, solo con ALLOW_DEMO_SEED=1 y un deploy hecho con LIVE_WINDOWS=1)
 */
import { network } from "hardhat";
import { getAddress } from "viem";
import { DAY, chainInfo, confirm, loadDeployment, loadProjects, usdToUnits, wallClockSeconds } from "./lib/common.js";

const OFFERING_STATE = ["Upcoming", "Open", "Closed", "Successful", "Failed"] as const;
const FAUCET_LIMIT = 1_000_000n * 10n ** 6n;
const TOKEN_UNIT = 10n ** 18n;
const BPS = 10_000n;
/** Escalones de precio de las órdenes: ±1 %, ±2,5 % y ±4 % alrededor del precio de referencia. */
const LEVELS = [100n, 250n, 400n];
/** Parte de los tokens comprados que se ofrece en cada escalón de venta. */
const SELL_SHARE_BPS = [150n, 250n, 400n];

const { viem, networkName } = await network.create();
const publicClient = await viem.getPublicClient();
const [wallet] = await viem.getWalletClients();
if (!wallet) throw new Error("No hay billetera: configurá DEPLOYER_PRIVATE_KEY.");
const me = getAddress(wallet.account.address);

const chainId = await publicClient.getChainId();
const chain = chainInfo(chainId);
if (chain.kind === "mainnet") throw new Error("Los datos de demo no se cargan nunca en mainnet.");
if (chain.kind === "local" && process.env.ALLOW_DEMO_SEED !== "1") {
  throw new Error("En una red local la historia la arma `npm run chain:simulate`. Para probar este script: ALLOW_DEMO_SEED=1.");
}

const deployment = await loadDeployment(chainId);
const projects = (await loadProjects()).filter((p) => p.network === chain.family && p.demo.market && deployment.projects[p.slug]);
console.log(`\nDatos de demo en ${chain.name} (${networkName}) con ${me}`);
if (projects.length === 0) {
  console.log("No hay proyectos fondeados en la demo para esta red. Nada que hacer.");
  process.exit(0);
}

const usdc = await viem.getContractAt("MockUSDC", deployment.paymentToken.address);
const market = await viem.getContractAt("P2PMarket", deployment.market.address);
const registry = await viem.getContractAt("IdentityRegistry", deployment.identityRegistry);

/** USDC de prueba de la canilla, en pedidos que respetan su límite. */
async function mintUsdc(amount: bigint) {
  for (let left = amount; left > 0n; left -= left > FAUCET_LIMIT ? FAUCET_LIMIT : left) {
    await confirm(publicClient, usdc.write.mint([me, left > FAUCET_LIMIT ? FAUCET_LIMIT : left]));
  }
}

// 1. KYC de la billetera que opera ------------------------------------------------------------------
if (!(await registry.read.isVerified([me]))) {
  const agentRole = await registry.read.AGENT_ROLE();
  const isAgent = await registry.read.hasRole([agentRole, me]);
  if (!isAgent) await confirm(publicClient, registry.write.grantRole([agentRole, me]));
  await confirm(publicClient, registry.write.registerInvestor([me, wallClockSeconds() + 365n * DAY]));
  if (!isAgent) await confirm(publicClient, registry.write.renounceRole([agentRole, me]));
  console.log("✓ billetera dada de alta en el registro KYC");
}

for (const p of projects) {
  const demoMarket = p.demo.market!;
  const addresses = deployment.projects[p.slug]!;
  const offering = await viem.getContractAt("TokenOffering", addresses.offering);
  const token = await viem.getContractAt("AssetToken", addresses.token);
  console.log(`\n${p.slug} (${p.token.symbol})`);

  // 2. Ronda completa y cerrada ----------------------------------------------------------------------
  let state = OFFERING_STATE[await offering.read.state()];
  if (state === "Open") {
    const remaining = (await offering.read.hardCap()) - (await offering.read.totalRaised());
    await mintUsdc(remaining);
    await confirm(publicClient, usdc.write.approve([offering.address, remaining]));
    await confirm(publicClient, offering.write.buy([remaining]));
    console.log(`  ✓ cupo completo: ${Number(remaining) / 1e6} USDC`);
    state = OFFERING_STATE[await offering.read.state()];
  }
  if (state === "Closed") {
    await confirm(publicClient, offering.write.finalize());
    state = OFFERING_STATE[await offering.read.state()];
  }
  if (state !== "Successful") {
    console.log(`  ! la ronda está en estado ${state}: se saltea (¿la ventana todavía no abrió?)`);
    continue;
  }
  if (!(await token.read.transfersEnabled())) {
    await confirm(publicClient, token.write.setTransfersEnabled([true]));
    console.log("  ✓ transferencias habilitadas: el mercado secundario está abierto");
  }

  // 3. Órdenes de compra y de venta ------------------------------------------------------------------
  const active = await market.read.getActiveOrders([token.address]);
  if (active.some((o) => getAddress(o.maker) === me)) {
    console.log("  · ya hay órdenes publicadas por esta billetera");
    continue;
  }
  const reference = usdToUnits(demoMarket.endPrice);
  const balance = await token.read.balanceOf([me]);
  const committed = await market.read.sellCommitted([me, token.address]);
  const sells = LEVELS.map((bps, i) => ({ price: (reference * (BPS + bps)) / BPS, amount: (balance * SELL_SHARE_BPS[i]!) / BPS }));
  const buys = LEVELS.map((bps, i) => {
    const price = (reference * (BPS - bps)) / BPS;
    return { price, amount: (balance * SELL_SHARE_BPS[i]!) / BPS / 2n };
  });

  const sellTotal = sells.reduce((sum, o) => sum + o.amount, 0n);
  await confirm(publicClient, token.write.approve([market.address, committed + sellTotal]));
  for (const o of sells) {
    await confirm(publicClient, market.write.createOrder([token.address, 0, o.amount, o.price]));
  }

  const buyerFeeBps = BigInt(await market.read.buyerFeeBps());
  const alreadyBuying = await market.read.buyCommittedValue([me]);
  const buyValue = buys.reduce((sum, o) => sum + (o.amount * o.price) / TOKEN_UNIT, 0n);
  const totalValue = alreadyBuying + buyValue;
  const budget = totalValue + (totalValue * buyerFeeBps) / BPS;
  const usdcBalance = await usdc.read.balanceOf([me]);
  if (usdcBalance < budget) await mintUsdc(budget - usdcBalance);
  await confirm(publicClient, usdc.write.approve([market.address, budget]));
  for (const o of buys) {
    await confirm(publicClient, market.write.createOrder([token.address, 1, o.amount, o.price]));
  }
  const fmt = (units: bigint) => (Number(units) / 1e6).toFixed(4);
  console.log(`  ✓ ventas a ${sells.map((o) => fmt(o.price)).join(" / ")} USDC y compras a ${buys.map((o) => fmt(o.price)).join(" / ")} USDC`);
}

console.log("\nListo. La app los ve después de `npm run chain:sync` (o en el próximo deploy de Vercel).");
