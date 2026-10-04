import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getAddress, type Address } from "viem";

/**
 * Sesión mínima en cookie firmada (HMAC-SHA256), sin estado en el servidor.
 * Se emite solo después de verificar una firma SIWE, así que prueba la titularidad de la billetera.
 */
export const SESSION_COOKIE = "tokenarg_session";
export const NONCE_COOKIE = "tokenarg_siwe_nonce";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const NONCE_TTL_SECONDS = 10 * 60;

export interface Session {
  address: Address;
  chainId: number;
  /** Vencimiento en segundos UNIX. */
  exp: number;
}

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error("SESSION_SECRET debe estar definida y tener al menos 32 caracteres");
  }
  return value;
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function seal(data: object) {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function unseal<T>(token: string | undefined): T | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString()) as T;
  } catch {
    return null;
  }
}

const cookieBase = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const session = unseal<Session>(store.get(SESSION_COOKIE)?.value);
  if (!session || session.exp < Math.floor(Date.now() / 1000)) return null;
  return { ...session, address: getAddress(session.address) };
}

export async function createSession(address: Address, chainId: number) {
  const store = await cookies();
  const session: Session = { address: getAddress(address), chainId, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS };
  store.set(SESSION_COOKIE, seal(session), { ...cookieBase, maxAge: SESSION_TTL_SECONDS });
  return session;
}

export async function destroySession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function issueNonce(nonce: string) {
  const store = await cookies();
  const exp = Math.floor(Date.now() / 1000) + NONCE_TTL_SECONDS;
  store.set(NONCE_COOKIE, seal({ nonce, exp }), { ...cookieBase, maxAge: NONCE_TTL_SECONDS });
}

/** Devuelve el nonce vigente y lo invalida (cada nonce sirve para una sola firma). */
export async function consumeNonce(): Promise<string | null> {
  const store = await cookies();
  const data = unseal<{ nonce: string; exp: number }>(store.get(NONCE_COOKIE)?.value);
  store.delete(NONCE_COOKIE);
  if (!data || data.exp < Math.floor(Date.now() / 1000)) return null;
  return data.nonce;
}
