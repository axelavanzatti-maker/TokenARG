import "server-only";
import { randomInt } from "node:crypto";
import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { prisma } from "@/server/db";
import { HttpError } from "@/server/errors";

/**
 * Captación: postulaciones de emisores ("Creá tu proyecto") y lista de espera del lanzamiento
 * con dinero real, con invitaciones. También quién puede ver el panel de administración.
 */

/** Canal de la visita (utm_source): letras, números y separadores simples. */
const sourceSchema = z
  .string()
  .trim()
  .max(60)
  .regex(/^[\w.\-]*$/)
  .optional()
  .transform((s) => s || undefined);

/** Campo trampa: está oculto para las personas, así que si viene completo es un bot. */
const honeypot = z.string().max(200).optional();

const optional = (schema: z.ZodType<string>) => schema.optional().or(z.literal("")).transform((s) => s || undefined);

export const applicationSchema = z.object({
  companyName: z.string().trim().min(2, "Contanos el nombre de la empresa o del proyecto").max(120),
  contactName: z.string().trim().min(2, "Falta tu nombre").max(120),
  email: z.email("Ingresá un email válido").max(200),
  phone: optional(z.string().trim().max(40)),
  category: z.enum(["INMUEBLES", "AGRO", "DEUDA_PYME", "EMPRESAS"], { error: "Elegí qué querés tokenizar" }),
  location: z.string().trim().min(2, "Decinos dónde está el activo").max(120),
  amountUSD: z.number({ error: "Ingresá cuánto querés recaudar, en dólares" }).positive("El monto tiene que ser mayor a cero").max(1e9),
  description: z.string().trim().min(30, "Contanos un poco más del proyecto: 30 caracteres como mínimo").max(4000),
  hasTrust: z.boolean(),
  website: optional(z.url("La web no parece una dirección válida").max(200)),
  source: sourceSchema,
  acceptTerms: z.literal(true, { error: "Tenés que aceptar que te contactemos" }),
  empresaWeb: honeypot,
});

export type ApplicationInput = z.infer<typeof applicationSchema>;

export async function createApplication(input: ApplicationInput) {
  if (input.empresaWeb) return; // bot: se responde igual que siempre, sin guardar nada
  await prisma.projectApplication.create({
    data: {
      companyName: input.companyName,
      contactName: input.contactName,
      email: input.email.toLowerCase(),
      phone: input.phone,
      category: input.category,
      location: input.location,
      amountUSD: input.amountUSD,
      description: input.description,
      hasTrust: input.hasTrust,
      website: input.website,
      source: input.source,
    },
  });
}

// Lista de espera ----------------------------------------------------------------------------------

/** Lugares que adelanta cada persona que se suma con tu enlace. */
export const PLACES_PER_REFERRAL = 10;
/** Sin letras ni números que se confunden al dictarlos (0/o, 1/l/i). */
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function newCode() {
  return Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}

export const codeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]{6,12}$/, "Código de invitación inválido");

export const waitlistSchema = z.object({
  email: z.email("Ingresá un email válido").max(200),
  name: optional(z.string().trim().max(80)),
  ref: codeSchema.optional().or(z.literal("")).transform((s) => s || undefined),
  source: sourceSchema,
  acceptTerms: z.literal(true, { error: "Tenés que aceptar que te escribamos para avisarte" }),
  empresaWeb: honeypot,
});

export type WaitlistInput = z.infer<typeof waitlistSchema>;

export interface WaitlistStatus {
  code: string;
  position: number;
  total: number;
  referrals: number;
}

/**
 * Posición de cada inscripto: el orden de llegada, adelantado PLACES_PER_REFERRAL lugares por
 * cada persona que se sumó con su enlace. Con miles de inscriptos sigue siendo una sola consulta.
 */
async function positions() {
  const entries = await prisma.waitlistEntry.findMany({
    select: { id: true, _count: { select: { referrals: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const ranked = entries
    .map((e, index) => ({ id: e.id, referrals: e._count.referrals, score: index - PLACES_PER_REFERRAL * e._count.referrals, index }))
    .sort((a, b) => a.score - b.score || a.index - b.index);
  return { total: entries.length, byId: new Map(ranked.map((e, i) => [e.id, { position: i + 1, referrals: e.referrals }])) };
}

export async function waitlistStatus(code: string): Promise<WaitlistStatus | null> {
  const entry = await prisma.waitlistEntry.findUnique({ where: { code }, select: { id: true, code: true } });
  if (!entry) return null;
  const { total, byId } = await positions();
  const mine = byId.get(entry.id)!;
  return { code: entry.code, position: mine.position, total, referrals: mine.referrals };
}

/** Suma a la lista (o devuelve el lugar si el email ya estaba). Nunca falla por un código de invitación ajeno. */
export async function joinWaitlist(input: WaitlistInput): Promise<WaitlistStatus> {
  const email = input.email.toLowerCase();
  if (input.empresaWeb) return { code: newCode(), position: 1, total: 1, referrals: 0 };

  const existing = await prisma.waitlistEntry.findUnique({ where: { email }, select: { code: true } });
  if (existing) return (await waitlistStatus(existing.code))!;

  const referrer = input.ref ? await prisma.waitlistEntry.findUnique({ where: { code: input.ref }, select: { id: true } }) : null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const created = await prisma.waitlistEntry.create({
        data: { email, name: input.name, code: newCode(), referredById: referrer?.id, source: input.source },
        select: { code: true },
      });
      return (await waitlistStatus(created.code))!;
    } catch (error) {
      // Choque de código (improbable) o el mismo email enviado dos veces a la vez: se reintenta.
      if ((error as { code?: string }).code !== "P2002") throw error;
      const raced = await prisma.waitlistEntry.findUnique({ where: { email }, select: { code: true } });
      if (raced) return (await waitlistStatus(raced.code))!;
    }
  }
  throw new HttpError(500, "No pudimos sumarte a la lista. Probá de nuevo en un momento.", "waitlist_failed");
}

// Administración -----------------------------------------------------------------------------------

/** Billeteras que pueden ver el panel: ADMIN_WALLETS, separadas por comas. */
export function adminWallets(): string[] {
  return (process.env.ADMIN_WALLETS ?? "")
    .split(",")
    .map((w) => w.trim())
    .filter((w) => isAddress(w))
    .map((w) => getAddress(w));
}

export function isAdminWallet(address: string | null | undefined) {
  if (!address || !isAddress(address)) return false;
  return adminWallets().includes(getAddress(address));
}
