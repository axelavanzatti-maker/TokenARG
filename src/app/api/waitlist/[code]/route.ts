import { NextResponse } from "next/server";
import { codeSchema, waitlistStatus } from "@/server/growth";
import { HttpError, handle } from "@/server/http";

export const dynamic = "force-dynamic";

/** Lugar en la lista y cantidad de invitados de un código. No expone el email. */
export const GET = handle(async (_request: Request, context: { params: Promise<{ code: string }> }) => {
  const code = codeSchema.parse((await context.params).code);
  const status = await waitlistStatus(code);
  if (!status) throw new HttpError(404, "No encontramos ese código en la lista", "not_found");
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
});
