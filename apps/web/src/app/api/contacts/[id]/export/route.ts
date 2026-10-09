import { z } from "zod";
import { limit, serviceFailure, withActor } from "@/lib/api";
import { getDb } from "@/lib/db";
import { exportContactFor } from "@/lib/privacy/service";

export const dynamic = "force-dynamic";

/** Right of access: a JSON file with everything held about this person (audited, rate-limited). */
export function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withActor(request, { write: false }, async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return serviceFailure({ code: "not_found" });
    const limited = await limit(`contact-export:${actor.organizationId}`, 30, 3600);
    if (limited) return limited;
    const r = await exportContactFor({ db: getDb().db }, actor, id);
    if (!r.ok) return serviceFailure(r);
    return new Response(JSON.stringify(r.data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="kisi-verisi-${id.slice(0, 8)}.json"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
