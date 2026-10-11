import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, serviceFailure, withActor } from "@/lib/api";
import { audienceDeps } from "@/lib/audience/deps";
import { createTagFor, getTags } from "@/lib/audience/service";

const tagSchema = z.object({
  name: z.string().trim().min(1, "Etiket adı gerekli.").max(50),
});

export function GET(request: Request) {
  return withActor(request, { write: false }, async ({ actor }) => {
    const result = await getTags(audienceDeps(), actor);
    return result.ok
      ? NextResponse.json({ tags: result.tags })
      : serviceFailure(result);
  });
}

export function POST(request: Request) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const parsed = await parseJson(request, tagSchema);
    if ("response" in parsed) return parsed.response;
    const result = await createTagFor(audienceDeps(), actor, parsed.data.name);
    return result.ok
      ? NextResponse.json({ id: result.id }, { status: 201 })
      : serviceFailure(result);
  });
}
