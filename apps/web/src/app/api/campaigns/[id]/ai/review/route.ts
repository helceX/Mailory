import { NextResponse } from "next/server";
import { z } from "zod";
import { limit, serviceFailure, withActor } from "@/lib/api";
import { aiDeps } from "@/lib/ai/deps";
import { campaignDeps } from "@/lib/campaigns/deps";
import { getCampaignFor } from "@/lib/campaigns/service";
import { reviewCampaignFor } from "@/lib/ai/service";
export function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return serviceFailure({ code: "not_found" });
    const limited = await limit(`ai:${actor.organizationId}`, 10, 60);
    if (limited) return limited;
    const health = await getCampaignFor(campaignDeps(), actor, id);
    const rules = health.ok ? health.health.findings.map((f) => f.message) : [];
    const r = await reviewCampaignFor(aiDeps(), actor, id, rules);
    return r.ok ? NextResponse.json({ review: r.review }) : serviceFailure(r);
  });
}
