import { NextResponse } from "next/server";
import { z } from "zod";
import { archiveTemplateSchema } from "@mailory/validation";
import { parseJson, serviceFailure, withActor } from "@/lib/api";
import { templateDeps } from "@/lib/templates/deps";
import { archiveTemplateFor } from "@/lib/templates/service";

export function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return serviceFailure({ code: "not_found" });
    const parsed = await parseJson(request, archiveTemplateSchema);
    if ("response" in parsed) return parsed.response;
    const result = await archiveTemplateFor(
      templateDeps(),
      actor,
      id,
      parsed.data.archived,
    );
    return result.ok ? NextResponse.json({ status: "ok" }) : serviceFailure(result);
  });
}
