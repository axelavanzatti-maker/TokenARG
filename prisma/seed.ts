/**
 * Carga el catálogo de proyectos de ejemplo (data/projects.json) y sus documentos.
 *
 * Es idempotente: se puede correr las veces que haga falta (en Vercel corre en cada deploy).
 *
 * - En modo local deja los montos de la demo hasta que `npm run chain:sync` los reemplace por
 *   los de la blockchain. En testnet y mainnet arranca en cero: no se muestran montos inventados.
 * - En un proyecto que ya tiene contratos, solo actualiza el catálogo (textos, imágenes, métricas
 *   del activo): recaudación, inversores, estado y fechas los define la blockchain.
 *
 * Uso: npm run db:seed
 */
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Category, type DocumentType, type Network, type ProjectStatus } from "../src/generated/prisma/client.ts";

interface SeedProject {
  slug: string;
  title: string;
  category: Category;
  /** Red donde se emite el token (Polygon o Ethereum). */
  network: Network;
  location: string;
  summary: string;
  description: string[];
  highlights: string[];
  risks: string[];
  issuer: string;
  trustee: string;
  status: ProjectStatus;
  targetAmountUSD: number;
  softCapUSD: number;
  minTicketUSD: number;
  tokenPriceUSD: number;
  estimatedIrr: number;
  capRate: number | null;
  termMonths: number;
  assetValuationUSD: number;
  offering: { opensInDays: number; closesInDays: number };
  /** Solo se usa fundedPct; el resto lo usa la simulación on-chain (blockchain/scripts). */
  demo: { fundedPct: number };
  token: { name: string; symbol: string };
  images: string[];
  documents: { type: DocumentType; title: string; file: string }[];
}

const ROOT = path.resolve(import.meta.dirname, "..");
const DAY_MS = 86_400_000;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("Falta DATABASE_URL (copiá .env.example a .env)");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function fileInfo(relative: string) {
  const file = path.join(ROOT, "public", "docs", relative);
  const [content, info] = await Promise.all([readFile(file), stat(file)]);
  return { sha256: createHash("sha256").update(content).digest("hex"), sizeBytes: info.size };
}

async function main() {
  const projects = JSON.parse(await readFile(path.join(ROOT, "data", "projects.json"), "utf8")) as SeedProject[];
  const now = Date.now();
  const demoAmounts = (process.env.NEXT_PUBLIC_NETWORK_MODE ?? "local") === "local";

  for (const p of projects) {
    const collected = demoAmounts ? Math.round((p.targetAmountUSD * p.demo.fundedPct) / 100) : 0;
    const catalog = {
      title: p.title,
      summary: p.summary,
      description: p.description.join("\n\n"),
      category: p.category,
      network: p.network,
      location: p.location,
      issuer: p.issuer,
      trustee: p.trustee,
      highlights: p.highlights,
      risks: p.risks,
      images: p.images,
      targetAmountUSD: p.targetAmountUSD,
      softCapUSD: p.softCapUSD,
      minTicketUSD: p.minTicketUSD,
      tokenPriceUSD: p.tokenPriceUSD,
      estimatedIrr: p.estimatedIrr,
      capRate: p.capRate,
      termMonths: p.termMonths,
      assetValuationUSD: p.assetValuationUSD,
      tokenSymbol: p.token.symbol,
    };
    // Lo que, una vez desplegado el proyecto, sale de la blockchain. Fuera de la demo local, un
    // proyecto sin contratos todavía no abrió (por ejemplo, Polygon en testnet antes del deploy):
    // queda "próximamente" hasta que el deploy de su red lo importe y la ronda diga su estado.
    const onchainFields = {
      status: demoAmounts ? p.status : "PROXIMAMENTE",
      collectedAmountUSD: collected,
      investorCount: collected > 0 ? Math.max(1, Math.round(collected / (p.minTicketUSD * 6))) : 0,
      opensAt: new Date(now + p.offering.opensInDays * DAY_MS),
      closesAt: new Date(now + p.offering.closesInDays * DAY_MS),
    };

    const existing = await prisma.project.findUnique({ where: { slug: p.slug }, select: { chainId: true } });
    const project = await prisma.project.upsert({
      where: { slug: p.slug },
      create: { slug: p.slug, ...catalog, ...onchainFields },
      update: existing?.chainId != null ? catalog : { ...catalog, ...onchainFields },
    });

    await prisma.document.deleteMany({ where: { projectId: project.id } });
    for (const [index, doc] of p.documents.entries()) {
      const info = await fileInfo(doc.file);
      await prisma.document.create({
        data: {
          projectId: project.id,
          type: doc.type,
          title: doc.title,
          url: `/docs/${doc.file}`,
          sha256: info.sha256,
          sizeBytes: info.sizeBytes,
          sortOrder: index,
        },
      });
    }
    console.log(`✓ ${p.slug} (${p.documents.length} documentos)`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
