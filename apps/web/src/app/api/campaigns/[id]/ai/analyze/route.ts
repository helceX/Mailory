import { NextResponse } from "next/server";
import { z } from "zod";
import { limit, serviceFailure, withActor } from "@/lib/api";
import { aiDeps } from "@/lib/ai/deps";
import { analyzeCampaignFor } from "@/lib/ai/service";
export function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return serviceFailure({ code: "not_found" });
    const limited = await limit(`ai:${actor.organizationId}`, 10, 60);
    if (limited) return limited;
    const r = await analyzeCampaignFor(aiDeps(), actor, id);
    return r.ok ? NextResponse.json({ analysis: r.analysis }) : serviceFailure(r);
  });
}
