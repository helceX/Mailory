import { NextResponse } from "next/server";
import { importPreviewSchema } from "@mailory/validation";
import { limit, parseJson, serviceFailure, tooLarge, withActor } from "@/lib/api";
import { audienceDeps } from "@/lib/audience/deps";
import { previewImport } from "@/lib/audience/service";

export function POST(request: Request) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const big = tooLarge(request, 9_000_000);
    if (big) return big;
    const limited = await limit(`import-preview:${actor.organizationId}`, 60, 3600);
    if (limited) return limited;
    const parsed = await parseJson(request, importPreviewSchema);
    if ("response" in parsed) return parsed.response;
    const result = await previewImport(audienceDeps(), actor, parsed.data.csv);
    if (!result.ok) return serviceFailure(result);
    const { ok: _ok, ...preview } = result;
    return NextResponse.json(preview);
  });
}
