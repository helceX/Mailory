import { NextResponse } from "next/server";
import { campaignPolicySchema } from "@mailory/validation";
import { parseJson, serviceFailure, withActor } from "@/lib/api";
import { campaignDeps } from "@/lib/campaigns/deps";
import { getPolicyFor, setPolicyFor } from "@/lib/campaigns/service";

export function GET(request: Request) {
  return withActor(request, { write: false }, async ({ actor }) => {
    const result = await getPolicyFor(campaignDeps(), actor);
    return result.ok
      ? NextResponse.json({ requireApproval: result.requireApproval })
      : serviceFailure(result);
  });
}

export function PUT(request: Request) {
  return withActor(request, { write: true }, async ({ actor }) => {
    const parsed = await parseJson(request, campaignPolicySchema);
    if ("response" in parsed) return parsed.response;
    const result = await setPolicyFor(
      campaignDeps(),
      actor,
      parsed.data.requireApproval,
    );
    return result.ok
      ? NextResponse.json({ requireApproval: result.requireApproval })
      : serviceFailure(result);
  });
}
