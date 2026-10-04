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

if (!process.env.DATABASE_URL) {
  console.error("Falta DATABASE_URL. En Vercel: Storage → conectá una base Postgres (por ejemplo, Neon) al proyecto.");
  process.exit(1);
}
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error("Falta SESSION_SECRET (32 caracteres como mínimo) en las variables de entorno del proyecto.");
  process.exit(1);
}

run("npx prisma migrate deploy");
run("npx prisma db seed");
run("npx tsx scripts/sync-chain.ts", { optional: true });
run("npx next build");
