import { NextResponse } from "next/server";
import { z } from "zod";
import { serviceFailure, withActor } from "@/lib/api";
import { campaignDeps } from "@/lib/campaigns/deps";
import { duplicateCampaignFor } from "@/lib/campaigns/service";

export function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return serviceFailure({ code: "not_found" });
    const result = await duplicateCampaignFor(campaignDeps(), actor, id);
    return result.ok
      ? NextResponse.json({ id: result.id }, { status: 201 })
      : serviceFailure(result);
  });
}
