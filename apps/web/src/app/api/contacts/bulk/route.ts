import { NextResponse } from "next/server";
import { bulkActionSchema } from "@mailory/validation";
import { limit, parseJson, serviceFailure, withActor } from "@/lib/api";
import { audienceDeps } from "@/lib/audience/deps";
import { bulkAction } from "@/lib/audience/service";

export function POST(request: Request) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const limited = await limit(`bulk:${actor.organizationId}`, 60, 3600);
    if (limited) return limited;
    const parsed = await parseJson(request, bulkActionSchema);
    if ("response" in parsed) return parsed.response;
    const result = await bulkAction(audienceDeps(), actor, parsed.data);
    return result.ok
      ? NextResponse.json({ affected: result.affected })
      : serviceFailure(result);
  });
}
