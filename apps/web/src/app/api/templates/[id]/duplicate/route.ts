import { NextResponse } from "next/server";
import { z } from "zod";
import { duplicateTemplateSchema } from "@mailory/validation";
import { parseJson, serviceFailure, withActor } from "@/lib/api";
import { templateDeps } from "@/lib/templates/deps";
import { duplicateTemplateFor } from "@/lib/templates/service";

export function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return serviceFailure({ code: "not_found" });
    const parsed = await parseJson(request, duplicateTemplateSchema);
    if ("response" in parsed) return parsed.response;
    const result = await duplicateTemplateFor(
      templateDeps(),
      actor,
      id,
      parsed.data.name,
    );
    return result.ok
      ? NextResponse.json({ id: result.id }, { status: 201 })
      : serviceFailure(result);
  });
}
