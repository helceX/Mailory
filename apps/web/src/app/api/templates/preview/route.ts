import { NextResponse } from "next/server";
import { previewTemplateSchema } from "@mailory/validation";
import { limit, parseJson, serviceFailure, tooLarge, withActor } from "@/lib/api";
import { templateDeps } from "@/lib/templates/deps";
import { previewTemplate } from "@/lib/templates/service";

// POST because the document travels in the body; it changes nothing, so it only needs the write-style CSRF check.
export function POST(request: Request) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const big = tooLarge(request, 400_000);
    if (big) return big;
    const limited = await limit(`template-preview:${actor.organizationId}`, 1200, 3600);
    if (limited) return limited;
    const parsed = await parseJson(request, previewTemplateSchema);
    if ("response" in parsed) return parsed.response;
    const result = await previewTemplate(templateDeps(), actor, parsed.data.doc);
    return result.ok
      ? NextResponse.json({
          html: result.html,
          text: result.text,
          unknownKeys: result.unknownKeys,
          warnings: result.warnings,
        })
      : serviceFailure(result);
  });
}
