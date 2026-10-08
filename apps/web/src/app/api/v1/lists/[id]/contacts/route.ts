import { z } from "zod";
import { parseJson, serviceFailure } from "@/lib/api";
import { apiJson, withApiKey } from "@/lib/api-v1";
import { audienceDeps } from "@/lib/audience/deps";
import { bulkAction } from "@/lib/audience/service";

export const dynamic = "force-dynamic";

const body = z.object({ contactIds: z.array(z.uuid()).min(1).max(100) });

/** Adds up to 100 contacts to a list. Ids that do not belong to this workspace are simply not found. */
export function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiKey(request, "write", async ({ actor }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return serviceFailure({ code: "not_found" });
    const parsed = await parseJson(request, body);
    if ("response" in parsed) return parsed.response;
    const r = await bulkAction(audienceDeps(), actor, {
      action: "add_to_list",
      listId: id,
      ids: parsed.data.contactIds,
    });
    return r.ok ? apiJson({ added: r.affected }) : serviceFailure(r);
  });
}
