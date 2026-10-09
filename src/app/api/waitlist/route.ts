import { NextResponse } from "next/server";
import { joinWaitlist, waitlistSchema } from "@/server/growth";
import { assertSameOrigin, handle, readJson } from "@/server/http";

export const dynamic = "force-dynamic";

/** Suma un email a la lista de espera del lanzamiento y devuelve su lugar y su código para invitar. */
export const POST = handle(async (request: Request) => {
  assertSameOrigin(request);
  return NextResponse.json(await joinWaitlist(await readJson(request, waitlistSchema)));
});
