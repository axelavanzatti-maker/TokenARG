import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Falta DATABASE_URL. Copiá .env.example a .env y levantá Postgres.");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

function getClient() {
  if (!globalForPrisma.prisma) globalForPrisma.prisma = createClient();
  return globalForPrisma.prisma;
}

/**
 * Cliente de Prisma con inicialización diferida: importar este módulo no abre conexiones
 * ni exige DATABASE_URL (útil durante `next build`), recién el primer uso.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getClient();
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
