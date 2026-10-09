import { NextResponse } from "next/server";
import { z } from "zod";
import { testSendSchema } from "@mailory/validation";
import { limit, parseJson, serviceFailure, withActor } from "@/lib/api";
import { campaignDeps } from "@/lib/campaigns/deps";
import { sendTestFor } from "@/lib/campaigns/service";

export function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return serviceFailure({ code: "not_found" });
    const limited = await limit(`campaign-test:${actor.organizationId}`, 20, 3600);
    if (limited) return limited;
    const parsed = await parseJson(request, testSendSchema);
    if ("response" in parsed) return parsed.response;
    const result = await sendTestFor(campaignDeps(), actor, id, parsed.data.recipients);
    return result.ok
      ? NextResponse.json({ sent: result.sent })
      : serviceFailure(result);
  });
}
