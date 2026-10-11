import { NextResponse } from "next/server";
import { z } from "zod";
import { serviceFailure, withActor } from "@/lib/api";
import { devDeps } from "@/lib/developers/deps";
import { revokeApiKeyFor } from "@/lib/developers/service";

export function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return serviceFailure({ code: "not_found" });
    const r = await revokeApiKeyFor(devDeps(), actor, id);
    return r.ok ? NextResponse.json({ ok: true }) : serviceFailure(r);
  });
}
