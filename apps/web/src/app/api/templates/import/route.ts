import { NextResponse } from "next/server";
import { TEMPLATE_CATEGORIES } from "@mailory/validation";
import { apiError, limit, serviceFailure, tooLarge, withActor } from "@/lib/api";
import { importHtmlTemplateFor, MAX_IMPORT_BYTES } from "@/lib/templates/import";
import { templateDeps } from "@/lib/templates/deps";

export function POST(request: Request) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const big = tooLarge(request, MAX_IMPORT_BYTES + 256 * 1024);
    if (big) return big;
    const limited = await limit(`template-import:${actor.organizationId}`, 20, 3600);
    if (limited) return limited;
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return apiError(400, "invalid", "Geçersiz yükleme isteği.");
    }
    const file = form.get("file");
    if (!(file instanceof File)) return apiError(400, "invalid", "Dosya seçilmedi.");
    const category = String(form.get("category") ?? "other");
    const entry = form.get("entry");
    const result = await importHtmlTemplateFor(templateDeps(), actor, {
      name: String(form.get("name") ?? file.name.replace(/\.[^.]+$/, "")),
      category: (TEMPLATE_CATEGORIES as readonly string[]).includes(category)
        ? category
        : "other",
      filename: file.name,
      bytes: Buffer.from(await file.arrayBuffer()),
      entry: typeof entry === "string" && entry ? entry : undefined,
    });
    if (!result.ok) return serviceFailure(result);
    return "choices" in result
      ? NextResponse.json({ choices: result.choices })
      : NextResponse.json(
          { id: result.id, warnings: result.warnings },
          { status: 201 },
        );
  });
}
