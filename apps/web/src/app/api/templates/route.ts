import { NextResponse } from "next/server";
import { createTemplateSchema } from "@mailory/validation";
import { parseJson, serviceFailure, withActor } from "@/lib/api";
import { templateDeps } from "@/lib/templates/deps";
import { createTemplateFor, listTemplatesFor } from "@/lib/templates/service";

export function GET(request: Request) {
  return withActor(request, { write: false }, async ({ actor }) => {
    const archived = new URL(request.url).searchParams.get("archived") === "1";
    const result = await listTemplatesFor(templateDeps(), actor, { archived });
    return result.ok
      ? NextResponse.json({ templates: result.templates })
      : serviceFailure(result);
  });
}

export function POST(request: Request) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const parsed = await parseJson(request, createTemplateSchema);
    if ("response" in parsed) return parsed.response;
    const result = await createTemplateFor(templateDeps(), actor, parsed.data);
    return result.ok
      ? NextResponse.json({ id: result.id }, { status: 201 })
      : serviceFailure(result);
  });
}
