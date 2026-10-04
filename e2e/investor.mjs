// Inversor con tenencias (cuenta #2 de la simulación): cobro de rentas, mercado secundario
// (tomar una orden, publicar y retirar), cartera, verificación de integridad del contrato de
// fideicomiso, filtros y vista móvil.
import { readFileSync } from "node:fs";
import { ACCOUNTS, BASE, SHOTS, connect, launch, newWalletPage, reporter } from "./wallet.mjs";

const PROJECTS = JSON.parse(readFileSync(new URL("../data/projects.json", import.meta.url), "utf8"));
const MARKET_SLUG = "galpones-parque-industrial-pilar"; // Ethereum, con historia de operaciones

const r = reporter("inversor con tenencias");
const browser = await launch();
const errors = [];
try {
  const { page, errors: pageErrors } = await newWalletPage(browser, ACCOUNTS.investorWithHoldings);
  await page.goto(BASE, { waitUntil: "networkidle" });
  await connect(page);

  r.step("canilla de USDC de prueba");
  await page.goto(`${BASE}/project/torre-cordoba-centro`, { waitUntil: "networkidle" });
  const balance = page.getByText(/en USDC$/);
  await balance.waitFor({ timeout: 20000 });
  const before = await balance.innerText();
  await page.getByRole("button", { name: "Cargar 10.000 USDC de prueba" }).click();
  await page.waitForFunction((text) => !document.body.innerText.includes(text), before, { timeout: 30000 });
  console.log(`  ${before} → ${await balance.innerText()}`);

  r.step("ficha del pagaré: ronda fondeada y cobro de rentas");
  await page.goto(`${BASE}/project/pagare-logistica-rosario`, { waitUntil: "networkidle" });
  await page.getByText("Ronda fondeada").waitFor({ timeout: 20000 });
  await page.getByText("Tu posición").waitFor({ timeout: 20000 });
  const claim = page.getByRole("button", { name: /^Cobrar USD/ });
  if ((await claim.count()) > 0) {
    await claim.click();
    await page.getByText(/^Listo\. Transacción/).waitFor({ timeout: 30000 });
    await page.screenshot({ path: `${SHOTS}10-rentas-cobradas.png` });
  } else {
    console.log("  (sin rentas pendientes: ya se cobraron en una corrida anterior)");
  }

  r.step("mercado secundario: gráfico y libro de órdenes");
  await page.goto(`${BASE}/project/${MARKET_SLUG}`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Mercado secundario" }).waitFor({ timeout: 20000 });
  await page.getByText(/^Precio de GPIL$/).waitFor();
  await page.getByRole("tab", { name: /Comprar GPIL/ }).waitFor({ timeout: 20000 });
  await page.locator("#mercado").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}13-mercado-ficha.png`, fullPage: true });

  r.step("mercado: tomar una orden de venta (comprar 1 GPIL)");
  await page.getByRole("button", { name: "Comprar", exact: true }).first().click();
  await page.getByRole("button", { name: /Cambiar a Ethereum/ }).first().click();
  const qty = page.getByLabel(/¿Cuántos GPIL comprás\?/);
  await qty.waitFor({ timeout: 20000 });
  await qty.fill("1");
  await page.getByRole("button", { name: /^Comprar 1 GPIL$/ }).click();
  await page.getByText(/^Compraste 1 GPIL a USD/).waitFor({ timeout: 60000 });
  await page.screenshot({ path: `${SHOTS}14-mercado-compra.png` });

  r.step("mercado: publicar una orden de venta y retirarla");
  await page.getByRole("button", { name: "Quiero vender" }).click();
  await page.getByLabel("Cantidad de GPIL").fill("1");
  await page.getByLabel("Precio por token (USD)").fill("99");
  await page.getByRole("button", { name: "Publicar orden de venta" }).click();
  await page.getByText("Tu orden quedó publicada.").waitFor({ timeout: 60000 });
  const mine = page.getByRole("heading", { name: "Tus órdenes activas" });
  await mine.waitFor({ timeout: 20000 });
  await page.screenshot({ path: `${SHOTS}15-mercado-orden-publicada.png` });
  // Se retiran todas las órdenes de prueba (también las que haya dejado una corrida anterior).
  const ownOrders = page.locator("li", { hasText: /Venta de 1 GPIL a USD 99,00/ });
  for (let count = await ownOrders.count(); count > 0; count = await ownOrders.count()) {
    await ownOrders.first().getByRole("button", { name: "Retirar" }).click();
    await page.waitForFunction(
      (previous) => document.body.innerText.split("Venta de 1 GPIL a USD 99,00").length - 1 < previous,
      count,
      { timeout: 60000 },
    );
  }

  r.step("página del mercado");
  await page.goto(`${BASE}/mercado`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Operar" }).first().waitFor({ timeout: 20000 });
  await page.screenshot({ path: `${SHOTS}16-mercado.png`, fullPage: true });

  r.step("cartera");
  await page.goto(`${BASE}/portfolio`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Historial de operaciones" }).waitFor({ timeout: 20000 });
  await page.getByText("Compra en mercado").first().waitFor({ timeout: 20000 });
  await page.screenshot({ path: `${SHOTS}11-cartera-inversor.png`, fullPage: true });

  r.step("integridad del contrato de fideicomiso contra el hash on-chain");
  await page.goto(`${BASE}/project/torre-cordoba-centro`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Verificar integridad" }).click();
  await page.getByText(/El archivo es idéntico/).waitFor({ timeout: 20000 });

  r.step("filtros de la portada (categoría y red)");
  await page.goto(`${BASE}/?categoria=inmuebles&orden=tir`, { waitUntil: "networkidle" });
  const inmuebles = PROJECTS.filter((p) => p.category === "INMUEBLES").length;
  const cards = await page.locator('ul[aria-label="Proyectos filtrados"] > li').count();
  if (cards !== inmuebles) throw new Error(`Se esperaban ${inmuebles} proyectos de inmuebles y hay ${cards}`);
  await page.goto(`${BASE}/?red=ethereum`, { waitUntil: "networkidle" });
  const onEthereum = PROJECTS.filter((p) => p.network === "ethereum").length;
  const ethCards = await page.locator('ul[aria-label="Proyectos filtrados"] > li').count();
  if (ethCards !== onEthereum) throw new Error(`Se esperaban ${onEthereum} proyectos en Ethereum y hay ${ethCards}`);

  r.step("vista móvil sin desborde horizontal");
  const mobile = await newWalletPage(browser, ACCOUNTS.investorWithHoldings, { width: 390, height: 844 });
  for (const [path, shot] of [
    ["/project/renta-palermo-hollywood", "12-movil-ficha.png"],
    [`/project/${MARKET_SLUG}`, "17-movil-mercado-ficha.png"],
    ["/mercado", "18-movil-mercado.png"],
    ["/", "19-movil-portada.png"],
  ]) {
    await mobile.page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    await mobile.page.waitForTimeout(2000);
    const overflow = await mobile.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 0) throw new Error(`${path} desborda ${overflow}px en 390px de ancho`);
    await mobile.page.screenshot({ path: `${SHOTS}${shot}`, fullPage: true });
  }
  errors.push(...pageErrors, ...mobile.errors);
} catch (error) {
  r.fail(error);
} finally {
  await browser.close();
  r.done(errors);
}
