/**
 * Despliega TokenARG en una red (correrlo una vez por red: Polygon y Ethereum).
 *
 *   1. Moneda de pago: USDC real en producción; MockUSDC con canilla en testnet y red local.
 *   2. Monedas aceptadas para pagar (ETH/POL, WBTC, USDT, WETH) y su conversión a USDC:
 *      Uniswap V3 en producción; MockSwapAdapter con precios de prueba en testnet y red local.
 *   3. IdentityRegistry, con AGENT_ROLE para la billetera del backend KYC.
 *   4. P2PMarket (mercado secundario) con la comisión configurada.
 *   5. Por cada proyecto de esta red en data/projects.json: AssetToken + TokenOffering; la oferta
 *      recibe MINTER_ROLE y autoriza al PaymentRouter, y el token se lista en el mercado.
 *
 * Uso:
 *   npx hardhat run scripts/deploy.ts --network localhost            (Polygon local, 31337)
 *   npx hardhat run scripts/deploy.ts --network localhostEthereum    (Ethereum local, 31338)
 *   npx hardhat run scripts/deploy.ts --network amoy | sepolia
 *
 * Variables de entorno (todas opcionales salvo en producción):
 *   KYC_AGENT_ADDRESS     billetera del backend que da de alta inversores (red local: cuenta #1).
 *   TREASURY_ADDRESS      tesorería del fideicomiso (default: deployer).
 *   FEE_RECIPIENT_ADDRESS billetera que cobra las comisiones del mercado (default: tesorería).
 *   MARKET_BUYER_FEE_BPS / MARKET_SELLER_FEE_BPS  comisión por parte (default 50 = 0,5 %).
 *   ADMIN_ADDRESS         multisig del fiduciario: recibe todos los roles y el deployer renuncia.
 *   DOCS_BASE_URL         URL pública de los PDF (default: http://localhost:3000/docs).
 *   CONFIRM_MAINNET=1     obligatorio en Polygon/Ethereum mainnet (ver config/mainnet.json).
 *
 * Resultado: blockchain/deployments/<chainId>.json, que la app importa con `npm run chain:sync`.
 */
import { network } from "hardhat";
import { getAddress, isAddress, parseUnits, zeroAddress, type Address } from "viem";
import {
  DAY,
  chainInfo,
  confirm,
  deploymentPath,
  loadMainnetConfig,
  loadProjects,
  primaryDocument,
  saveDeployment,
  sha256OfPublicFile,
  usdToUnits,
  wallClockSeconds,
  type Deployment,
  type PaymentAsset,
} from "./lib/common.js";

function envAddress(name: string): Address | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  if (!isAddress(value)) throw new Error(`${name} no es una dirección válida: ${value}`);
  return getAddress(value);
}

function envBps(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 0 || value > 200) throw new Error(`${name} debe ser un entero entre 0 y 200`);
  return value;
}

const { viem, networkName } = await network.create();
const publicClient = await viem.getPublicClient();
const wallets = await viem.getWalletClients();
const deployer = wallets[0];
if (!deployer) throw new Error("No hay cuenta para desplegar. Configurá DEPLOYER_PRIVATE_KEY.");
const deployerAddress = getAddress(deployer.account.address);

const chainId = await publicClient.getChainId();
const chain = chainInfo(chainId);
const isProduction = chain.kind === "mainnet";
if (isProduction && process.env.CONFIRM_MAINNET !== "1") {
  throw new Error("Deploy en producción bloqueado: verificá config/mainnet.json y corré con CONFIRM_MAINNET=1.");
}
const projects = (await loadProjects()).filter((p) => p.network === chain.family);
const docsBaseUrl = (process.env.DOCS_BASE_URL ?? "http://localhost:3000/docs").replace(/\/$/, "");

console.log(`\nDesplegando TokenARG en ${chain.name} (${networkName}, chainId ${chainId}) desde ${deployerAddress}`);
console.log(`Proyectos de esta red: ${projects.map((p) => p.slug).join(", ") || "ninguno"}\n`);

// 1. Moneda de pago (USDC) ----------------------------------------------------------------------
const mainnet = isProduction ? await loadMainnetConfig(chainId) : undefined;
let paymentTokenAddress: Address;
let paymentIsMock = false;
if (mainnet) {
  paymentTokenAddress = getAddress(mainnet.usdc);
  console.log(`USDC                ${paymentTokenAddress}`);
} else {
  const mock = await viem.deployContract("MockUSDC");
  paymentTokenAddress = getAddress(mock.address);
  paymentIsMock = true;
  console.log(`MockUSDC            ${paymentTokenAddress}`);
}
const usdc = await viem.getContractAt("MockUSDC", paymentTokenAddress); // solo funciones ERC-20
const [paymentSymbol, paymentDecimals] = await Promise.all([usdc.read.symbol(), usdc.read.decimals()]);
if (paymentDecimals !== 6) throw new Error(`Se esperaba un token de 6 decimales y ${paymentSymbol} tiene ${paymentDecimals}`);

// 2. Monedas aceptadas y conversión a USDC ---------------------------------------------------------
const nativeSymbol = chain.family === "polygon" ? "POL" : "ETH";
const paymentAssets: PaymentAsset[] = [];
let adapterAddress: Address;
let adapterKind: "mock" | "uniswap-v3";
// Cada adaptador es de un tipo distinto: estas funciones encapsulan lo que se hace después.
let linkAdapterToRouter: (router: Address) => Promise<unknown>;
let handOverAdapter: (newOwner: Address) => Promise<unknown>;

if (mainnet) {
  const adapter = await viem.deployContract("UniswapV3Adapter", [
    deployerAddress,
    getAddress(mainnet.uniswapSwapRouter02),
    getAddress(mainnet.uniswapQuoterV2),
    getAddress(mainnet.wrappedNative),
    paymentTokenAddress,
  ]);
  adapterAddress = getAddress(adapter.address);
  adapterKind = "uniswap-v3";
  linkAdapterToRouter = (router) => confirm(publicClient, adapter.write.setPaymentRouter([router]));
  handOverAdapter = (newOwner) => confirm(publicClient, adapter.write.transferOwnership([newOwner]));
  for (const asset of mainnet.assets) {
    const address = asset.address === "native" ? zeroAddress : getAddress(asset.address);
    await confirm(publicClient, adapter.write.setPoolFee([address, asset.poolFee]));
    paymentAssets.push({ symbol: asset.symbol, name: asset.name, address: asset.address === "native" ? "native" : address, decimals: asset.decimals, isMock: false });
  }
} else {
  // Precios de prueba (USDC por unidad): no reflejan el mercado real.
  const adapter = await viem.deployContract("MockSwapAdapter", [deployerAddress, paymentTokenAddress]);
  adapterAddress = getAddress(adapter.address);
  adapterKind = "mock";
  linkAdapterToRouter = (router) => confirm(publicClient, adapter.write.setPaymentRouter([router]));
  handOverAdapter = (newOwner) => confirm(publicClient, adapter.write.transferOwnership([newOwner]));
  const nativePrice = chain.family === "polygon" ? "0.25" : "3000";
  await confirm(publicClient, adapter.write.setPrice([zeroAddress, parseUnits(nativePrice, 6), 18]));
  paymentAssets.push({ symbol: nativeSymbol, name: chain.family === "polygon" ? "Polygon" : "Ether", address: "native", decimals: 18, isMock: true });

  const mocks = [
    { symbol: "WBTC", name: "Wrapped BTC (prueba)", decimals: 8, price: "100000", faucet: "10" },
    { symbol: "USDT", name: "Tether USD (prueba)", decimals: 6, price: "1", faucet: "1000000" },
    ...(chain.family === "polygon" ? [{ symbol: "WETH", name: "Wrapped Ether (prueba)", decimals: 18, price: "3000", faucet: "100" }] : []),
  ];
  for (const m of mocks) {
    const token = await viem.deployContract("MockERC20", [m.name, m.symbol, m.decimals, parseUnits(m.faucet, m.decimals)]);
    await confirm(publicClient, adapter.write.setPrice([token.address, parseUnits(m.price, 6), m.decimals]));
    paymentAssets.push({ symbol: m.symbol, name: m.name, address: getAddress(token.address), decimals: m.decimals, isMock: true });
  }
}

const router = await viem.deployContract("PaymentRouter", [deployerAddress, paymentTokenAddress, adapterAddress]);
const routerAddress = getAddress(router.address);
await linkAdapterToRouter(routerAddress);
for (const asset of paymentAssets) {
  await confirm(publicClient, router.write.setAccepted([asset.address === "native" ? zeroAddress : asset.address, true]));
}
console.log(`PaymentRouter       ${routerAddress}  (${adapterKind === "mock" ? "conversión de prueba" : "Uniswap V3"})`);
console.log(`  acepta: ${paymentAssets.map((a) => a.symbol).join(", ")} → USDC`);

// 3. Registro de identidad --------------------------------------------------------------------------
const kycAgent =
  envAddress("KYC_AGENT_ADDRESS") ?? (chain.kind === "local" && wallets[1] ? getAddress(wallets[1].account.address) : deployerAddress);
const treasury = envAddress("TREASURY_ADDRESS") ?? deployerAddress;
const feeRecipient = envAddress("FEE_RECIPIENT_ADDRESS") ?? treasury;
const admin = envAddress("ADMIN_ADDRESS") ?? deployerAddress;
const buyerFeeBps = envBps("MARKET_BUYER_FEE_BPS", 50);
const sellerFeeBps = envBps("MARKET_SELLER_FEE_BPS", 50);

const registry = await viem.deployContract("IdentityRegistry", [deployerAddress]);
const registryAddress = getAddress(registry.address);
console.log(`IdentityRegistry    ${registryAddress}`);
await confirm(publicClient, registry.write.grantRole([await registry.read.AGENT_ROLE(), kycAgent]));
console.log(`  AGENT_ROLE  →     ${kycAgent}`);

// 4. Mercado secundario ------------------------------------------------------------------------------
const MIN_ORDER_VALUE_USD = 10;
const market = await viem.deployContract("P2PMarket", [
  deployerAddress,
  paymentTokenAddress,
  feeRecipient,
  buyerFeeBps,
  sellerFeeBps,
  usdToUnits(MIN_ORDER_VALUE_USD),
]);
const marketAddress = getAddress(market.address);
console.log(`P2PMarket           ${marketAddress}  (comisión ${(buyerFeeBps / 100).toLocaleString("es-AR")} % + ${(sellerFeeBps / 100).toLocaleString("es-AR")} %)`);

// 5. Un token y una oferta por proyecto ----------------------------------------------------------------
const startBlock = Number(await publicClient.getBlockNumber());
// Las ventanas de las rondas se fijan con el reloj real. En la red local, el nodo arranca en el
// pasado y la simulación lo trae al presente recorriendo la historia.
const now = wallClockSeconds();
const deployment: Deployment = {
  chainId,
  family: chain.family,
  network: networkName,
  deployedAt: new Date().toISOString(),
  deployer: deployerAddress,
  startBlock,
  paymentToken: { address: paymentTokenAddress, symbol: paymentSymbol, decimals: paymentDecimals, isMock: paymentIsMock },
  paymentAssets,
  identityRegistry: registryAddress,
  kycAgent,
  treasury,
  admin,
  market: { address: marketAddress, feeRecipient, buyerFeeBps, sellerFeeBps, minOrderValueUSD: MIN_ORDER_VALUE_USD },
  paymentRouter: routerAddress,
  swapAdapter: { address: adapterAddress, kind: adapterKind },
  projects: {},
};

for (const p of projects) {
  const doc = primaryDocument(p);
  const documentHash = await sha256OfPublicFile(doc.file);
  const price = usdToUnits(p.tokenPriceUSD);
  const hardCap = usdToUnits(p.targetAmountUSD);
  const startTime = now + BigInt(p.offering.opensInDays) * DAY;
  const endTime = now + BigInt(p.offering.closesInDays) * DAY;

  const token = await viem.deployContract("AssetToken", [
    {
      name: p.token.name,
      symbol: p.token.symbol,
      maxSupply: (hardCap * 10n ** 18n) / price,
      admin: deployerAddress,
      identityRegistry: registryAddress,
      distributionToken: paymentTokenAddress,
      assetValuationUSD: BigInt(p.assetValuationUSD),
      expectedYieldBps: BigInt(Math.round(p.estimatedIrr * 100)),
      legalDocumentURI: `${docsBaseUrl}/${doc.file}`,
      legalDocumentHash: documentHash,
    },
  ]);
  const offering = await viem.deployContract("TokenOffering", [
    {
      assetToken: token.address,
      paymentToken: paymentTokenAddress,
      treasury,
      pricePerToken: price,
      minPurchase: usdToUnits(p.minTicketUSD),
      softCap: usdToUnits(p.softCapUSD),
      hardCap,
      startTime,
      endTime,
    },
    deployerAddress,
  ]);
  await confirm(publicClient, token.write.grantRole([await token.read.MINTER_ROLE(), offering.address]));
  await confirm(publicClient, offering.write.setRouter([routerAddress, true]));
  await confirm(publicClient, market.write.setListed([token.address, true]));

  deployment.projects[p.slug] = {
    token: getAddress(token.address),
    offering: getAddress(offering.address),
    documentHash,
    startTime: Number(startTime),
    endTime: Number(endTime),
  };
  console.log(`\n${p.slug}`);
  console.log(`  AssetToken ${p.token.symbol.padEnd(6)}  ${getAddress(token.address)}`);
  console.log(`  TokenOffering     ${getAddress(offering.address)}`);
}

// 6. Traspaso de control a la multisig del fiduciario -------------------------------------------------
if (admin !== deployerAddress) {
  console.log(`\nTraspasando roles a ${admin}…`);
  const adminRole = await registry.read.DEFAULT_ADMIN_ROLE();
  await confirm(publicClient, registry.write.grantRole([adminRole, admin]));
  await confirm(publicClient, registry.write.renounceRole([adminRole, deployerAddress]));
  await confirm(publicClient, market.write.grantRole([adminRole, admin]));
  await confirm(publicClient, market.write.renounceRole([adminRole, deployerAddress]));
  await confirm(publicClient, router.write.grantRole([adminRole, admin]));
  await confirm(publicClient, router.write.renounceRole([adminRole, deployerAddress]));
  await handOverAdapter(admin);

  for (const [slug, d] of Object.entries(deployment.projects)) {
    const token = await viem.getContractAt("AssetToken", d.token);
    const offering = await viem.getContractAt("TokenOffering", d.offering);
    const roles = [await token.read.PAUSER_ROLE(), await token.read.DISTRIBUTOR_ROLE(), adminRole];
    for (const role of roles) await confirm(publicClient, token.write.grantRole([role, admin]));
    for (const role of roles) await confirm(publicClient, token.write.renounceRole([role, deployerAddress]));
    await confirm(publicClient, offering.write.transferOwnership([admin]));
    console.log(`  ${slug}: roles transferidos; falta acceptOwnership() de la oferta desde la multisig`);
  }
}

await saveDeployment(deployment);

console.log(`\nListo. Direcciones guardadas en ${deploymentPath(chainId)}`);
if (chain.kind === "local") {
  const block = await publicClient.getBlock();
  const lagDays = Number(now - block.timestamp) / 86_400;
  if (lagDays > 1) {
    console.log(`\nEl nodo local está ${Math.round(lagDays)} días en el pasado a propósito: corré`);
    console.log("`npm run chain:simulate` para generar la historia de la demo y traerlo a hoy.");
  }
}
console.log("\nSiguiente paso: `npm run chain:sync` en la raíz para cargar las direcciones en la base de datos.");
