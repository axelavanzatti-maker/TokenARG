// Crea .env a partir de .env.example y completa los secretos con valores aleatorios.
// No pisa un .env existente.
//
// Uso: npm run setup:env
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const target = path.join(root, ".env");
if (existsSync(target)) {
  console.log(".env ya existe: no se modificó. Borralo si querés regenerarlo.");
  process.exit(0);
}

const secrets = {
  SESSION_SECRET: () => randomBytes(48).toString("base64"),
  KYC_WEBHOOK_SECRET: () => randomBytes(32).toString("hex"),
  CRON_SECRET: () => randomBytes(32).toString("hex"),
};

const content = readFileSync(path.join(root, ".env.example"), "utf8").replace(
  /^(SESSION_SECRET|KYC_WEBHOOK_SECRET|CRON_SECRET)=\s*$/gm,
  (_line, name) => `${name}=${secrets[name]()}`,
);
writeFileSync(target, content);
console.log(".env creado con secretos aleatorios. Revisá DATABASE_URL y la red antes de seguir.");
