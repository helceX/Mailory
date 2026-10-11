import { NextResponse } from "next/server";
import { createSegmentSchema } from "@mailory/validation";
import { parseJson, serviceFailure, withActor } from "@/lib/api";
import { audienceDeps } from "@/lib/audience/deps";
import { createSegmentFor, getSegments } from "@/lib/audience/service";

export function GET(request: Request) {
  return withActor(request, { write: false }, async ({ actor }) => {
    const result = await getSegments(audienceDeps(), actor);
    return result.ok
      ? NextResponse.json({ segments: result.segments })
      : serviceFailure(result);
  });
}

export function POST(request: Request) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const parsed = await parseJson(request, createSegmentSchema);
    if ("response" in parsed) return parsed.response;
    const result = await createSegmentFor(audienceDeps(), actor, parsed.data);
    return result.ok
      ? NextResponse.json({ id: result.id, count: result.count }, { status: 201 })
      : serviceFailure(result);
  });
}
