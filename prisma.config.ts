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
    // Opcional para `prisma generate`; obligatoria para migrar y sembrar.
    url: process.env.DATABASE_URL,
  },
});
