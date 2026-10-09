import { NextResponse } from "next/server";
import { applicationSchema, createApplication } from "@/server/growth";
import { assertSameOrigin, handle, readJson } from "@/server/http";

export const dynamic = "force-dynamic";

/** Postulación de un emisor desde "Creá tu proyecto". El equipo la ve en /admin. */
export const POST = handle(async (request: Request) => {
  assertSameOrigin(request);
  await createApplication(await readJson(request, applicationSchema));
  return NextResponse.json({ ok: true }, { status: 201 });
});
