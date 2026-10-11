import { NextResponse } from "next/server";
import { previewSegmentSchema } from "@mailory/validation";
import { limit, parseJson, serviceFailure, withActor } from "@/lib/api";
import { audienceDeps } from "@/lib/audience/deps";
import { previewSegment } from "@/lib/audience/service";

export function POST(request: Request) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const limited = await limit(`segment-preview:${actor.organizationId}`, 300, 3600);
    if (limited) return limited;
    const parsed = await parseJson(request, previewSegmentSchema);
    if ("response" in parsed) return parsed.response;
    const result = await previewSegment(audienceDeps(), actor, parsed.data.definition);
    return result.ok
      ? NextResponse.json({ count: result.count, sample: result.sample })
      : serviceFailure(result);
  });
}
