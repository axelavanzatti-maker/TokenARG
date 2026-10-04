import { NextResponse } from "next/server";
import { HttpError, assertSameOrigin, handle, readJson } from "@/server/http";
import { kycStartSchema, startKyc } from "@/server/kyc/service";
import { getSession } from "@/server/session";

export const dynamic = "force-dynamic";

/** Carga los datos del legajo e inicia la verificación con el proveedor KYC configurado. */
export const POST = handle(async (request: Request) => {
  assertSameOrigin(request);
  const session = await getSession();
  if (!session) throw new HttpError(401, "Firmá con tu billetera para iniciar la verificación.", "no_session");
  const input = await readJson(request, kycStartSchema);
  return NextResponse.json(await startKyc(session, input));
});
