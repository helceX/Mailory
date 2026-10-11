import { NextResponse } from "next/server";
import { z } from "zod";
import { serviceFailure, withActor } from "@/lib/api";
import { templateDeps } from "@/lib/templates/deps";
import { listVersionsFor } from "@/lib/templates/service";

export function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withActor(request, { write: false }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return serviceFailure({ code: "not_found" });
    const result = await listVersionsFor(templateDeps(), actor, id);
    return result.ok
      ? NextResponse.json({ versions: result.versions })
      : serviceFailure(result);
  });
}
