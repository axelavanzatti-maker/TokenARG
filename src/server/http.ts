import { NextResponse } from "next/server";
import { z } from "zod";
import { isAppChain } from "@/lib/chains";
import { HttpError } from "./errors";

export { HttpError };

export function jsonError(status: number, message: string, code?: string) {
  return NextResponse.json({ error: message, code }, { status });
}

/** Envuelve un handler de ruta: traduce HttpError y errores de validación a respuestas JSON. */
export function handle<Args extends unknown[]>(fn: (...args: Args) => Promise<Response>) {
  return async (...args: Args) => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof HttpError) return jsonError(error.status, error.message, error.code);
      if (error instanceof z.ZodError) {
        return jsonError(400, error.issues.map((issue) => issue.message).join(". "), "validation_error");
      }
      console.error(error);
      return jsonError(500, "Error interno. Probá de nuevo en unos minutos.", "internal_error");
    }
  };
}

/**
 * Defensa CSRF para POST/DELETE con cookie de sesión: el Origin tiene que ser el propio sitio.
 * (Las cookies son SameSite=Lax, esto agrega una segunda barrera.)
 */
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return; // clientes que no son navegador (curl, tests); la cookie igual hace falta
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host || new URL(origin).host !== host) {
    throw new HttpError(403, "Origen no permitido", "bad_origin");
  }
}

export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "El cuerpo de la solicitud no es JSON válido", "invalid_json");
  }
  return schema.parse(body);
}

/** Cuerpo de las rutas que indexan una transacción confirmada: red y hash. */
export const txBodySchema = z.object({
  chainId: z.number().int().refine(isAppChain, "Esa red no está habilitada en TokenARG"),
  txHash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "Hash de transacción inválido")
    .transform((hash) => hash as `0x${string}`),
});
