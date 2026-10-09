/**
 * Prueba en vivo del alta de un inversor contra la app publicada, con una billetera nueva:
 * inicio de sesión con la billetera (SIWE) → datos KYC → aprobación simulada → alta on-chain en
 * cada red con contratos → sesión con la identidad vigente → cierre de sesión.
 *
 * Es el camino que hace cualquier visitante de la demo. Solo sirve con el KYC simulado
 * (testnet), y cada corrida gasta el gas de un alta del agente KYC por red.
 * La corre el workflow "Publicar en Vercel" con la acción probar-alta.
 *
 * Uso: BASE_URL=https://token-arg.vercel.app NEXT_PUBLIC_NETWORK_MODE=testnet npx tsx scripts/live-check.ts
 */
import { appendFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { APP_CHAINS } from "@/lib/chains";
import { isValidCuit } from "@/lib/cuit";

const BASE = (process.env.BASE_URL ?? "https://token-arg.vercel.app").replace(/\/$/, "");
const { origin, host } = new URL(BASE);
const jar = new Map<string, string>();
let failed = false;

type Json = Record<string, unknown> & { error?: string; code?: string };

function report(level: "notice" | "error", message: string) {
  const escaped = message.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  console.log(`::${level} title=Alta de prueba en ${host}::${escaped}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- ${level === "error" ? "✗" : "✓"} ${message}\n`);
  if (level === "error") failed = true;
}

async function call(path: string, init: { method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { origin };
  if (jar.size > 0) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(BASE + path, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    redirect: "manual",
  });
  for (const cookie of response.headers.getSetCookie()) {
    const [pair = ""] = cookie.split(";");
    const index = pair.indexOf("=");
    const value = pair.slice(index + 1);
    if (!value || /max-age=0/i.test(cookie)) jar.delete(pair.slice(0, index));
    else jar.set(pair.slice(0, index), value);
  }
  const text = await response.text();
  let json: Json = {};
  try {
    json = JSON.parse(text) as Json;
  } catch {
    json = { error: text.slice(0, 200) };
  }
  return { status: response.status, json };
}

function randomCuit() {
  for (;;) {
    const body = `20${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
    for (let digit = 0; digit <= 9; digit += 1) if (isValidCuit(`${body}${digit}`)) return `${body}${digit}`;
  }
}

const problem = (step: string, res: { status: number; json: Json }) =>
  `${step}: respondió ${res.status}${res.json.error ? ` (${String(res.json.error).slice(0, 200)})` : ""}.`;

async function main() {
  const account = privateKeyToAccount(generatePrivateKey());
  console.log(`Alta de prueba en ${BASE} con la billetera nueva ${account.address}\n`);

  // 1. Inicio de sesión con la billetera. Se firma en Ethereum y, si no la acepta, en Polygon.
  let login = { status: 0, json: {} as Json };
  for (const { id: chainId } of [APP_CHAINS[1], APP_CHAINS[0]]) {
    const nonce = await call("/api/auth/nonce");
    if (nonce.status !== 200) return report("error", problem("Nonce de inicio de sesión", nonce));
    const now = new Date();
    const message = createSiweMessage({
      domain: host,
      uri: origin,
      address: account.address,
      chainId,
      nonce: String(nonce.json.nonce ?? ""),
      version: "1",
      statement: "Prueba en vivo de TokenARG.",
      issuedAt: now,
      expirationTime: new Date(now.getTime() + 5 * 60_000),
    });
    login = await call("/api/auth/verify", { body: { message, signature: await account.signMessage({ message }) } });
    if (login.status !== 400) break;
  }
  if (login.status !== 200) return report("error", problem("Inicio de sesión con la billetera", login));

  // 2. Datos KYC y aprobación simulada (el mismo camino que un webhook real, alta on-chain incluida).
  const start = await call("/api/kyc/start", {
    body: { fullName: "Prueba Automática", email: `prueba+${Date.now()}@example.com`, taxId: randomCuit(), isPep: false, acceptTerms: true },
  });
  if (start.status !== 200) return report("error", problem("Datos KYC", start));
  const started = Date.now();
  const approve = await call("/api/kyc/mock/complete", { body: { decision: "approve" } });
  const seconds = Math.round((Date.now() - started) / 1000);
  if (approve.status !== 200 || approve.json.status !== "APROBADO") return report("error", problem("Aprobación del KYC", approve));
  const chains = (approve.json.chains ?? []) as { chainId: number; name: string; outcome: string; error?: string }[];
  for (const c of chains.filter((c) => c.outcome === "failed")) report("error", `Alta en ${c.name}: falló (${c.error ?? "sin detalle"}).`);
  const enabled = chains.filter((c) => c.outcome !== "failed").map((c) => c.name);

  // 3. La sesión tiene que ver la identidad vigente y el alta en cada red con contratos.
  const session = await call("/api/auth/session");
  const kyc = session.json.kyc as { active?: boolean } | undefined;
  const onchain = (session.json.onchain ?? []) as { name: string; verified?: boolean }[];
  const missing = onchain.filter((v) => !v.verified).map((v) => v.name);
  if (!kyc?.active) report("error", problem("Sesión después del alta", session));
  else if (missing.length > 0) report("error", `La sesión no ve el alta en ${missing.join(" y ")}.`);

  await call("/api/auth/session", { method: "DELETE" });
  if (!failed) {
    report(
      "notice",
      `Inicio de sesión, KYC y alta on-chain en ${enabled.join(" y ") || "ninguna red"} en ${seconds} s, con la billetera ${account.address}.`,
    );
  }
}

main()
  .catch((error: unknown) => report("error", `La prueba se cortó: ${error instanceof Error ? error.message : String(error)}`))
  .finally(() => {
    if (failed) process.exitCode = 1;
  });
