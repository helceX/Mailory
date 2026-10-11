import { getOrganization } from "@mailory/db";
import { apiJson, withApiKey } from "@/lib/api-v1";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Who am I? Lets an integrator confirm a key works and see its scope. */
export function GET(request: Request) {
  return withApiKey(request, "read", async ({ actor }) => {
    const org = await getOrganization(getDb().db, actor.organizationId);
    return apiJson({
      organization: { id: actor.organizationId, name: org?.name ?? null },
      scope: actor.role === "editor" ? "write" : "read",
    });
  });
}
