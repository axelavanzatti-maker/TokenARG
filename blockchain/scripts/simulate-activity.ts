/**
 * SOLO RED LOCAL. Genera la historia de la demo y trae el nodo a la fecha de hoy.
 *
 * Los nodos locales arrancan 120 días en el pasado (hardhat.config.ts). Este script recorre
 * esa historia en orden cronológico, en la red donde se lo corra:
 *   - KYC para las cuentas #2 a #14 y USDC de prueba para todas (#15 a #19 quedan sin KYC).
 *   - Compras en cada ronda repartidas en su ventana, algunas pagadas con ETH/POL o WBTC.
 *   - Cierre de las rondas completas, rentas trimestrales y cobro de parte de ellas.
 *   - Mercado secundario: órdenes de compra y venta y operaciones con precios que cambian día
 *     a día, más algunas órdenes abiertas al final para que el libro tenga profundidad.
 *   - Al terminar, el reloj del nodo queda en la fecha y hora reales.
 *
 * La cuenta #2 participa en casi todo: importala en tu billetera para ver una cartera completa.
 *
 * Uso: npx hardhat run scripts/simulate-activity.ts --network localhost            (Polygon local)
 *      npx hardhat run scripts/simulate-activity.ts --network localhostEthereum    (Ethereum local)
 */
import { network } from "hardhat";
import { getAddress, parseUnits, zeroAddress, type Address } from "viem";
import {
  DAY,
  chainInfo,
  confirm,
  loadDeployment,
  loadProjects,
  usdToUnits,
  wallClockSeconds,
  type ProjectData,
} from "./lib/common.js";

const HOUR = 3_600n;
const SELL = 0;
const BUY = 1;

const { viem } = await network.create();
const publicClient = await viem.getPublicClient();
const testClient = await viem.getTestClient();
const chainId = await publicClient.getChainId();
const chain = chainInfo(chainId);
if (chain.kind !== "local") throw new Error("simulate-activity solo corre contra las redes locales (31337 y 31338).");

const wallets = await viem.getWalletClients();
const [fiduciary, agent] = wallets;
if (!fiduciary || !agent || wallets.length < 20) throw new Error("Se necesitan las 20 cuentas del nodo local de Hardhat.");
type Wallet = (typeof wallets)[number];
const investors = wallets.slice(2, 15);
const freshAccounts = wallets.slice(15, 20);

const deployment = await loadDeployment(chainId);
if (!deployment.paymentToken.isMock) throw new Error("La simulación necesita el MockUSDC del deploy local.");
const projects = (await loadProjects()).filter((p) => p.network === chain.family && deployment.projects[p.slug]);

const usdc = await viem.getContractAt("MockUSDC", deployment.paymentToken.address);
const registry = await viem.getContractAt("IdentityRegistry", deployment.identityRegistry);
const market = await viem.getContractAt("P2PMarket", deployment.market.address);
const router = await viem.getContractAt("PaymentRouter", deployment.paymentRouter);
const wbtcAsset = deployment.paymentAssets.find((a) => a.symbol === "WBTC");
const wbtc = wbtcAsset && wbtcAsset.address !== "native" ? await viem.getContractAt("MockERC20", wbtcAsset.address) : undefined;

const now = wallClockSeconds();

// --- Utilidades ------------------------------------------------------------------------------------

/** PRNG determinístico (mulberry32): cada corrida genera la misma demo. */
function rng(seedText: string) {
  let seed = [...seedText].reduce((acc, ch) => (Math.imul(acc, 31) + ch.charCodeAt(0)) >>> 0, 7);
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Normal estándar a partir de dos uniformes (Box-Muller). */
function gaussian(random: () => number) {
  const u = Math.max(random(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

const tokens = (n: number) => parseUnits(n.toFixed(6), 18);
const priceUnits = (usd: number) => usdToUnits(Math.round(usd * 1e4) / 1e4);

/** Avanza el reloj del nodo hasta `ts` (si ya pasó, la transacción sale en el bloque siguiente). */
async function travelTo(ts: bigint) {
  const latest = (await publicClient.getBlock()).timestamp;
  if (ts > latest) await testClient.setNextBlockTimestamp({ timestamp: ts });
}

interface SimEvent {
  at: bigint;
  run: () => Promise<void>;
}
const events: SimEvent[] = [];
const schedule = (at: bigint, run: () => Promise<void>) => events.push({ at, run });

// --- Arranque: KYC y saldos -------------------------------------------------------------------------

const start = (await publicClient.getBlock()).timestamp;
const earliest = projects.reduce((min, p) => {
  const d = deployment.projects[p.slug]!;
  return BigInt(d.startTime) < min ? BigInt(d.startTime) : min;
}, now);
if (start > earliest) {
  throw new Error(
    "El nodo no arrancó en el pasado, así que no se puede recorrer la historia de la demo.\n" +
      "Reinicialo con `npm run chain:node` (usa initialDate de hardhat.config.ts) y volvé a desplegar.",
  );
}

await confirm(
  publicClient,
  registry.write.batchRegisterInvestors([investors.map((w) => w.account.address), investors.map(() => now + 365n * DAY)], {
    account: agent.account,
  }),
);
for (const w of [...investors, ...freshAccounts]) {
  await confirm(publicClient, usdc.write.mint([w.account.address, usdToUnits(250_000)]));
  if (wbtc) await confirm(publicClient, wbtc.write.mint([w.account.address, parseUnits("2", 8)]));
}
console.log(`${chain.name}: KYC para ${investors.length} inversores; ${freshAccounts.length} cuentas quedan sin KYC.`);

// --- Historia de cada proyecto ------------------------------------------------------------------------

const summary: string[] = [];

for (const p of projects) {
  const d = deployment.projects[p.slug]!;
  const random = rng(`${chainId}:${p.slug}`);
  const offering = await viem.getContractAt("TokenOffering", d.offering);
  const token = await viem.getContractAt("AssetToken", d.token);
  const hardCap = await offering.read.hardCap();
  const minPurchase = await offering.read.minPurchase();
  const opensAt = BigInt(d.startTime);
  const closesAt = BigInt(d.endTime);
  const counters = { purchases: 0, viaRouter: 0, trades: 0, distributions: 0 };
  /** Momento en que el fiduciario habilita el mercado secundario (solo rondas completas). */
  let marketOpensAt: bigint | undefined;

  // Compras primarias, repartidas en la ventana de la ronda
  if (p.demo.fundedPct > 0 && opensAt < now) {
    const target = (hardCap * BigInt(p.demo.fundedPct)) / 100n;
    const complete = p.demo.fundedPct >= 100;
    const windowEnd = complete ? (opensAt + 15n * DAY < closesAt ? opensAt + 15n * DAY : closesAt - HOUR) : now - 2n * HOUR;
    const maxTicket = hardCap / 12n > minPurchase * 4n ? hardCap / 12n : minPurchase * 4n;

    const tickets: { buyer: Wallet; amount: bigint }[] = [];
    let planned = 0n;
    while (planned < target) {
      const buyer = tickets.length === 0 ? investors[0]! : investors[Math.floor(random() * investors.length)]!;
      const span = Number((maxTicket - minPurchase) / minPurchase);
      let amount = minPurchase * BigInt(1 + Math.floor(random() * random() * span));
      const left = target - planned;
      if (amount > left || left - amount < minPurchase) amount = left; // el último ticket cierra justo en el objetivo
      tickets.push({ buyer, amount });
      planned += amount;
    }

    const spacing = (windowEnd - opensAt - HOUR) / BigInt(tickets.length + 1);
    tickets.forEach((ticket, i) => {
      const at = opensAt + HOUR + spacing * BigInt(i + 1) + BigInt(Math.floor(random() * Number(spacing / 3n)));
      // Alrededor de uno de cada cinco tickets chicos se paga con la moneda de la red o con WBTC.
      const altPayment = ticket.amount <= usdToUnits(1_500) && random() < 0.22 ? (random() < 0.5 && wbtc ? "wbtc" : "native") : "usdc";
      schedule(at, async () => {
        if (altPayment === "usdc") {
          await confirm(publicClient, usdc.write.approve([offering.address, ticket.amount], { account: ticket.buyer.account }));
          await confirm(publicClient, offering.write.buy([ticket.amount], { account: ticket.buyer.account }));
        } else {
          const asset: Address = altPayment === "wbtc" ? wbtc!.address : zeroAddress;
          const { result: quote } = await publicClient.simulateContract({
            address: router.address,
            abi: router.abi,
            functionName: "quote",
            args: [asset, ticket.amount],
          });
          const maxIn = (quote * 101n) / 100n;
          // El próximo bloque puede tener la fecha del evento (travelTo), no la del último bloque.
          const latest = (await publicClient.getBlock()).timestamp;
          const deadline = (at > latest ? at : latest) + DAY;
          if (altPayment === "wbtc") {
            await confirm(publicClient, wbtc!.write.approve([router.address, maxIn], { account: ticket.buyer.account }));
          }
          await confirm(
            publicClient,
            router.write.buyWithAsset([offering.address, asset, ticket.amount, maxIn, deadline], {
              account: ticket.buyer.account,
              value: altPayment === "native" ? maxIn : 0n,
            }),
          );
          counters.viaRouter += 1;
        }
        counters.purchases += 1;
      });
    });

    if (complete) {
      // La ronda cierra con el cupo completo; el fiduciario habilita el mercado secundario.
      const closedAt = opensAt + HOUR + spacing * BigInt(tickets.length + 1) + 2n * HOUR;
      schedule(closedAt, async () => {
        await confirm(publicClient, offering.write.finalize());
      });
      if (p.demo.market) {
        marketOpensAt = closedAt + DAY;
        schedule(marketOpensAt, async () => {
          await confirm(publicClient, token.write.setTransfersEnabled([true]));
        });
      }
    }
  }

  // Rentas: el fiduciario deposita y una parte de los tenedores cobra en los días siguientes
  for (const dist of p.demo.distributions) {
    const at = now - BigInt(dist.daysAgo) * DAY;
    const amount = usdToUnits(dist.amountUSD);
    schedule(at, async () => {
      await confirm(publicClient, usdc.write.mint([fiduciary.account.address, amount]));
      await confirm(publicClient, usdc.write.approve([token.address, amount]));
      await confirm(publicClient, token.write.distribute([amount]));
      counters.distributions += 1;
    });
    if (dist.daysAgo > 1) {
      investors.forEach((holder, i) => {
        // Cobra la mitad de los tenedores. La cuenta #2 (investors[0], la de la demo) nunca
        // cobra: así siempre tiene rentas pendientes para mostrar el botón "Cobrar".
        if (i === 0 || i % 2 === 1) return;
        schedule(at + DAY + BigInt(i) * HOUR, async () => {
          const pending = await token.read.withdrawableDistributionOf([holder.account.address]);
          if (pending > 0n) await confirm(publicClient, token.write.claimDistributions({ account: holder.account }));
        });
      });
    }
  }

  // Mercado secundario: un precio que se mueve día a día y operaciones entre inversores
  const m = p.demo.market;
  if (m && marketOpensAt !== undefined) {
    const requested = now - BigInt(m.startsDaysAgo) * DAY;
    const first = requested > marketOpensAt + HOUR ? requested : marketOpensAt + HOUR;
    const last = now - 6n * HOUR;
    const step = (last - first) / BigInt(m.trades);
    let fair = m.startPrice;
    const drift = Math.log(m.endPrice / m.startPrice) / m.trades;

    for (let i = 0; i < m.trades; i += 1) {
      fair = fair * Math.exp(drift + m.volatility * gaussian(random) - (m.volatility * m.volatility) / 2);
      // Ancla suave hacia la trayectoria esperada para que el final se parezca a endPrice
      const expected = m.startPrice * Math.exp(drift * (i + 1));
      fair = fair * 0.85 + expected * 0.15;
      const price = priceUnits(fair);
      const at = first + step * BigInt(i) + BigInt(Math.floor(random() * Number(step / 2n)));
      const sellerIndex = Math.floor(random() * investors.length);
      const buyerIndex = (sellerIndex + 1 + Math.floor(random() * (investors.length - 1))) % investors.length;
      const sellerWallet = investors[sellerIndex]!;
      const buyerWallet = investors[buyerIndex]!;
      const makerSells = random() < 0.6;
      const partial = random() < 0.3;
      const amountTokens = Math.max(Math.ceil(12 / fair), Math.round(10 + random() * random() * 400));

      schedule(at, async () => {
        const balance = await token.read.balanceOf([sellerWallet.account.address]);
        let amount = tokens(amountTokens);
        if (balance < amount) amount = balance / 2n;
        const value = (amount * price) / 10n ** 18n;
        if (value < usdToUnits(deployment.market.minOrderValueUSD)) return;
        const buyerCost = value + (value * BigInt(deployment.market.buyerFeeBps)) / 10_000n + 1n;

        if (makerSells) {
          const committed = await market.read.sellCommitted([sellerWallet.account.address, token.address]);
          await confirm(publicClient, token.write.approve([market.address, committed + amount], { account: sellerWallet.account }));
          await confirm(publicClient, market.write.createOrder([token.address, SELL, amount, price], { account: sellerWallet.account }));
        } else {
          const committedValue = await market.read.buyCommittedValue([buyerWallet.account.address]);
          const allowance = committedValue + buyerCost + (committedValue * BigInt(deployment.market.buyerFeeBps)) / 10_000n + 1n;
          await confirm(publicClient, usdc.write.approve([market.address, allowance], { account: buyerWallet.account }));
          await confirm(publicClient, market.write.createOrder([token.address, BUY, amount, price], { account: buyerWallet.account }));
        }
        const id = await market.read.nextOrderId();
        const fillAmount = partial ? (amount * 3n) / 5n : amount;
        await travelTo((await publicClient.getBlock()).timestamp + BigInt(600 + Math.floor(random() * 6 * 3600)));
        if (makerSells) {
          await confirm(publicClient, usdc.write.approve([market.address, buyerCost], { account: buyerWallet.account }));
          await confirm(publicClient, market.write.fillOrder([id, fillAmount], { account: buyerWallet.account }));
        } else {
          await confirm(publicClient, token.write.approve([market.address, fillAmount], { account: sellerWallet.account }));
          await confirm(publicClient, market.write.fillOrder([id, fillAmount], { account: sellerWallet.account }));
        }
        // Lo que no se tomó queda publicado unas horas y después se retira
        if (partial) {
          await travelTo((await publicClient.getBlock()).timestamp + 3n * HOUR);
          const maker = makerSells ? sellerWallet : buyerWallet;
          await confirm(publicClient, market.write.cancelOrder([id], { account: maker.account }));
        }
        counters.trades += 1;
      });
    }

    // Órdenes abiertas al final: ventas por encima y compras por debajo del último precio
    for (let k = 0; k < m.openOrders; k += 1) {
      const sells = k % 2 === 0;
      const offset = 0.008 + 0.012 * Math.floor(k / 2) + random() * 0.006;
      const at = now - 4n * HOUR + BigInt(k) * 600n;
      const maker = investors[(k * 3 + 1) % investors.length]!;
      const amountTokens = Math.max(Math.ceil(15 / m.endPrice), Math.round(20 + random() * 250));
      schedule(at, async () => {
        const reference = fair;
        const price = priceUnits(reference * (sells ? 1 + offset : 1 - offset));
        let amount = tokens(amountTokens);
        if (sells) {
          const balance = await token.read.balanceOf([maker.account.address]);
          const committed = await market.read.sellCommitted([maker.account.address, token.address]);
          if (balance - committed < amount) amount = (balance - committed) / 2n;
          if (amount === 0n) return;
          await confirm(publicClient, token.write.approve([market.address, committed + amount], { account: maker.account }));
          await confirm(publicClient, market.write.createOrder([token.address, SELL, amount, price], { account: maker.account }));
        } else {
          const value = (amount * price) / 10n ** 18n;
          const committedValue = await market.read.buyCommittedValue([maker.account.address]);
          const total = committedValue + value;
          const allowance = total + (total * BigInt(deployment.market.buyerFeeBps)) / 10_000n + 1n;
          await confirm(publicClient, usdc.write.approve([market.address, allowance], { account: maker.account }));
          await confirm(publicClient, market.write.createOrder([token.address, BUY, amount, price], { account: maker.account }));
        }
      });
    }
  }

  summary.push(p.slug);
  // Al final se imprime el resumen con los contadores
  schedule(now - HOUR, async () => {
    const raised = await offering.read.totalRaised();
    console.log(
      `  ${p.slug}: ${counters.purchases} compras (${counters.viaRouter} con otra moneda), USD ${raised / 10n ** 6n}` +
        (counters.distributions ? `, ${counters.distributions} rentas` : "") +
        (counters.trades ? `, ${counters.trades} operaciones en el mercado` : ""),
    );
  });
}

// --- Ejecución en orden cronológico ------------------------------------------------------------------

events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
console.log(`Recorriendo ${events.length} eventos desde hace ${Number((now - start) / DAY)} días…`);
for (const event of events) {
  await travelTo(event.at);
  await event.run();
}

// El nodo queda en la fecha y hora reales
await travelTo(wallClockSeconds());
await testClient.mine({ blocks: 1 });
const finalTime = (await publicClient.getBlock()).timestamp;
console.log(`Reloj del nodo: ${new Date(Number(finalTime) * 1000).toISOString()}`);

console.log("\nCuentas para probar desde la web (nodo local de Hardhat):");
console.log(`  Con KYC y tenencias: cuenta #2 ${getAddress(investors[0]!.account.address)}`);
console.log(`  Sin KYC (alta completa): cuenta #15 ${getAddress(freshAccounts[0]!.account.address)}`);
console.log("\nSiguiente paso: `npm run chain:sync` en la raíz.");
