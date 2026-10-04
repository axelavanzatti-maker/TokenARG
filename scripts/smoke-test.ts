/**
 * Prueba de humo de punta a punta contra una app corriendo (npm run dev / npm start) y su red.
 *
 * Recorre el alta de un inversor por el mismo camino que en producción:
 *   SIWE (firma con una billetera nueva) → datos KYC → webhook firmado con HMAC, como lo
 *   enviaría el proveedor → alta on-chain en el IdentityRegistry de cada red → cartera.
 * Y verifica los rechazos esperados (firmas inválidas, origen ajeno, nonce reutilizado…).
 *
 * Uso: npm run smoke            (BASE_URL=http://localhost:3000 por defecto)
 * Requiere KYC_WEBHOOK_SECRET y CRON_SECRET en .env (npm run setup:env los genera).
 */
import { createHmac, randomBytes } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { APP_CHAINS, NETWORK_MODE } from "@/lib/chains";
import { isValidCuit } from "@/lib/cuit";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
// Se firma desde la segunda red (Ethereum): la sesión tiene que servir para las dos.
const CHAIN_ID = APP_CHAINS[1].id;
const { origin, host } = new URL(BASE);
const SLUG = process.env.SMOKE_SLUG ?? "torre-cordoba-centro";

type Json = Record<string, unknown> & { error?: string; code?: string };
const jar = new Map<string, string>();

async function call(
  path: string,
  init: { method?: string; body?: unknown; raw?: string; headers?: Record<string, string>; noOrigin?: boolean } = {},
) {
  const headers: Record<string, string> = { ...(init.noOrigin ? {} : { origin }), ...init.headers };
  if (jar.size > 0) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const body = init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body));
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(BASE + path, { method: init.method ?? (body ? "POST" : "GET"), headers, body, redirect: "manual" });
  for (const cookie of response.headers.getSetCookie()) {
    const [pair = ""] = cookie.split(";");
    const index = pair.indexOf("=");
    const name = pair.slice(0, index);
    const value = pair.slice(index + 1);
    if (!value || /max-age=0/i.test(cookie)) jar.delete(name);
    else jar.set(name, value);
  }
  const text = await response.text();
  let json: Json = {};
  try {
    json = JSON.parse(text) as Json;
  } catch {
    // páginas HTML
  }
  return { status: response.status, json, text };
}

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : `  → ${JSON.stringify(detail).slice(0, 300)}`}`);
  if (!ok) failures += 1;
}

function randomCuit() {
  for (;;) {
    const body = `20${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
    for (let digit = 0; digit <= 9; digit += 1) if (isValidCuit(`${body}${digit}`)) return `${body}${digit}`;
  }
}

function webhook(body: object, secret: string) {
  const raw = JSON.stringify(body);
  const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  return call("/api/kyc/webhook", { raw, headers: { "x-tokenarg-signature": signature }, noOrigin: true });
}

async function main() {
  console.log(`TokenARG smoke test → ${BASE} (modo ${NETWORK_MODE}: ${APP_CHAINS.map((c) => c.id).join(" + ")})\n`);

  // --- Páginas -------------------------------------------------------------------------------
  const home = await call("/");
  check("portada responde", home.status === 200 && home.text.includes("Invertí en la economía real argentina"), home.status);
  const detail = await call(`/project/${SLUG}`);
  check(`ficha /project/${SLUG}`, detail.status === 200, detail.status);
  check("proyecto inexistente da 404", (await call("/project/no-existe")).status === 404);
  const market = await call("/mercado");
  check("mercado secundario /mercado", market.status === 200 && market.text.includes("Mercado secundario"), market.status);

  // --- Rechazos esperados ---------------------------------------------------------------------
  const randomHash = () => `0x${randomBytes(32).toString("hex")}`;
  check("investments: hash mal formado → 400", (await call("/api/investments", { body: { chainId: CHAIN_ID, txHash: "0x123" } })).status === 400);
  check("investments: red ajena → 400", (await call("/api/investments", { body: { chainId: 999_999, txHash: randomHash() } })).status === 400);
  const unknownTx = await call("/api/investments", { body: { chainId: CHAIN_ID, txHash: randomHash() } });
  check("investments: transacción inexistente → 404", unknownTx.status === 404, unknownTx.json);
  const unknownTrade = await call("/api/market/trades", { body: { chainId: APP_CHAINS[0].id, txHash: randomHash() } });
  check("market/trades: transacción inexistente → 404", unknownTrade.status === 404, unknownTrade.json);
  check("cron sin credenciales → 401", (await call("/api/cron/sync")).status === 401);
  check("cartera con dirección inválida → 400", (await call("/api/portfolio/0xnope")).status === 400);
  check("KYC sin sesión → 401", (await call("/api/kyc/start", { body: {} })).status === 401);
  const forged = await call("/api/kyc/webhook", {
    raw: JSON.stringify({ reference: "x", status: "approved" }),
    headers: { "x-tokenarg-signature": "sha256=00" },
    noOrigin: true,
  });
  check("webhook con firma inválida → 401", forged.status === 401, forged.json);

  // --- SIWE con una billetera nueva -------------------------------------------------------------
  const account = privateKeyToAccount(generatePrivateKey());
  {
    const { json } = await call("/api/auth/nonce");
    const wrong = createSiweMessage({
      domain: host,
      uri: origin,
      address: account.address,
      chainId: 999_999,
      nonce: String(json.nonce ?? ""),
      version: "1",
      issuedAt: new Date(),
    });
    const res = await call("/api/auth/verify", { body: { message: wrong, signature: await account.signMessage({ message: wrong }) } });
    check("login firmado en una red ajena → 400", res.status === 400 && res.json.code === "wrong_chain", res.json);
  }
  const { json: nonceJson } = await call("/api/auth/nonce");
  const nonce = String(nonceJson.nonce ?? "");
  check("nonce SIWE", nonce.length >= 8, nonceJson);
  const now = new Date();
  const message = createSiweMessage({
    domain: host,
    uri: origin,
    address: account.address,
    chainId: CHAIN_ID,
    nonce,
    version: "1",
    statement: "Prueba de humo de TokenARG.",
    issuedAt: now,
    expirationTime: new Date(now.getTime() + 5 * 60_000),
  });
  const signature = await account.signMessage({ message });

  const badOrigin = await call("/api/auth/verify", { body: { message, signature }, headers: { origin: "https://phishing.example" } });
  check("login desde otro origen → 403", badOrigin.status === 403, badOrigin.json);
  // El rechazo anterior no llegó a consumir el nonce: el login legítimo tiene que funcionar.
  const login = await call("/api/auth/verify", { body: { message, signature } });
  check("login SIWE", login.status === 200 && login.json.address === account.address, login.json);
  const replay = await call("/api/auth/verify", { body: { message, signature } });
  check("reusar la misma firma → 401 (nonce consumido)", replay.status === 401, replay.json);

  // --- KYC por el camino del webhook ---------------------------------------------------------------
  const start = await call("/api/kyc/start", {
    body: { fullName: "Prueba Automática", email: `smoke+${Date.now()}@example.com`, taxId: randomCuit(), isPep: false, acceptTerms: true },
  });
  check("inicio de KYC", start.status === 200 && start.json.status === "PENDIENTE", start.json);
  const reference = String(start.json.reference ?? "");

  const secret = process.env.KYC_WEBHOOK_SECRET;
  if (!secret) {
    console.log("! KYC_WEBHOOK_SECRET no está definida: se saltea el webhook (corré npm run setup:env)");
  } else {
    const approved = await webhook({ reference, status: "approved" }, secret);
    check("webhook de aprobación → alta on-chain", approved.status === 200 && approved.json.status === "APROBADO", approved.json);
    const retried = await webhook({ reference, status: "approved" }, secret);
    check("webhook repetido es idempotente", retried.status === 200 && retried.json.status === "APROBADO", retried.json);

    const chains = (approved.json.chains ?? []) as { chainId: number; outcome: string }[];
    check(
      "alta en todas las redes activas",
      chains.length === APP_CHAINS.length && chains.every((c) => c.outcome === "enabled"),
      approved.json,
    );

    const session = await call("/api/auth/session");
    const kyc = session.json.kyc as { status?: string; active?: boolean } | undefined;
    const onchain = (session.json.onchain ?? []) as { chainId: number; verified?: boolean }[];
    check("sesión: legajo aprobado y vigente", kyc?.status === "APROBADO" && kyc.active === true, session.json);
    for (const chain of APP_CHAINS) {
      check(`IdentityRegistry.isVerified en ${chain.name}`, onchain.find((v) => v.chainId === chain.id)?.verified === true, session.json);
    }

    const resync = await call("/api/kyc/sync-chains", { body: {} });
    const resyncChains = (resync.json.chains ?? []) as { outcome: string }[];
    check("habilitar redes faltantes: no repite altas", resync.status === 200 && resyncChains.every((c) => c.outcome === "already"), resync.json);

    const portfolio = await call(`/api/portfolio/${account.address}`);
    const verifications = (portfolio.json.verifications ?? []) as { verified?: boolean }[];
    check(
      "cartera de la billetera nueva",
      portfolio.status === 200 && verifications.length === APP_CHAINS.length && verifications.every((v) => v.verified),
      portfolio.json,
    );
  }

  // --- Sincronización ----------------------------------------------------------------------------
  const sync = await call(`/api/projects/${SLUG}/sync`, { method: "POST" });
  check("sincronización de un proyecto", sync.status === 200, sync.json);
  if (process.env.CRON_SECRET) {
    const cron = await call("/api/cron/sync", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    check("cron de sincronización", cron.status === 200, cron.json);
  }

  // --- Cierre de sesión -------------------------------------------------------------------------
  check("logout", (await call("/api/auth/session", { method: "DELETE" })).status === 200);
  const after = await call("/api/auth/session");
  check("sin sesión después del logout", after.json.session === null, after.json);

  console.log(failures === 0 ? "\nTodo OK." : `\n${failures} verificación(es) fallaron.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
