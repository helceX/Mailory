import { NextResponse } from "next/server";
import { apiError, limit, serviceFailure, tooLarge, withActor } from "@/lib/api";
import { templateDeps } from "@/lib/templates/deps";
import { MAX_ASSET_BYTES, uploadAsset } from "@/lib/templates/service";

export function POST(request: Request) {
  return withActor(request, { write: true }, async ({ actor }) => {
    // Reject before buffering: multipart overhead is small, so cap the declared length slightly above the file limit.
    const big = tooLarge(request, MAX_ASSET_BYTES + 64 * 1024);
    if (big) return big;
    const limited = await limit(`asset-upload:${actor.organizationId}`, 60, 3600);
    if (limited) return limited;

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return apiError(400, "invalid", "Geçersiz yükleme isteği.");
    }
    const file = form.get("file");
    if (!(file instanceof File)) return apiError(400, "invalid", "Dosya seçilmedi.");
    const result = await uploadAsset(templateDeps(), actor, {
      bytes: Buffer.from(await file.arrayBuffer()),
      filename: file.name,
    });
    return result.ok
      ? NextResponse.json({ id: result.id, url: result.url }, { status: 201 })
      : serviceFailure(result);
  });
}
