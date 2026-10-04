// Billetera EIP-1193 de prueba para Playwright. Reenvía todo a los nodos locales de Hardhat
// (Polygon local 31337 en :8545 y Ethereum local 31338 en :8546), cuyas cuentas están
// desbloqueadas: el propio nodo firma personal_sign y eth_sendTransaction. Cambia de red con
// wallet_switchEthereumChain y avisa con "chainChanged", como MetaMask o Rabby. Se anuncia por EIP-6963.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

export const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const RPCS = {
  31337: process.env.E2E_RPC_URL_31337 ?? "http://127.0.0.1:8545",
  31338: process.env.E2E_RPC_URL_31338 ?? "http://127.0.0.1:8546",
};
export const SHOTS = new URL("./screenshots/", import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

/** Cuentas del nodo local de Hardhat (claves públicas de prueba: solo red local). */
export const ACCOUNTS = {
  investorWithHoldings: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", // #2: KYC + tenencias de la simulación
  fresh: [
    "0xcd3B766CCDd6AE721141F452C550Ca635964ce71", // #15
    "0x2546BcD3c84621e976D8185a91A922aE77ECEc30", // #16
    "0xbDA5747bFD65F08deb54cb465eB87D40e51B197E", // #17
    "0xdD2FD4581271e230360230F9337D5c0430Bf44C0", // #18
    "0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199", // #19
  ],
};

function providerScript(account, rpcs) {
  return `(() => {
    const RPCS = ${JSON.stringify(rpcs)};
    const account = ${JSON.stringify(account)};
    let chainId = 31337;
    let id = 0;
    const listeners = {};
    const hex = (n) => "0x" + n.toString(16);
    async function rpc(method, params) {
      const res = await fetch(RPCS[chainId], { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: params ?? [] }) });
      const json = await res.json();
      if (json.error) { const e = new Error(json.error.message); e.code = json.error.code; e.data = json.error.data; throw e; }
      return json.result;
    }
    const provider = {
      request: async ({ method, params }) => {
        switch (method) {
          case "eth_requestAccounts": case "eth_accounts": return [account];
          case "eth_chainId": return hex(chainId);
          case "net_version": return String(chainId);
          case "wallet_switchEthereumChain": {
            const next = parseInt(params[0].chainId, 16);
            if (!RPCS[next]) { const e = new Error("Unrecognized chain ID"); e.code = 4902; throw e; }
            if (next !== chainId) { chainId = next; (listeners.chainChanged || []).forEach((cb) => cb(hex(next))); }
            return null;
          }
          case "wallet_addEthereumChain": case "wallet_revokePermissions": return null;
          case "wallet_requestPermissions": case "wallet_getPermissions": return [{ parentCapability: "eth_accounts" }];
          default: return rpc(method, params);
        }
      },
      on: (event, cb) => { (listeners[event] ||= []).push(cb); return provider; },
      removeListener: (event, cb) => { listeners[event] = (listeners[event] || []).filter((x) => x !== cb); return provider; },
    };
    const info = { uuid: "5d8a4b2e-0000-4000-8000-00000000e2e0", name: "Billetera E2E", rdns: "test.tokenarg.e2e",
      icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%2313294b'/%3E%3C/svg%3E" };
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  })();`;
}

export async function launch() {
  return chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
}

export async function newWalletPage(browser, account, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires" });
  await context.addInitScript(providerScript(account, RPCS));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return { context, page, errors };
}

/** Conecta la billetera si wagmi no la reconectó sola (ya autorizada, como en MetaMask). */
export async function connect(page) {
  await page.waitForTimeout(1500);
  const button = page.getByRole("button", { name: "Conectar billetera" });
  if ((await button.count()) === 0) return;
  await button.first().click();
  await page.getByRole("menuitem", { name: /Billetera E2E/ }).click();
  await page.waitForFunction(() => !document.body.innerText.includes("Conectar billetera"), null, { timeout: 15000 });
}

export function reporter(name) {
  let failed = false;
  return {
    step: (message) => console.log(`• ${message}`),
    fail(error) {
      failed = true;
      console.error(`✗ ${name}: ${error.message}`);
    },
    done(errors = []) {
      if (errors.length > 0) {
        failed = true;
        console.error(`✗ ${name}: errores de JavaScript en la página:\n  ${errors.join("\n  ")}`);
      }
      if (!failed) console.log(`✓ ${name}`);
      process.exitCode = failed ? 1 : 0;
    },
  };
}
