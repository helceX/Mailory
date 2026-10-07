import { NextResponse } from "next/server";
import { z } from "zod";
import { saveTemplateSchema } from "@mailory/validation";
import { limit, parseJson, serviceFailure, tooLarge, withActor } from "@/lib/api";
import { templateDeps } from "@/lib/templates/deps";
import { getTemplateFor, saveTemplateFor } from "@/lib/templates/service";

type Params = { params: Promise<{ id: string }> };
const notFound = () => serviceFailure({ code: "not_found" });

export function GET(request: Request, { params }: Params) {
  return withActor(request, { write: false }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return notFound();
    const result = await getTemplateFor(templateDeps(), actor, id);
    return result.ok
      ? NextResponse.json({
          template: result.template,
          version: result.version,
          doc: result.doc,
        })
      : serviceFailure(result);
  });
}

export function PUT(request: Request, { params }: Params) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const big = tooLarge(request, 400_000);
    if (big) return big;
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return notFound();
    const limited = await limit(`template-save:${actor.organizationId}`, 300, 3600);
    if (limited) return limited;
    const parsed = await parseJson(request, saveTemplateSchema);
    if ("response" in parsed) return parsed.response;
    const result = await saveTemplateFor(templateDeps(), actor, id, parsed.data);
    if (result.ok) return NextResponse.json({ version: result.version });
    return serviceFailure(result);
  });
}
