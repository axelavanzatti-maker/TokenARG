/**
 * Carga el catálogo de proyectos de ejemplo (data/projects.json) y sus documentos.
 *
 * Es idempotente: se puede correr las veces que haga falta. Los montos recaudados que deja
 * son los de la demo; en cuanto haya contratos desplegados, `npm run chain:sync` los
 * reemplaza por los reales de la blockchain.
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

  for (const p of projects) {
    const collected = Math.round((p.targetAmountUSD * p.demo.fundedPct) / 100);
    const data = {
      title: p.title,
      summary: p.summary,
      description: p.description.join("\n\n"),
      category: p.category,
      network: p.network,
      status: p.status,
      location: p.location,
      issuer: p.issuer,
      trustee: p.trustee,
      highlights: p.highlights,
      risks: p.risks,
      images: p.images,
      targetAmountUSD: p.targetAmountUSD,
      softCapUSD: p.softCapUSD,
      collectedAmountUSD: collected,
      investorCount: collected > 0 ? Math.max(1, Math.round(collected / (p.minTicketUSD * 6))) : 0,
      minTicketUSD: p.minTicketUSD,
      tokenPriceUSD: p.tokenPriceUSD,
      estimatedIrr: p.estimatedIrr,
      capRate: p.capRate,
      termMonths: p.termMonths,
      assetValuationUSD: p.assetValuationUSD,
      opensAt: new Date(now + p.offering.opensInDays * DAY_MS),
      closesAt: new Date(now + p.offering.closesInDays * DAY_MS),
      tokenSymbol: p.token.symbol,
    };

    const project = await prisma.project.upsert({
      where: { slug: p.slug },
      create: { slug: p.slug, ...data },
      update: data,
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
