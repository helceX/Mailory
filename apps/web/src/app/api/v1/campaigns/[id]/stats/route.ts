import { z } from "zod";
import { serviceFailure } from "@/lib/api";
import { apiJson, withApiKey } from "@/lib/api-v1";
import { getDb } from "@/lib/db";
import { getCampaignReport } from "@/lib/analytics/service";

export const dynamic = "force-dynamic";

/** Aggregate numbers only (no per-contact data), in the same shape as the in-app report. */
export function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiKey(request, "read", async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return serviceFailure({ code: "not_found" });
    const r = await getCampaignReport({ db: getDb().db }, actor, id);
    return r.ok ? apiJson({ stats: r.stats, rates: r.rates }) : serviceFailure(r);
  });
}
