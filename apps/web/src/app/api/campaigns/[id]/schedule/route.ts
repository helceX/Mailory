import { NextResponse } from "next/server";
import { z } from "zod";
import { scheduleSchema } from "@mailory/validation";
import { parseJson, serviceFailure, withActor } from "@/lib/api";
import { campaignDeps } from "@/lib/campaigns/deps";
import { scheduleCampaignFor } from "@/lib/campaigns/service";

export function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return serviceFailure({ code: "not_found" });
    const parsed = await parseJson(request, scheduleSchema);
    if ("response" in parsed) return parsed.response;
    const result = await scheduleCampaignFor(
      campaignDeps(),
      actor,
      id,
      parsed.data.sendAt,
    );
    return result.ok
      ? NextResponse.json({ status: result.campaign.status })
      : serviceFailure(result);
  });
}
