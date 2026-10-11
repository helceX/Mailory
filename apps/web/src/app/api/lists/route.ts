import { NextResponse } from "next/server";
import { nameSchema } from "@mailory/validation";
import { parseJson, serviceFailure, withActor } from "@/lib/api";
import { audienceDeps } from "@/lib/audience/deps";
import { createListFor, getLists } from "@/lib/audience/service";

export function GET(request: Request) {
  return withActor(request, { write: false }, async ({ actor }) => {
    const result = await getLists(audienceDeps(), actor);
    return result.ok
      ? NextResponse.json({ lists: result.lists })
      : serviceFailure(result);
  });
}

export function POST(request: Request) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const parsed = await parseJson(request, nameSchema);
    if ("response" in parsed) return parsed.response;
    const result = await createListFor(audienceDeps(), actor, parsed.data);
    return result.ok
      ? NextResponse.json({ id: result.id }, { status: 201 })
      : serviceFailure(result);
  });
}
