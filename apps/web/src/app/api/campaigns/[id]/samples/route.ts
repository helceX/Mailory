import { NextResponse } from "next/server";
import { z } from "zod";
import { limit, serviceFailure, withActor } from "@/lib/api";
import { campaignDeps } from "@/lib/campaigns/deps";
import { reviewSamplesFor } from "@/lib/campaigns/service";

export function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withActor(request, { write: false }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return serviceFailure({ code: "not_found" });
    const limited = await limit(`samples:${actor.organizationId}`, 60, 3600);
    if (limited) return limited;
    const result = await reviewSamplesFor(campaignDeps(), actor, id);
    return result.ok
      ? NextResponse.json({ samples: result.samples, problems: result.problems })
      : serviceFailure(result);
  });
}
