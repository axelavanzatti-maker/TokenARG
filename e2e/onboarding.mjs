// Alta e inversión de un inversor nuevo, de punta a punta en la interfaz:
// portada → conectar → ficha (aviso KYC) → /kyc (firma SIWE + datos + aprobación simulada,
// que da de alta la billetera en Polygon y en Ethereum) → ficha en Polygon (autorizar USDC +
// invertir) → ficha en Ethereum (cambio de red + pagar con ETH) → cartera.
//
// Requiere: nodo local + `npm run demo:local` + la app corriendo con KYC_PROVIDER=mock.
// Usa la primera de las cuentas #15–#19 del nodo que todavía no tenga KYC.
import { ACCOUNTS, BASE, SHOTS, connect, launch, newWalletPage, reporter } from "./wallet.mjs";

const SLUG = process.env.SLUG ?? "torre-cordoba-centro"; // Polygon
const ETH_SLUG = process.env.ETH_SLUG ?? "renta-palermo-hollywood"; // Ethereum
const r = reporter("alta e inversión");

async function pickFreshAccount() {
  for (const address of ACCOUNTS.fresh) {
    const response = await fetch(`${BASE}/api/portfolio/${address}`);
    const portfolio = await response.json();
    const verified = (portfolio.verifications ?? []).some((v) => v.verified);
    if (!verified && portfolio.holdings?.length === 0) return address;
  }
  throw new Error("Las cuentas #15–#19 ya tienen KYC. Reiniciá el nodo y corré `npm run demo:local`.");
}

const browser = await launch();
let errors = [];
try {
  const account = await pickFreshAccount();
  r.step(`cuenta ${account}`);
  const session = await newWalletPage(browser, account);
  const { page } = session;
  errors = session.errors;

  r.step("portada");
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${SHOTS}01-portada.png`, fullPage: true });
  await connect(page);

  r.step("ficha sin KYC: el panel avisa y no deja invertir");
  await page.goto(`${BASE}/project/${SLUG}`, { waitUntil: "networkidle" });
  await page.getByText("Billetera no verificada en TokenARG").waitFor({ timeout: 20000 });
  await page.screenshot({ path: `${SHOTS}02-ficha-sin-kyc.png` });

  r.step("verificación: firma SIWE");
  await page.getByRole("link", { name: "Verificar mi identidad" }).first().click();
  await page.waitForURL("**/kyc");
  await page.getByRole("button", { name: "Firmar con mi billetera" }).click();
  const name = page.getByLabel("Nombre y apellido, como figuran en tu DNI");
  const enableButtons = page.getByRole("button", { name: /^Habilitar en / });
  await Promise.race([name.waitFor({ timeout: 20000 }), enableButtons.first().waitFor({ timeout: 20000 })]).catch(() => undefined);

  if (await name.isVisible()) {
    r.step("verificación: validación del formulario y envío");
    await page.getByRole("button", { name: "Enviar y validar mi identidad" }).click();
    await page.getByText("Revisá el CUIT/CUIL").waitFor();
    await name.fill("Lucía Fernández");
    await page.getByLabel("Email").fill(`lucia.${Date.now()}@example.com`);
    await page.getByLabel("CUIT o CUIL").fill("20123456786");
    await page.getByText("Declaro que los datos son correctos").click();
    await page.getByRole("button", { name: "Enviar y validar mi identidad" }).click();

    r.step("verificación: aprobación simulada → alta en el IdentityRegistry de las dos redes");
    await page.getByRole("button", { name: "Simular aprobación" }).click();
  } else {
    // El legajo de esta billetera ya estaba aprobado (corrida anterior) pero los nodos locales se
    // reiniciaron: no se repite el trámite, se habilita la billetera en cada red.
    r.step("verificación: legajo ya aprobado → habilitar la billetera en cada red");
    while ((await enableButtons.count()) > 0) {
      await enableButtons.first().click();
      await page.waitForTimeout(500);
      await page.waitForFunction(() => !document.querySelector("button[disabled] .animate-spin"), null, { timeout: 30000 });
    }
  }
  await page.getByText("Tu billetera está habilitada para invertir").waitFor({ timeout: 30000 });
  await page.waitForFunction(() => (document.body.innerText.match(/habilitada hasta el/g) ?? []).length === 2, null, { timeout: 30000 });
  await page.screenshot({ path: `${SHOTS}03-kyc-aprobado.png`, fullPage: true });

  r.step("inversión: autorizar USDC + comprar");
  await page.goto(`${BASE}/project/${SLUG}`, { waitUntil: "networkidle" });
  const amount = page.getByLabel("Monto a invertir");
  await amount.waitFor({ timeout: 20000 });
  await amount.fill("1.000");
  await page.getByRole("button", { name: /Autorizar e invertir|Invertir USD/ }).click();
  await page.getByText(/Invertiste USD 1\.000/).waitFor({ timeout: 60000 });
  await page.screenshot({ path: `${SHOTS}04-inversion-confirmada.png` });

  r.step("inversión en Ethereum pagando con ETH (cambio de red + conversión a USDC)");
  await page.goto(`${BASE}/project/${ETH_SLUG}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Cambiar a Ethereum/ }).click();
  await page.getByLabel("Monto a invertir").waitFor({ timeout: 20000 });
  await page.getByText("ETH", { exact: true }).click();
  const payWithEth = page.getByRole("button", { name: /Pagar con ETH e invertir/ });
  await payWithEth.waitFor({ timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector('[aria-label="Cotizando"]'), null, { timeout: 20000 });
  await payWithEth.click();
  await page.getByText(/Invertiste USD [\d.]+ \(pagaste [\d,]+ ETH\)/).waitFor({ timeout: 60000 });
  await page.screenshot({ path: `${SHOTS}04b-inversion-con-eth.png` });

  r.step("cartera");
  await page.goto(`${BASE}/portfolio`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Tenencias" }).waitFor();
  await page.locator(`a[href="/project/${SLUG}"]`).first().waitFor({ timeout: 20000 });
  await page.locator(`a[href="/project/${ETH_SLUG}"]`).first().waitFor({ timeout: 20000 });
  await page.screenshot({ path: `${SHOTS}05-cartera.png`, fullPage: true });
} catch (error) {
  r.fail(error);
} finally {
  await browser.close();
  r.done(errors);
}
