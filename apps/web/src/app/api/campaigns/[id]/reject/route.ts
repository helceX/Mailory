import { NextResponse } from "next/server";
import { z } from "zod";
import { rejectCampaignSchema } from "@mailory/validation";
import { parseJson, serviceFailure, withActor } from "@/lib/api";
import { campaignDeps } from "@/lib/campaigns/deps";
import { rejectCampaignFor } from "@/lib/campaigns/service";

export function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return serviceFailure({ code: "not_found" });
    const parsed = await parseJson(request, rejectCampaignSchema);
    if ("response" in parsed) return parsed.response;
    const result = await rejectCampaignFor(
      campaignDeps(),
      actor,
      id,
      parsed.data.reason,
    );
    return result.ok ? NextResponse.json({ ok: true }) : serviceFailure(result);
  });
}
