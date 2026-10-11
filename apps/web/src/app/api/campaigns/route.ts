import { NextResponse } from "next/server";
import { createCampaignSchema } from "@mailory/validation";
import { parseJson, serviceFailure, withActor } from "@/lib/api";
import { campaignDeps } from "@/lib/campaigns/deps";
import { createCampaignFor, listCampaignsFor } from "@/lib/campaigns/service";

export function GET(request: Request) {
  return withActor(request, { write: false }, async ({ actor }) => {
    const status = new URL(request.url).searchParams.get("status") ?? undefined;
    const result = await listCampaignsFor(campaignDeps(), actor, { status });
    return result.ok
      ? NextResponse.json({ campaigns: result.campaigns })
      : serviceFailure(result);
  });
}

export function POST(request: Request) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const parsed = await parseJson(request, createCampaignSchema);
    if ("response" in parsed) return parsed.response;
    const result = await createCampaignFor(campaignDeps(), actor, parsed.data);
    return result.ok
      ? NextResponse.json({ id: result.id }, { status: 201 })
      : serviceFailure(result);
  });
}
