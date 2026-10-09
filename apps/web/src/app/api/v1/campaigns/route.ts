import { serviceFailure } from "@/lib/api";
import { apiJson, withApiKey } from "@/lib/api-v1";
import { campaignDto } from "@/lib/api-v1-dto";
import { campaignDeps } from "@/lib/campaigns/deps";
import { listCampaignsFor } from "@/lib/campaigns/service";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return withApiKey(request, "read", async ({ actor }) => {
    const status = new URL(request.url).searchParams.get("status") ?? undefined;
    const r = await listCampaignsFor(campaignDeps(), actor, { status });
    return r.ok
      ? apiJson({ data: r.campaigns.map((c) => campaignDto(c as never)) })
      : serviceFailure(r);
  });
}
