import { NextResponse } from "next/server";
import { z } from "zod";
import { serviceFailure, withActor } from "@/lib/api";
import { templateDeps } from "@/lib/templates/deps";
import { restoreVersionFor } from "@/lib/templates/service";

export function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const { id, versionId } = await params;
    if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(versionId).success)
      return serviceFailure({ code: "not_found" });
    const result = await restoreVersionFor(templateDeps(), actor, id, versionId);
    return result.ok
      ? NextResponse.json({ version: result.version })
      : serviceFailure(result);
  });
}
