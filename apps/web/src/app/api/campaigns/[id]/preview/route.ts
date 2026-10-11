import { NextResponse } from "next/server";
import { z } from "zod";
import { serviceFailure, withActor } from "@/lib/api";
import { campaignDeps } from "@/lib/campaigns/deps";
import { previewCampaignFor } from "@/lib/campaigns/service";

export function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withActor(request, { write: false }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return serviceFailure({ code: "not_found" });
    const result = await previewCampaignFor(campaignDeps(), actor, id);
    return result.ok
      ? NextResponse.json({
          subject: result.subject,
          html: result.html,
          text: result.text,
        })
      : serviceFailure(result);
  });
}
