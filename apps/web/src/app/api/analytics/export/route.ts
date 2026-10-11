import { limit, serviceFailure, withActor } from "@/lib/api";
import { getDb } from "@/lib/db";
import { exportAnalyticsCsv } from "@/lib/analytics/service";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return withActor(request, { write: false }, async ({ actor }) => {
    const limited = await limit(`analytics-export:${actor.organizationId}`, 20, 3600);
    if (limited) return limited;
    const result = await exportAnalyticsCsv({ db: getDb().db }, actor);
    if (!result.ok) return serviceFailure(result);
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(result.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="mailory-campaigns-${stamp}.csv"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
