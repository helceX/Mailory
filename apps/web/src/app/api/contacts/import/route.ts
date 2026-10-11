import { NextResponse } from "next/server";
import { importRunSchema } from "@mailory/validation";
import { limit, parseJson, serviceFailure, tooLarge, withActor } from "@/lib/api";
import { audienceDeps } from "@/lib/audience/deps";
import { recentImports, runImport } from "@/lib/audience/service";

// An import of the maximum size takes a few seconds; allow the platform to wait for it.
export const maxDuration = 120;

export function GET(request: Request) {
  return withActor(request, { write: false }, async ({ actor }) => {
    const result = await recentImports(audienceDeps(), actor);
    return result.ok
      ? NextResponse.json({ jobs: result.jobs })
      : serviceFailure(result);
  });
}

export function POST(request: Request) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const big = tooLarge(request, 9_000_000);
    if (big) return big;
    const limited = await limit(`import:${actor.organizationId}`, 20, 3600);
    if (limited) return limited;
    const parsed = await parseJson(request, importRunSchema);
    if ("response" in parsed) return parsed.response;
    const result = await runImport(audienceDeps(), actor, parsed.data);
    if (!result.ok) return serviceFailure(result);
    const { ok: _ok, ...summary } = result;
    return NextResponse.json(summary);
  });
}
