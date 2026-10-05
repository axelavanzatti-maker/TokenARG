/**
 * Build de producción en Vercel (Vercel usa el script `vercel-build` si existe):
 *
 *   1. migraciones de la base (obligatorio);
 *   2. catálogo de proyectos y documentos (obligatorio; no pisa lo que ya viene de la blockchain);
 *   3. importa los deploys de blockchain/deployments/ y sincroniza el índice. Si una red no
 *      responde, el build sigue: el cron diario y las propias operaciones lo completan después;
 *   4. build de Next.js.
 *
 * Cada vez que el workflow de deploy commitea direcciones nuevas, Vercel redespliega y las importa.
 */
import { execSync } from "node:child_process";

function run(command, { optional = false } = {}) {
  console.log(`\n▶ ${command}`);
  try {
    execSync(command, { stdio: "inherit" });
  } catch (error) {
    if (!optional) throw error;
    console.warn(`! "${command}" falló; el build sigue y la sincronización se reintenta después.`);
  }
}

// Todo lo que falta, junto: así se carga de una vez en Settings → Environment Variables.
const mode = process.env.NEXT_PUBLIC_NETWORK_MODE;
const missing = [];
if (!process.env.DATABASE_URL) {
  missing.push("DATABASE_URL: conectá una base Postgres al proyecto en Storage (Prisma Postgres o Neon).");
}
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  missing.push("SESSION_SECRET: un texto al azar de 32 caracteres o más.");
}
if (process.env.VERCEL && mode !== "testnet" && mode !== "mainnet") {
  missing.push("NEXT_PUBLIC_NETWORK_MODE: testnet. Sin esto, la app arranca en modo local, con datos simulados y redes en 127.0.0.1.");
}
if (missing.length > 0) {
  console.error(
    `Faltan variables de entorno del proyecto (Settings → Environment Variables):\n${missing.map((m) => `  - ${m}`).join("\n")}\n` +
      "Cargalas y volvé a desplegar (Deployments → ⋯ → Redeploy).",
  );
  process.exit(1);
}

// Sin estas, la app compila y se puede recorrer, pero el alta de inversores o el cron no andan.
const kycMock = (process.env.KYC_PROVIDER ?? "mock") === "mock";
const warnings = [
  (mode === "testnet" || mode === "mainnet") && !process.env.KYC_AGENT_PRIVATE_KEY &&
    "KYC_AGENT_PRIVATE_KEY: sin la clave del agente KYC no se puede dar de alta a nadie.",
  mode === "testnet" && kycMock && process.env.ALLOW_MOCK_KYC !== "true" && "ALLOW_MOCK_KYC=true: habilita el KYC simulado de la demo.",
  process.env.VERCEL && !process.env.CRON_SECRET && "CRON_SECRET: sin esto, la sincronización diaria con la blockchain queda apagada.",
].filter(Boolean);
for (const warning of warnings) console.warn(`! Falta ${warning}`);

run("npx prisma migrate deploy");
run("npx prisma db seed");
run("npx tsx scripts/sync-chain.ts", { optional: true });
run("npx next build");
