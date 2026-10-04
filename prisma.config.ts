import { defineConfig } from "prisma/config";

// Prisma 7 ya no lee .env por su cuenta. Next.js sí lo hace para la app; para la CLI lo
// cargamos acá (si existe) con el lector nativo de Node.
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // El archivo no existe: se usan las variables del entorno.
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Opcional para `prisma generate`; obligatoria para migrar y sembrar. Las migraciones van por
    // una conexión directa si existe (Neon/Vercel: DATABASE_URL_UNPOOLED): el pooler en modo
    // transacción no soporta los bloqueos que usa `migrate deploy`.
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL,
  },
});
