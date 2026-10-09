import { NextResponse } from "next/server";
import { customFieldSchema } from "@mailory/validation";
import { parseJson, serviceFailure, withActor } from "@/lib/api";
import { audienceDeps } from "@/lib/audience/deps";
import { createFieldFor, getFields } from "@/lib/audience/service";

export function GET(request: Request) {
  return withActor(request, { write: false }, async ({ actor }) => {
    const result = await getFields(audienceDeps(), actor);
    return result.ok
      ? NextResponse.json({ fields: result.fields })
      : serviceFailure(result);
  });
}

export function POST(request: Request) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const parsed = await parseJson(request, customFieldSchema);
    if ("response" in parsed) return parsed.response;
    const result = await createFieldFor(audienceDeps(), actor, parsed.data);
    return result.ok
      ? NextResponse.json({ id: result.id }, { status: 201 })
      : serviceFailure(result);
  });
}
